// Smart Pharmacy ERP — Inventory Screen
import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  TextInput, FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter , useFocusEffect } from 'expo-router';
import { useTheme } from '@/contexts/ThemeContext';
import { getInventoryList, getProductUnits, getSetting, InventoryItem } from '@/services/database';
import { formatCurrency } from '@/constants/i18n';
import { PdfActions } from '@/components/PdfActions';
import { buildTableReportHtml } from '@/services/pdfReport';
import { decomposeBaseQuantity } from '@/services/unit-conversion';

const FILTERS = [
  { key: 'all', label: 'الكل', icon: 'inventory-2' },
  { key: 'ok', label: 'متوفر', icon: 'check-circle' },
  { key: 'low', label: 'منخفض', icon: 'warning' },
  { key: 'out', label: 'نافد', icon: 'cancel' },
  { key: 'expiring', label: 'قارب الانتهاء', icon: 'schedule' },
  { key: 'expired', label: 'منتهي', icon: 'error' },
];

function StatusBadge({ status, theme }: { status: InventoryItem['status']; theme: any }) {
  const config = {
    ok: { color: theme.colors.statusOk, label: 'متوفر' },
    low: { color: theme.colors.statusLow, label: 'منخفض' },
    out: { color: theme.colors.statusOut, label: 'نافد' },
    expiring: { color: theme.colors.statusExpiring, label: 'قارب الانتهاء' },
    expired: { color: theme.colors.statusExpired, label: 'منتهي' },
  }[status];
  return (
    <View style={{ backgroundColor: config.color + '18', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
      <Text style={{ fontSize: 10, fontWeight: '600', color: config.color }}>{config.label}</Text>
    </View>
  );
}

function stockBreakdown(item: InventoryItem): string {
  const configured = getProductUnits(item.product_id);
  const units = configured.some(unit => unit.unit_name === item.inventory_unit)
    ? configured
    : [{ unit_name: item.inventory_unit, conversion_factor: 1 }, ...configured];
  return decomposeBaseQuantity(item.total_quantity, item.inventory_unit, units)
    .map(part => `${part.quantity} ${part.unit}`).join(' + ');
}

export default function InventoryScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const load = useCallback(() => {
    try {
      setItems(getInventoryList({ search: search || undefined, status: filter === 'all' ? undefined : filter }));
    } catch {}
  }, [filter, search]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  const buildInventoryPdf = () => {
    const statusLabel: Record<InventoryItem['status'], string> = { ok: 'متوفر', low: 'منخفض', out: 'نافد', expiring: 'قارب الانتهاء', expired: 'منتهي' };
    const stockValue = items.reduce((sum, item) => sum + (item.total_quantity * item.selling_price), 0);
    return buildTableReportHtml({
      pharmacyName: getSetting('pharmacy_name') || 'صيدليتي',
      title: 'تقرير المخزون',
      periodLabel: FILTERS.find(item => item.key === filter)?.label || 'الكل',
      accent: '#00B8D9',
      summary: [
        { label: 'عدد الأصناف', value: items.length },
        { label: 'قيمة المخزون', value: formatCurrency(stockValue) },
        { label: 'المنخفض أو النافد', value: items.filter(item => item.status === 'low' || item.status === 'out').length, tone: 'negative' },
      ],
      columns: ['الصنف', 'الرصيد', 'سعر البيع', 'الحالة', 'أقرب انتهاء'],
      rows: items.map(item => [item.trade_name, `${item.total_quantity} ${item.inventory_unit}`, formatCurrency(item.selling_price), statusLabel[item.status], item.nearest_expiry || '—']),
      footerNote: search ? `نتائج البحث: ${search}` : undefined,
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ backgroundColor: '#00B8D9', paddingTop: insets.top + 10, paddingBottom: 14, paddingHorizontal: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity onPress={() => router.push('/add-product')} style={{ backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <MaterialIcons name="add" size={16} color="#FFFFFF" />
              <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '600' }}>صنف جديد</Text>
            </TouchableOpacity>
            <PdfActions buildHtml={buildInventoryPdf} title="تقرير المخزون" />
            <TouchableOpacity onPress={() => router.back()} style={{ width: 34, height: 34, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
              <MaterialIcons name="arrow-forward" size={20} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          <Text style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF' }}>المخزون</Text>
        </View>
        <View style={{ backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: 10, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, height: 40 }}>
          <MaterialIcons name="search" size={18} color="#5E6C84" />
          <TextInput value={search} onChangeText={q => { setSearch(q); }} onSubmitEditing={load}
            placeholder="ابحث عن صنف، مادة فعالة، باركود..."
            placeholderTextColor="#8993A4"
            style={{ flex: 1, fontSize: 13, textAlign: 'right', color: '#172B4D', marginRight: 6 }}
          />
        </View>
      </View>

      {/* Filter chips */}
      <View style={{ backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 8, flexDirection: 'row' }}>
          {FILTERS.map(f => (
            <TouchableOpacity
              key={f.key}
              onPress={() => setFilter(f.key)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: filter === f.key ? '#00B8D9' : theme.colors.surfaceAlt, borderWidth: 1, borderColor: filter === f.key ? '#00B8D9' : theme.colors.border }}
            >
              <Text style={{ fontSize: 12, fontWeight: '500', color: filter === f.key ? '#FFFFFF' : theme.colors.textSecondary }}>{f.label}</Text>
              <Text style={{ fontSize: 11, color: filter === f.key ? 'rgba(255,255,255,0.8)' : theme.colors.textTertiary }}>
                ({items.filter(i => f.key === 'all' || i.status === f.key).length})
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <FlatList
        data={items}
        keyExtractor={i => String(i.product_id)}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 24 }}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => router.push({ pathname: '/product-detail', params: { id: item.product_id } })}
            activeOpacity={0.75}
            style={{ backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.divider, paddingHorizontal: 14, paddingVertical: 12 }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <MaterialIcons name="chevron-left" size={16} color={theme.colors.textTertiary} style={{ marginLeft: 4 }} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <View style={{ alignItems: 'flex-start', gap: 3 }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: theme.colors.textPrimary }}>
                      {formatCurrency(item.selling_price)}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Text style={{ fontSize: 12, fontWeight: '600', color: item.total_quantity > 0 ? theme.colors.textPrimary : theme.colors.error }}>
                        {item.total_quantity} {item.inventory_unit}
                      </Text>
                      <Text style={{ fontSize: 10, color: theme.colors.textTertiary, textAlign: 'left' }}>{stockBreakdown(item)}</Text>
                    </View>
                  </View>
                  <View style={{ flex: 1, marginHorizontal: 10, alignItems: 'flex-end' }}>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: theme.colors.textPrimary, textAlign: 'right' }} numberOfLines={1}>{item.trade_name}</Text>
                    {item.generic_name ? <Text style={{ fontSize: 12, color: theme.colors.textTertiary, textAlign: 'right' }} numberOfLines={1}>{item.generic_name}</Text> : null}
                    <View style={{ flexDirection: 'row', gap: 6, marginTop: 4, alignItems: 'center' }}>
                      <StatusBadge status={item.status} theme={theme} />
                      {item.nearest_expiry && item.days_to_nearest_expiry !== null && item.days_to_nearest_expiry <= 90 && (
                        <Text style={{ fontSize: 10, color: theme.colors.statusExpiring }}>
                          {item.days_to_nearest_expiry <= 0 ? 'منتهية!' : `${item.days_to_nearest_expiry} يوم`}
                        </Text>
                      )}
                    </View>
                  </View>
                </View>
              </View>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={{ padding: 40, alignItems: 'center' }}>
            <MaterialIcons name="inventory-2" size={48} color={theme.colors.textTertiary} />
            <Text style={{ fontSize: 15, color: theme.colors.textTertiary, marginTop: 12 }}>لا توجد أصناف</Text>
            <TouchableOpacity onPress={() => router.push('/add-product')} style={{ marginTop: 14, backgroundColor: '#00B8D9', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 }}>
              <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '600' }}>أضف صنفاً</Text>
            </TouchableOpacity>
          </View>
        }
      />
    </View>
  );
}
