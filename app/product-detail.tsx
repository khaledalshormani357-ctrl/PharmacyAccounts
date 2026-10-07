// Smart Pharmacy ERP — Product Detail + Batch Management
import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams , useFocusEffect } from 'expo-router';
import { useTheme } from '@/contexts/ThemeContext';
import {
  getProduct, getBatches, getProductUnits, getStockMovements, getProductAlternatives,
  canEditOpeningStock, updateOpeningStock, adjustStock, Product, Batch, StockMovement,
} from '@/services/database';
import { formatCurrency, formatDate, daysFromToday, expiryLabel } from '@/constants/i18n';
import { useAlert } from '@/template';
import { decomposeBaseQuantity } from '@/services/unit-conversion';

export default function ProductDetailScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showAlert } = useAlert();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [product, setProduct] = useState<Product | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [alternatives, setAlternatives] = useState<Product[]>([]);
  const [activeTab, setActiveTab] = useState<'batches' | 'movements' | 'alternatives'>('batches');
  const [showAdjust, setShowAdjust] = useState(false);
  const [adjustBatch, setAdjustBatch] = useState<Batch | null>(null);
  const [adjustQty, setAdjustQty] = useState('');
  const [adjustNote, setAdjustNote] = useState('');
  const [openingEditBatch, setOpeningEditBatch] = useState<Batch | null>(null);
  const [openingEditQuantity, setOpeningEditQuantity] = useState('');
  const [openingEditCost, setOpeningEditCost] = useState('');
  const [openingEditBatchNumber, setOpeningEditBatchNumber] = useState('');
  const [openingEditExpiry, setOpeningEditExpiry] = useState('');

  const load = useCallback(() => {
    if (!id) return;
    const pid = parseInt(id);
    setProduct(getProduct(pid));
    setBatches(getBatches(pid, false));
    setMovements(getStockMovements(pid).slice(0, 30));
    setAlternatives(getProductAlternatives(pid));
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const totalStock = batches.filter(b => b.status === 'ACTIVE').reduce((s, b) => s + b.quantity, 0);

  const handleAdjust = () => {
    if (!adjustBatch || !adjustQty.trim()) return;
    const qty = parseFloat(adjustQty);
    if (isNaN(qty)) { showAlert('خطأ', 'أدخل كمية صحيحة'); return; }
    adjustStock({
      product_id: parseInt(id!),
      batch_id: adjustBatch.id,
      quantity_change: qty,
      type: qty > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
      note: adjustNote || 'تعديل يدوي',
    });
    setShowAdjust(false);
    setAdjustQty('');
    setAdjustNote('');
    load();
    showAlert('تم', 'تم تعديل المخزون');
  };

  const openOpeningEditor = (batch: Batch) => {
    setOpeningEditBatch(batch);
    setOpeningEditQuantity(String(batch.quantity));
    setOpeningEditCost(String(batch.purchase_price));
    setOpeningEditBatchNumber(batch.batch_number);
    setOpeningEditExpiry(batch.expiry_date || '');
  };

  const saveOpeningEdit = () => {
    if (!openingEditBatch) return;
    const result = updateOpeningStock({ batch_id: openingEditBatch.id, base_quantity: Number(openingEditQuantity),
      unit_cost_per_base: Number(openingEditCost), batch_number: openingEditBatchNumber, expiry_date: openingEditExpiry });
    if (!result.success) { showAlert('تعذر تعديل الافتتاح', result.error); return; }
    setOpeningEditBatch(null);
    load();
    showAlert('تم', 'تم تحديث الرصيد الافتتاحي وتسجيل التعديل في سجل التدقيق.');
  };

  if (!product) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Text>جار التحميل...</Text></View>;
  }

  const stockUnits = getProductUnits(product.id);
  const stockUnitDefinitions = stockUnits.some(unit => unit.unit_name === product.inventory_unit)
    ? stockUnits
    : [{ id: -1, product_id: product.id, unit_name: product.inventory_unit, conversion_factor: 1,
        sale_price: null, purchase_price: null, is_purchase_default: true, is_sale_default: true }, ...stockUnits];
  const stockBreakdown = decomposeBaseQuantity(totalStock, product.inventory_unit, stockUnitDefinitions);

  const movementTypeLabel = (t: string) => {
    const map: Record<string, string> = { PURCHASE: 'شراء', PURCHASE_RETURN: 'مرتجع شراء', SALE: 'بيع', SALE_RETURN: 'مرتجع بيع', ADJUSTMENT_IN: 'إضافة', ADJUSTMENT_OUT: 'خصم', OPENING: 'رصيد افتتاحي', DAMAGE: 'تالف', EXPIRED: 'منتهي' };
    return map[t] || t;
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {/* Header */}
      <View style={{ backgroundColor: '#00B8D9', paddingTop: insets.top + 10, paddingBottom: 16, paddingHorizontal: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity onPress={() => router.push({ pathname: '/add-product', params: { id: product.id } })} style={{ backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 }}>
              <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '600' }}>تعديل</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.back()} style={{ width: 34, height: 34, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
              <MaterialIcons name="arrow-forward" size={20} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF', flex: 1, textAlign: 'center' }} numberOfLines={1}>{product.trade_name}</Text>
        </View>
        {/* Stock Summary */}
        <View style={{ backgroundColor: 'rgba(0,0,0,0.15)', borderRadius: 12, padding: 12, flexDirection: 'row', justifyContent: 'space-around' }}>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>الرصيد</Text>
            <Text style={{ fontSize: 18, fontWeight: '800', color: totalStock > 0 ? '#AAFFCC' : '#FFAAAA' }}>{totalStock}</Text>
            <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>{product.inventory_unit}</Text>
            <Text style={{ fontSize: 10, color: '#FFFFFF', textAlign: 'center', marginTop: 2 }}>{stockBreakdown.map(part => `${part.quantity} ${part.unit}`).join(' + ')}</Text>
          </View>
          <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.2)' }} />
          <View style={{ alignItems: 'center' }}>
            <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>سعر البيع</Text>
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#FFFFFF' }}>{formatCurrency(product.selling_price)}</Text>
          </View>
          <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.2)' }} />
          <View style={{ alignItems: 'center' }}>
            <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>الدفعات</Text>
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#FFFFFF' }}>{batches.filter(b => b.status === 'ACTIVE').length}</Text>
          </View>
        </View>
      </View>

      {/* Product Info */}
      <View style={{ backgroundColor: theme.colors.surface, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {[
            { label: 'الاسم العلمي', value: product.generic_name },
            { label: 'المادة الفعالة', value: product.active_ingredient },
            { label: 'الشكل', value: product.dosage_form },
            { label: 'الشركة', value: product.manufacturer },
            { label: 'الفئة', value: product.category },
            { label: 'الباركود', value: product.barcode },
          ].filter(i => i.value).map(info => (
            <View key={info.label} style={{ backgroundColor: theme.colors.surfaceAlt, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, alignItems: 'flex-end' }}>
              <Text style={{ fontSize: 10, color: theme.colors.textTertiary }}>{info.label}</Text>
              <Text style={{ fontSize: 12, fontWeight: '600', color: theme.colors.textPrimary }}>{info.value}</Text>
            </View>
          ))}
          {product.prescription_required && (
            <View style={{ backgroundColor: '#FFF8E6', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}>
              <Text style={{ fontSize: 11, color: '#F59E0B', fontWeight: '600' }}>يستلزم وصفة</Text>
            </View>
          )}
          {product.controlled && (
            <View style={{ backgroundColor: '#FFEBE6', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}>
              <Text style={{ fontSize: 11, color: '#DE350B', fontWeight: '600' }}>مراقب</Text>
            </View>
          )}
        </View>
      </View>

      {/* Tabs */}
      <View style={{ flexDirection: 'row', backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
        {([
          { key: 'batches', label: 'الدفعات' },
          { key: 'movements', label: 'الحركات' },
          { key: 'alternatives', label: 'البدائل' },
        ] as const).map(tab => (
          <TouchableOpacity
            key={tab.key}
            onPress={() => setActiveTab(tab.key)}
            style={{ flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: activeTab === tab.key ? '#00B8D9' : 'transparent' }}
          >
            <Text style={{ fontSize: 13, fontWeight: '600', color: activeTab === tab.key ? '#00B8D9' : theme.colors.textTertiary }}>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>
        {activeTab === 'batches' && (
          <View>
            <TouchableOpacity
              onPress={() => { setAdjustBatch(null); setShowAdjust(true); }}
              style={{ margin: 14, backgroundColor: '#00B8D9', borderRadius: 10, padding: 12, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 }}
            >
              <MaterialIcons name="tune" size={18} color="#FFFFFF" />
              <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '600' }}>تعديل المخزون</Text>
            </TouchableOpacity>
            {batches.length === 0 ? (
              <View style={{ padding: 32, alignItems: 'center' }}>
                <Text style={{ color: theme.colors.textTertiary }}>لا توجد دفعات مسجلة</Text>
              </View>
            ) : (
              batches.map(batch => {
                const days = batch.expiry_date ? daysFromToday(batch.expiry_date) : 999999;
                const batchColor = days <= 0 ? theme.colors.statusExpired : days <= 30 ? theme.colors.statusExpiring : days <= 90 ? theme.colors.warning : theme.colors.statusOk;
                return (
                  <View key={batch.id} style={{ marginHorizontal: 14, marginBottom: 10, backgroundColor: theme.colors.surface, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, padding: 12 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <View style={{ backgroundColor: batchColor + '18', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                        <Text style={{ fontSize: 11, fontWeight: '600', color: batchColor }}>{expiryLabel(days)}</Text>
                      </View>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.textPrimary }}>{batch.is_opening ? 'الرصيد الافتتاحي' : `دفعة: ${batch.batch_number}`}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <View style={{ alignItems: 'flex-start' }}>
                        <Text style={{ fontSize: 11, color: theme.colors.textTertiary }}>الكمية</Text>
                        <Text style={{ fontSize: 16, fontWeight: '700', color: batch.quantity > 0 ? theme.colors.textPrimary : theme.colors.error }}>{batch.quantity} {product.inventory_unit}</Text>
                      </View>
                      <View style={{ alignItems: 'center' }}>
                        <Text style={{ fontSize: 11, color: theme.colors.textTertiary }}>تكلفة الوحدة الأساسية</Text>
                        <Text style={{ fontSize: 13, fontWeight: '600', color: theme.colors.textPrimary }}>{formatCurrency(batch.purchase_price)}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ fontSize: 11, color: theme.colors.textTertiary }}>تاريخ الانتهاء</Text>
                        <Text style={{ fontSize: 13, fontWeight: '600', color: batchColor }}>{batch.expiry_date ? formatDate(batch.expiry_date) : 'غير محدد'}</Text>
                      </View>
                    </View>
                    <TouchableOpacity onPress={() => { setAdjustBatch(batch); setShowAdjust(true); }} style={{ marginTop: 10, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: theme.colors.surfaceAlt, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5 }}>
                      <MaterialIcons name="edit" size={14} color={theme.colors.textSecondary} />
                      <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>تعديل</Text>
                    </TouchableOpacity>
                    {batch.is_opening && canEditOpeningStock(batch.id) && (
                      <TouchableOpacity onPress={() => openOpeningEditor(batch)} style={{ marginTop: 7, alignSelf: 'flex-start', backgroundColor: theme.colors.successLight, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 }}>
                        <Text style={{ fontSize: 11, color: theme.colors.success, fontWeight: '700' }}>تعديل بيانات الرصيد الافتتاحي</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })
            )}
          </View>
        )}

        {activeTab === 'movements' && (
          <View>
            {movements.length === 0 ? (
              <View style={{ padding: 32, alignItems: 'center' }}>
                <Text style={{ color: theme.colors.textTertiary }}>لا توجد حركات مسجلة</Text>
              </View>
            ) : (
              movements.map(m => (
                <View key={m.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.divider, backgroundColor: theme.colors.surface }}>
                  <View style={{ alignItems: 'flex-start' }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: m.quantity > 0 ? theme.colors.success : theme.colors.error }}>
                      {m.quantity > 0 ? '+' : ''}{m.quantity} {product.inventory_unit}
                    </Text>
                  </View>
                  <View style={{ flex: 1, marginHorizontal: 10, alignItems: 'flex-end' }}>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: theme.colors.textPrimary }}>{movementTypeLabel(m.type)}</Text>
                    {m.note ? <Text style={{ fontSize: 11, color: theme.colors.textTertiary }}>{m.note}</Text> : null}
                  </View>
                  <Text style={{ fontSize: 11, color: theme.colors.textTertiary }}>{m.created_at.slice(0, 10)}</Text>
                </View>
              ))
            )}
          </View>
        )}

        {activeTab === 'alternatives' && (
          <View style={{ padding: 14 }}>
            {alternatives.length === 0 ? (
              <View style={{ padding: 32, alignItems: 'center' }}>
                <Text style={{ fontSize: 14, color: theme.colors.textTertiary, textAlign: 'center' }}>لا توجد بدائل متاحة بنفس المادة الفعالة</Text>
              </View>
            ) : (
              <>
                <View style={{ backgroundColor: theme.colors.warningLight, borderRadius: 8, padding: 10, marginBottom: 12 }}>
                  <Text style={{ fontSize: 12, color: theme.colors.warning, textAlign: 'right', fontWeight: '600' }}>
                    ⚠️ البدائل التالية تحتوي على نفس المادة الفعالة. يجب على الصيدلاني التحقق من الملاءمة السريرية.
                  </Text>
                </View>
                {alternatives.map(alt => (
                  <TouchableOpacity key={alt.id} onPress={() => router.push({ pathname: '/product-detail', params: { id: alt.id } })} style={{ backgroundColor: theme.colors.surface, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, padding: 12, marginBottom: 10 }}>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: theme.colors.textPrimary, textAlign: 'right' }}>{alt.trade_name}</Text>
                    {alt.strength && <Text style={{ fontSize: 12, color: theme.colors.textTertiary, textAlign: 'right' }}>{alt.strength}</Text>}
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.primary }}>{formatCurrency(alt.selling_price)}</Text>
                      <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>{alt.manufacturer || ''}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </>
            )}
          </View>
        )}
      </ScrollView>

      {/* Adjust Modal */}
      <Modal visible={showAdjust} animationType="slide" transparent>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: theme.colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: insets.bottom + 20 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: theme.colors.textPrimary, textAlign: 'right', marginBottom: 16 }}>
              تعديل المخزون{adjustBatch ? ` — دفعة ${adjustBatch.batch_number}` : ''}
            </Text>
            <Text style={{ fontSize: 12, color: theme.colors.textSecondary, textAlign: 'right', marginBottom: 6 }}>الكمية (موجب للإضافة، سالب للخصم)</Text>
            <TextInput
              value={adjustQty}
              onChangeText={setAdjustQty}
              keyboardType="numeric"
              placeholder="مثال: +10 أو -5"
              placeholderTextColor={theme.colors.textTertiary}
              style={{ height: 48, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: 12, fontSize: 16, textAlign: 'center', color: theme.colors.textPrimary, marginBottom: 12 }}
            />
            <TextInput
              value={adjustNote}
              onChangeText={setAdjustNote}
              placeholder="سبب التعديل"
              placeholderTextColor={theme.colors.textTertiary}
              style={{ height: 44, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: 12, fontSize: 14, textAlign: 'right', color: theme.colors.textPrimary, marginBottom: 16 }}
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity onPress={() => setShowAdjust(false)} style={{ flex: 1, height: 48, backgroundColor: theme.colors.surfaceAlt, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleAdjust} style={{ flex: 2, height: 48, backgroundColor: '#00B8D9', borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>تطبيق التعديل</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <Modal visible={!!openingEditBatch} animationType="slide" transparent onRequestClose={() => setOpeningEditBatch(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: theme.colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: insets.bottom + 20 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: theme.colors.textPrimary, textAlign: 'right', marginBottom: 6 }}>تعديل الرصيد الافتتاحي</Text>
            <Text style={{ fontSize: 11, color: theme.colors.textTertiary, textAlign: 'right', marginBottom: 12 }}>يسمح بالتعديل المباشر قبل أي حركة أخرى فقط. الكمية والتكلفة بوحدة الأساس ({product.inventory_unit}).</Text>
            <TextInput value={openingEditQuantity} onChangeText={setOpeningEditQuantity} keyboardType="decimal-pad" placeholder="كمية بوحدة الأساس" placeholderTextColor={theme.colors.textTertiary} style={{ height: 46, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 9, paddingHorizontal: 12, textAlign: 'center', fontSize: 15, color: theme.colors.textPrimary, marginBottom: 8 }} />
            <TextInput value={openingEditCost} onChangeText={setOpeningEditCost} keyboardType="decimal-pad" placeholder="تكلفة الوحدة الأساسية" placeholderTextColor={theme.colors.textTertiary} style={{ height: 46, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 9, paddingHorizontal: 12, textAlign: 'center', fontSize: 15, color: theme.colors.textPrimary, marginBottom: 8 }} />
            <TextInput value={openingEditBatchNumber} onChangeText={setOpeningEditBatchNumber} placeholder="رقم التشغيلة (اختياري)" placeholderTextColor={theme.colors.textTertiary} style={{ height: 46, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 9, paddingHorizontal: 12, textAlign: 'right', fontSize: 14, color: theme.colors.textPrimary, marginBottom: 8 }} />
            <TextInput value={openingEditExpiry} onChangeText={setOpeningEditExpiry} placeholder="الانتهاء YYYY-MM-DD (اختياري)" placeholderTextColor={theme.colors.textTertiary} style={{ height: 46, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 9, paddingHorizontal: 12, textAlign: 'center', fontSize: 14, color: theme.colors.textPrimary, marginBottom: 14 }} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity onPress={() => setOpeningEditBatch(null)} style={{ flex: 1, height: 46, borderRadius: 9, backgroundColor: theme.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>إلغاء</Text></TouchableOpacity>
              <TouchableOpacity onPress={saveOpeningEdit} style={{ flex: 2, height: 46, borderRadius: 9, backgroundColor: theme.colors.success, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#FFFFFF', fontWeight: '700' }}>حفظ التعديل</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
