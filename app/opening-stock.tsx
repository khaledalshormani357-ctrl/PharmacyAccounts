// Smart Pharmacy ERP — Opening stock without financial posting.
import React, { useMemo, useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import { createOpeningStock, getProducts, getProductUnits, Product } from '@/services/database';
import { useAlert } from '@/template';

export default function OpeningStockScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showAlert } = useAlert();
  const products = useMemo(() => getProducts({ activeOnly: true }), []);
  const [search, setSearch] = useState('');
  const [product, setProduct] = useState<Product | null>(null);
  const [unit, setUnit] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unitCost, setUnitCost] = useState('0');
  const [batchNumber, setBatchNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [saving, setSaving] = useState(false);

  const inputStyle = {
    color: theme.colors.textPrimary, backgroundColor: theme.colors.background,
    borderColor: theme.colors.border, borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 11, textAlign: 'right' as const,
  };
  const visibleProducts = products.filter(p => !search.trim() ||
    [p.trade_name, p.generic_name || '', p.barcode || ''].some(v => v.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))).slice(0, 10);

  const save = () => {
    if (saving) return;
    if (!product || !unit) {
      showAlert('الصنف والوحدة مطلوبان', 'اختر الدواء ووحدة الرصيد الافتتاحي أولاً.');
      return;
    }
    const parsedQuantity = Number(quantity);
    const parsedCost = Number(unitCost);
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      showAlert('كمية غير صحيحة', 'أدخل كمية افتتاحية أكبر من صفر.');
      return;
    }
    if (!Number.isFinite(parsedCost) || parsedCost < 0) {
      showAlert('تكلفة غير صحيحة', 'أدخل تكلفة وحدة تساوي صفرًا أو أكثر.');
      return;
    }
    setSaving(true);
    try {
      const result = createOpeningStock({
        product_id: product.id, unit, quantity: parsedQuantity, unit_cost: parsedCost,
        batch_number: batchNumber.trim() || undefined,
        expiry_date: expiryDate.trim() || undefined,
      });
      if (!result.success) {
        showAlert('تعذر حفظ الرصيد الافتتاحي', result.error);
        return;
      }
      showAlert('تم ترصيد الصنف', `أضيفت كمية ${result.base_quantity} ${product.inventory_unit} إلى المخزون دون إنشاء فاتورة شراء أو حركة نقدية أو مديونية للمورد.`);
      router.back();
    } catch {
      showAlert('تعذر الحفظ', 'حدث خطأ أثناء حفظ الرصيد الافتتاحي. تحقق من المخزون قبل إعادة المحاولة.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background, paddingTop: insets.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: theme.colors.surface }}>
        <TouchableOpacity onPress={() => router.back()}><MaterialIcons name="arrow-forward" size={24} color={theme.colors.textPrimary} /></TouchableOpacity>
        <Text style={{ color: theme.colors.textPrimary, fontSize: 19, fontWeight: '800' }}>الأرصدة الافتتاحية</Text>
        <MaterialIcons name="inventory" size={24} color={theme.colors.primary} />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 36 }}>
        <View style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 12, padding: 12 }}>
          <Text style={{ color: theme.colors.textPrimary, textAlign: 'right', fontWeight: '700' }}>رصيد افتتاحي للمخزون فقط</Text>
          <Text style={{ color: theme.colors.textSecondary, textAlign: 'right', marginTop: 5, lineHeight: 20 }}>يسجل كمية بداية التشغيل وبيانات التشغيلة والتكلفة، ولا ينشئ فاتورة شراء أو رصيدًا ماليًا على المورد أو حركة صندوق.</Text>
        </View>
        <TextInput value={search} onChangeText={setSearch} placeholder="ابحث باسم الدواء أو الاسم العلمي أو الباركود" placeholderTextColor={theme.colors.textTertiary} style={inputStyle} />
        {visibleProducts.map(p => (
          <TouchableOpacity key={p.id} onPress={() => { setProduct(p); setUnit(getProductUnits(p.id)[0]?.unit_name || p.inventory_unit); }} style={{ padding: 12, borderRadius: 10, borderWidth: 1, borderColor: product?.id === p.id ? theme.colors.primary : theme.colors.border, backgroundColor: theme.colors.surface }}>
            <Text style={{ color: theme.colors.textPrimary, textAlign: 'right', fontWeight: '700' }}>{p.trade_name}</Text>
            <Text style={{ color: theme.colors.textSecondary, textAlign: 'right', fontSize: 12 }}>{p.generic_name || p.barcode || p.inventory_unit}</Text>
          </TouchableOpacity>
        ))}
        {product ? <>
          <Text style={{ color: theme.colors.textPrimary, textAlign: 'right', fontWeight: '800' }}>الصنف المختار: {product.trade_name}</Text>
          <Text style={{ color: theme.colors.textSecondary, textAlign: 'right' }}>وحدة الكمية</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(getProductUnits(product.id).length ? getProductUnits(product.id) : [{ unit_name: product.inventory_unit }]).map(u => (
              <TouchableOpacity key={u.unit_name} onPress={() => setUnit(u.unit_name)} style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 18, backgroundColor: unit === u.unit_name ? theme.colors.primary : theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }}>
                <Text style={{ color: unit === u.unit_name ? '#fff' : theme.colors.textPrimary }}>{u.unit_name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </> : null}
        <Text style={{ color: theme.colors.textPrimary, textAlign: 'right' }}>الكمية بالوحدة المختارة</Text>
        <TextInput value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" placeholder="الكمية" placeholderTextColor={theme.colors.textTertiary} style={inputStyle} />
        <Text style={{ color: theme.colors.textPrimary, textAlign: 'right' }}>التكلفة التقديرية للوحدة</Text>
        <TextInput value={unitCost} onChangeText={setUnitCost} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={theme.colors.textTertiary} style={inputStyle} />
        <Text style={{ color: theme.colors.textPrimary, textAlign: 'right' }}>رقم التشغيلة (اختياري)</Text>
        <TextInput value={batchNumber} onChangeText={setBatchNumber} placeholder="رقم التشغيلة" placeholderTextColor={theme.colors.textTertiary} style={inputStyle} />
        <Text style={{ color: theme.colors.textPrimary, textAlign: 'right' }}>تاريخ الانتهاء YYYY-MM-DD (اختياري)</Text>
        <TextInput value={expiryDate} onChangeText={setExpiryDate} placeholder="2027-12-31" placeholderTextColor={theme.colors.textTertiary} style={inputStyle} />
        <TouchableOpacity disabled={saving} onPress={save} style={{ backgroundColor: theme.colors.primary, padding: 15, borderRadius: 12, alignItems: 'center', opacity: saving ? 0.6 : 1 }}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>{saving ? 'جارٍ الحفظ…' : 'حفظ الرصيد الافتتاحي'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}
