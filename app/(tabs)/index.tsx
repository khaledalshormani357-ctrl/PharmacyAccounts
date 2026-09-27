// Smart Pharmacy ERP — Professional Dashboard
import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  RefreshControl, StyleSheet, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { useTheme } from '@/contexts/ThemeContext';
import { getDashboardKpis, DashboardKpis, getSetting, Sale } from '@/services/database';
import { formatCurrency, formatDateTime, getToday, AR } from '@/constants/i18n';

interface KpiBoxProps {
  label: string; value: number; icon: any; color: string;
  bgColor?: string; small?: boolean;
}
function KpiBox({ label, value, icon, color, bgColor, small }: KpiBoxProps) {
  const { theme } = useTheme();
  return (
    <View style={[styles.kpiBox, { backgroundColor: bgColor || theme.colors.surface, borderColor: theme.colors.border }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: color + '18', alignItems: 'center', justifyContent: 'center' }}>
          <MaterialIcons name={icon} size={18} color={color} />
        </View>
        <Text style={{ fontSize: small ? 18 : 20, fontWeight: '800', color, textAlign: 'right' }} numberOfLines={1}>
          {formatCurrency(value)}
        </Text>
      </View>
      <Text style={{ fontSize: 11, fontWeight: '500', color: theme.colors.textTertiary, textAlign: 'right', marginTop: 6 }}>
        {label}
      </Text>
    </View>
  );
}

interface AlertBadgeProps { icon: any; label: string; count: number; color: string; onPress: () => void; }
function AlertBadge({ icon, label, count, color, onPress }: AlertBadgeProps) {
  const { theme } = useTheme();
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: color + '15', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, gap: 6, borderWidth: 1, borderColor: color + '30' }}>
      <MaterialIcons name={icon} size={14} color={color} />
      <Text style={{ fontSize: 12, color, fontWeight: '600' }}>{count}</Text>
      <Text style={{ fontSize: 11, color: theme.colors.textSecondary }}>{label}</Text>
    </Pressable>
  );
}

const QUICK_ACTIONS = [
  { label: AR.addCashSale, icon: 'point-of-sale' as const, color: '#00875A', route: '/pos' },
  { label: AR.addCreditSale, icon: 'credit-card' as const, color: '#F59E0B', route: '/pos' },
  { label: AR.collectDebt, icon: 'account-balance-wallet' as const, color: '#0052CC', route: '/customers' },
  { label: AR.addExpense, icon: 'money-off' as const, color: '#DE350B', route: '/add-expense' },
  { label: AR.addPurchase, icon: 'shopping-cart' as const, color: '#6554C0', route: '/add-purchase' },
  { label: AR.newProduct, icon: 'medication' as const, color: '#00B8D9', route: '/add-product' },
];

