// Smart Pharmacy ERP — Batch-level stocktake
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import { getProducts, getAllBatches, applyStocktake, Product, Batch } from '@/services/database';
import { useAlert } from '@/template';

type StocktakeRow = { batch: Batch; product: Product; counted: string };

export default function StocktakeScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showAlert } = useAlert();
  const [search, setSearch] = useState('');
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [adjustmentReason, setAdjustmentReason] = useState('جرد مخزون فعلي');

  const rows = useMemo<StocktakeRow[]>(() => {
    const products = getProducts({ search: search.trim() });
    const byId = new Map(products.map(p => [p.id, p]));
    return getAllBatches({ status: 'ACTIVE' })
      .filter(batch => byId.has(batch.product_id))
      .sort((a, b) => (byId.get(a.product_id)?.trade_name || '').localeCompare(byId.get(b.product_id)?.trade_name || '', 'ar'))
      .map(batch => ({ batch, product: byId.get(batch.product_id)!, counted: counts[batch.id] ?? String(batch.quantity) }));
  }, [search, counts, refreshKey]);

  const deltaRows = rows.filter(row => {
    const n = Number(row.counted);
    return row.counted.trim() !== '' && Number.isFinite(n) && n >= 0 && Math.abs(n - row.batch.quantity) > 1e-8;
  });
  const invalidCount = rows.some(row => row.counted.trim() === '' || !Number.isFinite(Number(row.counted)) || Number(row.counted) < 0);

  const submit = useCallback(() => {
    if (saving) return;
    if (invalidCount) {
      showAlert('تحقق من الجرد', 'أدخل كمية فعلية صحيحة وغير سالبة لكل دفعة ظاهرة قبل اعتماد الجرد.');
      return;
    }
    if (!adjustmentReason.trim()) {
      showAlert('سبب التسوية مطلوب', 'اكتب سببًا واضحًا قبل اعتماد فروقات الجرد.');
      return;
    }
    if (!deltaRows.length) {
      showAlert('لا توجد فروقات', 'الكميات الفعلية تطابق أرصدة النظام.');
      return;
    }
    showAlert('تأكيد اعتماد الجرد', 'سيتم تسجيل ' + deltaRows.length + ' فرق/فروقات كحركات تسوية مع سبب موحد. لا يمكن التراجع عنها تلقائياً.', [
      { text: 'إلغاء', style: 'cancel' },
      { text: 'اعتماد الجرد', onPress: () => {
        setSaving(true);
        const result = applyStocktake({
          counts: deltaRows.map(row => ({
            product_id: row.product.id,
            batch_id: row.batch.id,
            actual_quantity: Number(row.counted),
          })),
          reason: adjustmentReason.trim(),
        });
        setSaving(false);
        setRefreshKey(v => v + 1);
        if (!result.success) {
          showAlert('تعذر اعتماد الجرد', result.error);
          return;
        }
        setCounts({});
        showAlert('اكتمل الجرد', result.applied === 0 ? 'لا توجد فروقات لتسجيلها.' : 'تم تسجيل ' + result.applied + ' فرق/فروقات جرد دفعة واحدة.');
      }},
    ]);
  }, [saving, invalidCount, deltaRows, showAlert]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 14, backgroundColor: theme.colors.primary, flexDirection: 'row', alignItems: 'center' }}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 8 }}><MaterialIcons name="arrow-forward" size={24} color="#fff" /></TouchableOpacity>
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <Text style={{ color: '#fff', fontSize: 19, fontWeight: '800' }}>الجرد الفعلي للمخزون</Text>
          <Text style={{ color: '#E6F4FF', fontSize: 12, marginTop: 3 }}>قارن رصيد كل دفعة بالكمية الفعلية</Text>
        </View>
      </View>
      <View style={{ padding: 12, backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
        <TextInput value={search} onChangeText={setSearch} placeholder="ابحث باسم الدواء أو الباركود..." placeholderTextColor={theme.colors.textTertiary}
          style={{ backgroundColor: theme.colors.background, color: theme.colors.textPrimary, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, textAlign: 'right' }} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>الدفعات الظاهرة: {rows.length}</Text>
          <Text style={{ color: deltaRows.length ? theme.colors.error : theme.colors.success, fontSize: 12, fontWeight: '700' }}>الفروقات: {deltaRows.length}</Text>
        </View>
        <Text style={{ color: theme.colors.textSecondary, fontSize: 12, textAlign: 'right', marginTop: 12, marginBottom: 5 }}>سبب التسوية (يُحفظ في سجل الحركة)</Text>
        <TextInput value={adjustmentReason} onChangeText={setAdjustmentReason} placeholder="مثال: جرد نهاية الشهر" placeholderTextColor={theme.colors.textTertiary}
          style={{ backgroundColor: theme.colors.background, color: theme.colors.textPrimary, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, textAlign: 'right' }} />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 12, paddingBottom: 110 }}>
        {rows.map(({ batch, product, counted }) => {
          const current = Number(counted);
          const valid = counted.trim() !== '' && Number.isFinite(current) && current >= 0;
          const delta = valid ? current - batch.quantity : 0;
          return (
            <View key={batch.id} style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 14, padding: 13, marginBottom: 9 }}>
              <Text style={{ color: theme.colors.textPrimary, fontSize: 15, fontWeight: '800', textAlign: 'right' }}>{product.trade_name}</Text>
              <Text style={{ color: theme.colors.textTertiary, fontSize: 11, textAlign: 'right', marginTop: 3 }}>الدفعة: {batch.batch_number || 'بدون رقم'}  ·  الصلاحية: {batch.expiry_date || 'غير محددة'}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.textTertiary, fontSize: 11, textAlign: 'center', marginBottom: 5 }}>الكمية الفعلية</Text>
                  <TextInput keyboardType="decimal-pad" value={counted} onChangeText={value => setCounts(prev => ({ ...prev, [batch.id]: value }))}
                    selectTextOnFocus style={{ borderWidth: 1, borderColor: valid && Math.abs(delta) > 1e-8 ? theme.colors.warning : theme.colors.border, borderRadius: 10, color: theme.colors.textPrimary, padding: 10, textAlign: 'center', fontSize: 16, fontWeight: '700' }} />
                </View>
                <View style={{ flex: 1, alignItems: 'center' }}>
                  <Text style={{ color: theme.colors.textTertiary, fontSize: 11 }}>رصيد النظام</Text>
                  <Text style={{ color: theme.colors.textPrimary, fontSize: 18, fontWeight: '700', marginTop: 8 }}>{batch.quantity}</Text>
                </View>
                <View style={{ flex: 1, alignItems: 'center' }}>
                  <Text style={{ color: theme.colors.textTertiary, fontSize: 11 }}>الفرق</Text>
                  <Text style={{ color: !valid ? theme.colors.danger : delta > 0 ? theme.colors.success : delta < 0 ? theme.colors.danger : theme.colors.textSecondary, fontSize: 18, fontWeight: '800', marginTop: 8 }}>{valid ? (delta > 0 ? '+' : '') + delta : '—'}</Text>
                </View>
              </View>
            </View>
          );
        })}
        {!rows.length && <Text style={{ textAlign: 'center', color: theme.colors.textTertiary, padding: 32 }}>لا توجد دفعات نشطة مطابقة للبحث.</Text>}
        <Text style={{ color: theme.colors.textTertiary, fontSize: 11, textAlign: 'right', lineHeight: 18, marginTop: 6 }}>تنبيه: الجرد يحسب الفروقات على مستوى الدفعة، ويحفظ كل فرق كسجل تسوية مع سجل تدقيق. راجع الكميات قبل الاعتماد.</Text>
      </ScrollView>
      <View style={{ padding: 12, paddingBottom: Math.max(insets.bottom, 10) + 8, backgroundColor: theme.colors.surface, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
        <TouchableOpacity disabled={saving || !rows.length} onPress={submit} style={{ backgroundColor: saving || !rows.length ? theme.colors.textTertiary : theme.colors.primary, borderRadius: 12, padding: 15, alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>{saving ? 'جارٍ اعتماد الجرد...' : 'اعتماد الفروقات (' + deltaRows.length + ')'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
