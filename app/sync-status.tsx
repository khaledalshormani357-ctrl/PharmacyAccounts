import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { getSyncOutboxStatus } from '@/services/supabase-sync-outbox';

type QueueStatus = { pending: number; exhausted: number };

export default function SyncStatusScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [status, setStatus] = useState<QueueStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      setStatus(await getSyncOutboxStatus());
    } catch {
      setError('تعذر قراءة قائمة النقل المحلية. قد تكون بيانات القائمة غير صالحة.');
      setStatus(null);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const colors = theme.colors;
  const panel = { backgroundColor: colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.divider };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ backgroundColor: colors.primary, paddingTop: insets.top + 12, paddingBottom: 18, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center' }}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="رجوع" onPress={() => router.back()} style={{ padding: 8 }}>
          <MaterialIcons name="arrow-forward" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '800', textAlign: 'right' }}>حالة المزامنة</Text>
          <Text style={{ color: '#DCE8FF', fontSize: 12, textAlign: 'right', marginTop: 4 }}>تشخيص قائمة النقل على هذا الجهاز</Text>
        </View>
        <MaterialIcons name="sync" size={26} color="#FFFFFF" />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        <View style={{ ...panel, borderColor: '#D97706' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
            <MaterialIcons name="info-outline" size={22} color="#D97706" />
            <Text style={{ flex: 1, color: colors.textPrimary, fontSize: 15, fontWeight: '800', textAlign: 'right', marginRight: 8 }}>تنبيه مهم</Text>
          </View>
          <Text style={{ color: colors.textPrimary, fontSize: 13, lineHeight: 21, textAlign: 'right' }}>
            هذه الشاشة تعرض قائمة أحداث النقل المحلية فقط. رفع الأحداث إلى Supabase غير مكتمل الربط بالعمليات التجارية، ولا يوجد حتى الآن سحب للتغييرات أو تسوية تعارضات. لذلك لا تعتبر الأرقام هنا دليلًا على أن المبيعات أو المخزون أو الأرصدة متزامنة بين الأجهزة.
          </Text>
        </View>

        <View style={panel}>
          <Text style={{ color: colors.textPrimary, fontSize: 15, fontWeight: '800', textAlign: 'right', marginBottom: 14 }}>قائمة النقل المحلية</Text>
          {refreshing && !status ? <ActivityIndicator color={colors.primary} /> : null}
          {status ? (
            <>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1, backgroundColor: colors.background, borderRadius: 12, padding: 14, alignItems: 'center' }}>
                  <Text style={{ color: colors.textTertiary, fontSize: 12 }}>بانتظار المعالجة</Text>
                  <Text style={{ color: colors.textPrimary, fontSize: 28, fontWeight: '800', marginTop: 5 }}>{status.pending}</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: colors.background, borderRadius: 12, padding: 14, alignItems: 'center' }}>
                  <Text style={{ color: colors.textTertiary, fontSize: 12 }}>تجاوزت حد المحاولات</Text>
                  <Text style={{ color: status.exhausted ? '#C62828' : colors.textPrimary, fontSize: 28, fontWeight: '800', marginTop: 5 }}>{status.exhausted}</Text>
                </View>
              </View>
              <Text style={{ color: colors.textTertiary, fontSize: 12, textAlign: 'right', marginTop: 12 }}>
                لا تشمل هذه الأعداد السجلات التشغيلية المحلية التي لم تُحوّل بعد إلى أحداث نقل.
              </Text>
            </>
          ) : null}
          {error ? <Text style={{ color: '#C62828', textAlign: 'right', marginTop: 10 }}>{error}</Text> : null}
          <TouchableOpacity accessibilityRole="button" onPress={() => void refresh()} disabled={refreshing} style={{ marginTop: 16, backgroundColor: colors.primary, padding: 13, borderRadius: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, opacity: refreshing ? 0.6 : 1 }}>
            <MaterialIcons name="refresh" size={18} color="#FFFFFF" />
            <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>{refreshing ? 'جارٍ التحديث…' : 'تحديث الحالة'}</Text>
          </TouchableOpacity>
        </View>

        <View style={panel}>
          <Text style={{ color: colors.textPrimary, fontSize: 15, fontWeight: '800', textAlign: 'right', marginBottom: 8 }}>ما الذي ينقص لإكمال المزامنة؟</Text>
          {[
            'ربط كل عملية بيع وشراء ومخزون بقيد محلي موثوق داخل معاملة واحدة.',
            'إنشاء جداول تشغيلية وسياسات RLS واختبارها في بيئة تجريبية.',
            'تنفيذ معالجة خادمية ذرية للمبيعات والمخزون والمرتجعات.',
            'سحب التغييرات البعيدة ومعالجة التعارضات واختبار جهازين فعليًا.'
          ].map((item, index) => (
            <View key={item} style={{ flexDirection: 'row', alignItems: 'flex-start', marginTop: 10 }}>
              <Text style={{ color: colors.textTertiary, fontSize: 13, marginLeft: 8 }}>{index + 1}.</Text>
              <Text style={{ flex: 1, color: colors.textPrimary, fontSize: 13, lineHeight: 20, textAlign: 'right' }}>{item}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
