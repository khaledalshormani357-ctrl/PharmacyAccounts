// Smart Pharmacy ERP — Sale Detail
import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams , useFocusEffect } from 'expo-router';
import { useTheme } from '@/contexts/ThemeContext';
import { getSale, getSaleItems, cancelSale, getSaleItemReturnableQuantity, getSaleItemReturnedQuantity, getSaleReturns, getSetting, Sale, SaleItem, SaleReturn } from '@/services/database';
import { formatCurrency, formatDateTime } from '@/constants/i18n';
import { useAlert } from '@/template';
import { PdfActions } from '@/components/PdfActions';
import { buildInvoiceHtml } from '@/services/pdfReport';

export default function SaleDetailScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showAlert } = useAlert();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [sale, setSale] = useState<Sale | null>(null);
  const [items, setItems] = useState<SaleItem[]>([]);
  const [returns, setReturns] = useState<SaleReturn[]>([]);

  const load = useCallback(() => {
    if (!id) return;
    const sid = parseInt(id);
    setSale(getSale(sid));
    setItems(getSaleItems(sid));
    setReturns(getSaleReturns(sid));
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!sale) return null;

  const typeColor = sale.sale_type === 'cash' ? theme.colors.income : theme.colors.credit;
  const typeLabel = sale.sale_type === 'cash' ? 'نقدي' : 'آجل';
  const remainingAfterReturns = Math.max(0, sale.remaining - returns.reduce((sum, entry) => sum + entry.credit_reduction, 0));
  const buildInvoicePdf = () => buildInvoiceHtml({
    pharmacyName: getSetting('pharmacy_name') || 'صيدليتي',
    kind: 'sale',
    invoiceNumber: sale.invoice_number,
    date: formatDateTime(sale.created_at),
    partyName: sale.customer_name,
    paymentLabel: `بيع ${typeLabel}`,
    cancelled: sale.cancelled,
    cancelReason: sale.cancel_reason,
    subtotal: sale.subtotal,
    discount: sale.discount,
    total: sale.total,
    amountPaid: sale.amount_paid,
    remaining: sale.remaining,
    changeGiven: sale.change_given,
    notes: sale.notes,
    items: items.map(item => ({
      name: item.product_name,
      quantity: item.quantity,
      unit: item.unit_name || item.unit,
      unitPrice: item.unit_price,
      discount: item.discount,
      total: item.line_total,
    })),
  });
  const returnStatus = sale?.cancelled ? 'ملغاة'
    : returns.length === 0 ? 'نشطة — بلا مرتجعات'
      : items.some(item => getSaleItemReturnableQuantity(item.id) > 0) ? 'مرتجعة جزئيًا'
        : 'مرتجعة بالكامل';

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ backgroundColor: typeColor, paddingTop: insets.top + 10, paddingBottom: 16, paddingHorizontal: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {!sale.cancelled && returns.length === 0 && (
              <TouchableOpacity
                onPress={() => showAlert('إلغاء الفاتورة', 'هل تريد إلغاء هذه الفاتورة؟', [
                  { text: 'لا', style: 'cancel' },
                  { text: 'إلغاء', style: 'destructive', onPress: () => { cancelSale(sale.id, 'إلغاء من التفاصيل'); load(); } },
                ])}
                style={{ backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 }}
              >
                <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '600' }}>إلغاء</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => router.back()} style={{ width: 34, height: 34, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
              <MaterialIcons name="arrow-forward" size={20} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          <Text style={{ fontSize: 16, fontWeight: '700', color: '#FFFFFF' }}>{sale.invoice_number}</Text>
          <PdfActions buildHtml={buildInvoicePdf} title={`فاتورة ${sale.invoice_number}`} onError={(message) => showAlert('خطأ', message)} />
        </View>

        {sale.cancelled && (
          <View style={{ backgroundColor: theme.colors.error, borderRadius: 8, padding: 8, marginBottom: 10, alignItems: 'center' }}>
            <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '700' }}>⚠️ هذه الفاتورة ملغاة</Text>
            {sale.cancel_reason ? <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 11, marginTop: 2 }}>السبب: {sale.cancel_reason}</Text> : null}
          </View>
        )}
        {returns.length > 0 && (
          <View style={{ backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 8, padding: 8, marginBottom: 10 }}>
            <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '700', textAlign: 'right' }}>مرتجعات مسجلة: {returns.length} — {formatCurrency(returns.reduce((sum, entry) => sum + entry.total, 0))}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 10, textAlign: 'right', marginTop: 3 }}>حالة الفاتورة: {returnStatus} · الأصل لم يُعدّل</Text>
          </View>
        )}
        {returns.length === 0 && <Text style={{ color: 'rgba(255,255,255,0.88)', textAlign: 'right', fontSize: 11, marginBottom: 8 }}>حالة الفاتورة: {returnStatus}</Text>}

        <View style={{ backgroundColor: 'rgba(0,0,0,0.15)', borderRadius: 12, padding: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
            <View style={{ backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
              <Text style={{ fontSize: 12, color: '#FFFFFF', fontWeight: '600' }}>{typeLabel}</Text>
            </View>
            <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)' }}>{formatDateTime(sale.created_at)}</Text>
          </View>
          {sale.customer_name && (
            <Text style={{ fontSize: 14, fontWeight: '600', color: '#FFFFFF', textAlign: 'right', marginBottom: 8 }}>{sale.customer_name}</Text>
          )}
          <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>الإجمالي</Text>
              <Text style={{ fontSize: 20, fontWeight: '800', color: '#FFFFFF' }}>{formatCurrency(sale.total)}</Text>
            </View>
            {sale.gross_profit > 0 && (
              <>
                <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.2)' }} />
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>الربح</Text>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: '#AAFFCC' }}>{formatCurrency(sale.gross_profit)}</Text>
                </View>
              </>
            )}
            {remainingAfterReturns > 0 && (
              <>
                <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.2)' }} />
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>المتبقي</Text>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: '#FFAAAA' }}>{formatCurrency(remainingAfterReturns)}</Text>
                </View>
              </>
            )}
          </View>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>
        {/* Items */}
        <View style={{ margin: 14, backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, overflow: 'hidden' }}>
          <View style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: theme.colors.textPrimary, textAlign: 'right' }}>الأصناف ({items.length})</Text>
          </View>
          {items.map((item, i) => (
            <View key={item.id} style={{ paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: i < items.length - 1 ? 1 : 0, borderBottomColor: theme.colors.divider }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: typeColor }}>{formatCurrency(item.line_total)}</Text>
                <Text style={{ fontSize: 14, fontWeight: '600', color: theme.colors.textPrimary }}>{item.product_name}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                <Text style={{ fontSize: 12, color: theme.colors.textTertiary }}>
                  {item.quantity} × {formatCurrency(item.unit_price)} {item.discount > 0 ? `(خصم ${formatCurrency(item.discount)})` : ''}
                </Text>
                <Text style={{ fontSize: 11, color: theme.colors.success }}>تكلفة: {formatCurrency(item.cogs)}</Text>
              </View>
              {!sale.cancelled && getSaleItemReturnableQuantity(item.id) > 0 && (
                <TouchableOpacity onPress={() => router.push({ pathname: '/new-return', params: { type: 'sale', invoiceId: String(sale.id) } } as any)} style={{ alignSelf: 'flex-start', marginTop: 9, backgroundColor: theme.colors.warningLight, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 6 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: theme.colors.warning }}>إنشاء مرتجع — الأصل {item.quantity} · سابقًا {getSaleItemReturnedQuantity(item.id)} · المتاح {getSaleItemReturnableQuantity(item.id)} {item.unit_name || item.unit}</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>

        {/* Financial Summary */}
        <View style={{ marginHorizontal: 14, backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, padding: 14 }}>
          {[
            { label: 'المجموع الفرعي', value: sale.subtotal },
            sale.discount > 0 ? { label: 'الخصم', value: -sale.discount } : null,
            { label: 'الإجمالي', value: sale.total, bold: true },
            { label: 'المدفوع', value: sale.amount_paid },
            sale.change_given > 0 ? { label: 'الباقي للعميل', value: sale.change_given } : null,
            remainingAfterReturns > 0 ? { label: 'متبقي على العميل بعد المرتجعات', value: remainingAfterReturns } : null,
            sale.cogs > 0 ? { label: 'تكلفة البضاعة', value: sale.cogs } : null,
            sale.gross_profit > 0 ? { label: 'إجمالي الربح', value: sale.gross_profit, highlight: true } : null,
          ].filter(Boolean).map((row: any, i) => (
            <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: i < 7 ? 1 : 0, borderBottomColor: theme.colors.divider }}>
              <Text style={{ fontSize: row.bold ? 16 : 13, fontWeight: row.bold ? '800' : '400', color: row.highlight ? theme.colors.success : row.value < 0 ? theme.colors.error : theme.colors.textPrimary }}>
                {formatCurrency(Math.abs(row.value))}
              </Text>
              <Text style={{ fontSize: row.bold ? 14 : 13, fontWeight: row.bold ? '700' : '400', color: row.bold ? theme.colors.textPrimary : theme.colors.textSecondary }}>{row.label}</Text>
            </View>
          ))}
        </View>

        {sale.notes ? (
          <View style={{ marginHorizontal: 14, marginTop: 12, backgroundColor: theme.colors.surfaceAlt, borderRadius: 10, padding: 12 }}>
            <Text style={{ fontSize: 12, color: theme.colors.textTertiary, textAlign: 'right', marginBottom: 4 }}>ملاحظات</Text>
            <Text style={{ fontSize: 13, color: theme.colors.textPrimary, textAlign: 'right' }}>{sale.notes}</Text>
          </View>
        ) : null}
      </ScrollView>

    </View>
  );
}
