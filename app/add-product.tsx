// Smart Pharmacy ERP — Add / Edit Product
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  Switch, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTheme } from '@/contexts/ThemeContext';
import { addProduct, createOpeningStock, getProduct, getProductUnits, hasProductStockHistory, replaceProductUnits, updateProduct } from '@/services/database';
import { AR } from '@/constants/i18n';
import { useAlert } from '@/template';
import { deriveUnitFactors, formatUnitEquivalents, isValidIsoDate, isValidUnitQuantity, priceForUnit } from '@/services/unit-conversion';

const DOSAGE_FORMS = ['أقراص', 'كبسول', 'شراب', 'حقن', 'كريم', 'مرهم', 'قطرة', 'بخاخ', 'تحاميل', 'مسحوق', 'أخرى'];
const CATEGORIES = ['مضادات حيوية', 'مسكنات', 'فيتامينات', 'قلب وأوعية', 'جهاز هضمي', 'جهاز تنفسي', 'عيون وأذن', 'جلدية', 'مستلزمات طبية', 'أخرى'];
const UNITS = ['قطعة', 'علبة', 'شريط', 'حبة', 'زجاجة', 'كرتون', 'أمبول', 'أنبوب', 'كيس', 'مل', 'لتر', 'ملجم', 'جرام', 'كجم'];
type UnitDraft = { unit_name: string; parent_unit_name: string; quantity_per_parent: string; sale_price: string; purchase_price: string };

