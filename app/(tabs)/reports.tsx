// Smart Pharmacy ERP — Financial & Operational Reports Hub
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl, TextInput } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useTheme } from '@/contexts/ThemeContext';
import {
  getReportSummary, getExpensesByCategory, getSetting, getSales,
  getAllSaleReturns, getAllPurchaseReturns, getExpenses, getCashTransactions,
  getProducts, getProductStock, getInventoryList, getExpiryRadar, getDeadStock,
  getStockMovements, getAuditLogs,
} from '@/services/database';
import { formatCurrency, formatDate, getDateRange, getToday } from '@/constants/i18n';
import { Card } from '@/components/ui';
import { buildTableReportHtml } from '@/services/pdfReport';
import { useAlert } from '@/template';
import { PdfActions } from '@/components/PdfActions';

type ReportKey = 'profit-loss' | 'cashbox' | 'sales' | 'sale-returns' | 'purchase-returns' | 'expenses' | 'profit-margin' | 'expense-analysis' | 'moving-stock' | 'dead-stock' | 'inventory-value' | 'expired' | 'expiring' | 'free-samples' | 'stock-adjustments' | 'modified-invoices';
type ReportGroup = 'financial' | 'inventory' | 'audit';
type ReportDefinition = { key: ReportKey; title: string; subtitle: string; group: ReportGroup; icon: string; color: string };
type ReportRow = { columns: string[]; rows: (string | number)[][]; summary: { label: string; value: string | number; tone?: 'positive' | 'negative' | 'neutral' }[] };

const REPORTS: ReportDefinition[] = [
  { key: 'profit-loss', title: 'الأرباح والخسائر', subtitle: 'صافي المبيعات والتكلفة والمصروفات والربح', group: 'financial', icon: 'trending-up', color: '#00875A' },
  { key: 'cashbox', title: 'الصندوق والخزينة', subtitle: 'حركات القبض والصرف والأرصدة', group: 'financial', icon: 'account-balance-wallet', color: '#0052CC' },
  { key: 'sales', title: 'المبيعات', subtitle: 'الفواتير النقدية والآجلة والمختلطة', group: 'financial', icon: 'point-of-sale', color: '#0052CC' },
  { key: 'sale-returns', title: 'مرتجعات المبيعات', subtitle: 'المبالغ المرتجعة وتسويات العملاء', group: 'financial', icon: 'assignment-return', color: '#F97316' },
  { key: 'purchase-returns', title: 'مرتجعات المشتريات', subtitle: 'إرجاع البضاعة وتسويات الموردين', group: 'financial', icon: 'keyboard-return', color: '#DC2626' },
  { key: 'expenses', title: 'المصاريف والتشغيل', subtitle: 'سجلات المصروفات خلال الفترة', group: 'financial', icon: 'receipt-long', color: '#DC2626' },
  { key: 'profit-margin', title: 'الأرباح والهوامش', subtitle: 'ربح كل فاتورة وهامشها', group: 'financial', icon: 'monetization-on', color: '#00875A' },
  { key: 'expense-analysis', title: 'تحليل المصروفات حسب الحساب', subtitle: 'إجمالي كل فئة ونسبتها', group: 'financial', icon: 'pie-chart', color: '#9333EA' },
  { key: 'moving-stock', title: 'الأصناف المتحركة', subtitle: 'الأصناف التي لها حركات مخزون بالفترة', group: 'inventory', icon: 'trending-up', color: '#00875A' },
  { key: 'dead-stock', title: 'الأصناف الراكدة', subtitle: 'أصناف متوفرة دون حركة صرف خلال 90 يومًا', group: 'inventory', icon: 'hourglass-empty', color: '#DC2626' },
  { key: 'inventory-value', title: 'تقييم المخزون والقيم', subtitle: 'قيمة التكلفة وقيمة البيع للمخزون الحالي', group: 'inventory', icon: 'inventory-2', color: '#0052CC' },
  { key: 'expired', title: 'الأدوية منتهية الصلاحية', subtitle: 'دفعات منتهية وما زال لها رصيد', group: 'inventory', icon: 'report-problem', color: '#DC2626' },
  { key: 'expiring', title: 'الأدوية قريبة الانتهاء', subtitle: 'دفعات تنتهي خلال 90 يومًا', group: 'inventory', icon: 'schedule', color: '#F97316' },
  { key: 'free-samples', title: 'العينات المجانية', subtitle: 'الحركات الموسومة صراحة بأنها عينة أو مجاني', group: 'inventory', icon: 'redeem', color: '#00875A' },
  { key: 'stock-adjustments', title: 'تسويات المخزون', subtitle: 'تدقيق تعديلات المخزون خلال الفترة', group: 'audit', icon: 'tune', color: '#0052CC' },
  { key: 'modified-invoices', title: 'الفواتير المعدّلة والملغاة', subtitle: 'سجل التدقيق المرتبط بالفواتير', group: 'audit', icon: 'edit-note', color: '#9333EA' },
];
const GROUPS: { key: ReportGroup; title: string }[] = [
  { key: 'financial', title: 'التقارير المالية والتشغيلية' },
  { key: 'inventory', title: 'تقارير المخزون والانتهاء' },
  { key: 'audit', title: 'تقارير التدقيق والتعديلات' },
];
const PERIODS = [
  { key: 'today', label: 'اليوم' }, { key: 'yesterday', label: 'أمس' },
  { key: 'week', label: '7 أيام' }, { key: 'month', label: 'هذا الشهر' }, { key: 'year', label: 'هذه السنة' },
];
const TYPE_LABELS: Record<string, string> = {
  cash: 'نقدي', credit: 'آجل', mixed: 'مختلط', SALE_CASH: 'بيع نقدي', COLLECTION: 'تحصيل',
  PURCHASE_PAYMENT: 'سداد مشتريات', SUPPLIER_PAYMENT: 'دفعة مورد', CUSTOMER_REFUND: 'رد مبلغ عميل',
  PURCHASE_RETURN: 'مرتجع مشتريات', EXPENSE: 'مصروف', WITHDRAWAL: 'سحب', DEPOSIT: 'إيداع',
  OPENING: 'رصيد افتتاحي', CLOSING: 'إغلاق', ADJUSTMENT: 'تسوية', RECEIPT: 'سند قبض',
  PAYMENT: 'سند صرف', TRANSFER_IN: 'تحويل وارد', TRANSFER_OUT: 'تحويل صادر',
};
function isWithin(date: string | null | undefined, from: string, to: string): boolean {
  if (!date) return false;
  const day = date.slice(0, 10);
  return day >= from && day <= to;
}
function money(value: number): string { return formatCurrency(Number.isFinite(value) ? value : 0); }

