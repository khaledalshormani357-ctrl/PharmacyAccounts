import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import {
  getPurchase, getPurchaseReturn, getSale, getSaleReturn,
  PurchaseReturn, SaleReturn, getSetting,
} from '@/services/database';
import { formatCurrency, formatDate } from '@/constants/i18n';
import { PdfActions } from '@/components/PdfActions';
import { buildReturnInvoiceHtml } from '@/services/pdfReport';
import { useAlert } from '@/template';

function settlementName(value?: string): string {
  switch (value) {
    case 'CASH_REFUND': return 'رد نقدي';
    case 'CUSTOMER_BALANCE': return 'خصم من حساب العميل';
    case 'CUSTOMER_CREDIT': return 'رصيد دائن للعميل';
    case 'SUPPLIER_BALANCE': return 'قيد على حساب المورد';
    default: return 'تسوية مسجلة';
  }
}

export default function ReturnDetailScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showAlert } = useAlert();
  const params = useLocalSearchParams<{ type?: string | string[]; returnId?: string | string[] }>();
  const kind = params.type === 'purchase' || (Array.isArray(params.type) && params.type[0] === 'purchase') ? 'purchase' : 'sale';
  const rawId = Array.isArray(params.returnId) ? params.returnId[0] : params.returnId;
  const id = Number(rawId);
  const saleReturn = kind === 'sale' && Number.isFinite(id) ? getSaleReturn(id) : null;
  const purchaseReturn = kind === 'purchase' && Number.isFinite(id) ? getPurchaseReturn(id) : null;
  const record: SaleReturn | PurchaseReturn | null = saleReturn || purchaseReturn;
  if (!record) return <View style={{ flex: 1, backgroundColor: theme.colors.background, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: theme.colors.textSecondary }}>تعذر العثور على مستند المرتجع.</Text></View>;

  const original = kind === 'sale' ? getSale((record as SaleReturn).sale_id) : getPurchase((record as PurchaseReturn).purchase_id);
  const partyName = kind === 'sale' ? (original as any)?.customer_name || 'عميل نقدي' : (original as any)?.supplier_name || 'مورد مباشر';
  const returnNumber = record.return_number || `${kind === 'sale' ? 'SR' : 'PR'}-${String(record.id).padStart(6, '0')}`;
  const title = kind === 'sale' ? 'مرتجع مبيعات' : 'مرتجع مشتريات';
  const accent = kind === 'sale' ? theme.colors.income : '#6554C0';
  const settlement = settlementName(record.settlement_method);
  const buildPdf = () => buildReturnInvoiceHtml({
    pharmacyName: getSetting('pharmacy_name') || 'صيدليتي',
    kind,
    returnNumber,
    originalInvoiceNumber: original?.invoice_number || record.invoice_number,
    date: formatDate(record.date),
    partyName,
    settlementLabel: settlement,
    notes: record.notes,
    total: record.total,
    items: record.items.map(item => ({
      name: item.product_name,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unit_price ?? (item.quantity ? item.refund_amount / item.quantity : 0),
      total: item.refund_amount,
    })),
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ paddingTop: insets.top + 8, paddingBottom: 14, paddingHorizontal: 14, backgroundColor: accent }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <TouchableOpacity onPress={() => router.back()} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.16)' }}><MaterialIcons name="arrow-forward" size={20} color="#FFFFFF" /></TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'center' }}><Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 16 }}>{title}</Text><Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 11, marginTop: 2 }}>{returnNumber}</Text></View>
          <PdfActions buildHtml={buildPdf} title={`${title} ${returnNumber}`} onError={message => showAlert('تعذر إنشاء المستند', message)} />
        </View>
        <View style={{ backgroundColor: 'rgba(0,0,0,0.13)', borderRadius: 12, padding: 13 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ color: '#FFFFFF', fontWeight: '900', fontSize: 20 }}>{formatCurrency(record.total)}</Text><Text style={{ color: '#FFFFFF', fontWeight: '700' }}>الإجمالي</Text></View>
          <Text style={{ textAlign: 'right', color: '#FFFFFF', marginTop: 8 }}>{kind === 'sale' ? 'العميل' : 'المورد'}: {partyName}</Text>
          <Text style={{ textAlign: 'right', color: 'rgba(255,255,255,0.86)', marginTop: 4 }}>الأصل: {original?.invoice_number || record.invoice_number} · {formatDate(record.date)}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 32 }}>
        <TouchableOpacity onPress={() => router.push({ pathname: kind === 'sale' ? '/sale-detail' : '/purchase-detail', params: { id: String(kind === 'sale' ? (record as SaleReturn).sale_id : (record as PurchaseReturn).purchase_id) } } as any)} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderRadius: 10, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 12 }}>
          <MaterialIcons name="open-in-new" size={18} color={theme.colors.primary} />
          <Text style={{ color: theme.colors.primary, fontWeight: '700' }}>عرض الفاتورة الأصلية — {original?.invoice_number || record.invoice_number}</Text>
        </TouchableOpacity>

        <View style={{ padding: 14, borderRadius: 11, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 12 }}>
          <Text style={{ textAlign: 'right', fontWeight: '800', color: theme.colors.textPrimary, marginBottom: 9 }}>بيانات المعاملة</Text>
          {[
            ['طريقة التسوية', settlement],
            ['المستخدم', record.user_name || 'غير مسجل'],
            ['الحالة', record.status === 'POSTED' ? 'معتمد — سجل ثابت' : 'مسجل'],
            ...(kind === 'sale' ? [['حالة البضاعة', (record as SaleReturn).condition === 'DAMAGED' ? 'تالف / محجور خارج الرصيد المتاح' : 'صالح لإعادة البيع']] : []),
          ].map(([label, value], index) => <View key={index} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: index < 3 ? 1 : 0, borderBottomColor: theme.colors.divider }}><Text style={{ color: theme.colors.textPrimary, fontSize: 12 }}>{value}</Text><Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>{label}</Text></View>)}
        </View>

        <View style={{ borderRadius: 11, overflow: 'hidden', backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }}>
          <Text style={{ padding: 12, textAlign: 'right', color: theme.colors.textPrimary, fontWeight: '800', borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>الأصناف المرتجعة ({record.items.length})</Text>
          {record.items.map((item, index) => {
            const originalQuantity = item.original_quantity ?? item.quantity;
            const previouslyReturned = item.previously_returned_quantity ?? 0;
            const returnableAfter = Math.max(0, originalQuantity - previouslyReturned - item.quantity);
            return <View key={item.id} style={{ padding: 13, borderBottomWidth: index < record.items.length - 1 ? 1 : 0, borderBottomColor: theme.colors.divider }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Text style={{ color: accent, fontWeight: '800' }}>{formatCurrency(item.refund_amount)}</Text><Text style={{ color: theme.colors.textPrimary, fontWeight: '700' }}>{item.product_name}</Text></View>
              <Text style={{ textAlign: 'right', color: theme.colors.textSecondary, fontSize: 11, marginTop: 5 }}>الأصل {originalQuantity} · المرتجع سابقًا {previouslyReturned} · في هذا المرتجع {item.quantity} · المتبقي القابل للإرجاع {returnableAfter} {item.unit}</Text>
              <Text style={{ textAlign: 'right', color: theme.colors.textTertiary, fontSize: 10, marginTop: 3 }}>السعر التاريخي: {formatCurrency(item.unit_price ?? (item.quantity ? item.refund_amount / item.quantity : 0))} · معامل التحويل: {item.conversion_factor} · كمية الأساس: {item.quantity_in_inventory_unit}</Text>
              {kind === 'sale' && (item as any).condition === 'DAMAGED' && <Text style={{ textAlign: 'right', color: theme.colors.error, fontSize: 10, marginTop: 3 }}>تالف ومحجور عن البيع، محفوظ على الدفعة الأصلية.</Text>}
            </View>;
          })}
          <View style={{ padding: 13, flexDirection: 'row', justifyContent: 'space-between', backgroundColor: theme.colors.surfaceAlt }}><Text style={{ color: accent, fontWeight: '900', fontSize: 16 }}>{formatCurrency(record.total)}</Text><Text style={{ color: theme.colors.textPrimary, fontWeight: '900' }}>إجمالي المرتجع</Text></View>
        </View>
        {record.notes ? <View style={{ marginTop: 12, padding: 12, borderRadius: 10, backgroundColor: theme.colors.surfaceAlt }}><Text style={{ color: theme.colors.textSecondary, textAlign: 'right', fontSize: 11 }}>ملاحظات</Text><Text style={{ color: theme.colors.textPrimary, textAlign: 'right', marginTop: 4 }}>{record.notes}</Text></View> : null}
        <Text style={{ color: theme.colors.textTertiary, textAlign: 'center', fontSize: 10, marginTop: 14 }}>هذا مستند مستقل؛ الفاتورة الأصلية باقية دون تعديل. لا يمكن حذف المرتجع المعتمد.</Text>
      </ScrollView>
    </View>
  );
}
