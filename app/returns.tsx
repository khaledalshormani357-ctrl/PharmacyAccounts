import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import {
  getAllPurchaseReturns, getAllSaleReturns, getPurchase, getSale,
  PurchaseReturn, SaleReturn,
} from '@/services/database';
import { formatCurrency, formatDate } from '@/constants/i18n';

 type ReturnKind = 'sale' | 'purchase';

function settlementLabel(value?: string): string {
  switch (value) {
    case 'CASH_REFUND': return 'رد نقدي';
    case 'CUSTOMER_BALANCE': return 'خصم من حساب العميل';
    case 'CUSTOMER_CREDIT': return 'رصيد دائن للعميل';
    case 'SUPPLIER_BALANCE': return 'قيد على حساب المورد';
    default: return 'تسوية مسجلة';
  }
}

export default function ReturnsScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [kind, setKind] = useState<ReturnKind>('sale');
  const [query, setQuery] = useState('');
  const [, setRevision] = useState(0);

  const load = useCallback(() => setRevision(value => value + 1), []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const saleReturns = getAllSaleReturns();
  const purchaseReturns = getAllPurchaseReturns();
  const rows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (kind === 'sale') {
      return saleReturns.filter(entry => {
        const original = getSale(entry.sale_id);
        const text = [entry.return_number, entry.invoice_number, original?.invoice_number, original?.customer_name,
          original?.date, entry.date, entry.user_name, settlementLabel(entry.settlement_method)].join(' ').toLocaleLowerCase();
        return !q || text.includes(q);
      });
    }
    return purchaseReturns.filter(entry => {
      const original = getPurchase(entry.purchase_id);
      const text = [entry.return_number, entry.invoice_number, original?.invoice_number, original?.supplier_name,
        original?.date, entry.date, entry.user_name, settlementLabel(entry.settlement_method)].join(' ').toLocaleLowerCase();
      return !q || text.includes(q);
    });
  }, [kind, query, saleReturns, purchaseReturns]);

  const openCreate = (nextKind: ReturnKind) => router.push({ pathname: '/new-return', params: { type: nextKind } } as any);
  const openDetail = (nextKind: ReturnKind, id: number) => router.push({ pathname: '/return-detail', params: { type: nextKind, returnId: String(id) } } as any);
  const accent = kind === 'sale' ? theme.colors.income : '#6554C0';

  const renderSale = (entry: SaleReturn) => {
    const original = getSale(entry.sale_id);
    return (
      <TouchableOpacity key={`s-${entry.id}`} onPress={() => openDetail('sale', entry.id)} activeOpacity={0.75}
        style={{ padding: 14, backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontSize: 15, fontWeight: '800', color: accent }}>{formatCurrency(entry.total)}</Text>
          <Text style={{ color: theme.colors.textPrimary, fontWeight: '700' }}>{entry.return_number || `SR-${String(entry.id).padStart(6, '0')}`}</Text>
        </View>
        <Text style={{ color: theme.colors.textSecondary, textAlign: 'right', marginTop: 5 }}>الأصل: {original?.invoice_number || entry.invoice_number} · {original?.customer_name || 'عميل نقدي'}</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 }}>
          <Text style={{ color: theme.colors.textTertiary, fontSize: 11 }}>{settlementLabel(entry.settlement_method)} · {entry.user_name || 'مستخدم غير مسجل'}</Text>
          <Text style={{ color: theme.colors.textTertiary, fontSize: 11 }}>{formatDate(entry.date)} · {entry.items.length} أصناف</Text>
        </View>
        <Text style={{ color: theme.colors.textTertiary, textAlign: 'right', fontSize: 10, marginTop: 4 }}>الحالة: {entry.status === 'POSTED' ? 'معتمد — غير قابل للحذف' : 'مسجل'}</Text>
      </TouchableOpacity>
    );
  };

  const renderPurchase = (entry: PurchaseReturn) => {
    const original = getPurchase(entry.purchase_id);
    return (
      <TouchableOpacity key={`p-${entry.id}`} onPress={() => openDetail('purchase', entry.id)} activeOpacity={0.75}
        style={{ padding: 14, backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontSize: 15, fontWeight: '800', color: accent }}>{formatCurrency(entry.total)}</Text>
          <Text style={{ color: theme.colors.textPrimary, fontWeight: '700' }}>{entry.return_number || `PR-${String(entry.id).padStart(6, '0')}`}</Text>
        </View>
        <Text style={{ color: theme.colors.textSecondary, textAlign: 'right', marginTop: 5 }}>الأصل: {original?.invoice_number || entry.invoice_number} · {original?.supplier_name || 'مورد مباشر'}</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 }}>
          <Text style={{ color: theme.colors.textTertiary, fontSize: 11 }}>{settlementLabel(entry.settlement_method)} · {entry.user_name || 'مستخدم غير مسجل'}</Text>
          <Text style={{ color: theme.colors.textTertiary, fontSize: 11 }}>{formatDate(entry.date)} · {entry.items.length} أصناف</Text>
        </View>
        <Text style={{ color: theme.colors.textTertiary, textAlign: 'right', fontSize: 10, marginTop: 4 }}>الحالة: {entry.status === 'POSTED' ? 'معتمد — غير قابل للحذف' : 'مسجل'}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 14, paddingBottom: 12, backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <TouchableOpacity onPress={() => router.back()} style={{ width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceAlt }}>
            <MaterialIcons name="arrow-forward" size={20} color={theme.colors.textPrimary} />
          </TouchableOpacity>
          <Text style={{ fontSize: 19, color: theme.colors.textPrimary, fontWeight: '800' }}>فواتير المرتجعات</Text>
          <View style={{ width: 38 }} />
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {([{ key: 'sale', label: 'مرتجعات المبيعات', icon: 'point-of-sale' }, { key: 'purchase', label: 'مرتجعات المشتريات', icon: 'shopping-cart' }] as const).map(option => {
            const active = kind === option.key;
            return <TouchableOpacity key={option.key} onPress={() => setKind(option.key)} style={{ flex: 1, minHeight: 42, borderRadius: 10, paddingHorizontal: 8, flexDirection: 'row', gap: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? (option.key === 'sale' ? theme.colors.income : '#6554C0') : theme.colors.surfaceAlt }}>
              <MaterialIcons name={option.icon as any} size={16} color={active ? '#FFFFFF' : theme.colors.textSecondary} />
              <Text style={{ fontSize: 11, fontWeight: '700', color: active ? '#FFFFFF' : theme.colors.textSecondary }}>{option.label}</Text>
            </TouchableOpacity>;
          })}
        </View>
      </View>

      <View style={{ margin: 14, flexDirection: 'row', alignItems: 'center', borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, paddingHorizontal: 10 }}>
        <MaterialIcons name="search" size={20} color={theme.colors.textTertiary} />
        <TextInput value={query} onChangeText={setQuery} placeholder="ابحث برقم المرتجع أو الفاتورة أو العميل/المورد" placeholderTextColor={theme.colors.textTertiary} style={{ flex: 1, height: 44, paddingHorizontal: 8, color: theme.colors.textPrimary, textAlign: 'right', fontSize: 12 }} />
      </View>

      <TouchableOpacity onPress={() => openCreate(kind)} style={{ marginHorizontal: 14, marginBottom: 10, height: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7, backgroundColor: accent }}>
        <MaterialIcons name="add-circle-outline" size={20} color="#FFFFFF" />
        <Text style={{ color: '#FFFFFF', fontWeight: '800' }}>{kind === 'sale' ? 'إنشاء مرتجع مبيعات' : 'إنشاء مرتجع مشتريات'}</Text>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={{ paddingBottom: 28 }}>
        {rows.length ? rows.map(entry => kind === 'sale' ? renderSale(entry as SaleReturn) : renderPurchase(entry as PurchaseReturn)) : (
          <View style={{ alignItems: 'center', padding: 36 }}>
            <MaterialIcons name="assignment-return" size={36} color={theme.colors.textTertiary} />
            <Text style={{ marginTop: 8, color: theme.colors.textSecondary, fontWeight: '600' }}>لا توجد مرتجعات مطابقة</Text>
            <Text style={{ marginTop: 4, color: theme.colors.textTertiary, textAlign: 'center', fontSize: 12 }}>أنشئ مرتجعًا مستقلًا مع الحفاظ على الفاتورة الأصلية.</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
