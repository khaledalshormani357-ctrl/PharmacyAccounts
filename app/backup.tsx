// Smart Pharmacy ERP — Backup & Restore Screen
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Share } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { useTheme } from '@/contexts/ThemeContext';
import { createBackup, restoreBackup } from '@/services/database';
import { useAlert } from '@/template';

const REQUIRED_COLLECTIONS = [
  'products', 'productUnits', 'batches', 'stockMovements', 'customers', 'suppliers',
  'sales', 'saleItems', 'saleBatchAllocations', 'saleReturns', 'purchases',
  'purchaseItems', 'purchaseReturns', 'expenses', 'cashTransactions', 'shifts',
  'customerTransactions', 'supplierTransactions', 'auditLogs',
] as const;

function validateBackupFile(value: unknown): value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Record<string, any>;
  if (typeof data.schema_version !== 'string' || !data.schema_version.trim()) return false;
  if (data.settings !== undefined && (
    !data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings) ||
    Object.values(data.settings).some(item => typeof item !== 'string')
  )) return false;
  return REQUIRED_COLLECTIONS.every(key =>
    Array.isArray(data[key]) && data[key].every((row: unknown) =>
      !!row && typeof row === 'object' && !Array.isArray(row)
    )
  );
}

export default function BackupScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showAlert } = useAlert();
  const [backupJson, setBackupJson] = useState('');
  const [selectedBackupName, setSelectedBackupName] = useState('');
  const [lastBackupTime, setLastBackupTime] = useState('');

  const handleBackup = async () => {
    try {
      const data = createBackup();
      const json = JSON.stringify(data, null, 2);
      setBackupJson(json);
      setSelectedBackupName('');
      setLastBackupTime(new Date().toLocaleString('ar-SA'));
      await Share.share({
        title: `نسخة احتياطية — ${data.pharmacy_name || data.settings?.pharmacy_name || 'الصيدلية'}`,
        message: json,
      });
    } catch (e: any) {
      showAlert('خطأ', e?.message || 'فشل إنشاء النسخة الاحتياطية');
    }
  };

  const handleSelectBackup = async () => {
    try {
      const selection = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (selection.canceled || !selection.assets?.length) return;

      const file = selection.assets[0];
      if (typeof file.size === 'number' && file.size > 25 * 1024 * 1024) {
        showAlert('حجم الملف كبير', 'اختر نسخة احتياطية لا يتجاوز حجمها 25 ميغابايت.');
        return;
      }

      const raw = await FileSystem.readAsStringAsync(file.uri);
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        showAlert('ملف غير صالح', 'تعذر قراءة الملف كبيانات JSON. اختر ملف النسخة الاحتياطية الأصلي.');
        return;
      }

      if (!validateBackupFile(parsed)) {
        showAlert('نسخة غير مكتملة', 'بنية الملف لا تطابق نسخة صيدليتي الاحتياطية أو أن بعض الجداول المطلوبة مفقودة. لم يتم تغيير أي بيانات.');
        return;
      }

      setBackupJson(JSON.stringify(parsed));
      setSelectedBackupName(file.name || 'backup.json');
      showAlert('تم فحص الملف', 'بنية النسخة تبدو سليمة. لم تُستعد البيانات بعد؛ اضغط «استعادة البيانات» للمتابعة بعد التأكد من إنشاء نسخة من بياناتك الحالية.');
    } catch (e: any) {
      showAlert('تعذر فتح الملف', e?.message || 'لم نتمكن من قراءة ملف النسخة الاحتياطية.');
    }
  };

  const handleRestore = () => {
    if (!backupJson.trim() || !selectedBackupName) {
      showAlert('اختر ملف النسخة أولاً', 'اضغط «اختيار ملف النسخة» وحدد ملف JSON صالحاً قبل بدء الاستعادة.');
      return;
    }
    showAlert('استعادة البيانات', `سيتم استبدال بيانات الصيدلية الحالية بمحتويات «${selectedBackupName}». يُنصح بإنشاء نسخة احتياطية من الجهاز الحالي أولاً. هل تريد المتابعة؟`, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'استعادة', style: 'destructive',
        onPress: async () => {
          try {
            const data = JSON.parse(backupJson);
            if (!validateBackupFile(data)) {
              showAlert('نسخة غير صالحة', 'فشل التحقق من بنية النسخة؛ لم يتم استبدال البيانات.');
              return;
            }
            const result = await restoreBackup(data);
            if (result.success) {
              setBackupJson('');
              setSelectedBackupName('');
              showAlert('تمت الاستعادة', 'اكتملت استعادة النسخة وحفظ البيانات. إعداد PIN المحلي لهذا الجهاز لا يتم استبداله بالنسخة.');
            } else {
              showAlert('فشلت الاستعادة', result.error || 'لم يتم اعتماد التغييرات. تحقق من الملف ومساحة التخزين ثم حاول مجدداً.');
            }
          } catch (e: any) {
            showAlert('فشلت الاستعادة', e?.message || 'البيانات غير صالحة أو تعذر حفظها.');
          }
        },
      },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ backgroundColor: '#00875A', paddingTop: insets.top + 10, paddingBottom: 14, paddingHorizontal: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <TouchableOpacity onPress={() => router.back()} style={{ width: 34, height: 34, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
            <MaterialIcons name="arrow-forward" size={20} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF' }}>النسخ الاحتياطي</Text>
          <View style={{ width: 34 }} />
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
        <View style={{ backgroundColor: theme.colors.infoLight, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: theme.colors.info + '30' }}>
          <Text style={{ fontSize: 13, color: theme.colors.info, textAlign: 'right', lineHeight: 20 }}>
            النسخ الاحتياطي يشمل بيانات الصيدلية: الأصناف، المخزون، الدفعات، المبيعات، المشتريات، العملاء، الموردين، والمصروفات. احتفظ بالملف في مكان آمن.
          </Text>
        </View>

        <View style={{ backgroundColor: theme.colors.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, padding: 16 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: theme.colors.textPrimary, textAlign: 'right', marginBottom: 10 }}>إنشاء نسخة احتياطية</Text>
          {lastBackupTime ? <Text style={{ fontSize: 12, color: theme.colors.success, textAlign: 'right', marginBottom: 10 }}>آخر نسخة: {lastBackupTime}</Text> : null}
          <Text style={{ fontSize: 12, color: theme.colors.textTertiary, textAlign: 'right', marginBottom: 14 }}>
            أنشئ نسخة JSON وشاركها لحفظها في موقع آمن أو نقلها إلى جهاز آخر.
          </Text>
          <TouchableOpacity onPress={handleBackup} style={{ height: 52, backgroundColor: '#00875A', borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <MaterialIcons name="backup" size={22} color="#FFFFFF" />
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#FFFFFF' }}>إنشاء ومشاركة النسخة</Text>
          </TouchableOpacity>
        </View>

        <View style={{ backgroundColor: theme.colors.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, padding: 16 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: theme.colors.textPrimary, textAlign: 'right', marginBottom: 8 }}>استعادة نسخة احتياطية من ملف</Text>
          <View style={{ backgroundColor: theme.colors.warningLight, borderRadius: 8, padding: 10, marginBottom: 14 }}>
            <Text style={{ fontSize: 12, color: theme.colors.warning, textAlign: 'right', lineHeight: 19 }}>
              ⚠️ الاستعادة تستبدل بيانات العمل الحالية. أنشئ نسخة احتياطية حديثة قبل المتابعة.
            </Text>
          </View>
          <Text style={{ fontSize: 12, color: theme.colors.textTertiary, textAlign: 'right', marginBottom: 12 }}>
            اختر ملف JSON، وسيتم التحقق من بنيته أولاً. لن تُستبدل البيانات إلا بعد ضغط زر الاستعادة وتأكيد العملية.
          </Text>
          <TouchableOpacity onPress={handleSelectBackup} style={{ height: 48, backgroundColor: theme.colors.info, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 10 }}>
            <MaterialIcons name="folder-open" size={21} color="#FFFFFF" />
            <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF' }}>اختيار ملف النسخة</Text>
          </TouchableOpacity>
          {selectedBackupName ? (
            <View style={{ backgroundColor: theme.colors.infoLight, borderRadius: 8, padding: 10, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <MaterialIcons name="description" size={20} color={theme.colors.info} />
              <Text numberOfLines={2} style={{ flex: 1, fontSize: 12, color: theme.colors.textPrimary, textAlign: 'right' }}>الملف المحدد: {selectedBackupName}</Text>
              <MaterialIcons name="check-circle" size={20} color={theme.colors.success} />
            </View>
          ) : null}
          <TouchableOpacity onPress={handleRestore} disabled={!selectedBackupName} style={{ height: 52, backgroundColor: selectedBackupName ? theme.colors.error : theme.colors.border, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: selectedBackupName ? 0.95 : 0.7 }}>
            <MaterialIcons name="restore" size={22} color="#FFFFFF" />
            <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF' }}>استعادة البيانات</Text>
          </TouchableOpacity>
        </View>

        <View style={{ backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, padding: 14 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.textPrimary, textAlign: 'right', marginBottom: 8 }}>ملاحظات أمنية</Text>
          {[
            'النسخة الاحتياطية تحتوي على بيانات تجارية حساسة',
            'احفظ الملف في مكان آمن، ولا تشاركه مع أشخاص غير مصرح لهم',
            'أنشئ نسخة احتياطية يومياً في نهاية الدوام',
            'يتم الاحتفاظ برمز PIN المحلي للجهاز المستقبِل وعدم استبداله من الملف',
          ].map((note, i) => <Text key={i} style={{ fontSize: 12, color: theme.colors.textSecondary, textAlign: 'right', marginBottom: 4 }}>• {note}</Text>)}
        </View>
      </ScrollView>
    </View>
  );
}
