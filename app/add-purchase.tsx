// Smart Pharmacy ERP — Add Purchase (Invoice)
import React, { useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  Modal, FlatList, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '@/contexts/ThemeContext';
import { createPurchase, getSuppliers, getProducts, getSetting, Supplier, Product } from '@/services/database';
import { formatCurrency, getToday, AR } from '@/constants/i18n';
import { useAlert } from '@/template';

interface PurchaseLineItem {
  product: Product;
  batch_number: string;
  expiry_date: string;
  unit: string;
  quantity: string;
  purchase_price: string;
  free_quantity: string;
  discount: string;
}

export default function AddPurchaseScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showAlert } = useAlert();

  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [invoiceNo, setInvoiceNo] = useState('');
  const [date, setDate] = useState(getToday());
  const [items, setItems] = useState<PurchaseLineItem[]>([]);
  const [invoiceDiscount, setInvoiceDiscount] = useState('0');
  const [amountPaid, setAmountPaid] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const [showSupplierPicker, setShowSupplierPicker] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierSearch, setSupplierSearch] = useState('');

  const [showProductSearch, setShowProductSearch] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [productResults, setProductResults] = useState<Product[]>([]);

  const currencySymbol = getSetting('currency_symbol') || 'ر.س';

  const subtotal = items.reduce((s, i) => {
    const qty = parseFloat(i.quantity) || 0;
    const freeQty = parseFloat(i.free_quantity) || 0;
    const price = parseFloat(i.purchase_price) || 0;
    const disc = parseFloat(i.discount) || 0;
    return s + ((qty + freeQty) * price - disc);
  }, 0);
  const invoiceDiscountNum = parseFloat(invoiceDiscount) || 0;
  const total = Math.max(0, subtotal - invoiceDiscountNum);
  const amountPaidNum = parseFloat(amountPaid) || 0;
  const remaining = Math.max(0, total - amountPaidNum);

  const addItem = (product: Product) => {
    setShowProductSearch(false);
    setProductSearch('');
    setItems(prev => [{
      product,
      batch_number: '',
      expiry_date: '',
      unit: product.inventory_unit,
      quantity: '1',
      purchase_price: String(product.default_purchase_price || 0),
      free_quantity: '0',
      discount: '0',
    }, ...prev]);
  };

  const updateItem = (index: number, field: keyof PurchaseLineItem, value: any) => {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };
    setItems(updated);
  };

  const handleSave = async () => {
    if (items.length === 0) { showAlert('تنبيه', 'أضف صنفاً واحداً على الأقل'); return; }
    for (const item of items) {
      if (!item.batch_number.trim()) { showAlert('تنبيه', `أدخل رقم دفعة ${item.product.trade_name}`); return; }
      if (!item.expiry_date.trim()) { showAlert('تنبيه', `أدخل تاريخ انتهاء ${item.product.trade_name}`); return; }
    }

    setSaving(true);
    try {
      const result = createPurchase({
        supplier_id: supplier?.id ?? null,
        invoice_number: invoiceNo.trim() || undefined,
        date,
        items: items.map(i => ({
          product_id: i.product.id,
          batch_number: i.batch_number,
          expiry_date: i.expiry_date,
          unit: i.unit,
          quantity: parseFloat(i.quantity) || 1,
          purchase_price: parseFloat(i.purchase_price) || 0,
          free_quantity: parseFloat(i.free_quantity) || 0,
          discount: parseFloat(i.discount) || 0,
        })),
        discount: invoiceDiscountNum,
        amount_paid: amountPaidNum,
        notes,
      });
      if (result.success) {
        showAlert('تم', `تم تسجيل فاتورة الشراء ${result.purchase?.invoice_number}`, [
          { text: 'موافق', onPress: () => router.back() },
        ]);
      } else {
        showAlert('خطأ', result.error || 'فشل تسجيل الفاتورة');
      }
    } finally {
      setSaving(false);
    }
  };

  const inputSm = { height: 40, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: 8, fontSize: 13, textAlign: 'center' as const, color: theme.colors.textPrimary, backgroundColor: theme.colors.surfaceAlt };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ backgroundColor: '#6554C0', paddingTop: insets.top + 10, paddingBottom: 12, paddingHorizontal: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <TouchableOpacity onPress={() => router.back()}>
            <MaterialIcons name="close" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF' }}>فاتورة شراء جديدة</Text>
          <TouchableOpacity onPress={() => { setShowProductSearch(true); setProductResults(getProducts({ activeOnly: true })); }} style={{ backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <MaterialIcons name="add" size={16} color="#FFFFFF" />
            <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '600' }}>إضافة صنف</Text>
          </TouchableOpacity>
        </View>

        {/* Header fields */}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity onPress={() => { setSuppliers(getSuppliers()); setShowSupplierPicker(true); }} style={{ flex: 2, height: 38, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, gap: 6 }}>
            <Text style={{ flex: 1, fontSize: 13, color: supplier ? '#FFFFFF' : 'rgba(255,255,255,0.7)', textAlign: 'right' }} numberOfLines={1}>{supplier?.name || 'اختر مورداً'}</Text>
            <MaterialIcons name="keyboard-arrow-down" size={16} color="rgba(255,255,255,0.7)" />
          </TouchableOpacity>
          <TextInput value={invoiceNo} onChangeText={setInvoiceNo} placeholder="رقم الفاتورة" placeholderTextColor="rgba(255,255,255,0.6)"
            style={{ flex: 1, height: 38, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8, paddingHorizontal: 10, fontSize: 13, color: '#FFFFFF', textAlign: 'right' }}
          />
          <TextInput value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor="rgba(255,255,255,0.6)"
            style={{ flex: 1, height: 38, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8, paddingHorizontal: 8, fontSize: 12, color: '#FFFFFF', textAlign: 'center' }}
          />
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 14, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">

          {items.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 40 }}>
              <MaterialIcons name="shopping-cart" size={48} color={theme.colors.textTertiary} />
              <Text style={{ fontSize: 14, color: theme.colors.textTertiary, marginTop: 12 }}>اضغط "إضافة صنف" لإضافة منتجات الفاتورة</Text>
            </View>
          ) : (
            items.map((item, index) => (
              <View key={index} style={{ backgroundColor: theme.colors.surface, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, padding: 12, marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <TouchableOpacity onPress={() => setItems(prev => prev.filter((_, i) => i !== index))}>
                    <MaterialIcons name="delete-outline" size={18} color={theme.colors.error} />
                  </TouchableOpacity>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: theme.colors.textPrimary, flex: 1, textAlign: 'right', marginLeft: 8 }} numberOfLines={1}>{item.product.trade_name}</Text>
                </View>

                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                  <View style={{ flex: 2 }}>
                    <Text style={{ fontSize: 10, color: theme.colors.textTertiary, textAlign: 'right', marginBottom: 3 }}>رقم الدفعة *</Text>
                    <TextInput value={item.batch_number} onChangeText={v => updateItem(index, 'batch_number', v)} placeholder="B2024001" placeholderTextColor={theme.colors.textTertiary} style={[inputSm, { textAlign: 'right' }]} />
                  </View>
                  <View style={{ flex: 2 }}>
                    <Text style={{ fontSize: 10, color: theme.colors.textTertiary, textAlign: 'right', marginBottom: 3 }}>تاريخ الانتهاء *</Text>
                    <TextInput value={item.expiry_date} onChangeText={v => updateItem(index, 'expiry_date', v)} placeholder="2026-12-31" placeholderTextColor={theme.colors.textTertiary} style={inputSm} />
                  </View>
                </View>

                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {[
                    { label: 'الكمية', field: 'quantity' as const },
                    { label: 'السعر', field: 'purchase_price' as const },
                    { label: 'مجاني', field: 'free_quantity' as const },
                    { label: 'خصم', field: 'discount' as const },
                  ].map(f => (
                    <View key={f.field} style={{ flex: 1 }}>
                      <Text style={{ fontSize: 10, color: theme.colors.textTertiary, textAlign: 'center', marginBottom: 3 }}>{f.label}</Text>
                      <TextInput value={item[f.field]} onChangeText={v => updateItem(index, f.field, v)} keyboardType="numeric" style={inputSm} />
                    </View>
                  ))}
                </View>

                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#6554C0' }}>
                    {formatCurrency(((parseFloat(item.quantity) || 0) + (parseFloat(item.free_quantity) || 0)) * (parseFloat(item.purchase_price) || 0) - (parseFloat(item.discount) || 0), currencySymbol)}
                  </Text>
                  <Text style={{ fontSize: 11, color: theme.colors.textTertiary }}>المجموع</Text>
                </View>
              </View>
            ))
          )}

          {/* Totals */}
          {items.length > 0 && (
            <View style={{ backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, padding: 14, marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                <TextInput value={invoiceDiscount} onChangeText={setInvoiceDiscount} keyboardType="numeric" style={{ width: 80, height: 36, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: 8, textAlign: 'center', fontSize: 13, color: theme.colors.textPrimary }} />
                <Text style={{ fontSize: 13, color: theme.colors.textSecondary }}>خصم الفاتورة</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
                <Text style={{ fontSize: 16, fontWeight: '800', color: '#6554C0' }}>{formatCurrency(total, currencySymbol)}</Text>
                <Text style={{ fontSize: 14, fontWeight: '700', color: theme.colors.textPrimary }}>الإجمالي</Text>
              </View>
              <View style={{ height: 1, backgroundColor: theme.colors.divider, marginVertical: 8 }} />
              <Text style={{ fontSize: 12, color: theme.colors.textTertiary, textAlign: 'right', marginBottom: 6 }}>المبلغ المدفوع</Text>
              <TextInput value={amountPaid} onChangeText={setAmountPaid} keyboardType="numeric" placeholder="0.00" placeholderTextColor={theme.colors.textTertiary}
                style={{ height: 46, borderRadius: 10, borderWidth: 1.5, borderColor: '#6554C0', paddingHorizontal: 12, fontSize: 16, fontWeight: '700', textAlign: 'center', color: theme.colors.textPrimary, marginBottom: 8 }}
              />
              {remaining > 0 && (
                <View style={{ backgroundColor: theme.colors.errorLight, borderRadius: 8, padding: 8, alignItems: 'center' }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.error }}>متبقي للمورد: {formatCurrency(remaining, currencySymbol)}</Text>
                </View>
              )}
            </View>
          )}

          <TextInput value={notes} onChangeText={setNotes} placeholder="ملاحظات" placeholderTextColor={theme.colors.textTertiary} multiline
            style={{ backgroundColor: theme.colors.surface, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, padding: 12, fontSize: 13, textAlign: 'right', color: theme.colors.textPrimary, height: 56, marginBottom: 16 }}
          />

          <TouchableOpacity onPress={handleSave} disabled={saving || items.length === 0}
            style={{ height: 52, backgroundColor: items.length > 0 ? '#6554C0' : theme.colors.border, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }}
          >
            {saving ? <ActivityIndicator color="#FFFFFF" /> : <MaterialIcons name="save" size={20} color="#FFFFFF" />}
            <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF' }}>
              {saving ? 'جار الحفظ...' : `حفظ فاتورة الشراء — ${formatCurrency(total, currencySymbol)}`}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Supplier picker */}
      <Modal visible={showSupplierPicker} animationType="slide" transparent>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: theme.colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '65%', paddingBottom: insets.bottom + 16 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
              <TouchableOpacity onPress={() => setShowSupplierPicker(false)}><MaterialIcons name="close" size={22} color={theme.colors.textPrimary} /></TouchableOpacity>
              <Text style={{ fontSize: 16, fontWeight: '700', color: theme.colors.textPrimary }}>اختر مورداً</Text>
              <TouchableOpacity onPress={() => { setShowSupplierPicker(false); router.push('/add-supplier'); }}><MaterialIcons name="add" size={22} color="#6554C0" /></TouchableOpacity>
            </View>
            <View style={{ margin: 12, backgroundColor: theme.colors.surfaceAlt, borderRadius: 8, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, height: 40 }}>
              <MaterialIcons name="search" size={18} color={theme.colors.textTertiary} />
              <TextInput value={supplierSearch} onChangeText={q => { setSupplierSearch(q); setSuppliers(getSuppliers(q || undefined)); }} placeholder="ابحث..." placeholderTextColor={theme.colors.textTertiary} style={{ flex: 1, fontSize: 14, textAlign: 'right', color: theme.colors.textPrimary, marginRight: 6 }} />
            </View>
            <FlatList data={suppliers} keyExtractor={s => String(s.id)}
              renderItem={({ item }) => (
                <TouchableOpacity onPress={() => { setSupplier(item); setShowSupplierPicker(false); setSupplierSearch(''); }}
                  style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
                  <Text style={{ fontSize: 12, color: item.balance > 0 ? theme.colors.error : theme.colors.success }}>{item.balance > 0 ? formatCurrency(item.balance) + ' مستحق' : 'سوي'}</Text>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: theme.colors.textPrimary }}>{item.name}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>

      {/* Product search */}
      <Modal visible={showProductSearch} animationType="slide" transparent>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: theme.colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '75%', paddingBottom: insets.bottom + 16 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
              <TouchableOpacity onPress={() => setShowProductSearch(false)}><MaterialIcons name="close" size={22} color={theme.colors.textPrimary} /></TouchableOpacity>
              <Text style={{ fontSize: 16, fontWeight: '700', color: theme.colors.textPrimary }}>اختر صنفاً</Text>
              <View style={{ width: 22 }} />
            </View>
            <View style={{ margin: 12, backgroundColor: theme.colors.surfaceAlt, borderRadius: 8, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, height: 40 }}>
              <MaterialIcons name="search" size={18} color={theme.colors.textTertiary} />
              <TextInput value={productSearch} onChangeText={q => { setProductSearch(q); setProductResults(getProducts({ search: q || undefined, activeOnly: true })); }} placeholder="ابحث عن صنف..." placeholderTextColor={theme.colors.textTertiary} style={{ flex: 1, fontSize: 14, textAlign: 'right', color: theme.colors.textPrimary, marginRight: 6 }} />
            </View>
            <FlatList data={productResults.slice(0, 20)} keyExtractor={p => String(p.id)}
              renderItem={({ item }) => (
                <TouchableOpacity onPress={() => addItem(item)} style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.divider, flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 13, color: '#6554C0', fontWeight: '600' }}>{formatCurrency(item.default_purchase_price)}</Text>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: theme.colors.textPrimary }}>{item.trade_name}</Text>
                    {item.generic_name ? <Text style={{ fontSize: 11, color: theme.colors.textTertiary }}>{item.generic_name}</Text> : null}
                  </View>
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}
