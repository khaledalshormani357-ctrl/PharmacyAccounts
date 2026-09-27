// Smart Pharmacy ERP — More Screen (navigation hub)
import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { getSetting, getCashBalance } from '@/services/database';
import { formatCurrency } from '@/constants/i18n';

interface MenuItemProps {
  icon: any; label: string; sublabel?: string; color?: string; onPress: () => void; badge?: string;
}
function MenuItem({ icon, label, sublabel, color, onPress, badge }: MenuItemProps) {
  const { theme } = useTheme();
  const c = color || theme.colors.primary;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}
      style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}
    >
      <MaterialIcons name="chevron-left" size={16} color={theme.colors.textTertiary} style={{ marginLeft: 4 }} />
      <View style={{ flex: 1, marginHorizontal: 12 }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: theme.colors.textPrimary, textAlign: 'right' }}>{label}</Text>
        {sublabel ? <Text style={{ fontSize: 12, color: theme.colors.textTertiary, textAlign: 'right', marginTop: 1 }}>{sublabel}</Text> : null}
      </View>
      {badge ? (
        <View style={{ backgroundColor: c + '18', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginLeft: 8 }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: c }}>{badge}</Text>
        </View>
      ) : null}
      <View style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: c + '18', alignItems: 'center', justifyContent: 'center' }}>
        <MaterialIcons name={icon} size={20} color={c} />
      </View>
    </TouchableOpacity>
  );
}

interface SectionProps { title: string; children: React.ReactNode; }
function Section({ title, children }: SectionProps) {
  const { theme } = useTheme();
  return (
    <View style={{ marginBottom: 8 }}>
      <Text style={{ fontSize: 11, fontWeight: '600', color: theme.colors.textTertiary, textAlign: 'right', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: theme.colors.background }}>
        {title}
      </Text>
      <View style={{ backgroundColor: theme.colors.surface }}>{children}</View>
    </View>
  );
}

export default function MoreScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pharmacyName = getSetting('pharmacy_name') || 'صيدلية ذكية';
  const cashBalance = getCashBalance();

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {/* Header */}
      <View style={{ backgroundColor: theme.colors.primary, paddingTop: insets.top + 12, paddingBottom: 16, paddingHorizontal: 16 }}>
        <Text style={{ fontSize: 18, fontWeight: '800', color: '#FFFFFF', textAlign: 'right' }}>{pharmacyName}</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: cashBalance >= 0 ? '#AAFFCC' : '#FFAAAA' }}>{formatCurrency(cashBalance)}</Text>
          <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>رصيد الصندوق</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>
        <Section title="المخزون والمنتجات">
          <MenuItem icon="inventory-2" label="المخزون" sublabel="إدارة الأصناف والكميات" color="#00B8D9" onPress={() => router.push('/inventory')} />
          <MenuItem icon="medication" label="الأصناف" sublabel="إضافة وتعديل الأدوية" color="#00B8D9" onPress={() => router.push('/add-product')} />
          <MenuItem icon="schedule" label="رادار انتهاء الصلاحية" color="#FF8B00" onPress={() => router.push('/expiry-radar')} />
          <MenuItem icon="trending-down" label="المخزون الراكد" color="#6554C0" onPress={() => router.push('/dead-stock')} />
          <MenuItem icon="refresh" label="مقترحات إعادة الطلب" color="#0052CC" onPress={() => router.push('/reorder')} />
          <MenuItem icon="analytics" label="تحليل ABC" color="#6554C0" onPress={() => router.push('/abc-analysis')} />
        </Section>

        <Section title="العمليات المالية">
          <MenuItem icon="people" label="العملاء" sublabel="إدارة الحسابات والديون" color="#0052CC" onPress={() => router.push('/customers')} />
          <MenuItem icon="local-shipping" label="الموردون" sublabel="إدارة المشتريات والمدفوعات" color="#6554C0" onPress={() => router.push('/suppliers')} />
          <MenuItem icon="money-off" label="المصروفات" color="#DE350B" onPress={() => router.push('/expenses')} />
          <MenuItem icon="account-balance" label="الصندوق" sublabel={formatCurrency(cashBalance)} color="#00875A" onPress={() => router.push('/cashbox')} />
          <MenuItem icon="work" label="الورديات" color="#0052CC" onPress={() => router.push('/shifts')} />
        </Section>

        <Section title="الذكاء والتحليل">
          <MenuItem icon="psychology" label="المساعد الذكي" sublabel="أسئلة عن أداء الصيدلية" color="#6554C0" onPress={() => router.push('/assistant')} />
        </Section>

        <Section title="النظام">
          <MenuItem icon="manage-accounts" label="المستخدمون" color="#0052CC" onPress={() => router.push('/settings')} />
          <MenuItem icon="history" label="سجل التدقيق" color="#5E6C84" onPress={() => router.push('/audit-log')} />
          <MenuItem icon="backup" label="النسخ الاحتياطي" color="#00875A" onPress={() => router.push('/backup')} />
          <MenuItem icon="settings" label="الإعدادات" onPress={() => router.push('/settings')} />
        </Section>
      </ScrollView>
    </View>
  );
}
