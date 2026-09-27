// Smart Pharmacy ERP — ABC Analysis
import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, ScrollView } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { getAbcAnalysis, AbcItem } from '@/services/database';
import { formatCurrency, getDateRange } from '@/constants/i18n';

const PERIODS = [
  { key: 'month', label: 'هذا الشهر' },
  { key: 'week', label: 'هذا الأسبوع' },
  { key: 'year', label: 'هذا العام' },
];

const ABC_CONFIG = {
  A: { color: '#00875A', bg: '#E3F5EF', label: 'A — الأكثر إيراداً (70%)' },
  B: { color: '#F59E0B', bg: '#FFF8E6', label: 'B — متوسط (20%)' },
  C: { color: '#5E6C84', bg: '#F4F5F7', label: 'C — أقل إيراداً (10%)' },
};

export default function AbcAnalysisScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<AbcItem[]>([]);
  const [period, setPeriod] = useState('month');
  const [filter, setFilter] = useState<'all' | 'A' | 'B' | 'C'>('all');

  useFocusEffect(useCallback(() => {
    const { from, to } = getDateRange(period);
    setItems(getAbcAnalysis(from, to));
  }, [period]));

  const filtered = filter === 'all' ? items : items.filter(i => i.abc_class === filter);
  const totalRevenue = items.reduce((s, i) => s + i.total_revenue, 0);

  const classCounts = (['A', 'B', 'C'] as const).map(c => ({
    class: c,
    count: items.filter(i => i.abc_class === c).length,
    revenue: items.filter(i => i.abc_class === c).reduce((s, i) => s + i.total_revenue, 0),
  }));

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ backgroundColor: '#6554C0', paddingTop: insets.top + 10, paddingBottom: 14, paddingHorizontal: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <TouchableOpacity onPress={() => router.back()} style={{ width: 34, height: 34, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
            <MaterialIcons name="arrow-forward" size={20} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF' }}>تحليل ABC</Text>
          <View style={{ width: 34 }} />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, flexDirection: 'row', marginBottom: 10 }}>
          {PERIODS.map(p => (
            <TouchableOpacity key={p.key} onPress={() => setPeriod(p.key)} style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: period === p.key ? '#FFFFFF' : 'rgba(255,255,255,0.15)' }}>
              <Text style={{ fontSize: 12, fontWeight: '600', color: period === p.key ? '#6554C0' : '#FFFFFF' }}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          {classCounts.map(c => {
            const cfg = ABC_CONFIG[c.class];
            return (
              <TouchableOpacity key={c.class} onPress={() => setFilter(filter === c.class ? 'all' : c.class)} style={{ flex: 1, backgroundColor: filter === c.class ? '#FFFFFF' : 'rgba(255,255,255,0.12)', borderRadius: 10, padding: 10, alignItems: 'center' }}>
                <Text style={{ fontSize: 22, fontWeight: '800', color: filter === c.class ? cfg.color : '#FFFFFF' }}>{c.count}</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: filter === c.class ? cfg.color : '#FFFFFF' }}>{c.class}</Text>
                <Text style={{ fontSize: 10, color: filter === c.class ? '#5E6C84' : 'rgba(255,255,255,0.7)' }}>{formatCurrency(c.revenue)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={i => String(i.product_id)}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 32 }}
        renderItem={({ item, index }) => {
          const cfg = ABC_CONFIG[item.abc_class];
          return (
            <TouchableOpacity
              onPress={() => router.push({ pathname: '/product-detail', params: { id: item.product_id } })}
              activeOpacity={0.75}
              style={{ backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.divider, paddingHorizontal: 14, paddingVertical: 12 }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ fontSize: 13, color: theme.colors.textTertiary, width: 28 }}>{index + 1}</Text>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <View style={{ backgroundColor: cfg.bg, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Text style={{ fontSize: 11, fontWeight: '800', color: cfg.color }}>{item.abc_class}</Text>
                      </View>
                      <Text style={{ fontSize: 12, color: theme.colors.textTertiary }}>{item.revenue_pct.toFixed(1)}%</Text>
                    </View>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: theme.colors.textPrimary }}>{item.trade_name}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: cfg.color }}>{formatCurrency(item.total_revenue)}</Text>
                    <Text style={{ fontSize: 11, color: theme.colors.textTertiary }}>تراكمي: {item.cumulative_pct.toFixed(1)}%</Text>
                  </View>
                  {/* Revenue bar */}
                  <View style={{ height: 4, borderRadius: 2, backgroundColor: theme.colors.surfaceAlt, marginTop: 6 }}>
                    <View style={{ height: 4, borderRadius: 2, backgroundColor: cfg.color, width: `${Math.min(item.revenue_pct, 100)}%` as any }} />
                  </View>
                </View>
              </View>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={{ padding: 40, alignItems: 'center' }}>
            <MaterialIcons name="analytics" size={48} color={theme.colors.textTertiary} />
            <Text style={{ fontSize: 14, color: theme.colors.textTertiary, marginTop: 12 }}>لا توجد بيانات مبيعات للتحليل</Text>
          </View>
        }
      />
    </View>
  );
}
