// Smart Pharmacy ERP — Expiry Radar
import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, ScrollView } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { getExpiryRadar, getSetting, ExpiryRadarItem } from '@/services/database';
import { formatCurrency, formatDate } from '@/constants/i18n';
import { PdfActions } from '@/components/PdfActions';
import { buildTableReportHtml } from '@/services/pdfReport';

const GROUPS = [
  { key: 'expired', label: 'منتهية الصلاحية', color: '#BF2600', bg: '#FFEBE6' },
  { key: '30', label: 'خلال 30 يوم', color: '#FF5630', bg: '#FFEBE6' },
  { key: '60', label: 'خلال 60 يوم', color: '#FF8B00', bg: '#FFF8E6' },
  { key: '90', label: 'خلال 90 يوم', color: '#FFAB00', bg: '#FFF8E6' },
];

export default function ExpiryRadarScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<ExpiryRadarItem[]>([]);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);

  useFocusEffect(useCallback(() => { setItems(getExpiryRadar()); }, []));

  const filtered = activeGroup ? items.filter(i => i.group === activeGroup) : items;
  const totalValue = filtered.reduce((s, i) => s + i.stock_value, 0);

  const groupCounts = GROUPS.map(g => ({ ...g, count: items.filter(i => i.group === g.key).length, value: items.filter(i => i.group === g.key).reduce((s, i) => s + i.stock_value, 0) }));
  const buildExpiryPdf = () => buildTableReportHtml({
    pharmacyName: getSetting('pharmacy_name') || 'صيدليتي',
    title: 'تقرير رادار انتهاء الصلاحية',
    periodLabel: activeGroup ? GROUPS.find(group => group.key === activeGroup)?.label : 'كل الأصناف المعرضة للخطر',
    accent: '#FF8B00',
    summary: [
      { label: 'عدد الدفعات', value: filtered.length, tone: 'negative' },
      { label: 'قيمة المخزون المعرض للخطر', value: formatCurrency(totalValue), tone: 'negative' },
      { label: 'الدفعات المنتهية', value: groupCounts.find(group => group.key === 'expired')?.count || 0, tone: 'negative' },
    ],
    columns: ['الصنف', 'رقم الدفعة', 'تاريخ الانتهاء', 'المتبقي', 'الكمية', 'القيمة'],
    rows: filtered.map(item => [item.product_name, item.batch_number, formatDate(item.expiry_date), item.days_to_expiry <= 0 ? 'منتهي' : `${item.days_to_expiry} يوم`, `${item.quantity} ${item.unit}`, formatCurrency(item.stock_value)]),
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ backgroundColor: '#FF8B00', paddingTop: insets.top + 10, paddingBottom: 14, paddingHorizontal: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <TouchableOpacity onPress={() => router.back()} style={{ width: 34, height: 34, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
              <MaterialIcons name="arrow-forward" size={20} color="#FFFFFF" />
            </TouchableOpacity>
            <PdfActions buildHtml={buildExpiryPdf} title="تقرير رادار انتهاء الصلاحية" />
          </View>
          <Text style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF' }}>رادار الانتهاء</Text>
          <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)' }}>{items.length} صنف</Text>
        </View>
        {/* Group Summary Cards */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, flexDirection: 'row' }}>
          {groupCounts.map(g => (
            <TouchableOpacity
              key={g.key}
              onPress={() => setActiveGroup(activeGroup === g.key ? null : g.key)}
              style={{ backgroundColor: activeGroup === g.key ? '#FFFFFF' : 'rgba(255,255,255,0.15)', borderRadius: 10, padding: 10, minWidth: 90, alignItems: 'center' }}
            >
              <Text style={{ fontSize: 18, fontWeight: '800', color: activeGroup === g.key ? g.color : '#FFFFFF' }}>{g.count}</Text>
              <Text style={{ fontSize: 10, color: activeGroup === g.key ? g.color : 'rgba(255,255,255,0.8)', marginTop: 2, textAlign: 'center' }}>{g.label}</Text>
              <Text style={{ fontSize: 10, color: activeGroup === g.key ? '#5E6C84' : 'rgba(255,255,255,0.6)', marginTop: 1 }}>{formatCurrency(g.value)}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {filtered.length > 0 && (
        <View style={{ backgroundColor: '#FFF8E6', paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#FFD700' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#FF8B00' }}>{formatCurrency(totalValue)}</Text>
            <Text style={{ fontSize: 13, color: '#5E6C84' }}>إجمالي قيمة المخزون المعرض للخطر</Text>
          </View>
        </View>
      )}

      <FlatList
        data={filtered}
        keyExtractor={item => String(item.batch_id)}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 32 }}
        renderItem={({ item }) => {
          const grp = GROUPS.find(g => g.key === item.group)!;
          return (
            <TouchableOpacity
              onPress={() => router.push({ pathname: '/product-detail', params: { id: item.product_id } })}
              activeOpacity={0.75}
              style={{ backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.divider, paddingHorizontal: 14, paddingVertical: 12 }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ alignItems: 'flex-start', gap: 2 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: grp.color }}>
                    {item.days_to_expiry <= 0 ? 'منتهية!' : `${item.days_to_expiry} يوم`}
                  </Text>
                  <View style={{ backgroundColor: grp.bg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1, borderColor: grp.color + '30' }}>
                    <Text style={{ fontSize: 10, fontWeight: '600', color: grp.color }}>
                      {item.quantity} {item.unit}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 11, color: theme.colors.textTertiary }}>قيمة: {formatCurrency(item.stock_value)}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: theme.colors.textPrimary }}>{item.product_name}</Text>
                  <Text style={{ fontSize: 12, color: theme.colors.textTertiary, marginTop: 2 }}>دفعة: {item.batch_number}</Text>
                  <Text style={{ fontSize: 12, color: grp.color, marginTop: 1 }}>انتهاء: {formatDate(item.expiry_date)}</Text>
                </View>
              </View>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={{ padding: 48, alignItems: 'center' }}>
            <MaterialIcons name="check-circle" size={56} color={theme.colors.success} />
            <Text style={{ fontSize: 16, fontWeight: '700', color: theme.colors.success, marginTop: 14 }}>ممتاز!</Text>
            <Text style={{ fontSize: 13, color: theme.colors.textTertiary, marginTop: 6, textAlign: 'center' }}>لا توجد أصناف قاربت أو انتهت صلاحيتها</Text>
          </View>
        }
      />
    </View>
  );
}
