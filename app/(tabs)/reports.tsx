// Smart Pharmacy ERP — Reports Tab (comprehensive)
import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useTheme } from '@/contexts/ThemeContext';
import { getReportSummary, getExpensesByCategory, ReportSummary, getSetting } from '@/services/database';
import { formatCurrency, getDateRange, AR } from '@/constants/i18n';
import { Card } from '@/components/ui';
import { buildReportHtml } from '@/services/pdfReport';
import { useAlert } from '@/template';
import { PdfActions } from '@/components/PdfActions';

const PERIODS = [
  { key: 'today', label: 'اليوم' },
  { key: 'yesterday', label: 'أمس' },
  { key: 'week', label: 'هذا الأسبوع' },
  { key: 'month', label: 'الشهر' },
  { key: 'year', label: 'السنة' },
];

const BAR_COLORS = ['#EF4444','#F59E0B','#8B5CF6','#3B82F6','#10B981','#EC4899','#F97316','#06B6D4'];

function SummaryRow({ label, value, color, bold }: { label: string; value: number; color?: string; bold?: boolean }) {
  const { theme } = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
      <Text style={{ fontSize: bold ? 15 : 13, fontWeight: bold ? '800' : '500', color: color || theme.colors.textSecondary }}>{formatCurrency(value)}</Text>
      <Text style={{ fontSize: bold ? 14 : 13, fontWeight: bold ? '700' : '400', color: bold ? theme.colors.textPrimary : theme.colors.textSecondary }}>{label}</Text>
    </View>
  );
}