function SaleRow({ sale, theme }: { sale: Sale; theme: any }) {
  const router = useRouter();
  const typeColor = sale.sale_type === 'cash' ? theme.colors.income : theme.colors.credit;
  const typeLabel = sale.sale_type === 'cash' ? 'نقدي' : sale.sale_type === 'credit' ? 'آجل' : 'مختلط';
  return (
    <TouchableOpacity
      onPress={() => router.push({ pathname: '/sale-detail', params: { id: sale.id } })}
      activeOpacity={0.75}
      style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}
    >
      <Text style={{ fontSize: 12, color: theme.colors.textTertiary, minWidth: 44 }}>
        {new Date(sale.created_at).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}
      </Text>
      <View style={{ flex: 1, marginHorizontal: 10 }}>
        <Text style={{ fontSize: 13, fontWeight: '600', color: theme.colors.textPrimary, textAlign: 'right' }} numberOfLines={1}>
          {sale.customer_name || 'عميل نقدي'} — {sale.invoice_number}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: typeColor }}>
          {formatCurrency(sale.total)}
        </Text>
        <View style={{ backgroundColor: typeColor + '18', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
          <Text style={{ fontSize: 10, fontWeight: '600', color: typeColor }}>{typeLabel}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function DashboardScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [kpis, setKpis] = useState<DashboardKpis | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pharmacyName, setPharmacyName] = useState('صيدلية ذكية');

  const load = useCallback(() => {
    try {
      const name = getSetting('pharmacy_name');
      if (name) setPharmacyName(name);
      setKpis(getDashboardKpis());
    } catch (e) { console.error(e); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
    setRefreshing(false);
  }, [load]);

  const cashBalance = kpis?.cashBalance ?? 0;
  const balanceColor = cashBalance >= 0 ? '#AAFFCC' : '#FFAAAA';

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {/* Header */}
      <View style={{ backgroundColor: theme.colors.primary, paddingTop: insets.top + 10, paddingBottom: 20, paddingHorizontal: 16 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity onPress={() => router.push('/settings')} style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}>
              <MaterialIcons name="settings" size={20} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push('/assistant')} style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}>
              <MaterialIcons name="psychology" size={20} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ fontSize: 17, fontWeight: '800', color: '#FFFFFF' }}>{pharmacyName}</Text>
            <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', marginTop: 1 }}>
              {new Date().toLocaleDateString('ar-SA', { weekday: 'long', day: 'numeric', month: 'long' })}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push('/pos')}
            style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}
          >
            <MaterialIcons name="add" size={22} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        {/* Balance Hero */}
        <View style={{ backgroundColor: 'rgba(0,0,0,0.18)', borderRadius: 14, padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View>
            <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', marginBottom: 2 }}>الربح اليومي</Text>
            <Text style={{ fontSize: 16, fontWeight: '700', color: (kpis?.todayGrossProfit ?? 0) >= 0 ? '#AAFFCC' : '#FFAAAA' }}>
              {formatCurrency(kpis?.todayGrossProfit ?? 0)}
            </Text>
          </View>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', marginBottom: 2 }}>رصيد الصندوق</Text>
            <Text style={{ fontSize: 26, fontWeight: '800', color: balanceColor }}>{formatCurrency(cashBalance)}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', marginBottom: 2 }}>المبيعات</Text>
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#AAFFCC' }}>
              {formatCurrency(kpis?.todaySales ?? 0)}
            </Text>
          </View>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[theme.colors.primary]} />}
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        {/* Alerts */}
        {((kpis?.lowStockCount ?? 0) > 0 || (kpis?.expiringCount ?? 0) > 0 || (kpis?.expiredCount ?? 0) > 0 || (kpis?.outOfStockCount ?? 0) > 0) && (
          <View style={{ marginHorizontal: 14, marginTop: 14 }}>
            <Text style={{ fontSize: 12, fontWeight: '600', color: theme.colors.textSecondary, textAlign: 'right', marginBottom: 8 }}>التنبيهات</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, flexDirection: 'row' }}>
              {(kpis?.outOfStockCount ?? 0) > 0 && <AlertBadge icon="inventory" label="نفد مخزونه" count={kpis!.outOfStockCount} color={theme.colors.statusOut} onPress={() => router.push('/inventory')} />}
              {(kpis?.lowStockCount ?? 0) > 0 && <AlertBadge icon="warning" label="مخزون منخفض" count={kpis!.lowStockCount} color={theme.colors.statusLow} onPress={() => router.push('/inventory')} />}
              {(kpis?.expiredCount ?? 0) > 0 && <AlertBadge icon="error" label="منتهي الصلاحية" count={kpis!.expiredCount} color={theme.colors.statusExpired} onPress={() => router.push('/expiry-radar')} />}
              {(kpis?.expiringCount ?? 0) > 0 && <AlertBadge icon="schedule" label="قارب الانتهاء" count={kpis!.expiringCount} color={theme.colors.statusExpiring} onPress={() => router.push('/expiry-radar')} />}
            </ScrollView>
          </View>
        )}

        {/* KPI Grid */}
        <View style={{ paddingHorizontal: 14, paddingTop: 14 }}>
          <Text style={{ fontSize: 12, fontWeight: '600', color: theme.colors.textSecondary, textAlign: 'right', marginBottom: 10 }}>ملخص اليوم</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
            <KpiBox label="مبيعات نقدية" value={kpis?.todayCashSales ?? 0} icon="point-of-sale" color={theme.colors.income} />
            <KpiBox label="مبيعات آجلة" value={kpis?.todayCreditSales ?? 0} icon="credit-card" color={theme.colors.credit} />
          </View>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
            <KpiBox label="التحصيلات" value={kpis?.todayCollections ?? 0} icon="account-balance-wallet" color={theme.colors.secondary} />
            <KpiBox label="المصروفات" value={kpis?.todayExpenses ?? 0} icon="money-off" color={theme.colors.expense} />
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <KpiBox label="المشتريات" value={kpis?.todayPurchases ?? 0} icon="shopping-cart" color={theme.colors.purple} />
            <KpiBox label="ديون العملاء" value={kpis?.totalCustomerDebt ?? 0} icon="people" color={theme.colors.warning} />
          </View>
        </View>

        {/* Quick Actions */}
        <View style={{ paddingHorizontal: 14, paddingTop: 18 }}>
          <Text style={{ fontSize: 12, fontWeight: '600', color: theme.colors.textSecondary, textAlign: 'right', marginBottom: 10 }}>إجراءات سريعة</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'flex-end' }}>
            {QUICK_ACTIONS.map((a) => (
              <TouchableOpacity
                key={a.label}
                onPress={() => router.push(a.route as any)}
                activeOpacity={0.75}
                style={{ alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: theme.colors.border, width: '30%' }}
              >
                <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: a.color + '18', alignItems: 'center', justifyContent: 'center', marginBottom: 6 }}>
                  <MaterialIcons name={a.icon} size={22} color={a.color} />
                </View>
                <Text style={{ fontSize: 11, fontWeight: '600', color: theme.colors.textSecondary, textAlign: 'center' }} numberOfLines={2}>{a.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Recent Sales */}
        <View style={{ paddingHorizontal: 14, paddingTop: 18 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <TouchableOpacity onPress={() => router.push('/(tabs)/sales')}>
              <Text style={{ fontSize: 12, color: theme.colors.primary, fontWeight: '600' }}>عرض الكل</Text>
            </TouchableOpacity>
            <Text style={{ fontSize: 12, fontWeight: '600', color: theme.colors.textSecondary }}>آخر المبيعات</Text>
          </View>
          <View style={{ backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, overflow: 'hidden' }}>
            {(kpis?.recentSales ?? []).length > 0
              ? (kpis!.recentSales).map(s => <SaleRow key={s.id} sale={s} theme={theme} />)
              : (
                <View style={{ padding: 24, alignItems: 'center' }}>
                  <MaterialIcons name="receipt-long" size={32} color={theme.colors.textTertiary} />
                  <Text style={{ fontSize: 13, color: theme.colors.textTertiary, marginTop: 8 }}>لا توجد مبيعات اليوم</Text>
                  <TouchableOpacity onPress={() => router.push('/pos')} style={{ marginTop: 10, backgroundColor: theme.colors.primary, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 }}>
                    <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '600' }}>ابدأ البيع</Text>
                  </TouchableOpacity>
                </View>
              )
            }
          </View>
        </View>

        {/* Inventory Shortcuts */}
        <View style={{ paddingHorizontal: 14, paddingTop: 18 }}>
          <Text style={{ fontSize: 12, fontWeight: '600', color: theme.colors.textSecondary, textAlign: 'right', marginBottom: 10 }}>المخزون السريع</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {[
              { label: 'رادار الانتهاء', icon: 'schedule', color: '#FF8B00', route: '/expiry-radar' },
              { label: 'مقترحات الطلب', icon: 'refresh', color: '#0052CC', route: '/reorder' },
              { label: 'تحليل ABC', icon: 'analytics', color: '#6554C0', route: '/abc-analysis' },
            ].map(item => (
              <TouchableOpacity
                key={item.label}
                onPress={() => router.push(item.route as any)}
                activeOpacity={0.75}
                style={{ flex: 1, alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: theme.colors.border }}
              >
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: item.color + '18', alignItems: 'center', justifyContent: 'center', marginBottom: 6 }}>
                  <MaterialIcons name={item.icon as any} size={18} color={item.color} />
                </View>
                <Text style={{ fontSize: 11, fontWeight: '600', color: theme.colors.textSecondary, textAlign: 'center' }}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  kpiBox: {
    flex: 1,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
  },
});