function buildRows(key: ReportKey, from: string, to: string): ReportRow {
  const summary = getReportSummary(from, to);
  const sales = getSales({ dateFrom: from, dateTo: to });
  const saleReturns = getAllSaleReturns().filter(item => isWithin(item.date, from, to));
  const purchaseReturns = getAllPurchaseReturns().filter(item => isWithin(item.date, from, to));
  const expenses = getExpenses({ dateFrom: from, dateTo: to });
  const cashTransactions = getCashTransactions({ dateFrom: from, dateTo: to });
  const inventory = getInventoryList();
  const expiry = getExpiryRadar();
  const audits = getAuditLogs().filter(item => isWithin(item.created_at, from, to));

  switch (key) {
    case 'profit-loss':
      return {
        columns: ['البند', 'القيمة'],
        rows: [
          ['صافي المبيعات بعد المرتجعات والخصومات', money(summary.totalSales)],
          ['تكلفة البضاعة المباعة بعد المرتجعات', money(summary.cogs)],
          ['مجمل الربح', money(summary.grossProfit)],
          ['المصروفات التشغيلية', money(summary.totalExpenses)],
          ['صافي الربح التشغيلي التقديري', money(summary.grossProfit - summary.totalExpenses)],
          ['المشتريات بعد مرتجعات المشتريات', money(summary.totalPurchases)],
          ['صافي الحركة النقدية للفترة', money(summary.netCash)],
        ],
        summary: [
          { label: 'صافي المبيعات', value: money(summary.totalSales), tone: 'positive' },
          { label: 'مجمل الربح', value: money(summary.grossProfit), tone: summary.grossProfit >= 0 ? 'positive' : 'negative' },
          { label: 'صافي الربح التشغيلي التقديري', value: money(summary.grossProfit - summary.totalExpenses), tone: summary.grossProfit - summary.totalExpenses >= 0 ? 'positive' : 'negative' },
        ],
      };
    case 'cashbox':
      return {
        columns: ['التاريخ', 'نوع الحركة', 'الصندوق', 'البيان', 'المبلغ'],
        rows: cashTransactions.map(t => [formatDate(t.date), TYPE_LABELS[t.type] || t.type, t.cashbox_id || 'اليومية', t.note || '—', money(t.amount)]),
        summary: [
          { label: 'إجمالي المقبوضات', value: money(cashTransactions.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0)), tone: 'positive' },
          { label: 'إجمالي المدفوعات', value: money(Math.abs(cashTransactions.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0))), tone: 'negative' },
          { label: 'صافي حركة الصندوق', value: money(cashTransactions.reduce((s, t) => s + t.amount, 0)) },
        ],
      };
    case 'sales':
      return {
        columns: ['رقم الفاتورة', 'التاريخ', 'العميل', 'نوع البيع', 'الخصم', 'الإجمالي', 'المدفوع', 'المتبقي'],
        rows: sales.map(s => [s.invoice_number, formatDate(s.date), s.customer_name || 'عميل نقدي', TYPE_LABELS[s.sale_type] || s.sale_type, money(s.discount), money(s.total), money(s.amount_paid), money(s.remaining)]),
        summary: [
          { label: 'عدد الفواتير', value: sales.length },
          { label: 'إجمالي المبيعات', value: money(sales.reduce((sum, s) => sum + s.total, 0)), tone: 'positive' },
          { label: 'الخصومات', value: money(sales.reduce((sum, s) => sum + s.discount, 0)) },
          { label: 'المتبقي الآجل', value: money(sales.reduce((sum, s) => sum + s.remaining, 0)), tone: 'negative' },
        ],
      };
    case 'sale-returns':
      return {
        columns: ['رقم المرتجع', 'الفاتورة الأصلية', 'التاريخ', 'المبلغ', 'رد نقدي', 'تخفيض آجل', 'التسوية'],
        rows: saleReturns.map(r => [r.return_number || ('SR-' + r.id), r.invoice_number, formatDate(r.date), money(r.total), money(r.cash_refund), money(r.credit_reduction), r.settlement_method || '—']),
        summary: [{ label: 'عدد المرتجعات', value: saleReturns.length }, { label: 'إجمالي المرتجعات', value: money(saleReturns.reduce((s, r) => s + r.total, 0)), tone: 'negative' }],
      };
    case 'purchase-returns':
      return {
        columns: ['رقم المرتجع', 'الفاتورة الأصلية', 'التاريخ', 'المبلغ', 'رد نقدي', 'تخفيض مستحق المورد', 'التسوية'],
        rows: purchaseReturns.map(r => [r.return_number || ('PR-' + r.id), r.invoice_number, formatDate(r.date), money(r.total), money(r.cash_refund), money(r.payable_reduction), r.settlement_method || '—']),
        summary: [{ label: 'عدد المرتجعات', value: purchaseReturns.length }, { label: 'إجمالي المرتجعات', value: money(purchaseReturns.reduce((s, r) => s + r.total, 0)), tone: 'negative' }],
      };
    case 'expenses':
      return {
        columns: ['التاريخ', 'الفئة', 'البيان', 'المبلغ'],
        rows: expenses.map(e => [formatDate(e.date), e.category, e.note || '—', money(e.amount)]),
        summary: [{ label: 'عدد القيود', value: expenses.length }, { label: 'إجمالي المصروفات', value: money(expenses.reduce((s, e) => s + e.amount, 0)), tone: 'negative' }],
      };
    case 'profit-margin':
      return {
        columns: ['الفاتورة', 'التاريخ', 'المبيعات الصافية', 'تكلفة البضاعة', 'الربح الإجمالي', 'الهامش'],
        rows: sales.map(s => [s.invoice_number, formatDate(s.date), money(s.total), money(s.cogs), money(s.gross_profit), (s.total > 0 ? (s.gross_profit / s.total * 100).toFixed(1) : '0.0') + '%']),
        summary: [
          { label: 'إجمالي المبيعات', value: money(sales.reduce((s, x) => s + x.total, 0)), tone: 'positive' },
          { label: 'إجمالي الربح المسجل', value: money(sales.reduce((s, x) => s + x.gross_profit, 0)), tone: 'positive' },
          { label: 'هامش الربح المرجح', value: (sales.reduce((s, x) => s + x.total, 0) > 0 ? (sales.reduce((s, x) => s + x.gross_profit, 0) / sales.reduce((s, x) => s + x.total, 0) * 100).toFixed(1) : '0.0') + '%' },
        ],
      };
    case 'expense-analysis': {
      const byCategory = getExpensesByCategory(from, to);
      const total = byCategory.reduce((s, x) => s + x.total, 0);
      return {
        columns: ['فئة المصروف', 'الإجمالي', 'النسبة من المصروفات'],
        rows: byCategory.map(x => [x.category, money(x.total), (total > 0 ? (x.total / total * 100).toFixed(1) : '0.0') + '%']),
        summary: [{ label: 'إجمالي المصروفات', value: money(total), tone: 'negative' }, { label: 'عدد الفئات', value: byCategory.length }],
      };
    }
    case 'moving-stock': {
      const products = getProducts();
      const rows = products.map(p => {
        const movements = getStockMovements(p.id).filter(m => isWithin(m.created_at, from, to));
        return { p, movements, inbound: movements.filter(m => m.quantity > 0).reduce((s, m) => s + m.quantity, 0), outbound: Math.abs(movements.filter(m => m.quantity < 0).reduce((s, m) => s + m.quantity, 0)) };
      }).filter(x => x.movements.length > 0).sort((a, b) => b.movements.length - a.movements.length);
      return {
        columns: ['الصنف', 'الرصيد الحالي', 'حركات واردة', 'حركات صادرة', 'عدد الحركات'],
        rows: rows.map(x => [x.p.trade_name, String(getProductStock(x.p.id)) + ' ' + x.p.inventory_unit, x.inbound, x.outbound, x.movements.length]),
        summary: [{ label: 'الأصناف ذات الحركة', value: rows.length }, { label: 'إجمالي الحركات', value: rows.reduce((s, x) => s + x.movements.length, 0) }],
      };
    }
    case 'dead-stock': {
      const rows = getDeadStock(90);
      return {
        columns: ['الصنف', 'الباركود', 'الرصيد', 'الوحدة', 'متوسط تكلفة الدفعة', 'قيمة التكلفة', 'أقرب انتهاء'],
        rows: rows.map(x => [x.trade_name, x.barcode || '—', x.total_quantity, x.inventory_unit, money(x.batches.reduce((s, b) => s + b.purchase_price, 0) / Math.max(1, x.batches.length)), money(x.batches.reduce((s, b) => s + b.quantity * b.purchase_price, 0)), x.nearest_expiry || '—']),
        summary: [{ label: 'أصناف راكدة', value: rows.length }, { label: 'قيمة تكلفة الأصناف الراكدة', value: money(rows.reduce((s, x) => s + x.batches.reduce((v, b) => v + b.quantity * b.purchase_price, 0), 0)), tone: 'negative' }],
      };
    }
    case 'inventory-value': {
      const qty = inventory.reduce((s, x) => s + x.total_quantity, 0);
      const cost = inventory.reduce((s, x) => s + x.batches.reduce((v, b) => v + b.quantity * b.purchase_price, 0), 0);
      const retail = inventory.reduce((s, x) => s + x.total_quantity * x.selling_price, 0);
      return {
        columns: ['الصنف', 'الفئة', 'الكمية', 'الوحدة', 'قيمة التكلفة', 'قيمة البيع التقديرية', 'الحالة'],
        rows: inventory.map(x => [x.trade_name, x.category || '—', x.total_quantity, x.inventory_unit, money(x.batches.reduce((s, b) => s + b.quantity * b.purchase_price, 0)), money(x.total_quantity * x.selling_price), x.status]),
        summary: [{ label: 'عدد الأصناف', value: inventory.length }, { label: 'قيمة المخزون بالتكلفة', value: money(cost), tone: 'positive' }, { label: 'قيمة البيع التقديرية', value: money(retail), tone: 'positive' }, { label: 'إجمالي الوحدات', value: qty }],
      };
    }
    case 'expired':
    case 'expiring': {
      const list = expiry.filter(x => key === 'expired' ? x.group === 'expired' : x.group !== 'expired' && x.days_to_expiry <= 90).filter(x => isWithin(x.expiry_date, from, to));
      return {
        columns: ['الصنف', 'رقم الدفعة', 'تاريخ الانتهاء', 'الأيام المتبقية', 'الكمية', 'قيمة التكلفة'],
        rows: list.map(x => [x.product_name, x.batch_number, formatDate(x.expiry_date), x.days_to_expiry, String(x.quantity) + ' ' + x.unit, money(x.stock_value)]),
        summary: [{ label: 'عدد الدفعات', value: list.length }, { label: 'قيمة التكلفة المعرضة للخطر', value: money(list.reduce((s, x) => s + x.stock_value, 0)), tone: 'negative' }],
      };
    }
    case 'free-samples': {
      const matches = getProducts().flatMap(p => getStockMovements(p.id).filter(m => isWithin(m.created_at, from, to) && /عينة|مجاني|free.?sample/i.test((m.note || '') + ' ' + m.type)).map(m => [p.trade_name, formatDate(m.created_at), m.type, m.quantity, m.note || '—']));
      return { columns: ['الصنف', 'التاريخ', 'نوع الحركة', 'الكمية', 'البيان'], rows: matches, summary: [{ label: 'حركات العينات الموسومة', value: matches.length }] };
    }
    case 'stock-adjustments': {
      const list = audits.filter(a => /STOCK_ADJUST|ADJUSTMENT|OPENING_STOCK|STOCK_RECONCILE/i.test(a.action + ' ' + a.entity));
      return {
        columns: ['التاريخ', 'المستخدم', 'الإجراء', 'الكيان', 'رقم الكيان', 'السبب'],
        rows: list.map(a => [formatDate(a.created_at), a.user_name || '—', a.action, a.entity, a.entity_id ?? '—', a.reason || '—']),
        summary: [{ label: 'عمليات التدقيق', value: list.length }],
      };
    }
    case 'modified-invoices': {
      const list = audits.filter(a => /SALE_CANCEL|PURCHASE_CANCEL|INVOICE|SALE_UPDATE|PURCHASE_UPDATE|RETURN/i.test(a.action + ' ' + a.entity));
      return {
        columns: ['التاريخ', 'المستخدم', 'الإجراء', 'الكيان', 'رقم الكيان', 'السبب'],
        rows: list.map(a => [formatDate(a.created_at), a.user_name || '—', a.action, a.entity, a.entity_id ?? '—', a.reason || '—']),
        summary: [{ label: 'عمليات التدقيق المرتبطة بالفواتير', value: list.length }],
      };
    }
  }
}

