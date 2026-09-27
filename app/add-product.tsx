// Smart Pharmacy ERP — Add / Edit Product
import React, { useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  Switch, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTheme } from '@/contexts/ThemeContext';
import { addProduct, getProduct, updateProduct, addProductUnit } from '@/services/database';
import { AR } from '@/constants/i18n';
import { useAlert } from '@/template';

const DOSAGE_FORMS = ['أقراص', 'كبسول', 'شراب', 'حقن', 'كريم', 'مرهم', 'قطرة', 'بخاخ', 'تحاميل', 'مسحوق', 'أخرى'];
const CATEGORIES = ['مضادات حيوية', 'مسكنات', 'فيتامينات', 'قلب وأوعية', 'جهاز هضمي', 'جهاز تنفسي', 'عيون وأذن', 'جلدية', 'مستلزمات طبية', 'أخرى'];
const UNITS = ['قطعة', 'علبة', 'شريط', 'حبة', 'زجاجة', 'كرتون', 'أمبول', 'أنبوب', 'كيس'];

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
        setSellingPrice(String(p.selling_price));
        setPurchasePrice(String(p.default_purchase_price));
        setMinStock(String(p.minimum_stock));
        setReorderLevel(String(p.reorder_level));
        setPrescriptionRequired(p.prescription_required);
        setControlled(p.controlled);
        setNotes(p.notes || '');
      }
    }
  }, [id]);

  const handleSave = () => {
    if (!tradeName.trim()) { showAlert('تنبيه', 'أدخل الاسم التجاري للصنف'); return; }
    if (!sellingPrice || parseFloat(sellingPrice) < 0) { showAlert('تنبيه', 'أدخل سعر البيع'); return; }

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
      selling_price: parseFloat(sellingPrice) || 0,
      default_purchase_price: parseFloat(purchasePrice) || 0,
      minimum_stock: parseInt(minStock) || 10,
      reorder_level: parseInt(reorderLevel) || 20,
      prescription_required: prescriptionRequired,
      controlled,
      active: true,
      notes: notes.trim() || null,
    };

    try {
      if (isEdit) {
        updateProduct(parseInt(id!), data);
        showAlert('تم', 'تم تحديث الصنف', [{ text: 'موافق', onPress: () => router.back() }]);
      } else {
        const product = addProduct(data);
        // Add default units
        addProductUnit({ product_id: product.id, unit_name: inventoryUnit, conversion_factor: 1, is_purchase_default: true, is_sale_default: true });
        showAlert('تم', 'تم إضافة الصنف', [{ text: 'موافق', onPress: () => router.back() }]);
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
          <Text style={labelStyle}>وحدة المخزون</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, flexDirection: 'row', marginBottom: 12 }}>
            {UNITS.map(u => (
              <TouchableOpacity key={u} onPress={() => setInventoryUnit(u)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: inventoryUnit === u ? theme.colors.primary : theme.colors.surfaceAlt, borderWidth: 1, borderColor: inventoryUnit === u ? theme.colors.primary : theme.colors.border }}>
                <Text style={{ fontSize: 12, color: inventoryUnit === u ? '#FFFFFF' : theme.colors.textSecondary }}>{u}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={labelStyle}>سعر البيع *</Text>
              <TextInput style={inputStyle} value={sellingPrice} onChangeText={setSellingPrice} keyboardType="numeric" placeholder="0.00" placeholderTextColor={theme.colors.textTertiary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={labelStyle}>سعر الشراء</Text>
              <TextInput style={inputStyle} value={purchasePrice} onChangeText={setPurchasePrice} keyboardType="numeric" placeholder="0.00" placeholderTextColor={theme.colors.textTertiary} />
            </View>
          </View>

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