export default function AddProductScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showAlert } = useAlert();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const isEdit = !!id;

  const [barcode, setBarcode] = useState('');
  const [internalCode, setInternalCode] = useState('');
  const [tradeName, setTradeName] = useState('');
  const [genericName, setGenericName] = useState('');
  const [activeIngredient, setActiveIngredient] = useState('');
  const [strength, setStrength] = useState('');
  const [dosageForm, setDosageForm] = useState('أقراص');
  const [manufacturer, setManufacturer] = useState('');
  const [category, setCategory] = useState('أخرى');
  const [inventoryUnit, setInventoryUnit] = useState('قطعة');
  const [sellingPrice, setSellingPrice] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [minStock, setMinStock] = useState('10');
  const [reorderLevel, setReorderLevel] = useState('20');
  const [prescriptionRequired, setPrescriptionRequired] = useState(false);
  const [controlled, setControlled] = useState(false);
  const [notes, setNotes] = useState('');
  const [units, setUnits] = useState<UnitDraft[]>([]);
  const [openingQuantity, setOpeningQuantity] = useState('0');
  const [openingUnit, setOpeningUnit] = useState('قطعة');
  const [openingCost, setOpeningCost] = useState('');
  const [openingBatch, setOpeningBatch] = useState('');
  const [openingExpiry, setOpeningExpiry] = useState('');

  // Load existing product if editing
  React.useEffect(() => {
    if (id) {
      const p = getProduct(parseInt(id));
      if (p) {
        setBarcode(p.barcode || '');
        setInternalCode(p.internal_code || '');
        setTradeName(p.trade_name);
        setGenericName(p.generic_name || '');
        setActiveIngredient(p.active_ingredient || '');
        setStrength(p.strength || '');
        setDosageForm(p.dosage_form || 'أقراص');
        setManufacturer(p.manufacturer || '');
        setCategory(p.category || 'أخرى');
        setInventoryUnit(p.inventory_unit);
        setOpeningUnit(p.inventory_unit);
        setSellingPrice(String(p.selling_price));
        setPurchasePrice(String(p.default_purchase_price));
        setMinStock(String(p.minimum_stock));
        setReorderLevel(String(p.reorder_level));
        setPrescriptionRequired(p.prescription_required);
        setControlled(p.controlled);
        setNotes(p.notes || '');
        const currentUnits = getProductUnits(p.id).filter(u => u.unit_name !== p.inventory_unit);
        setUnits(currentUnits.map(u => ({
          unit_name: u.unit_name,
          parent_unit_name: u.parent_unit_name || p.inventory_unit,
          quantity_per_parent: String(u.quantity_per_parent ?? u.conversion_factor),
          sale_price: u.sale_price == null ? '' : String(u.sale_price),
          purchase_price: u.purchase_price == null ? '' : String(u.purchase_price),
        })));
      }
    }
  }, [id]);

  const namedUnits = units.filter(unit => unit.unit_name.trim());
  const hierarchyInputs = namedUnits.map(unit => ({ unit_name: unit.unit_name.trim(), parent_unit_name: unit.parent_unit_name, quantity_per_parent: Number(unit.quantity_per_parent) }));
  const hierarchy = deriveUnitFactors(inventoryUnit, hierarchyInputs);
  const unitDefinitions = hierarchy.ok
    ? [{ unit_name: inventoryUnit, conversion_factor: 1 }, ...namedUnits.map(unit => ({ unit_name: unit.unit_name.trim(), conversion_factor: hierarchy.factors[unit.unit_name.trim()] }))]
    : [{ unit_name: inventoryUnit, conversion_factor: 1 }];
  const openingQty = Number(openingQuantity);
  const openingFactor = hierarchy.ok ? hierarchy.factors[openingUnit] : undefined;
  const openingOverrideText = openingUnit === inventoryUnit ? '' : units.find(unit => unit.unit_name.trim() === openingUnit)?.purchase_price.trim() || '';
  const suggestedOpeningCost = openingFactor
    ? priceForUnit(Number(purchasePrice) || 0, openingFactor, openingOverrideText === '' ? null : Number(openingOverrideText))
    : Number.NaN;
  const effectiveOpeningCost = openingCost.trim() === '' ? suggestedOpeningCost : Number(openingCost);
  const openingEquivalent = openingFactor && Number.isFinite(openingQty) && openingQty > 0
    ? formatUnitEquivalents(openingQty, openingUnit, inventoryUnit, unitDefinitions)
    : [];

  const normalizedUnits = () => [
    { unit_name: inventoryUnit, conversion_factor: 1, parent_unit_name: null, quantity_per_parent: 1, sale_price: null, purchase_price: null, is_purchase_default: true, is_sale_default: true },
    ...namedUnits.map(unit => ({
      unit_name: unit.unit_name.trim(),
      conversion_factor: hierarchy.ok ? hierarchy.factors[unit.unit_name.trim()] : 0,
      parent_unit_name: unit.parent_unit_name,
      quantity_per_parent: Number(unit.quantity_per_parent),
      sale_price: unit.sale_price.trim() === '' ? null : Math.max(0, Number(unit.sale_price)),
      purchase_price: unit.purchase_price.trim() === '' ? null : Math.max(0, Number(unit.purchase_price)),
      is_purchase_default: false,
      is_sale_default: false,
    })),
  ];

  const handleBaseUnitChange = (nextUnit: string) => {
    if (isEdit && id && nextUnit !== inventoryUnit && hasProductStockHistory(parseInt(id))) {
      showAlert('لا يمكن تغيير وحدة المخزون', 'لدى هذا الصنف أرصدة أو حركات سابقة. غيّر وحداته الأعلى مع الإبقاء على وحدة المخزون الأساسية لحماية الدفعات والفواتير القديمة.');
      return;
    }
    setInventoryUnit(nextUnit);
    if (!isEdit) setOpeningUnit(nextUnit);
    setUnits(prev => prev.map(unit => unit.parent_unit_name === inventoryUnit ? { ...unit, parent_unit_name: nextUnit } : unit));
  };

  const handleSave = () => {
    if (!tradeName.trim()) { showAlert('تنبيه', 'أدخل الاسم التجاري للصنف'); return; }
    if (sellingPrice.trim() === '' || !Number.isFinite(Number(sellingPrice)) || Number(sellingPrice) < 0) { showAlert('سعر غير صحيح', 'أدخل سعر بيع صحيحًا لا يقل عن صفر.'); return; }
    if (purchasePrice.trim() !== '' && (!Number.isFinite(Number(purchasePrice)) || Number(purchasePrice) < 0)) { showAlert('تكلفة غير صحيحة', 'أدخل سعر شراء صحيحًا لا يقل عن صفر.'); return; }
    if (units.some(unit => !unit.unit_name.trim())) { showAlert('تحقق من الوحدات', 'أدخل اسم كل وحدة مضافة أو احذف الصف الفارغ.'); return; }
    if (!hierarchy.ok) { showAlert('تحقق من الوحدات', hierarchy.error); return; }
    if (namedUnits.some(unit => unit.sale_price.trim() && (!Number.isFinite(Number(unit.sale_price)) || Number(unit.sale_price) < 0) || unit.purchase_price.trim() && (!Number.isFinite(Number(unit.purchase_price)) || Number(unit.purchase_price) < 0))) {
      showAlert('تحقق من السعر', 'سعر الوحدة الاختياري يجب أن يكون رقمًا موجبًا أو صفرًا. اتركه فارغًا لاشتقاق السعر تلقائيًا.'); return;
    }
    if (!isEdit && openingQty < 0) { showAlert('كمية غير صحيحة', 'لا يمكن أن يكون الرصيد الافتتاحي سالبًا.'); return; }
    if (!isEdit && Number.isFinite(openingQty) && openingQty > 0) {
      if (!isValidUnitQuantity(openingQty, openingUnit)) { showAlert('كمية غير صحيحة', 'الوحدات العددية تقبل أعدادًا صحيحة؛ الكسور متاحة لوحدات الحجم والوزن.'); return; }
      if (!openingFactor || !Number.isFinite(effectiveOpeningCost) || effectiveOpeningCost < 0) { showAlert('تحقق من الرصيد الافتتاحي', 'اختر وحدة معرفة وأدخل تكلفة اقتناء صحيحة.'); return; }
      if (openingExpiry.trim() && !isValidIsoDate(openingExpiry)) { showAlert('تاريخ غير صحيح', 'أدخل تاريخ الانتهاء بصيغة YYYY-MM-DD صحيحة أو اتركه فارغًا.'); return; }
    } else if (!isEdit && openingQuantity.trim() && !Number.isFinite(openingQty)) {
      showAlert('كمية غير صحيحة', 'أدخل كمية افتتاحية صحيحة أو اترك الحقل فارغًا.'); return;
    }

    const data = {
      barcode: barcode.trim() || null,
      internal_code: internalCode.trim() || null,
      trade_name: tradeName.trim(),
      generic_name: genericName.trim() || null,
      active_ingredient: activeIngredient.trim() || null,
      strength: strength.trim() || null,
      dosage_form: dosageForm,
      manufacturer: manufacturer.trim() || null,
      category,
      inventory_unit: inventoryUnit,
      selling_price: Number(sellingPrice),
      default_purchase_price: purchasePrice.trim() === '' ? 0 : Number(purchasePrice),
      minimum_stock: Number.isFinite(Number(minStock)) && Number(minStock) >= 0 ? Number(minStock) : 10,
      reorder_level: Number.isFinite(Number(reorderLevel)) && Number(reorderLevel) >= 0 ? Number(reorderLevel) : 20,
      prescription_required: prescriptionRequired,
      controlled,
      active: true,
      notes: notes.trim() || null,
    };

    try {
      if (isEdit) {
        updateProduct(parseInt(id!), data);
        replaceProductUnits(parseInt(id!), normalizedUnits());
        showAlert('تم', 'تم تحديث الصنف', [{ text: 'موافق', onPress: () => router.back() }]);
      } else {
        const product = addProduct(data);
        replaceProductUnits(product.id, normalizedUnits());
        if (openingQty > 0) {
          const opening = createOpeningStock({ product_id: product.id, unit: openingUnit, quantity: openingQty,
            unit_cost: effectiveOpeningCost, batch_number: openingBatch, expiry_date: openingExpiry });
          if (!opening.success) { showAlert('تم إنشاء الدواء مع خطأ في الرصيد الافتتاحي', opening.error); return; }
        }
        showAlert('تم', openingQty > 0 ? `تم إضافة الصنف وتسجيل الرصيد الافتتاحي (${openingQty} ${openingUnit})` : 'تم إضافة الصنف', [{ text: 'موافق', onPress: () => router.back() }]);
      }
    } catch (e: any) {
      showAlert('خطأ', e?.message || AR.errorSave);
    }
  };

  const inputStyle = {
    height: 46, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border,
    paddingHorizontal: 12, fontSize: 14, textAlign: 'right' as const,
    backgroundColor: theme.colors.surface, color: theme.colors.textPrimary,
  };
  const labelStyle = { fontSize: 12, fontWeight: '600' as const, color: theme.colors.textSecondary, textAlign: 'right' as const, marginBottom: 5 };
  const sectionTitle = (title: string) => (
    <Text style={{ fontSize: 14, fontWeight: '700', color: theme.colors.textPrimary, textAlign: 'right', marginTop: 18, marginBottom: 10, borderRightWidth: 3, borderRightColor: '#00B8D9', paddingRight: 8 }}>{title}</Text>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ backgroundColor: '#00B8D9', paddingTop: insets.top + 10, paddingBottom: 14, paddingHorizontal: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <TouchableOpacity onPress={handleSave} style={{ backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 }}>
          <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '700' }}>حفظ</Text>
        </TouchableOpacity>
        <Text style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF' }}>{isEdit ? 'تعديل صنف' : 'صنف جديد'}</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <MaterialIcons name="close" size={22} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 14, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">

          {sectionTitle('المعلومات الأساسية')}
          <Text style={labelStyle}>الاسم التجاري *</Text>
          <TextInput style={inputStyle} value={tradeName} onChangeText={setTradeName} placeholder="مثال: بروفين 400" placeholderTextColor={theme.colors.textTertiary} />

          <Text style={[labelStyle, { marginTop: 10 }]}>الاسم العلمي (الجنيسي)</Text>
          <TextInput style={inputStyle} value={genericName} onChangeText={setGenericName} placeholder="مثال: ايبوبروفين" placeholderTextColor={theme.colors.textTertiary} />

          <Text style={[labelStyle, { marginTop: 10 }]}>المادة الفعالة</Text>
          <TextInput style={inputStyle} value={activeIngredient} onChangeText={setActiveIngredient} placeholder="مثال: Ibuprofen" placeholderTextColor={theme.colors.textTertiary} />

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={labelStyle}>التركيز</Text>
              <TextInput style={inputStyle} value={strength} onChangeText={setStrength} placeholder="400mg" placeholderTextColor={theme.colors.textTertiary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={labelStyle}>الباركود</Text>
              <TextInput style={inputStyle} value={barcode} onChangeText={setBarcode} placeholder="ادخل أو امسح" placeholderTextColor={theme.colors.textTertiary} keyboardType="numeric" />
            </View>
          </View>

          <Text style={[labelStyle, { marginTop: 10 }]}>الشركة المصنعة</Text>
          <TextInput style={inputStyle} value={manufacturer} onChangeText={setManufacturer} placeholder="اسم الشركة" placeholderTextColor={theme.colors.textTertiary} />

          {sectionTitle('التصنيف والشكل')}
          <Text style={labelStyle}>الشكل الصيدلاني</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, flexDirection: 'row', marginBottom: 12 }}>
            {DOSAGE_FORMS.map(f => (
              <TouchableOpacity key={f} onPress={() => setDosageForm(f)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: dosageForm === f ? '#00B8D9' : theme.colors.surfaceAlt, borderWidth: 1, borderColor: dosageForm === f ? '#00B8D9' : theme.colors.border }}>
                <Text style={{ fontSize: 12, color: dosageForm === f ? '#FFFFFF' : theme.colors.textSecondary }}>{f}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={labelStyle}>الفئة العلاجية</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, flexDirection: 'row', marginBottom: 12 }}>
            {CATEGORIES.map(c => (
              <TouchableOpacity key={c} onPress={() => setCategory(c)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: category === c ? '#00B8D9' : theme.colors.surfaceAlt, borderWidth: 1, borderColor: category === c ? '#00B8D9' : theme.colors.border }}>
                <Text style={{ fontSize: 12, color: category === c ? '#FFFFFF' : theme.colors.textSecondary }}>{c}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {sectionTitle('المخزون والأسعار')}
          <Text style={labelStyle}>وحدة المخزون الأساسية (الرصيد يُحفظ بها وحدها)</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, flexDirection: 'row', marginBottom: 12 }}>
            {UNITS.map(u => (
              <TouchableOpacity key={u} onPress={() => handleBaseUnitChange(u)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: inventoryUnit === u ? theme.colors.primary : theme.colors.surfaceAlt, borderWidth: 1, borderColor: inventoryUnit === u ? theme.colors.primary : theme.colors.border }}>
                <Text style={{ fontSize: 12, color: inventoryUnit === u ? '#FFFFFF' : theme.colors.textSecondary }}>{u}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <Text style={[labelStyle, { marginTop: 2 }]}>أو اسم وحدة أساسية مخصصة</Text>
          <TextInput style={inputStyle} value={inventoryUnit} onChangeText={handleBaseUnitChange}
            editable={!isEdit || !id || !hasProductStockHistory(parseInt(id))}
            placeholder="مثال: ملليلتر أو Tablet" placeholderTextColor={theme.colors.textTertiary} />

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={labelStyle}>سعر البيع *</Text>
              <TextInput style={inputStyle} value={sellingPrice} onChangeText={setSellingPrice} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={theme.colors.textTertiary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={labelStyle}>سعر الشراء</Text>
              <TextInput style={inputStyle} value={purchasePrice} onChangeText={setPurchasePrice} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={theme.colors.textTertiary} />
            </View>
          </View>

          {sectionTitle('تسلسل الوحدات والتحويل التلقائي')}
          <Text style={{ fontSize: 11, color: theme.colors.textTertiary, textAlign: 'right', marginBottom: 8 }}>
            عرّف النسبة إلى وحدة أصغر، وسيحسب التطبيق المكافئ إلى {inventoryUnit} تلقائيًا. اترك السعر فارغًا لاشتقاقه من سعر الوحدة الأساسية.
          </Text>
          {units.map((unit, index) => (
            <View key={`${index}-${unit.unit_name}`} style={{ backgroundColor: theme.colors.surfaceAlt, borderRadius: 9, padding: 9, marginBottom: 8 }}>
              <View style={{ flexDirection: 'row', gap: 7, alignItems: 'center' }}>
                <TouchableOpacity onPress={() => setUnits(prev => prev.filter((_, i) => i !== index))}>
                  <MaterialIcons name="delete-outline" size={19} color={theme.colors.error} />
                </TouchableOpacity>
                <TextInput style={[inputStyle, { flex: 1, height: 40 }]} value={unit.unit_name} onChangeText={v => setUnits(prev => prev.map((u, i) => i === index ? { ...u, unit_name: v } : u))} placeholder="اسم الوحدة (مثل شريط)" placeholderTextColor={theme.colors.textTertiary} />
              </View>
              <Text style={[labelStyle, { marginTop: 8 }]}>الوحدة الأدنى التي تتكوّن منها</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, flexDirection: 'row' }}>
                {[inventoryUnit, ...namedUnits.map(candidate => candidate.unit_name.trim()).filter((name, unitIndex, all) => name && name !== unit.unit_name.trim() && all.indexOf(name) === unitIndex)].map(parent => (
                  <TouchableOpacity key={parent} onPress={() => setUnits(prev => prev.map((u, i) => i === index ? { ...u, parent_unit_name: parent } : u))} style={{ borderRadius: 14, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: unit.parent_unit_name === parent ? theme.colors.primary : theme.colors.surface, borderWidth: 1, borderColor: unit.parent_unit_name === parent ? theme.colors.primary : theme.colors.border }}>
                    <Text style={{ fontSize: 11, color: unit.parent_unit_name === parent ? '#FFFFFF' : theme.colors.textSecondary }}>{parent}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 8 }}>
                <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>١ {unit.unit_name || 'وحدة'} =</Text>
                <TextInput style={[inputStyle, { width: 78, height: 38, textAlign: 'center' }]} value={unit.quantity_per_parent} onChangeText={v => setUnits(prev => prev.map((u, i) => i === index ? { ...u, quantity_per_parent: v } : u))} keyboardType="decimal-pad" placeholder="العدد" placeholderTextColor={theme.colors.textTertiary} />
                <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>{unit.parent_unit_name}</Text>
                <Text style={{ flex: 1, fontSize: 11, color: theme.colors.primary, textAlign: 'left' }}>{hierarchy.ok && unit.unit_name.trim() ? `= ${hierarchy.factors[unit.unit_name.trim()]} ${inventoryUnit}` : ''}</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 7 }}>
                <View style={{ flex: 1 }}>
                  <TextInput style={[inputStyle, { height: 38 }]} value={unit.sale_price} onChangeText={v => setUnits(prev => prev.map((u, i) => i === index ? { ...u, sale_price: v } : u))} keyboardType="decimal-pad" placeholder="سعر بيع خاص (اختياري)" placeholderTextColor={theme.colors.textTertiary} />
                  <Text style={{ fontSize: 10, color: theme.colors.textTertiary, textAlign: 'right', marginTop: 3 }}>{hierarchy.ok ? `المشتق: ${priceForUnit(Number(sellingPrice) || 0, hierarchy.factors[unit.unit_name.trim()] || 1).toFixed(2)}` : 'يشتق من سعر الأساس'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <TextInput style={[inputStyle, { height: 38 }]} value={unit.purchase_price} onChangeText={v => setUnits(prev => prev.map((u, i) => i === index ? { ...u, purchase_price: v } : u))} keyboardType="decimal-pad" placeholder="تكلفة خاصة (اختياري)" placeholderTextColor={theme.colors.textTertiary} />
                  <Text style={{ fontSize: 10, color: theme.colors.textTertiary, textAlign: 'right', marginTop: 3 }}>{hierarchy.ok ? `المشتق: ${priceForUnit(Number(purchasePrice) || 0, hierarchy.factors[unit.unit_name.trim()] || 1).toFixed(2)}` : 'يشتق من تكلفة الأساس'}</Text>
                </View>
              </View>
            </View>
          ))}
          {!hierarchy.ok && namedUnits.length > 0 ? <Text style={{ color: theme.colors.error, fontSize: 12, textAlign: 'right', marginBottom: 8 }}>{hierarchy.error}</Text> : null}
          <TouchableOpacity onPress={() => setUnits(prev => [...prev, { unit_name: '', parent_unit_name: namedUnits[namedUnits.length - 1]?.unit_name.trim() || inventoryUnit, quantity_per_parent: '1', sale_price: '', purchase_price: '' }])} style={{ borderWidth: 1, borderColor: theme.colors.primary, borderRadius: 8, paddingVertical: 9, alignItems: 'center', marginBottom: 8 }}>
            <Text style={{ color: theme.colors.primary, fontWeight: '700', fontSize: 13 }}>+ إضافة وحدة أخرى</Text>
          </TouchableOpacity>

          {!isEdit && (
            <View style={{ backgroundColor: theme.colors.successLight, borderColor: theme.colors.success, borderWidth: 1, borderRadius: 10, padding: 12, marginTop: 8 }}>
              {sectionTitle('الرصيد الافتتاحي')}
              <Text style={{ fontSize: 11, color: theme.colors.textSecondary, textAlign: 'right', marginBottom: 9 }}>يُسجل كحركة مخزون افتتاحية ودفعة، ولا يُنشئ شراءً أو مديونية مورد أو حركة صندوق.</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={labelStyle}>الكمية الافتتاحية</Text>
                  <TextInput style={inputStyle} value={openingQuantity} onChangeText={setOpeningQuantity} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={theme.colors.textTertiary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={labelStyle}>تكلفة وحدة الافتتاح</Text>
                  <TextInput style={inputStyle} value={openingCost} onChangeText={setOpeningCost} keyboardType="decimal-pad" placeholder={Number.isFinite(suggestedOpeningCost) ? suggestedOpeningCost.toFixed(2) : '0.00'} placeholderTextColor={theme.colors.textTertiary} />
                </View>
              </View>
              <Text style={[labelStyle, { marginTop: 8 }]}>وحدة الافتتاح</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, flexDirection: 'row' }}>
                {unitDefinitions.map(unit => (
                  <TouchableOpacity key={unit.unit_name} onPress={() => { setOpeningUnit(unit.unit_name); setOpeningCost(''); }} style={{ borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: openingUnit === unit.unit_name ? theme.colors.success : theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }}>
                    <Text style={{ color: openingUnit === unit.unit_name ? '#FFFFFF' : theme.colors.textSecondary, fontSize: 11 }}>{unit.unit_name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 9 }}>
                <TextInput style={[inputStyle, { flex: 1 }]} value={openingBatch} onChangeText={setOpeningBatch} placeholder="رقم التشغيلة (اختياري)" placeholderTextColor={theme.colors.textTertiary} />
                <TextInput style={[inputStyle, { flex: 1, textAlign: 'center' }]} value={openingExpiry} onChangeText={setOpeningExpiry} placeholder="الانتهاء YYYY-MM-DD (اختياري)" placeholderTextColor={theme.colors.textTertiary} />
              </View>
              {openingEquivalent.length > 0 && (
                <View style={{ backgroundColor: theme.colors.surface, borderRadius: 8, padding: 9, marginTop: 10 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: theme.colors.success, textAlign: 'right', marginBottom: 5 }}>سيتم إضافة — الرصيد الافتتاحي</Text>
                  {openingEquivalent.map(item => <Text key={item.unit} style={{ fontSize: 13, color: theme.colors.textPrimary, textAlign: 'right' }}>{item.quantity} {item.unit}</Text>)}
                </View>
              )}
            </View>
          )}

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={labelStyle}>الحد الأدنى</Text>
              <TextInput style={inputStyle} value={minStock} onChangeText={setMinStock} keyboardType="numeric" placeholder="10" placeholderTextColor={theme.colors.textTertiary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={labelStyle}>نقطة إعادة الطلب</Text>
              <TextInput style={inputStyle} value={reorderLevel} onChangeText={setReorderLevel} keyboardType="numeric" placeholder="20" placeholderTextColor={theme.colors.textTertiary} />
            </View>
          </View>

          {sectionTitle('معلومات إضافية')}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <Switch value={prescriptionRequired} onValueChange={setPrescriptionRequired} trackColor={{ true: '#00B8D9' }} />
            <Text style={{ fontSize: 14, color: theme.colors.textPrimary }}>يستلزم وصفة طبية</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <Switch value={controlled} onValueChange={setControlled} trackColor={{ true: '#DE350B' }} />
            <Text style={{ fontSize: 14, color: theme.colors.textPrimary }}>دواء مراقب</Text>
          </View>
          <Text style={[labelStyle, { marginTop: 8 }]}>ملاحظات</Text>
          <TextInput
            style={[inputStyle, { height: 72, textAlignVertical: 'top', paddingTop: 10 }]}
            value={notes}
            onChangeText={setNotes}
            placeholder="ملاحظات إضافية..."
            placeholderTextColor={theme.colors.textTertiary}
            multiline
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
