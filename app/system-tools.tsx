import React, { useCallback, useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Network from 'expo-network';
import { useTheme } from '@/contexts/ThemeContext';
import { inspectAndRepairDatabase, DatabaseIntegrityReport } from '@/services/database';
import { useAlert } from '@/template';

export default function SystemToolsScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showAlert } = useAlert();
  const [report, setReport] = useState<DatabaseIntegrityReport | null>(null);
  const [ipAddress, setIpAddress] = useState('');
  const [checking, setChecking] = useState(false);
  const colors = theme.colors;

  const loadNetwork = useCallback(async () => {
    try {
      const state = await Network.getNetworkStateAsync();
      const ip = await Network.getIpAddressAsync();
      setIpAddress(state.isConnected && state.type === Network.NetworkStateType.WIFI ? ip : 'غير متصل بشبكة Wi-Fi');
    } catch {
      setIpAddress('تعذر قراءة عنوان الشبكة');
    }
  }, []);

  useFocusEffect(useCallback(() => { void loadNetwork(); }, [loadNetwork]));

  const runCheck = async (repair = false) => {
    setChecking(true);
    try {
      const next = inspectAndRepairDatabase(repair);
      setReport(next);
      if (repair) showAlert('اكتمل الفحص والإصلاح الآمن', next.repaired
        ? 'تم تصحيح ' + next.repaired + ' حالة مخزون مشتقة. لم تُحذف سجلات ولم تتغير كميات أو فواتير.'
        : 'لم تكن هناك حالات آمنة تحتاج إلى تصحيح. راجع قائمة الملاحظات أدناه.');
    } catch (error: any) {
      showAlert('تعذر فحص البيانات', error?.message || 'حدث خطأ أثناء فحص قاعدة البيانات المحلية.');
    } finally {
      setChecking(false);
    }
  };

  const requestRepair = () => showAlert('الإصلاح الآمن', 'سيتم تصحيح حالات الدفعات المشتقة فقط: الدفعة ذات الرصيد الصفري تُعلّم كمنتهية، والدفعة النشطة ذات الصلاحية المنقضية تُعلّم كمنتهية الصلاحية. لن تُحذف أي بيانات ولن تتغير الكميات أو الفواتير. هل تريد المتابعة؟', [
    { text: 'إلغاء', style: 'cancel' },
    { text: 'فحص وإصلاح', onPress: () => { void runCheck(true); } },
  ]);

  const card = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, marginBottom: 12 };
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
      <View style={{ backgroundColor: colors.primary, padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <TouchableOpacity onPress={() => router.back()}><MaterialIcons name="arrow-forward" size={23} color="#FFFFFF" /></TouchableOpacity>
        <Text style={{ color: '#FFFFFF', fontSize: 17, fontWeight: '800' }}>أدوات النظام وسلامة البيانات</Text>
        <MaterialIcons name="build-circle" size={23} color="#FFFFFF" />
      </View>
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 36 }}>
        <View style={card}>
          <Text style={{ color: colors.textPrimary, textAlign: 'right', fontWeight: '800', fontSize: 15 }}>فحص قاعدة البيانات المحلية</Text>
          <Text style={{ color: colors.textSecondary, textAlign: 'right', lineHeight: 21, marginTop: 6, marginBottom: 12 }}>يفحص مراجع الأصناف والدفعات وحركات المخزون ووحدات التحويل وأسماء المستخدمين. الإصلاح لا يحذف سجلات ولا يعدّل كميات أو فواتير.</Text>
          <TouchableOpacity disabled={checking} onPress={() => { void runCheck(false); }} style={{ backgroundColor: colors.primary, padding: 13, borderRadius: 9, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, opacity: checking ? 0.6 : 1 }}>
            {checking ? <ActivityIndicator color="#FFFFFF" /> : <MaterialIcons name="fact-check" size={20} color="#FFFFFF" />}
            <Text style={{ color: '#FFFFFF', fontWeight: '800' }}>فحص قاعدة البيانات</Text>
          </TouchableOpacity>
          {report ? <>
            <Text style={{ color: colors.textTertiary, textAlign: 'right', fontSize: 11, marginTop: 10 }}>وقت الفحص: {new Date(report.checked_at).toLocaleString()}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 10 }}>
              {Object.entries(report.counts).map(([label, value]) => <View key={label} style={{ backgroundColor: colors.surfaceAlt, borderRadius: 8, padding: 8, minWidth: '30%' }}><Text style={{ color: colors.textTertiary, fontSize: 10, textAlign: 'right' }}>{label}</Text><Text style={{ color: colors.textPrimary, fontWeight: '800', textAlign: 'right' }}>{value}</Text></View>)}
            </View>
            <Text style={{ color: colors.textPrimary, textAlign: 'right', fontWeight: '800', marginTop: 14, marginBottom: 6 }}>نتيجة الفحص: {report.issues.length ? report.issues.length + ' ملاحظة' : 'لا توجد ملاحظات مكتشفة'}</Text>
            {report.issues.map(issue => <View key={issue.code} style={{ borderTopWidth: 1, borderTopColor: colors.divider, paddingVertical: 9 }}>
              <Text style={{ color: issue.severity === 'error' ? colors.error : colors.warning, textAlign: 'right', fontWeight: '700' }}>{issue.message} — {issue.count}</Text>
            </View>)}
            <TouchableOpacity disabled={checking} onPress={requestRepair} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.primary, padding: 12, borderRadius: 9, alignItems: 'center', marginTop: 12 }}>
              <Text style={{ color: colors.primary, fontWeight: '800' }}>الإصلاح التلقائي الآمن</Text>
            </TouchableOpacity>
          </> : null}
        </View>
        <View style={card}>
          <Text style={{ color: colors.textPrimary, textAlign: 'right', fontWeight: '800', fontSize: 15 }}>النسخ والنقل بين الهواتف</Text>
          <Text style={{ color: colors.textSecondary, textAlign: 'right', lineHeight: 21, marginTop: 6 }}>يمكنك إنشاء نسخة JSON ومشاركتها من قائمة أندرويد عبر Bluetooth أو WhatsApp أو Nearby Share، ثم استيرادها من شاشة النسخ الاحتياطي على الهاتف الآخر.</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginTop: 10, gap: 8 }}>
            <Text style={{ color: colors.textSecondary, textAlign: 'right', flex: 1 }}>عنوان Wi-Fi لهذا الجهاز: {ipAddress || 'جارٍ الفحص…'}</Text>
            <MaterialIcons name="wifi" size={22} color={colors.primary} />
          </View>
          <TouchableOpacity onPress={() => router.push('/backup')} style={{ backgroundColor: colors.primary, borderRadius: 9, padding: 13, alignItems: 'center', marginTop: 12 }}>
            <Text style={{ color: '#FFFFFF', fontWeight: '800' }}>فتح النسخ الاحتياطي والاستعادة</Text>
          </TouchableOpacity>
          <Text style={{ color: colors.textTertiary, textAlign: 'right', fontSize: 11, lineHeight: 17, marginTop: 8 }}>ملاحظة: هذا الإصدار يعرض عنوان الشبكة ويوفر نقل الملف عبر تطبيقات المشاركة؛ لم يتم إنشاء خادم استقبال مباشر على الشبكة المحلية بعد.</Text>
        </View>
        <View style={card}>
          <Text style={{ color: colors.textPrimary, textAlign: 'right', fontWeight: '800', fontSize: 15 }}>إعدادات الهوية والطباعة</Text>
          <Text style={{ color: colors.textSecondary, textAlign: 'right', lineHeight: 21, marginTop: 6, marginBottom: 10 }}>اسم الصيدلية والشعار والهاتف والعنوان ونصوص الفواتير موجودة في الإعدادات. الطباعة المحلية تعتمد على قالب المستند وخيارات أندرويد المتاحة.</Text>
          <TouchableOpacity onPress={() => router.push('/settings')} style={{ borderWidth: 1, borderColor: colors.primary, borderRadius: 9, padding: 12, alignItems: 'center' }}>
            <Text style={{ color: colors.primary, fontWeight: '800' }}>فتح إعدادات الصيدلية</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}