export default function ReportsScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { showAlert } = useAlert();
  const [period, setPeriod] = useState('today');
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [expByCategory, setExpByCategory] = useState<{ category: string; total: number }[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    try {
      const { from, to } = getDateRange(period);
      setSummary(getReportSummary(from, to));
      setExpByCategory(getExpensesByCategory(from, to));
    } catch (e) { console.error(e); }
  }, [period]);

  const buildFinancialPdf = () => {
    const periodMap: Record<string, string> = { today: 'اليوم', yesterday: 'أمس', week: 'هذا الأسبوع', month: 'هذا الشهر', year: 'هذا العام' };
    const { from, to } = getDateRange(period);
    return buildReportHtml({
      pharmacyName: getSetting('pharmacy_name') || 'صيدليتي',
      periodLabel: periodMap[period] || period,
      dateRange: from === to ? from : `${from} — ${to}`,
      summary: summary || { cashSales: 0, creditSales: 0, totalSales: 0, collections: 0, totalExpenses: 0, totalPurchases: 0, grossProfit: 0, netCash: 0, transactionCount: 0, cogs: 0 },
      expensesByCategory: expByCategory,
    });
  };

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const marginPct = summary && summary.totalSales > 0 ? ((summary.grossProfit / summary.totalSales) * 100).toFixed(1) : '0';
  const grandTotal = expByCategory.reduce((s, c) => s + c.total, 0);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ backgroundColor: '#0052CC', paddingTop: insets.top + 12, paddingBottom: 16, paddingHorizontal: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          {summary ? <PdfActions buildHtml={buildFinancialPdf} title="التقرير المالي" onError={(message) => showAlert('خطأ', message)} /> : <View style={{ width: 74 }} />}
          <Text style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF' }}>التقارير</Text>
          <View style={{ width: 70 }} />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, flexDirection: 'row' }}>
          {PERIODS.map(p => (
            <TouchableOpacity key={p.key} onPress={() => setPeriod(p.key)} style={{ paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20, backgroundColor: period === p.key ? '#FFFFFF' : 'rgba(255,255,255,0.15)' }}>
              <Text style={{ fontSize: 12, fontWeight: '600', color: period === p.key ? '#0052CC' : '#FFFFFF' }}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); setRefreshing(false); }} colors={['#0052CC']} />}
        contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: 40 }}
      >
        {/* Net Balance Hero */}
        <View style={{ backgroundColor: (summary?.netCash ?? 0) >= 0 ? theme.colors.successLight : theme.colors.errorLight, borderRadius: 14, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: (summary?.netCash ?? 0) >= 0 ? theme.colors.success : theme.colors.error }}>
          <Text style={{ fontSize: 12, color: theme.colors.textSecondary, marginBottom: 4 }}>صافي الحركة المالية</Text>
          <Text style={{ fontSize: 32, fontWeight: '800', color: (summary?.netCash ?? 0) >= 0 ? theme.colors.success : theme.colors.error }}>{formatCurrency(summary?.netCash ?? 0)}</Text>
          <View style={{ flexDirection: 'row', gap: 16, marginTop: 8 }}>
            <Text style={{ fontSize: 12, color: theme.colors.success, fontWeight: '600' }}>ربح إجمالي: {formatCurrency(summary?.grossProfit ?? 0)}</Text>
            <Text style={{ fontSize: 12, color: theme.colors.textTertiary }}>هامش: {marginPct}%</Text>
            <Text style={{ fontSize: 12, color: theme.colors.textTertiary }}>{summary?.transactionCount ?? 0} فاتورة</Text>
          </View>
        </View>

        {/* Sales */}
        <Card>
          <Text style={{ fontSize: 14, fontWeight: '700', color: theme.colors.textPrimary, textAlign: 'right', marginBottom: 6 }}>📊 تقرير المبيعات</Text>
          <SummaryRow label="مبيعات نقدية" value={summary?.cashSales ?? 0} color={theme.colors.income} />
          <SummaryRow label="مبيعات آجلة" value={summary?.creditSales ?? 0} color={theme.colors.credit} />
          <SummaryRow label="التحصيلات" value={summary?.collections ?? 0} color={theme.colors.secondary} />
          <SummaryRow label="تكلفة البضاعة" value={summary?.cogs ?? 0} color={theme.colors.textTertiary} />
          <SummaryRow label="إجمالي المبيعات" value={summary?.totalSales ?? 0} bold color={theme.colors.income} />
          <SummaryRow label="إجمالي الربح" value={summary?.grossProfit ?? 0} bold color={theme.colors.success} />
        </Card>

        {/* Expenses + Purchases */}
        <Card>
          <Text style={{ fontSize: 14, fontWeight: '700', color: theme.colors.textPrimary, textAlign: 'right', marginBottom: 6 }}>📉 المصروفات والمشتريات</Text>
          <SummaryRow label="إجمالي المصروفات" value={summary?.totalExpenses ?? 0} color={theme.colors.error} />
          <SummaryRow label="إجمالي المشتريات" value={summary?.totalPurchases ?? 0} color={theme.colors.purple} />
          <SummaryRow label="الإجمالي" value={(summary?.totalExpenses ?? 0) + (summary?.totalPurchases ?? 0)} bold color={theme.colors.error} />
        </Card>

        {/* Expense bar chart */}
        {expByCategory.length > 0 && (
          <Card>
            <Text style={{ fontSize: 14, fontWeight: '700', color: theme.colors.textPrimary, textAlign: 'right', marginBottom: 12 }}>🏷️ المصروفات حسب الفئة</Text>
            {/* Stacked bar */}
            <View style={{ height: 8, borderRadius: 4, flexDirection: 'row', overflow: 'hidden', backgroundColor: theme.colors.surfaceAlt, marginBottom: 12 }}>
              {expByCategory.map((cat, i) => {
                const pct = grandTotal > 0 ? (cat.total / grandTotal) : 0;
                return <View key={cat.category} style={{ width: `${pct * 100}%` as any, backgroundColor: BAR_COLORS[i % BAR_COLORS.length] }} />;
              })}
            </View>
            {expByCategory.map((cat, i) => {
              const pct = grandTotal > 0 ? (cat.total / grandTotal) * 100 : 0;
              const bc = BAR_COLORS[i % BAR_COLORS.length];
              return (
                <View key={cat.category} style={{ marginBottom: 10 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: bc }}>{formatCurrency(cat.total)}</Text>
                      <Text style={{ fontSize: 11, color: theme.colors.textTertiary }}>{pct.toFixed(1)}%</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>{cat.category}</Text>
                      <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: bc }} />
                    </View>
                  </View>
                  <View style={{ height: 5, borderRadius: 3, backgroundColor: theme.colors.surfaceAlt }}>
                    <View style={{ height: 5, borderRadius: 3, backgroundColor: bc, width: `${pct}%` as any }} />
                  </View>
                </View>
              );
            })}
          </Card>
        )}

        {/* Closing */}
        <Card style={{ backgroundColor: theme.colors.primaryLight, borderColor: theme.colors.primary }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: theme.colors.primary, textAlign: 'right', marginBottom: 10 }}>🔒 الإغلاق المالي</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
            <Text style={{ fontSize: 16, fontWeight: '800', color: (summary?.netCash ?? 0) >= 0 ? theme.colors.success : theme.colors.error }}>{formatCurrency(summary?.netCash ?? 0)}</Text>
            <Text style={{ fontSize: 13, color: theme.colors.textSecondary }}>صافي الحركة</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 13, color: theme.colors.textSecondary }}>{summary?.transactionCount ?? 0} معاملة</Text>
            <Text style={{ fontSize: 13, color: theme.colors.textSecondary }}>هامش الربح: {marginPct}%</Text>
          </View>
        </Card>
      </ScrollView>
    </View>
  );
}
