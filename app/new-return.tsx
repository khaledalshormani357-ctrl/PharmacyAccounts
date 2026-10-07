import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import {
  createPurchaseReturn, createSaleReturn, getCustomer, getProduct, getPurchase,
  getPurchaseItemReturnableQuantity, getPurchaseItemReturnedQuantity, getPurchaseItems, getPurchases,
  getSale, getSaleItemReturnableQuantity, getSaleItemReturnedQuantity, getSaleItems, getSales,
  getSupplier, Purchase, PurchaseItem, Sale, SaleItem, ReturnSettlementMethod,
} from '@/services/database';
import { formatCurrency, formatDate } from '@/constants/i18n';
import { useAlert } from '@/template';

type ReturnKind = 'sale' | 'purchase';
type SourceInvoice = Sale | Purchase;
type SourceItem = SaleItem | PurchaseItem;

const settlementNames: Record<string, string> = {
  CASH_REFUND: 'رد نقدي',
  CUSTOMER_BALANCE: 'خصم من حساب العميل',
  CUSTOMER_CREDIT: 'رصيد دائن للعميل',
  SUPPLIER_BALANCE: 'قيد على حساب المورد',
};

function selectedType(value: string | string[] | undefined): ReturnKind {
  return value === 'purchase' || (Array.isArray(value) && value[0] === 'purchase') ? 'purchase' : 'sale';
}

function returnValue(kind: ReturnKind, invoice: SourceInvoice, item: SourceItem, quantity: number): number {
  if (!Number.isFinite(quantity) || quantity <= 0 || item.quantity <= 0) return 0;
  if (kind === 'sale') {
    const sale = invoice as Sale;
    const line = item as SaleItem;
    const invoiceDiscountShare = sale.subtotal > 0 ? sale.discount * line.line_total / sale.subtotal : 0;
    const netLine = Math.max(0, line.line_total - invoiceDiscountShare);
    return quantity * netLine / line.quantity;
  }
  const purchase = invoice as Purchase;
  const line = item as PurchaseItem;
  const invoiceDiscountShare = purchase.subtotal > 0 ? purchase.discount * line.line_total / purchase.subtotal : 0;
  const netLine = Math.max(0, line.line_total - invoiceDiscountShare);
  const receivedQuantity = line.quantity + line.free_quantity;
  return receivedQuantity > 0 ? quantity * netLine / receivedQuantity : 0;
}

