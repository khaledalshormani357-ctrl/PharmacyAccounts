// Smart Pharmacy ERP — Purchase Detail
import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { useTheme } from '@/contexts/ThemeContext';
import { getPurchase, getPurchaseItems, getSetting, Purchase, PurchaseItem } from '@/services/database';
import { formatCurrency, formatDate } from '@/constants/i18n';
import { PdfActions } from '@/components/PdfActions';
import { buildInvoiceHtml } from '@/services/pdfReport';

export default function PurchaseDetailScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [items, setItems] = useState<PurchaseItem[]>([]);

  const load = useCallback(() => {
    if (!id) return;
    const pid = parseInt(id);
    setPurchase(getPurchase(pid));
    setItems(getPurchaseItems(pid));
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (!purchase) return null;

  const buildInvoicePdf = () => buildInvoiceHtml({
    pharmacyName: getSetting('pharmacy_name') || 'صيدليتي',
    kind: 'purchase',
    invoiceNumber: purchase.invoice_number,
    date: formatDate(purchase.date),
    partyName: purchase.supplier_name,
    cancelled: purchase.cancelled,
    cancelReason: purchase.cancel_reason,
    subtotal: purchase.subtotal,
    discount: purchase.discount,
    total: purchase.total,
    amountPaid: purchase.amount_paid,
    remaining: purchase.remaining,
    notes: purchase.notes,
    items: items.map(item => ({
      name: item.product_name,
      quantity: item.quantity + item.free_quantity,
      unit: item.unit,
      unitPrice: item.purchase_price,
      discount: item.discount,
      total: item.line_total,
      details: `دفعة: ${item.batch_number} · انتهاء: ${formatDate(item.expiry_date)}`,
    })),
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ backgroundColor: '#6554C0', paddingTop: insets.top + 10, paddingBottom: 16, paddingHorizontal: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <TouchableOpacity onPress={() => router.back()} style={{ width: 34, height: 34, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
            <MaterialIcons name="arrow-forward" size={20} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={{ fontSize: 16, fontWeight: '700', color: '#FFFFFF' }}>{purchase.invoice_number}</Text>
          <PdfActions buildHtml={buildInvoicePdf} title={`فاتورة ${purchase.invoice_number}`} />
        </View>
        <View style={{ backgroundColor: 'rgba(0,0,0,0.15)', borderRadius: 12, padding: 12 }}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: '#FFFFFF', textAlign: 'right', marginBottom: 10 }}>{purchase.supplier_name || 'مورد مباشر'}</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>الإجمالي</Text>
              <Text style={{ fontSize: 20, fontWeight: '800', color: '#FFFFFF' }}>{formatCurrency(purchase.total)}</Text>
            </View>
            {purchase.remaining > 0 && <><View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.2)' }} /><View style={{ alignItems: 'center' }}><Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>متبقي</Text><Text style={{ fontSize: 16, fontWeight: '700', color: '#FFAAAA' }}>{formatCurrency(purchase.remaining)}</Text></View></>}
            {purchase.amount_paid > 0 && <><View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.2)' }} /><View style={{ alignItems: 'center' }}><Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>مدفوع</Text><Text style={{ fontSize: 16, fontWeight: '700', color: '#AAFFCC' }}>{formatCurrency(purchase.amount_paid)}</Text></View></>}
          </View>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 14, paddingBottom: 32 }}>
        <View style={{ backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, overflow: 'hidden', marginBottom: 14 }}>
          <View style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: theme.colors.textPrimary, textAlign: 'right' }}>الأصناف ({items.length})</Text>
          </View>
          {items.map((item, i) => (
            <View key={item.id} style={{ paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: i < items.length - 1 ? 1 : 0, borderBottomColor: theme.colors.divider }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#6554C0' }}>{formatCurrency(item.line_total)}</Text>
                <Text style={{ fontSize: 14, fontWeight: '600', color: theme.colors.textPrimary }}>{item.product_name}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 11, color: theme.colors.textTertiary }}>{item.quantity} {item.unit} × {formatCurrency(item.purchase_price)}</Text>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontSize: 11, color: theme.colors.textSecondary }}>دفعة: {item.batch_number}</Text>
                  <Text style={{ fontSize: 11, color: theme.colors.textTertiary }}>انتهاء: {formatDate(item.expiry_date)}</Text>
                </View>
              </View>
            </View>
          ))}
        </View>

        <View style={{ backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, padding: 14 }}>
          {[
            { label: 'التاريخ', value: formatDate(purchase.date), isText: true },
            { label: 'المجموع', value: purchase.subtotal },
            purchase.discount > 0 ? { label: 'الخصم', value: -purchase.discount } : null,
            { label: 'الإجمالي', value: purchase.total, bold: true },
            { label: 'المدفوع', value: purchase.amount_paid },
            purchase.remaining > 0 ? { label: 'المتبقي للمورد', value: purchase.remaining } : null,
          ].filter(Boolean).map((row: any, i) => (
            <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
              <Text style={{ fontSize: row.bold ? 16 : 13, fontWeight: row.bold ? '800' : '400', color: row.isText ? theme.colors.textPrimary : row.bold ? '#6554C0' : theme.colors.textPrimary }}>
                {row.isText ? row.value : formatCurrency(Math.abs(row.value))}
              </Text>
              <Text style={{ fontSize: row.bold ? 14 : 13, fontWeight: row.bold ? '700' : '400', color: row.bold ? theme.colors.textPrimary : theme.colors.textSecondary }}>{row.label}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
