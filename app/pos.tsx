// Smart Pharmacy ERP — POS (Point of Sale)
import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  FlatList, Modal, KeyboardAvoidingView, Platform,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTheme } from '@/contexts/ThemeContext';
import {
  getProducts, getCustomers, createSale,
  Product, Customer, getSetting, getProductStock,
} from '@/services/database';
import { formatCurrency, AR } from '@/constants/i18n';
import { useAlert } from '@/template';

interface CartItem {
  product: Product;
  quantity: string;
  unit: string;
  unit_price: string;
  discount: string;
}

export default function PosScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showAlert } = useAlert();
  const params = useLocalSearchParams<{ type?: string }>();

  const [cart, setCart] = useState<CartItem[]>([]);
  const [saleType, setSaleType] = useState<'cash' | 'credit'>(
    params.type === 'credit' ? 'credit' : 'cash'
  );
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [invoiceDiscount, setInvoiceDiscount] = useState('0');
  const [amountPaid, setAmountPaid] = useState('');
  const [notes, setNotes] = useState('');
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [showCustomerPicker, setShowCustomerPicker] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const currencySymbol = getSetting('currency_symbol') || 'ر.س';

  const handleProductSearch = useCallback((q: string) => {
    setSearch(q);
    if (q.trim().length === 0) {
      setSearchResults([]);
      setShowSearch(false);
      return;
    }
    const results = getProducts({ search: q, activeOnly: true });
    setSearchResults(results.slice(0, 12));
    setShowSearch(true);
  }, []);

  const addToCart = (product: Product) => {
    setShowSearch(false);
    setSearch('');
    setSearchResults([]);
    const existing = cart.findIndex(i => i.product.id === product.id);
    if (existing >= 0) {
      const updated = [...cart];
      const current = parseInt(updated[existing].quantity) || 1;
      updated[existing] = { ...updated[existing], quantity: String(current + 1) };
      setCart(updated);
    } else {
      setCart(prev => [{
        product,
        quantity: '1',
        unit: product.inventory_unit,
        unit_price: String(product.selling_price),
        discount: '0',
      }, ...prev]);
    }
  };

  const updateCartItem = (index: number, field: keyof CartItem, value: string) => {
    const updated = [...cart];
    updated[index] = { ...updated[index], [field]: value };
    setCart(updated);
  };

  const removeFromCart = (index: number) => {
    setCart(prev => prev.filter((_, i) => i !== index));
  };

  const subtotal = cart.reduce((s, item) => {
    const qty = parseFloat(item.quantity) || 0;
    const price = parseFloat(item.unit_price) || 0;
    const disc = parseFloat(item.discount) || 0;
    return s + (qty * price - disc);
  }, 0);

  const totalDiscount = parseFloat(invoiceDiscount) || 0;
  const total = Math.max(0, subtotal - totalDiscount);
  const paid = parseFloat(amountPaid) || (saleType === 'cash' ? total : 0);
  const change = Math.max(0, paid - total);
  const remaining = Math.max(0, total - paid);

  const handleSave = async () => {
    if (cart.length === 0) { showAlert('تنبيه', 'أضف صنفاً واحداً على الأقل'); return; }
    if (saleType === 'credit' && !selectedCustomer) { showAlert('تنبيه', 'اختر عميلاً للبيع الآجل'); return; }

    setSaving(true);
    try {
      const result = createSale({
        sale_type: saleType,
        customer_id: selectedCustomer?.id ?? null,
        items: cart.map(item => ({
          product_id: item.product.id,
          unit: item.unit,
          quantity: parseFloat(item.quantity) || 1,
          unit_price: parseFloat(item.unit_price) || item.product.selling_price,
          discount: parseFloat(item.discount) || 0,
        })),
        discount: totalDiscount,
        amount_paid: paid,
        notes,
      });

      if (result.success) {
        showAlert('تم', `تم حفظ الفاتورة ${result.sale?.invoice_number}`, [
          { text: 'موافق', onPress: () => router.back() },
        ]);
      } else {
        showAlert('خطأ', result.error || 'فشل في حفظ الفاتورة');
      }
    } finally {
      setSaving(false);
    }
  };

  const openCustomerPicker = () => {
    setCustomers(getCustomers());
    setShowCustomerPicker(true);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {/* Header */}
      <View style={{ backgroundColor: theme.colors.primary, paddingTop: insets.top + 10, paddingBottom: 12, paddingHorizontal: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <TouchableOpacity onPress={() => router.back()}>
            <MaterialIcons name="arrow-forward" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF' }}>نقطة البيع</Text>
          {/* Sale type toggle */}
          <View style={{ flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: 2 }}>
            {(['cash', 'credit'] as const).map(type => (
              <TouchableOpacity
                key={type}
                onPress={() => setSaleType(type)}
                style={{ paddingHorizontal: 12, paddingVertical: 4, borderRadius: 6, backgroundColor: saleType === type ? '#FFFFFF' : 'transparent' }}
              >
                <Text style={{ fontSize: 12, fontWeight: '600', color: saleType === type ? theme.colors.primary : 'rgba(255,255,255,0.8)' }}>
                  {type === 'cash' ? 'نقدي' : 'آجل'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Product Search */}
        <View style={{ backgroundColor: '#FFFFFF', borderRadius: 10, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, height: 42 }}>
          <MaterialIcons name="search" size={20} color={theme.colors.textTertiary} />
          <TextInput
            value={search}
            onChangeText={handleProductSearch}
            placeholder="ابحث عن صنف، باركود، أو مادة فعالة..."
            placeholderTextColor={theme.colors.textTertiary}
            style={{ flex: 1, fontSize: 14, textAlign: 'right', color: theme.colors.textPrimary, marginRight: 6 }}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => { setSearch(''); setShowSearch(false); }}>
              <MaterialIcons name="close" size={18} color={theme.colors.textTertiary} />
            </TouchableOpacity>
          )}
        </View>

        {/* Search Results */}
        {showSearch && searchResults.length > 0 && (
          <View style={{ position: 'absolute', top: insets.top + 80, left: 14, right: 14, backgroundColor: '#FFFFFF', borderRadius: 10, maxHeight: 240, zIndex: 99, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, elevation: 8 }}>
            <FlatList
              data={searchResults}
              keyExtractor={i => String(i.id)}
              renderItem={({ item }) => {
                const stock = getProductStock(item.id);
                return (
                  <TouchableOpacity
                    onPress={() => addToCart(item)}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}
                  >
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: theme.colors.textPrimary }}>{item.trade_name}</Text>
                      {item.generic_name ? <Text style={{ fontSize: 11, color: theme.colors.textTertiary }}>{item.generic_name}</Text> : null}
                    </View>
                    <View style={{ flex: 1 }} />
                    <View style={{ alignItems: 'flex-start', gap: 2 }}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.primary }}>{formatCurrency(item.selling_price)}</Text>
                      <Text style={{ fontSize: 10, color: stock > 0 ? theme.colors.success : theme.colors.error }}>
                        {stock > 0 ? `${stock} ${item.inventory_unit}` : 'نافد'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        )}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 14, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">

          {/* Customer for credit */}
          {saleType === 'credit' && (
            <TouchableOpacity
              onPress={openCustomerPicker}
              style={{ backgroundColor: theme.colors.surface, borderRadius: 10, borderWidth: 1, borderColor: selectedCustomer ? theme.colors.primary : theme.colors.border, padding: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}
            >
              <MaterialIcons name="person" size={18} color={selectedCustomer ? theme.colors.primary : theme.colors.textTertiary} />
              <Text style={{ flex: 1, fontSize: 14, color: selectedCustomer ? theme.colors.textPrimary : theme.colors.textTertiary, textAlign: 'right', marginHorizontal: 8 }}>
                {selectedCustomer?.name || 'اختر عميلاً... (مطلوب)'}
              </Text>
              <MaterialIcons name="keyboard-arrow-down" size={18} color={theme.colors.textTertiary} />
            </TouchableOpacity>
          )}

          {/* Cart */}
          {cart.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 40 }}>
              <MaterialIcons name="shopping-cart" size={48} color={theme.colors.textTertiary} />
              <Text style={{ fontSize: 15, color: theme.colors.textTertiary, marginTop: 12 }}>ابحث عن صنف لإضافته</Text>
            </View>
          ) : (
            cart.map((item, index) => (
              <View key={index} style={{ backgroundColor: theme.colors.surface, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, padding: 12, marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <TouchableOpacity onPress={() => removeFromCart(index)}>
                    <MaterialIcons name="close" size={18} color={theme.colors.error} />
                  </TouchableOpacity>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: theme.colors.textPrimary, flex: 1, textAlign: 'right', marginLeft: 8 }} numberOfLines={1}>
                    {item.product.trade_name}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {[
                    { label: 'الكمية', field: 'quantity' as const, flex: 1 },
                    { label: 'السعر', field: 'unit_price' as const, flex: 2 },
                    { label: 'خصم', field: 'discount' as const, flex: 1 },
                  ].map(f => (
                    <View key={f.field} style={{ flex: f.flex }}>
                      <Text style={{ fontSize: 10, color: theme.colors.textTertiary, textAlign: 'right', marginBottom: 3 }}>{f.label}</Text>
                      <TextInput
                        value={item[f.field]}
                        onChangeText={v => updateCartItem(index, f.field, v)}
                        keyboardType="numeric"
                        style={{ height: 38, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: 8, textAlign: 'center', fontSize: 14, fontWeight: '600', color: theme.colors.textPrimary, backgroundColor: theme.colors.surfaceAlt }}
                      />
                    </View>
                  ))}
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.primary }}>
                    {formatCurrency((parseFloat(item.quantity) || 0) * (parseFloat(item.unit_price) || 0) - (parseFloat(item.discount) || 0), currencySymbol)}
                  </Text>
                  <Text style={{ fontSize: 11, color: theme.colors.textTertiary }}>{item.unit}</Text>
                </View>
              </View>
            ))
          )}

          {/* Invoice Discount */}
          {cart.length > 0 && (
            <View style={{ backgroundColor: theme.colors.surface, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, padding: 12, marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <TextInput
                  value={invoiceDiscount}
                  onChangeText={setInvoiceDiscount}
                  keyboardType="numeric"
                  style={{ width: 100, height: 38, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: 8, textAlign: 'center', fontSize: 14, color: theme.colors.textPrimary }}
                />
                <Text style={{ fontSize: 13, color: theme.colors.textSecondary }}>خصم الفاتورة</Text>
              </View>
            </View>
          )}

          {/* Totals */}
          {cart.length > 0 && (
            <View style={{ backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, padding: 14, marginBottom: 12 }}>
              {[
                { label: 'المجموع', value: subtotal },
                totalDiscount > 0 ? { label: 'الخصم', value: -totalDiscount } : null,
                { label: 'الإجمالي', value: total, bold: true },
              ].filter(Boolean).map((row: any, i) => (
                <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
                  <Text style={{ fontSize: row.bold ? 16 : 14, fontWeight: row.bold ? '800' : '400', color: row.value < 0 ? theme.colors.error : theme.colors.textPrimary }}>
                    {formatCurrency(Math.abs(row.value), currencySymbol)}
                  </Text>
                  <Text style={{ fontSize: row.bold ? 15 : 13, fontWeight: row.bold ? '700' : '400', color: row.bold ? theme.colors.textPrimary : theme.colors.textSecondary }}>
                    {row.label}
                  </Text>
                </View>
              ))}

              <View style={{ height: 1, backgroundColor: theme.colors.divider, marginVertical: 8 }} />

              <Text style={{ fontSize: 12, color: theme.colors.textTertiary, textAlign: 'right', marginBottom: 6 }}>المبلغ المدفوع</Text>
              <TextInput
                value={amountPaid}
                onChangeText={setAmountPaid}
                keyboardType="numeric"
                placeholder={formatCurrency(total, currencySymbol)}
                placeholderTextColor={theme.colors.textTertiary}
                style={{ height: 48, borderRadius: 10, borderWidth: 1.5, borderColor: theme.colors.primary, paddingHorizontal: 12, fontSize: 18, fontWeight: '700', textAlign: 'center', color: theme.colors.textPrimary, marginBottom: 8 }}
              />

              {change > 0 && (
                <View style={{ backgroundColor: theme.colors.successLight, borderRadius: 8, padding: 8, alignItems: 'center' }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.success }}>الباقي: {formatCurrency(change, currencySymbol)}</Text>
                </View>
              )}
              {remaining > 0 && saleType === 'credit' && (
                <View style={{ backgroundColor: theme.colors.warningLight, borderRadius: 8, padding: 8, alignItems: 'center', marginTop: 6 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.warning }}>متبقي على العميل: {formatCurrency(remaining, currencySymbol)}</Text>
                </View>
              )}
            </View>
          )}

          {/* Notes */}
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="ملاحظات (اختياري)"
            placeholderTextColor={theme.colors.textTertiary}
            multiline
            style={{ backgroundColor: theme.colors.surface, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, padding: 12, fontSize: 14, textAlign: 'right', color: theme.colors.textPrimary, height: 64, marginBottom: 16 }}
          />

          {/* Save Button */}
          <TouchableOpacity
            onPress={handleSave}
            disabled={saving || cart.length === 0}
            style={{ height: 54, backgroundColor: cart.length > 0 ? theme.colors.primary : theme.colors.border, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }}
          >
            {saving ? <ActivityIndicator color="#FFFFFF" /> : <MaterialIcons name="check-circle" size={22} color="#FFFFFF" />}
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#FFFFFF' }}>
              {saving ? 'جار الحفظ...' : `حفظ الفاتورة — ${formatCurrency(total, currencySymbol)}`}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Customer Picker Modal */}
      <Modal visible={showCustomerPicker} animationType="slide" transparent>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: theme.colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '70%', paddingBottom: insets.bottom + 16 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
              <TouchableOpacity onPress={() => setShowCustomerPicker(false)}>
                <MaterialIcons name="close" size={22} color={theme.colors.textPrimary} />
              </TouchableOpacity>
              <Text style={{ fontSize: 16, fontWeight: '700', color: theme.colors.textPrimary }}>اختر عميلاً</Text>
              <TouchableOpacity onPress={() => { setShowCustomerPicker(false); router.push('/add-customer'); }}>
                <MaterialIcons name="person-add" size={22} color={theme.colors.primary} />
              </TouchableOpacity>
            </View>
            <View style={{ margin: 12, backgroundColor: theme.colors.surfaceAlt, borderRadius: 8, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, height: 40 }}>
              <MaterialIcons name="search" size={18} color={theme.colors.textTertiary} />
              <TextInput
                value={customerSearch}
                onChangeText={q => { setCustomerSearch(q); setCustomers(getCustomers(q || undefined)); }}
                placeholder="ابحث عن عميل..."
                placeholderTextColor={theme.colors.textTertiary}
                style={{ flex: 1, fontSize: 14, textAlign: 'right', color: theme.colors.textPrimary, marginRight: 6 }}
              />
            </View>
            <FlatList
              data={customers}
              keyExtractor={c => String(c.id)}
              renderItem={({ item }) => (
                <TouchableOpacity
                  onPress={() => { setSelectedCustomer(item); setShowCustomerPicker(false); setCustomerSearch(''); }}
                  style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}
                >
                  <Text style={{ fontSize: 13, color: item.balance > 0 ? theme.colors.warning : theme.colors.success }}>
                    {item.balance > 0 ? `${formatCurrency(item.balance)} مدين` : 'سوي'}
                  </Text>
                  <View>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: theme.colors.textPrimary, textAlign: 'right' }}>{item.name}</Text>
                    {item.phone ? <Text style={{ fontSize: 12, color: theme.colors.textTertiary, textAlign: 'right' }}>{item.phone}</Text> : null}
                  </View>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={{ padding: 24, alignItems: 'center' }}>
                  <Text style={{ color: theme.colors.textTertiary }}>لا يوجد عملاء</Text>
                </View>
              }
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}
