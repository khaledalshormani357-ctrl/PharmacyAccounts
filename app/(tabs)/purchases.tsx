// Smart Pharmacy ERP — Purchases Tab
import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, FlatList, RefreshControl, TextInput, ScrollView } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { getPurchases, Purchase } from '@/services/database';
import { formatCurrency, formatDate, getToday, getDateRange } from '@/constants/i18n';
import { useAlert } from '@/template';

const PERIODS = [
  { key: 'today', label: 'اليوم' },
  { key: 'week', label: 'هذا الأسبوع' },
  { key: 'month', label: 'الشهر' },
];

export default function PurchasesScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [period, setPeriod] = useState('month');
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    try {
      const { from, to } = getDateRange(period);
      let result = getPurchases({ dateFrom: from, dateTo: to });
      if (search) result = result.filter(p => (p.supplier_name || '').includes(search) || p.invoice_number.includes(search));
      setPurchases(result);
    } catch {}
  }, [period, search]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const totalAmount = purchases.reduce((s, p) => s + p.total, 0);
  const totalPaid = purchases.reduce((s, p) => s + p.amount_paid, 0);
  const totalRemaining = purchases.reduce((s, p) => s + p.remaining, 0);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ backgroundColor: '#6554C0', paddingTop: insets.top + 10, paddingBottom: 14, paddingHorizontal: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <TouchableOpacity onPress={() => router.push('/add-purchase')} style={{ backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <MaterialIcons name="add" size={16} color="#FFFFFF" />
            <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '600' }}>فاتورة جديدة</Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF' }}>المشتريات</Text>
        </View>
        <View style={{ backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 10, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, height: 38 }}>
          <MaterialIcons name="search" size={18} color="rgba(255,255,255,0.8)" />
          <TextInput value={search} onChangeText={setSearch} onSubmitEditing={load} placeholder="ابحث في الفواتير..." placeholderTextColor="rgba(255,255,255,0.6)" style={{ flex: 1, fontSize: 13, textAlign: 'right', color: '#FFFFFF', marginRight: 6 }} />
        </View>
      </View>

      <View style={{ backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 8, flexDirection: 'row' }}>
          {PERIODS.map(p => (
            <TouchableOpacity key={p.key} onPress={() => setPeriod(p.key)} style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: period === p.key ? '#6554C0' : theme.colors.surfaceAlt, borderWidth: 1, borderColor: period === p.key ? '#6554C0' : theme.colors.border }}>
              <Text style={{ fontSize: 12, fontWeight: '500', color: period === p.key ? '#FFFFFF' : theme.colors.textSecondary }}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {purchases.length > 0 && (
        <View style={{ backgroundColor: '#EAE6FF', paddingHorizontal: 14, paddingVertical: 8, flexDirection: 'row', justifyContent: 'space-around' }}>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ fontSize: 10, color: '#6554C0' }}>متبقي</Text>
            <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.error }}>{formatCurrency(totalRemaining)}</Text>
          </View>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ fontSize: 10, color: '#6554C0' }}>مدفوع</Text>
            <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.success }}>{formatCurrency(totalPaid)}</Text>
          </View>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ fontSize: 10, color: '#6554C0' }}>الإجمالي</Text>
            <Text style={{ fontSize: 14, fontWeight: '800', color: '#6554C0' }}>{formatCurrency(totalAmount)}</Text>
          </View>
        </View>
      )}

      <FlatList
        data={purchases}
        keyExtractor={p => String(p.id)}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); setRefreshing(false); }} colors={['#6554C0']} />}
        contentContainerStyle={{ paddingBottom: 24 }}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => router.push({ pathname: '/purchase-detail', params: { id: item.id } })}
            activeOpacity={0.75}
            style={{ backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.divider, paddingHorizontal: 14, paddingVertical: 12 }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <MaterialIcons name="chevron-left" size={16} color={theme.colors.textTertiary} />
              <View style={{ flex: 1, marginHorizontal: 10 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                  <Text style={{ fontSize: 15, fontWeight: '800', color: '#6554C0' }}>{formatCurrency(item.total)}</Text>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: theme.colors.textPrimary }}>{item.supplier_name || 'مورد مباشر'}</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {item.remaining > 0 && <Text style={{ fontSize: 11, color: theme.colors.error, fontWeight: '600' }}>متبقي: {formatCurrency(item.remaining)}</Text>}
                    {item.amount_paid > 0 && <Text style={{ fontSize: 11, color: theme.colors.success }}>مدفوع: {formatCurrency(item.amount_paid)}</Text>}
                  </View>
                  <Text style={{ fontSize: 11, color: theme.colors.textTertiary }}>{item.invoice_number} · {formatDate(item.date)}</Text>
                </View>
              </View>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={{ padding: 40, alignItems: 'center' }}>
            <MaterialIcons name="shopping-cart" size={48} color={theme.colors.textTertiary} />
            <Text style={{ fontSize: 15, color: theme.colors.textTertiary, marginTop: 12 }}>لا توجد فواتير شراء</Text>
            <TouchableOpacity onPress={() => router.push('/add-purchase')} style={{ marginTop: 14, backgroundColor: '#6554C0', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 }}>
              <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '600' }}>فاتورة جديدة</Text>
            </TouchableOpacity>
          </View>
        }
      />
    </View>
  );
}