function ReportMetric({ label, value, tone }: { label: string; value: string | number; tone?: 'positive' | 'negative' | 'neutral' }) {
  const { theme } = useTheme();
  const color = tone === 'positive' ? theme.colors.success : tone === 'negative' ? theme.colors.error : theme.colors.textPrimary;
  return <View style={{ flexGrow: 1, minWidth: 130, padding: 12, borderRadius: 10, backgroundColor: theme.colors.surfaceAlt, borderWidth: 1, borderColor: theme.colors.border }}>
    <Text style={{ fontSize: 11, textAlign: 'right', color: theme.colors.textSecondary }}>{label}</Text>
    <Text style={{ fontSize: 16, fontWeight: '800', textAlign: 'right', color, marginTop: 5 }}>{value}</Text>
  </View>;
}

export default function ReportsScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { showAlert } = useAlert();
  const today = getToday();
  const [period, setPeriod] = useState('month');
  const [from, setFrom] = useState(getDateRange('month').from);
  const [to, setTo] = useState(getDateRange('month').to);
  const [selected, setSelected] = useState<ReportKey>('profit-loss');
  const [revision, setRevision] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const applyPeriod = (key: string) => {
    const range = getDateRange(key);
    setPeriod(key); setFrom(range.from); setTo(range.to);
  };
  const selectedReport = REPORTS.find(r => r.key === selected) || REPORTS[0];
  const reportData = useMemo(() => buildRows(selected, from, to), [selected, from, to, revision]);
  const pharmacyName = getSetting('pharmacy_name') || 'صيدليتي';
  const buildPdf = () => buildTableReportHtml({
    pharmacyName, title: selectedReport.title, periodLabel: 'الفترة المحددة', dateRange: from + ' — ' + to,
    accent: selectedReport.color, summary: reportData.summary, columns: reportData.columns, rows: reportData.rows,
    emptyMessage: 'لا توجد بيانات مطابقة للفترة المحددة.',
    footerNote: 'تم إعداد التقرير من البيانات المحلية المسجلة في التطبيق. راجع اكتمال المزامنة قبل اعتماد التقارير المشتركة.',
  });
  useFocusEffect(useCallback(() => { setRevision(value => value + 1); }, []));
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to && to <= today;
  const chooseReport = (key: ReportKey) => { setSelected(key); setRevision(value => value + 1); };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ backgroundColor: '#0052CC', paddingTop: insets.top + 10, paddingBottom: 14, paddingHorizontal: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <Text style={{ fontSize: 19, fontWeight: '800', color: '#FFFFFF' }}>التقارير المالية والإدارية</Text>
          <TouchableOpacity onPress={() => setRevision(value => value + 1)} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.16)' }}>
            <MaterialIcons name="refresh" size={22} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, flexDirection: 'row' }}>
          {PERIODS.map(p => <TouchableOpacity key={p.key} onPress={() => applyPeriod(p.key)} style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18, backgroundColor: period === p.key ? '#FFFFFF' : 'rgba(255,255,255,0.16)' }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: period === p.key ? '#0052CC' : '#FFFFFF' }}>{p.label}</Text>
          </TouchableOpacity>)}
        </ScrollView>
      </View>
      <ScrollView showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); setRevision(value => value + 1); setRefreshing(false); }} colors={['#0052CC']} />}
        contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: 40 }}>
        <Card>
          <Text style={{ fontSize: 14, fontWeight: '800', color: theme.colors.textPrimary, textAlign: 'right', marginBottom: 8 }}>الفترة الزمنية</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, color: theme.colors.textSecondary, textAlign: 'right', marginBottom: 4 }}>من (YYYY-MM-DD)</Text>
              <TextInput value={from} onChangeText={value => { setFrom(value); setPeriod('custom'); }} placeholder="2026-10-01" keyboardType="numbers-and-punctuation" maxLength={10} style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 9, textAlign: 'center', color: theme.colors.textPrimary, backgroundColor: theme.colors.surface }} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, color: theme.colors.textSecondary, textAlign: 'right', marginBottom: 4 }}>إلى (YYYY-MM-DD)</Text>
              <TextInput value={to} onChangeText={value => { setTo(value); setPeriod('custom'); }} placeholder={today} keyboardType="numbers-and-punctuation" maxLength={10} style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 9, textAlign: 'center', color: theme.colors.textPrimary, backgroundColor: theme.colors.surface }} />
            </View>
          </View>
          {!dateValid && <Text style={{ color: theme.colors.error, fontSize: 11, textAlign: 'right', marginTop: 7 }}>تحقق من التاريخين: الصيغة YYYY-MM-DD، والبداية قبل النهاية، والنهاية ليست في المستقبل.</Text>}
          <Text style={{ fontSize: 11, color: theme.colors.textTertiary, textAlign: 'right', marginTop: 7 }}>التقارير المالية تتبع تاريخ العملية؛ تقارير الانتهاء تتبع تاريخ انتهاء الدفعة. تقرير الركود يستخدم نافذة 90 يومًا.</Text>
        </Card>
        {GROUPS.map(group => <View key={group.key} style={{ gap: 8 }}>
          <Text style={{ fontSize: 15, fontWeight: '800', color: theme.colors.textPrimary, textAlign: 'right' }}>{group.title}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {REPORTS.filter(report => report.group === group.key).map(report => {
              const active = selected === report.key;
              return <TouchableOpacity key={report.key} onPress={() => chooseReport(report.key)} activeOpacity={0.75}
                style={{ width: '48%', minHeight: 98, padding: 11, borderRadius: 12, borderWidth: active ? 2 : 1, borderColor: active ? report.color : theme.colors.border, backgroundColor: active ? report.color + '12' : theme.colors.surface, justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <MaterialIcons name={report.icon as any} size={21} color={report.color} />
                  {active && <MaterialIcons name="check-circle" size={17} color={report.color} />}
                </View>
                <Text style={{ color: theme.colors.textPrimary, fontSize: 12, fontWeight: '800', textAlign: 'right', marginTop: 7 }}>{report.title}</Text>
                <Text style={{ color: theme.colors.textTertiary, fontSize: 10, textAlign: 'right', marginTop: 4 }}>{report.subtitle}</Text>
              </TouchableOpacity>;
            })}
          </View>
        </View>)}
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <PdfActions buildHtml={buildPdf} title={selectedReport.title} onError={message => showAlert('تعذر إنشاء التقرير', message)} />
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={{ fontSize: 16, fontWeight: '800', color: selectedReport.color, textAlign: 'right' }}>{selectedReport.title}</Text>
              <Text style={{ fontSize: 10, color: theme.colors.textTertiary, textAlign: 'right', marginTop: 3 }}>{from} — {to}</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {reportData.summary.map(metric => <ReportMetric key={metric.label} {...metric} />)}
          </View>
          {reportData.rows.length === 0 ? <View style={{ alignItems: 'center', paddingVertical: 24 }}>
            <MaterialIcons name="insert-chart-outlined" size={36} color={theme.colors.textTertiary} />
            <Text style={{ color: theme.colors.textSecondary, textAlign: 'center', marginTop: 8 }}>لا توجد بيانات مسجلة مطابقة لهذا التقرير والفترة.</Text>
            {selected === 'free-samples' && <Text style={{ color: theme.colors.textTertiary, textAlign: 'center', fontSize: 11, marginTop: 5 }}>يظهر التقرير الحركات التي وُسمت في الملاحظات بكلمة «عينة» أو «مجاني» فقط.</Text>}
          </View> : <ScrollView horizontal showsHorizontalScrollIndicator>
            <View>
              <View style={{ flexDirection: 'row', backgroundColor: theme.colors.surfaceAlt, borderBottomWidth: 1, borderColor: theme.colors.border }}>
                {reportData.columns.map((column, index) => <Text key={column + '-' + index} style={{ minWidth: 104, maxWidth: 190, padding: 9, textAlign: 'right', fontSize: 11, fontWeight: '800', color: theme.colors.textPrimary }}>{column}</Text>)}
              </View>
              {reportData.rows.slice(0, 500).map((row, rowIndex) => <View key={'row-' + rowIndex} style={{ flexDirection: 'row', borderBottomWidth: 1, borderColor: theme.colors.divider }}>
                {row.map((cell, cellIndex) => <Text key={'cell-' + rowIndex + '-' + cellIndex} style={{ minWidth: 104, maxWidth: 190, padding: 9, textAlign: 'right', fontSize: 11, color: theme.colors.textSecondary }}>{String(cell)}</Text>)}
              </View>)}
              {reportData.rows.length > 500 && <Text style={{ color: theme.colors.textTertiary, textAlign: 'right', padding: 8, fontSize: 11 }}>يعرض التطبيق أول 500 صف؛ ملف PDF يتضمن البيانات التي أُعدت للتقرير.</Text>}
            </View>
          </ScrollView>}
        </Card>
        <Text style={{ fontSize: 10, color: theme.colors.textTertiary, textAlign: 'center', paddingHorizontal: 8 }}>
          التقارير مبنية على البيانات المحلية الحالية. لا تعتبرها تقارير موحّدة بين الأجهزة حتى تُنفّذ المزامنة السحابية وتُختبر فعليًا.
        </Text>
      </ScrollView>
    </View>
  );
}
