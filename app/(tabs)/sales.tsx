// Smart Pharmacy ERP — Sales Tab
import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  RefreshControl, TextInput, FlatList,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { getSales, cancelSale, getSetting, Sale } from '@/services/database';
import { formatCurrency, formatDate, getToday, AR } from '@/constants/i18n';
import { useAlert } from '@/template';
import { PdfActions } from '@/components/PdfActions';
import { buildTableReportHtml } from '@/services/pdfReport';

const FILTERS = [
  { key: 'all', label: 'الكل' },
  { key: 'cash', label: 'نقدي' },
  { key: 'credit', label: 'آجل' },
];

const PERIODS = [
  { key: 'today', label: 'اليوم' },
  { key: 'week', label: 'هذا الأسبوع' },
  { key: 'month', label: 'الشهر' },
];

function getDateRange(period: string) {
  const now = new Date();
  const todayStr = getToday();
  if (period === 'today') return { from: todayStr, to: todayStr };
  if (period === 'week') {
    const start = new Date(now); start.setDate(now.getDate() - 6);
    return { from: start.toISOString().split('T')[0], to: todayStr };
  }
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: start.toISOString().split('T')[0], to: todayStr };
}

function SaleCard({ sale, onPress, onCancel, theme }: { sale: Sale; onPress: () => void; onCancel: () => void; theme: any }) {
  const typeColor = sale.sale_type === 'cash' ? theme.colors.income : theme.colors.credit;
  const typeLabel = sale.sale_type === 'cash' ? 'نقدي' : 'آجل';
  return (
    <TouchableOpacity onPress={onPress} onLongPress={onCancel} activeOpacity={0.75}
      style={{ backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.divider, paddingHorizontal: 14, paddingVertical: 12 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <MaterialIcons name="chevron-left" size={16} color={theme.colors.textTertiary} />
        <View style={{ flex: 1, marginHorizontal: 10 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ backgroundColor: typeColor + '18', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
                <Text style={{ fontSize: 10, fontWeight: '600', color: typeColor }}>{typeLabel}</Text>
              </View>
              <Text style={{ fontSize: 11, color: theme.colors.textTertiary }}>{sale.invoice_number}</Text>
            </View>
            <Text style={{ fontSize: 15, fontWeight: '800', color: typeColor }}>{formatCurrency(sale.total)}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 11, color: theme.colors.textTertiary }}>{formatDate(sale.date)}</Text>
            <Text style={{ fontSize: 13, fontWeight: '600', color: theme.colors.textPrimary }}>
              {sale.customer_name || 'عميل نقدي'}
            </Text>
          </View>
          {sale.remaining > 0 && (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
              <Text style={{ fontSize: 11, color: theme.colors.error, fontWeight: '600' }}>متبقي: {formatCurrency(sale.remaining)}</Text>
            </View>
          )}
          {sale.gross_profit > 0 && (
            <Text style={{ fontSize: 11, color: theme.colors.success, marginTop: 2 }}>ربح: {formatCurrency(sale.gross_profit)}</Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function SalesScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showAlert } = useAlert();
  const [sales, setSales] = useState<Sale[]>([]);
  const [filter, setFilter] = useState('all');
  const [period, setPeriod] = useState('today');
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    try {
      const { from, to } = getDateRange(period);
      let result = getSales({ dateFrom: from, dateTo: to });
      if (filter !== 'all') result = result.filter(s => s.sale_type === filter);
      if (search) result = result.filter(s => (s.customer_name || '').includes(search) || s.invoice_number.includes(search));
      setSales(result);
    } catch {}
  }, [filter, period, search]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleCancel = (sale: Sale) => {
    showAlert(`إلغاء ${sale.invoice_number}`, 'هل تريد إلغاء هذه الفاتورة؟', [
      { text: 'لا', style: 'cancel' },
      { text: 'إلغاء الفاتورة', style: 'destructive', onPress: () => { cancelSale(sale.id, 'إلغاء يدوي'); load(); } },
    ]);
  };

  const totalSales = sales.reduce((s, sale) => s + sale.total, 0);
  const totalProfit = sales.reduce((s, sale) => s + sale.gross_profit, 0);
  const buildSalesPdf = () => {
    const { from, to } = getDateRange(period);
    const periodLabel = PERIODS.find(item => item.key === period)?.label || period;
    return buildTableReportHtml({
      pharmacyName: getSetting('pharmacy_name') || 'صيدليتي',
      title: 'تقرير فواتير المبيعات',
      periodLabel,
      dateRange: from === to ? from : `${from} — ${to}`,
      accent: theme.colors.primary,
      summary: [
        { label: 'عدد الفواتير', value: sales.length },
        { label: 'إجمالي المبيعات', value: formatCurrency(totalSales), tone: 'positive' },
        { label: 'إجمالي الربح', value: formatCurrency(totalProfit), tone: 'positive' },
      ],
      columns: ['الفاتورة', 'العميل', 'النوع', 'التاريخ', 'الإجمالي', 'المتبقي'],
      rows: sales.map(sale => [sale.invoice_number, sale.customer_name || 'عميل نقدي', sale.sale_type === 'cash' ? 'نقدي' : 'آجل', formatDate(sale.date), formatCurrency(sale.total), formatCurrency(sale.remaining)]),
      footerNote: filter !== 'all' || search ? 'تم تطبيق الفلاتر الحالية على التقرير.' : undefined,
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ backgroundColor: theme.colors.primary, paddingTop: insets.top + 10, paddingBottom: 14, paddingHorizontal: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <PdfActions buildHtml={buildSalesPdf} title="تقرير فواتير المبيعات" onError={(message) => showAlert('خطأ', message)} />
            <TouchableOpacity onPress={() => router.push('/pos')} style={{ backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <MaterialIcons name="add" size={16} color="#FFFFFF" />
              <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '600' }}>بيع جديد</Text>
            </TouchableOpacity>
          </View>
          <Text style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF' }}>المبيعات</Text>
        </View>
        <View style={{ backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 10, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, height: 38 }}>
          <MaterialIcons name="search" size={18} color="rgba(255,255,255,0.8)" />
          <TextInput value={search} onChangeText={setSearch} onSubmitEditing={load}
            placeholder="ابحث في الفواتير..."
            placeholderTextColor="rgba(255,255,255,0.6)"
            style={{ flex: 1, fontSize: 13, textAlign: 'right', color: '#FFFFFF', marginRight: 6 }}
          />
        </View>
      </View>

      {/* Period + Filter */}
      <View style={{ backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 8, flexDirection: 'row' }}>
          {PERIODS.map(p => (
            <TouchableOpacity key={p.key} onPress={() => setPeriod(p.key)} style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: period === p.key ? theme.colors.primary : theme.colors.surfaceAlt, borderWidth: 1, borderColor: period === p.key ? theme.colors.primary : theme.colors.border }}>
              <Text style={{ fontSize: 12, fontWeight: '500', color: period === p.key ? '#FFFFFF' : theme.colors.textSecondary }}>{p.label}</Text>
            </TouchableOpacity>
          ))}
          <View style={{ width: 1, backgroundColor: theme.colors.border }} />
          {FILTERS.map(f => (
            <TouchableOpacity key={f.key} onPress={() => setFilter(f.key)} style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: filter === f.key ? theme.colors.secondary : theme.colors.surfaceAlt, borderWidth: 1, borderColor: filter === f.key ? theme.colors.secondary : theme.colors.border }}>
              <Text style={{ fontSize: 12, fontWeight: '500', color: filter === f.key ? '#FFFFFF' : theme.colors.textSecondary }}>{f.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Summary bar */}
      {sales.length > 0 && (
        <View style={{ backgroundColor: theme.colors.primaryLight, paddingHorizontal: 14, paddingVertical: 8, flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 12, color: theme.colors.success, fontWeight: '600' }}>ربح: {formatCurrency(totalProfit)}</Text>
          <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>{sales.length} فاتورة</Text>
          <Text style={{ fontSize: 14, fontWeight: '700', color: theme.colors.primary }}>المجموع: {formatCurrency(totalSales)}</Text>
        </View>
      )}

      <FlatList
        data={sales}
        keyExtractor={s => String(s.id)}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); setRefreshing(false); }} colors={[theme.colors.primary]} />}
        contentContainerStyle={{ paddingBottom: 24 }}
        renderItem={({ item }) => (
          <SaleCard
            sale={item}
            theme={theme}
            onPress={() => router.push({ pathname: '/sale-detail', params: { id: item.id } })}
            onCancel={() => handleCancel(item)}
          />
        )}
        ListEmptyComponent={
          <View style={{ padding: 40, alignItems: 'center' }}>
            <MaterialIcons name="receipt-long" size={48} color={theme.colors.textTertiary} />
            <Text style={{ fontSize: 15, color: theme.colors.textTertiary, marginTop: 12 }}>لا توجد مبيعات</Text>
            <TouchableOpacity onPress={() => router.push('/pos')} style={{ marginTop: 14, backgroundColor: theme.colors.primary, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 }}>
              <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '600' }}>ابدأ البيع</Text>
            </TouchableOpacity>
          </View>
        }
      />
    </View>
  );
}
