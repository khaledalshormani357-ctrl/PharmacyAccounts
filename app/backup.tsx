// Smart Pharmacy ERP — Backup & Restore Screen
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, Share } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { createBackup, restoreBackup } from '@/services/database';
import { useAlert } from '@/template';

export default function BackupScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showAlert } = useAlert();
  const [backupJson, setBackupJson] = useState('');
  const [lastBackupTime, setLastBackupTime] = useState('');

  const handleBackup = () => {
    try {
      const data = createBackup();
      const json = JSON.stringify(data, null, 2);
      setBackupJson(json);
      setLastBackupTime(new Date().toLocaleString('ar-SA'));
      Share.share({
        title: `نسخة احتياطية — ${data.pharmacy_name}`,
        message: json,
      });
    } catch (e: any) {
      showAlert('خطأ', e?.message || 'فشل إنشاء النسخة الاحتياطية');
    }
  };

  const handleRestore = () => {
    if (!backupJson.trim()) {
      showAlert('تنبيه', 'لصق بيانات النسخة الاحتياطية هنا غير متاح حالياً. استخدم خاصية المشاركة لحفظ النسخة.');
      return;
    }
    showAlert('استعادة البيانات', 'سيتم استبدال جميع البيانات الحالية. هل أنت متأكد؟', [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'استعادة',
        style: 'destructive',
        onPress: () => {
          try {
            const data = JSON.parse(backupJson);
            const result = restoreBackup(data);
            if (result.success) {
              showAlert('تم', 'تمت استعادة البيانات بنجاح');
            } else {
              showAlert('خطأ', result.error || 'فشلت الاستعادة');
            }
          } catch (e) {
            showAlert('خطأ', 'البيانات غير صالحة');
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
        {/* Info */}
        <View style={{ backgroundColor: theme.colors.infoLight, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: theme.colors.info + '30' }}>
          <Text style={{ fontSize: 13, color: theme.colors.info, textAlign: 'right', lineHeight: 20 }}>
            النسخ الاحتياطي يشمل جميع بيانات الصيدلية: الأصناف، المخزون، الدفعات، المبيعات، المشتريات، العملاء، الموردين، والمصروفات.
          </Text>
        </View>

        {/* Create Backup */}
        <View style={{ backgroundColor: theme.colors.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, padding: 16 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: theme.colors.textPrimary, textAlign: 'right', marginBottom: 10 }}>إنشاء نسخة احتياطية</Text>
          {lastBackupTime ? (
            <Text style={{ fontSize: 12, color: theme.colors.success, textAlign: 'right', marginBottom: 10 }}>
              آخر نسخة: {lastBackupTime}
            </Text>
          ) : null}
          <Text style={{ fontSize: 12, color: theme.colors.textTertiary, textAlign: 'right', marginBottom: 14 }}>
            سيتم إنشاء ملف JSON يمكن حفظه أو مشاركته عبر البريد الإلكتروني أو التخزين السحابي.
          </Text>
          <TouchableOpacity
            onPress={handleBackup}
            style={{ height: 52, backgroundColor: '#00875A', borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            <MaterialIcons name="backup" size={22} color="#FFFFFF" />
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#FFFFFF' }}>إنشاء ومشاركة النسخة</Text>
          </TouchableOpacity>
        </View>

        {/* Restore */}
        <View style={{ backgroundColor: theme.colors.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, padding: 16 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: theme.colors.textPrimary, textAlign: 'right', marginBottom: 8 }}>استعادة نسخة احتياطية</Text>
          <View style={{ backgroundColor: theme.colors.warningLight, borderRadius: 8, padding: 10, marginBottom: 14 }}>
            <Text style={{ fontSize: 12, color: theme.colors.warning, textAlign: 'right' }}>
              ⚠️ الاستعادة ستستبدل جميع البيانات الحالية. تأكد من إنشاء نسخة احتياطية أولاً.
            </Text>
          </View>
          <Text style={{ fontSize: 12, color: theme.colors.textTertiary, textAlign: 'right', marginBottom: 14 }}>
            لاستعادة البيانات، قم بتحميل ملف النسخة الاحتياطية واستخدمه هنا.
          </Text>
          <TouchableOpacity
            onPress={handleRestore}
            style={{ height: 52, backgroundColor: theme.colors.error, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: 0.9 }}
          >
            <MaterialIcons name="restore" size={22} color="#FFFFFF" />
            <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF' }}>استعادة البيانات</Text>
          </TouchableOpacity>
        </View>

        {/* Security Note */}
        <View style={{ backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, padding: 14 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.textPrimary, textAlign: 'right', marginBottom: 8 }}>ملاحظات أمنية</Text>
          {[
            'النسخة الاحتياطية تحتوي على بيانات تجارية حساسة',
            'احفظها في مكان آمن ومشفر',
            'لا تشارك النسخة مع أشخاص غير مصرح لهم',
            'انشئ نسخة احتياطية يومياً في نهاية الدوام',
          ].map((note, i) => (
            <Text key={i} style={{ fontSize: 12, color: theme.colors.textSecondary, textAlign: 'right', marginBottom: 4 }}>• {note}</Text>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
