// Smart Pharmacy ERP — Receive free supplier samples without financial posting.
import React, { useMemo, useRef, useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import { createFreeSampleReceipt, getProducts, getProductUnits, getSuppliers, Product } from '@/services/database';
import { useAlert } from '@/template';

export default function FreeSamplesScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showAlert } = useAlert();
  const products = useMemo(() => getProducts({ activeOnly: true }), []);
  const suppliers = useMemo(() => getSuppliers(), []);
  const [search, setSearch] = useState('');
  const [product, setProduct] = useState<Product | null>(null);
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [unit, setUnit] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unitCost, setUnitCost] = useState('0');
  const [batchNumber, setBatchNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [reason, setReason] = useState('عينة مجانية من المورد');
  const [saving, setSaving] = useState(false);
  const saveInProgress = useRef(false);
  const fields = [
    { label: 'رقم التشغيلة', value: batchNumber, set: setBatchNumber, placeholder: 'مثال: BATCH-001' },
    { label: 'تاريخ الانتهاء (YYYY-MM-DD)', value: expiryDate, set: setExpiryDate, placeholder: '2027-12-31' },
    { label: 'الكمية', value: quantity, set: setQuantity, placeholder: 'الكمية', numeric: true },
    { label: 'التكلفة التقديرية للوحدة المختارة', value: unitCost, set: setUnitCost, placeholder: '0', numeric: true },
    { label: 'سبب/ملاحظة', value: reason, set: setReason, placeholder: 'سبب استلام العينة' },
  ];
  const inputStyle = { color: theme.colors.textPrimary, backgroundColor: theme.colors.background, borderColor: theme.colors.divider, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, textAlign: 'right' as const };
  const save = () => {
    // A ref blocks rapid repeated taps before React has rendered the disabled state.
    if (saveInProgress.current) return;
    if (!product || !unit) { showAlert('تنبيه', 'اختر الصنف ووحدة الكمية أولاً'); return; }
    if (supplierId === null) { showAlert('المورد مطلوب', 'اختر المورد الذي قدّم العينة أو الهدية حتى تُسجّل الحركة على المورد الصحيح.'); return; }
    const parsedQuantity = Number(quantity);
    const parsedCost = Number(unitCost);
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) { showAlert('كمية غير صحيحة', 'أدخل كمية أكبر من صفر.'); return; }
    if (!Number.isFinite(parsedCost) || parsedCost < 0) { showAlert('تكلفة غير صحيحة', 'أدخل تكلفة تقديرية تساوي صفرًا أو أكثر.'); return; }
    if (expiryDate.trim() && !/^\\d{4}-\\d{2}-\\d{2}$/.test(expiryDate.trim())) { showAlert('تاريخ غير صحيح', 'أدخل تاريخ الانتهاء بصيغة YYYY-MM-DD أو اتركه فارغًا.'); return; }
    saveInProgress.current = true;
    setSaving(true);
    try {
      const result = createFreeSampleReceipt({
        product_id: product.id, unit, quantity: parsedQuantity, unit_cost: parsedCost,
        batch_number: batchNumber, expiry_date: expiryDate, supplier_id: supplierId, reason,
      });
      if (!result.success) { showAlert('تعذر حفظ العينة', result.error); return; }
      showAlert('تم استلام العينة', `تمت إضافة ${result.base_quantity} ${product.inventory_unit} إلى المخزون دون إنشاء مبيعات أو رصيد مستحق للمورد.`);
      router.back();
    } catch {
      showAlert('تعذر حفظ العينة', 'حدث خطأ غير متوقع أثناء حفظ العينة. تحقق من المخزون ثم حاول مرة أخرى.');
    } finally {
      saveInProgress.current = false;
      setSaving(false);
    }
  };
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background, paddingTop: insets.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: theme.colors.surface }}>
        <TouchableOpacity onPress={() => router.back()}><MaterialIcons name="arrow-forward" size={24} color={theme.colors.textPrimary} /></TouchableOpacity>
        <Text style={{ color: theme.colors.textPrimary, fontSize: 19, fontWeight: '800' }}>استلام عينات مجانية</Text>
        <MaterialIcons name="card-giftcard" size={24} color={theme.colors.primary} />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}>
        <Text style={{ color: theme.colors.textSecondary, textAlign: 'right' }}>تزيد العينة المخزون فقط، ولا تنشئ فاتورة شراء أو دينًا على المورد أو إيراد مبيعات.</Text>
        <TextInput value={search} onChangeText={setSearch} placeholder="ابحث عن الصنف بالاسم أو الباركود" placeholderTextColor={theme.colors.textTertiary} style={inputStyle} />
        {products.filter(p => !search.trim() || [p.trade_name, p.generic_name || '', p.barcode || ''].some(v => v.toLowerCase().includes(search.toLowerCase()))).slice(0, 8).map(p => (
          <TouchableOpacity key={p.id} onPress={() => { setProduct(p); setUnit(getProductUnits(p.id)[0]?.unit_name || p.inventory_unit); }} style={{ padding: 12, borderRadius: 10, borderWidth: 1, borderColor: product?.id === p.id ? theme.colors.primary : theme.colors.divider, backgroundColor: theme.colors.surface }}>
            <Text style={{ color: theme.colors.textPrimary, textAlign: 'right', fontWeight: '700' }}>{p.trade_name}</Text>
            <Text style={{ color: theme.colors.textSecondary, textAlign: 'right', fontSize: 12 }}>{p.barcode || p.inventory_unit}</Text>
          </TouchableOpacity>
        ))}
        {product ? <>
          <Text style={{ color: theme.colors.textPrimary, textAlign: 'right', fontWeight: '700' }}>الصنف المختار: {product.trade_name}</Text>
          <Text style={{ color: theme.colors.textSecondary, textAlign: 'right' }}>وحدة الكمية</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(getProductUnits(product.id).length ? getProductUnits(product.id) : [{ unit_name: product.inventory_unit }]).map(u => (
              <TouchableOpacity key={u.unit_name} onPress={() => setUnit(u.unit_name)} style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 18, backgroundColor: unit === u.unit_name ? theme.colors.primary : theme.colors.surface, borderWidth: 1, borderColor: theme.colors.divider }}>
                <Text style={{ color: unit === u.unit_name ? '#fff' : theme.colors.textPrimary }}>{u.unit_name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </> : null}
        <Text style={{ color: theme.colors.textSecondary, textAlign: 'right' }}>المورد (اختياري؛ لا يتغير رصيده المالي)</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <TouchableOpacity onPress={() => setSupplierId(null)} style={{ padding: 9, borderRadius: 8, backgroundColor: supplierId === null ? theme.colors.primary : theme.colors.surface }}><Text style={{ color: supplierId === null ? '#fff' : theme.colors.textPrimary }}>بدون مورد</Text></TouchableOpacity>
          {suppliers.map(s => <TouchableOpacity key={s.id} onPress={() => setSupplierId(s.id)} style={{ padding: 9, borderRadius: 8, backgroundColor: supplierId === s.id ? theme.colors.primary : theme.colors.surface }}><Text style={{ color: supplierId === s.id ? '#fff' : theme.colors.textPrimary }}>{s.name}</Text></TouchableOpacity>)}
        </View>
        {fields.map(f => <View key={f.label} style={{ gap: 5 }}><Text style={{ color: theme.colors.textPrimary, textAlign: 'right' }}>{f.label}</Text><TextInput value={f.value} onChangeText={f.set} placeholder={f.placeholder} placeholderTextColor={theme.colors.textTertiary} keyboardType={'numeric' in f && f.numeric ? 'decimal-pad' : 'default'} style={inputStyle} /></View>)}
        <TouchableOpacity disabled={saving} onPress={save} style={{ backgroundColor: theme.colors.primary, padding: 15, borderRadius: 12, alignItems: 'center', opacity: saving ? 0.6 : 1 }}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>{saving ? 'جارٍ الحفظ…' : 'حفظ وترصيد العينة'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}