function useStableOperationKey() {
  const key = useRef(`return-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  return key.current;
}

export default function NewReturnScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showAlert } = useAlert();
  const params = useLocalSearchParams<{ type?: string | string[]; invoiceId?: string | string[] }>();
  const kind = selectedType(params.type);
  const initialInvoiceId = Array.isArray(params.invoiceId) ? params.invoiceId[0] : params.invoiceId;
  const initialInvoice = initialInvoiceId ? (kind === 'sale' ? getSale(Number(initialInvoiceId)) : getPurchase(Number(initialInvoiceId))) : null;
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(initialInvoiceId ? Number(initialInvoiceId) : null);
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [settlement, setSettlement] = useState<ReturnSettlementMethod>(() => kind === 'sale'
    ? ((initialInvoice as Sale | null)?.customer_id ? 'CUSTOMER_BALANCE' : 'CASH_REFUND')
    : ((initialInvoice as Purchase | null)?.supplier_id ? 'SUPPLIER_BALANCE' : 'CASH_REFUND'));
  const [condition, setCondition] = useState<'SELLABLE' | 'DAMAGED'>('SELLABLE');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const operationKey = useStableOperationKey();
  const [, setRevision] = useState(0);

  const load = useCallback(() => setRevision(value => value + 1), []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const invoices: SourceInvoice[] = kind === 'sale' ? getSales({ includeCancelled: false }) : getPurchases();
  const selectedInvoice = selectedId === null ? null : (kind === 'sale' ? getSale(selectedId) : getPurchase(selectedId));
  const sourceItems: SourceItem[] = selectedInvoice ? (kind === 'sale' ? getSaleItems(selectedId!) : getPurchaseItems(selectedId!)) : [];
  const partyName = selectedInvoice ? (kind === 'sale' ? (selectedInvoice as Sale).customer_name : (selectedInvoice as Purchase).supplier_name) : '';
  const hasAccountParty = selectedInvoice ? (kind === 'sale' ? !!(selectedInvoice as Sale).customer_id : !!(selectedInvoice as Purchase).supplier_id) : false;
  const accent = kind === 'sale' ? theme.colors.income : '#6554C0';

  const matches = useMemo(() => {
    const q = search.trim().toLocaleLowerCase();
    return invoices.filter(invoice => {
      const items = kind === 'sale' ? getSaleItems(invoice.id) : getPurchaseItems(invoice.id);
      const party = kind === 'sale' ? (invoice as Sale).customer_name : (invoice as Purchase).supplier_name;
      const partyId = kind === 'sale' ? (invoice as Sale).customer_id : (invoice as Purchase).supplier_id;
      const phone = kind === 'sale' && partyId ? getCustomer(partyId)?.phone : kind === 'purchase' && partyId ? getSupplier(partyId)?.phone : '';
      const lineSearch = items.map(item => `${item.product_name} ${getProduct(item.product_id)?.barcode || ''}`).join(' ');
      const text = `${invoice.invoice_number} ${party || ''} ${invoice.date} ${phone || ''} ${lineSearch}`.toLocaleLowerCase();
      const hasReturnable = items.some(item => kind === 'sale'
        ? getSaleItemReturnableQuantity(item.id) > 0
        : getPurchaseItemReturnableQuantity(item.id) > 0);
      return hasReturnable && (!q || text.includes(q));
    }).slice(0, 60);
  }, [invoices, kind, search]);

  const totals = sourceItems.reduce((sum, item) => {
    const quantity = Number(quantities[item.id] || 0);
    return sum + returnValue(kind, selectedInvoice as SourceInvoice, item, Number.isFinite(quantity) ? quantity : 0);
  }, 0);

  const setQuantity = (itemId: number, value: string) => setQuantities(current => ({ ...current, [itemId]: value }));
  const selectInvoice = (invoice: SourceInvoice) => {
    setSelectedId(invoice.id);
    setQuantities({});
    setSearch('');
    setSettlement(kind === 'sale' ? ((invoice as Sale).customer_id ? 'CUSTOMER_BALANCE' : 'CASH_REFUND') : ((invoice as Purchase).supplier_id ? 'SUPPLIER_BALANCE' : 'CASH_REFUND'));
  };
  const fillAllReturnable = () => {
    const values: Record<number, string> = {};
    sourceItems.forEach(item => {
      const remaining = kind === 'sale' ? getSaleItemReturnableQuantity(item.id) : getPurchaseItemReturnableQuantity(item.id);
      values[item.id] = remaining > 0 ? String(remaining) : '';
    });
    setQuantities(values);
  };

  const submit = () => {
    if (!selectedInvoice) { showAlert('اختر الفاتورة', 'حدد الفاتورة الأصلية أولًا.'); return; }
    const chosen = sourceItems.map(item => ({ item, quantity: Number(quantities[item.id] || 0) })).filter(row => row.quantity > 0);
    if (!chosen.length) { showAlert('لا توجد كميات', 'أدخل كمية موجبة لصنف واحد على الأقل.'); return; }
    for (const row of chosen) {
      const available = kind === 'sale' ? getSaleItemReturnableQuantity(row.item.id) : getPurchaseItemReturnableQuantity(row.item.id);
      if (!Number.isFinite(row.quantity) || row.quantity <= 0 || row.quantity > available) {
        showAlert('كمية غير صحيحة', 'الكمية المرتجعة تتجاوز الكمية المتبقية القابلة للإرجاع.'); return;
      }
    }
    setSaving(true);
    const result = kind === 'sale'
      ? createSaleReturn({ sale_id: selectedInvoice.id, items: chosen.map(row => ({ sale_item_id: row.item.id, quantity: row.quantity })), settlement_method: settlement as Extract<ReturnSettlementMethod, 'CASH_REFUND' | 'CUSTOMER_BALANCE' | 'CUSTOMER_CREDIT'>, condition, notes, idempotency_key: `${operationKey}-sale-${selectedInvoice.id}` })
      : createPurchaseReturn({ purchase_id: selectedInvoice.id, items: chosen.map(row => ({ purchase_item_id: row.item.id, quantity: row.quantity })), settlement_method: settlement as Extract<ReturnSettlementMethod, 'CASH_REFUND' | 'SUPPLIER_BALANCE'>, notes, idempotency_key: `${operationKey}-purchase-${selectedInvoice.id}` });
    setSaving(false);
    if (!result.success) { showAlert('تعذر تسجيل المرتجع', result.error); return; }
    router.replace({ pathname: '/return-detail', params: { type: kind, returnId: String(result.record.id) } } as any);
  };

  const settlementOptions: { value: ReturnSettlementMethod; label: string }[] = kind === 'sale'
    ? [{ value: 'CASH_REFUND', label: settlementNames.CASH_REFUND }, { value: 'CUSTOMER_BALANCE', label: settlementNames.CUSTOMER_BALANCE }, { value: 'CUSTOMER_CREDIT', label: settlementNames.CUSTOMER_CREDIT }]
    : [{ value: 'CASH_REFUND', label: settlementNames.CASH_REFUND }, { value: 'SUPPLIER_BALANCE', label: settlementNames.SUPPLIER_BALANCE }];

  const Header = <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 14, paddingBottom: 12, backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <TouchableOpacity onPress={() => router.back()} style={{ width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceAlt }}><MaterialIcons name="arrow-forward" size={20} color={theme.colors.textPrimary} /></TouchableOpacity>
      <Text style={{ fontSize: 17, fontWeight: '800', color: theme.colors.textPrimary }}>{kind === 'sale' ? 'إنشاء مرتجع مبيعات' : 'إنشاء مرتجع مشتريات'}</Text>
      <View style={{ width: 38 }} />
    </View>
    <Text style={{ color: theme.colors.textTertiary, fontSize: 11, textAlign: 'right', marginTop: 6 }}>يُنشأ مستند مستقل؛ الفاتورة الأصلية لا تتغير ولا تُلغى.</Text>
  </View>;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {Header}
      {!selectedInvoice ? <>
        <View style={{ margin: 14, flexDirection: 'row', alignItems: 'center', borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, paddingHorizontal: 10 }}>
          <MaterialIcons name="search" size={20} color={theme.colors.textTertiary} />
          <TextInput value={search} onChangeText={setSearch} placeholder="رقم الفاتورة، الطرف، التاريخ، الهاتف، الدواء أو الباركود" placeholderTextColor={theme.colors.textTertiary} style={{ flex: 1, height: 46, paddingHorizontal: 8, color: theme.colors.textPrimary, textAlign: 'right', fontSize: 12 }} />
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
          {matches.map(invoice => {
            const party = kind === 'sale' ? (invoice as Sale).customer_name : (invoice as Purchase).supplier_name;
            const title = kind === 'sale' ? 'بيع' : 'شراء';
            return <TouchableOpacity key={invoice.id} onPress={() => selectInvoice(invoice)} style={{ padding: 14, backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ color: accent, fontWeight: '800' }}>{formatCurrency(invoice.total)}</Text><Text style={{ color: theme.colors.textPrimary, fontWeight: '700' }}>{invoice.invoice_number}</Text></View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 }}><Text style={{ color: theme.colors.textTertiary, fontSize: 11 }}>{formatDate(invoice.date)}</Text><Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>{party || (kind === 'sale' ? 'عميل نقدي' : 'مورد مباشر')}</Text></View>
              <Text style={{ textAlign: 'right', marginTop: 4, color: theme.colors.textTertiary, fontSize: 10 }}>فاتورة {title} · اخترها لتحديد الأصناف المتاحة للإرجاع</Text>
            </TouchableOpacity>;
          })}
          {!matches.length && <Text style={{ textAlign: 'center', color: theme.colors.textTertiary, padding: 32 }}>لا توجد فواتير قابلة للإرجاع مطابقة للبحث.</Text>}
        </ScrollView>
      </> : <>
        <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 24 }}>
          <View style={{ padding: 14, backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <TouchableOpacity onPress={() => { setSelectedId(null); setQuantities({}); }}><Text style={{ color: theme.colors.primary, fontWeight: '700', fontSize: 12 }}>تغيير</Text></TouchableOpacity>
              <Text style={{ fontWeight: '800', color: theme.colors.textPrimary, fontSize: 15 }}>{selectedInvoice.invoice_number}</Text>
            </View>
            <Text style={{ color: theme.colors.textSecondary, textAlign: 'right', marginTop: 5 }}>{partyName || (kind === 'sale' ? 'عميل نقدي' : 'مورد مباشر')} · {formatDate(selectedInvoice.date)}</Text>
            <Text style={{ color: theme.colors.textTertiary, textAlign: 'right', fontSize: 11, marginTop: 4 }}>القيمة تُحتسب من السعر والخصم التاريخيين في الفاتورة الأصلية.</Text>
          </View>

          <TouchableOpacity onPress={fillAllReturnable} style={{ marginBottom: 10, height: 40, borderRadius: 9, backgroundColor: theme.colors.warningLight, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: theme.colors.warning, fontWeight: '800', fontSize: 12 }}>إرجاع كامل الكميات المتبقية القابلة للإرجاع</Text>
          </TouchableOpacity>

          {sourceItems.map(item => {
            const remaining = kind === 'sale' ? getSaleItemReturnableQuantity(item.id) : getPurchaseItemReturnableQuantity(item.id);
            const returned = kind === 'sale' ? getSaleItemReturnedQuantity(item.id) : getPurchaseItemReturnedQuantity(item.id);
            const original = kind === 'sale' ? (item as SaleItem).quantity : (item as PurchaseItem).quantity + (item as PurchaseItem).free_quantity;
            const unit = item.unit_name || item.unit;
            const currentQuantity = Number(quantities[item.id] || 0);
            const lineValue = returnValue(kind, selectedInvoice, item, Number.isFinite(currentQuantity) ? currentQuantity : 0);
            return <View key={item.id} style={{ padding: 13, borderRadius: 11, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, marginBottom: 9, opacity: remaining > 0 ? 1 : 0.55 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontWeight: '800', color: accent, fontSize: 13 }}>{formatCurrency(lineValue)}</Text>
                <Text style={{ fontWeight: '700', color: theme.colors.textPrimary, flex: 1, textAlign: 'right', marginLeft: 10 }}>{item.product_name}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 7 }}>
                <Text style={{ fontSize: 10, color: theme.colors.textTertiary }}>الأصل {original} · سابقًا {returned} · المتاح {remaining} {unit}</Text>
                <Text style={{ fontSize: 10, color: theme.colors.textSecondary }}>السعر التاريخي {formatCurrency(returnValue(kind, selectedInvoice, item, 1))}/{unit}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginTop: 9 }}>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>الكمية الحالية</Text>
                <TextInput value={quantities[item.id] || ''} editable={remaining > 0} onChangeText={value => setQuantity(item.id, value)} keyboardType="decimal-pad" placeholder={remaining > 0 ? `حتى ${remaining}` : 'مكتمل'} placeholderTextColor={theme.colors.textTertiary} style={{ width: 104, height: 42, textAlign: 'center', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8, color: theme.colors.textPrimary, backgroundColor: theme.colors.background }} />
              </View>
            </View>;
          })}

          <View style={{ padding: 13, borderRadius: 11, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, marginTop: 3, marginBottom: 10 }}>
            <Text style={{ textAlign: 'right', fontWeight: '800', color: theme.colors.textPrimary, marginBottom: 9 }}>طريقة التسوية</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, justifyContent: 'flex-end' }}>
              {settlementOptions.map(option => {
                const requiresParty = option.value !== 'CASH_REFUND';
                const disabled = requiresParty && !hasAccountParty;
                const active = settlement === option.value;
                return <TouchableOpacity key={option.value} disabled={disabled} onPress={() => setSettlement(option.value)} style={{ paddingHorizontal: 10, paddingVertical: 8, borderRadius: 16, backgroundColor: active ? accent : theme.colors.surfaceAlt, opacity: disabled ? 0.45 : 1 }}>
                  <Text style={{ color: active ? '#FFFFFF' : theme.colors.textSecondary, fontSize: 11, fontWeight: '700' }}>{option.label}</Text>
                </TouchableOpacity>;
              })}
            </View>
            {kind === 'sale' && <Text style={{ textAlign: 'right', color: theme.colors.textTertiary, fontSize: 10, marginTop: 7 }}>تسويات حساب العميل تحتاج فاتورة مرتبطة بعميل.</Text>}
          </View>

          {kind === 'sale' && <View style={{ padding: 13, borderRadius: 11, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 10 }}>
            <Text style={{ textAlign: 'right', fontWeight: '800', color: theme.colors.textPrimary, marginBottom: 9 }}>حالة البضاعة المرتجعة</Text>
            <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
              {[{ value: 'SELLABLE', label: 'صالحة لإعادة البيع' }, { value: 'DAMAGED', label: 'تالف / محجور' }].map(option => <TouchableOpacity key={option.value} onPress={() => setCondition(option.value as 'SELLABLE' | 'DAMAGED')} style={{ paddingHorizontal: 10, paddingVertical: 8, borderRadius: 16, backgroundColor: condition === option.value ? (option.value === 'DAMAGED' ? theme.colors.error : accent) : theme.colors.surfaceAlt }}><Text style={{ color: condition === option.value ? '#FFFFFF' : theme.colors.textSecondary, fontSize: 11, fontWeight: '700' }}>{option.label}</Text></TouchableOpacity>)}
            </View>
            <Text style={{ textAlign: 'right', color: theme.colors.textTertiary, fontSize: 10, marginTop: 7 }}>المحجور يُسجل على الدفعة الأصلية ولا يزيد الكمية المتاحة للبيع.</Text>
          </View>}

          <View style={{ padding: 13, borderRadius: 11, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 12 }}>
            <Text style={{ textAlign: 'right', fontWeight: '800', color: theme.colors.textPrimary, marginBottom: 6 }}>ملاحظات</Text>
            <TextInput value={notes} onChangeText={setNotes} multiline placeholder="اختياري" placeholderTextColor={theme.colors.textTertiary} style={{ minHeight: 58, textAlign: 'right', textAlignVertical: 'top', color: theme.colors.textPrimary, borderRadius: 8, backgroundColor: theme.colors.background, padding: 9 }} />
            <View style={{ borderTopWidth: 1, borderTopColor: theme.colors.divider, marginTop: 10, paddingTop: 10, flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: accent, fontSize: 17, fontWeight: '900' }}>{formatCurrency(totals)}</Text>
              <Text style={{ color: theme.colors.textPrimary, fontWeight: '800' }}>إجمالي المرتجع التقديري</Text>
            </View>
          </View>
          <Text style={{ textAlign: 'right', color: theme.colors.textTertiary, fontSize: 10, marginBottom: 8 }}>سيسجل مستخدم العملية إن توفر معرّفه في الجلسة الحالية؛ لا توجد في التطبيق واجهة دور نشطة خاصة بالمرتجعات.</Text>
        </ScrollView>
        <View style={{ paddingHorizontal: 14, paddingTop: 9, paddingBottom: insets.bottom + 10, backgroundColor: theme.colors.surface, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
          <TouchableOpacity disabled={saving || totals <= 0} onPress={submit} style={{ height: 50, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: accent, opacity: saving || totals <= 0 ? 0.5 : 1 }}>
            <Text style={{ color: '#FFFFFF', fontWeight: '900' }}>{saving ? 'جارٍ التسجيل…' : `تأكيد وإنشاء ${kind === 'sale' ? 'مرتجع البيع' : 'مرتجع الشراء'} · ${formatCurrency(totals)}`}</Text>
          </TouchableOpacity>
        </View>
      </>}
    </View>
  );
}
