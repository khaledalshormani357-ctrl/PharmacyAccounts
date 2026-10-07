// Smart Pharmacy ERP — Supplier Detail
import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, Modal, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { useTheme } from '@/contexts/ThemeContext';
import { getSupplier, getSupplierTransactions, recordSupplierPayment, getSetting, Supplier, SupplierTransaction } from '@/services/database';
import { formatCurrency, AR } from '@/constants/i18n';
import { useAlert } from '@/template';
import { PdfActions } from '@/components/PdfActions';
import { buildAccountStatementHtml } from '@/services/pdfReport';

export default function SupplierDetailScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showAlert } = useAlert();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [transactions, setTransactions] = useState<SupplierTransaction[]>([]);
  const [showPayment, setShowPayment] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payNote, setPayNote] = useState('');

  const load = useCallback(() => {
    if (!id) return;
    const sid = parseInt(id);
    setSupplier(getSupplier(sid));
    setTransactions(getSupplierTransactions(sid));
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handlePayment = () => {
    const amount = parseFloat(payAmount);
    if (!amount || amount <= 0) { showAlert('تنبيه', 'أدخل مبلغاً صحيحاً'); return; }
    recordSupplierPayment(parseInt(id!), amount, payNote || 'دفعة للمورد');
    setShowPayment(false); setPayAmount(''); setPayNote('');
    load();
    showAlert('تم', `تم تسجيل دفعة ${formatCurrency(amount)}`);
  };

  if (!supplier) return null;

  const totalPurchases = transactions.filter(t => t.type === 'purchase').reduce((s, t) => s + t.amount, 0);
  const totalPayments = transactions.filter(t => t.type === 'payment').reduce((s, t) => s + Math.abs(t.amount), 0);
  const txTypeLabel = (type: SupplierTransaction['type']) => ({ purchase: 'شراء', payment: 'دفعة', return: 'مرتجع', adjustment: 'تسوية' }[type] || type);
  const buildStatementPdf = () => buildAccountStatementHtml({
    pharmacyName: getSetting('pharmacy_name') || 'صيدليتي',
    title: 'كشف حساب مورد',
    accountName: supplier.name,
    phone: supplier.phone,
    balance: supplier.balance,
    balanceLabel: supplier.balance > 0 ? 'المستحق للمورد' : 'رصيد المورد',
    totalPrimary: totalPurchases,
    totalPrimaryLabel: 'إجمالي المشتريات',
    totalPayments,
    transactions: transactions.map(transaction => ({
      date: transaction.date,
      type: txTypeLabel(transaction.type),
      description: transaction.note,
      amount: transaction.amount,
      balanceAfter: transaction.balance_after,
    })),
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ backgroundColor: '#6554C0', paddingTop: insets.top + 10, paddingBottom: 16, paddingHorizontal: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <TouchableOpacity onPress={() => router.back()} style={{ width: 34, height: 34, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
              <MaterialIcons name="arrow-forward" size={20} color="#FFFFFF" />
            </TouchableOpacity>
            <PdfActions buildHtml={buildStatementPdf} title={`كشف حساب ${supplier.name}`} onError={(message) => showAlert('خطأ', message)} />
          </View>
          <Text style={{ fontSize: 16, fontWeight: '700', color: '#FFFFFF' }}>{supplier.name}</Text>
          <TouchableOpacity onPress={() => setShowPayment(true)} style={{ backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}>
            <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '600' }}>تسجيل دفعة</Text>
          </TouchableOpacity>
        </View>
        <View style={{ backgroundColor: 'rgba(0,0,0,0.15)', borderRadius: 12, padding: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>إجمالي المشتريات</Text>
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF' }}>{formatCurrency(totalPurchases)}</Text>
            </View>
            <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.2)' }} />
            <View style={{ alignItems: 'center' }}>
              <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>المستحق</Text>
              <Text style={{ fontSize: 22, fontWeight: '800', color: supplier.balance > 0 ? '#FFAAAA' : '#AAFFCC' }}>{formatCurrency(Math.abs(supplier.balance))}</Text>
              <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>{supplier.balance > 0 ? 'علينا' : 'سوي'}</Text>
            </View>
            <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.2)' }} />
            <View style={{ alignItems: 'center' }}>
              <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>المدفوع</Text>
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#AAFFCC' }}>{formatCurrency(totalPayments)}</Text>
            </View>
          </View>
        </View>
      </View>

      {supplier.balance > 0 && (
        <TouchableOpacity onPress={() => setShowPayment(true)} style={{ backgroundColor: '#6554C0', margin: 14, borderRadius: 10, padding: 12, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
          <MaterialIcons name="payments" size={18} color="#FFFFFF" />
          <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '700' }}>تسجيل دفعة — مستحق {formatCurrency(supplier.balance)}</Text>
        </TouchableOpacity>
      )}

      <FlatList
        data={transactions}
        keyExtractor={t => String(t.id)}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 32 }}
        renderItem={({ item }) => (
          <View style={{ backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.divider, paddingHorizontal: 14, paddingVertical: 12 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: item.type === 'payment' ? theme.colors.success : theme.colors.error }}>
                  {formatCurrency(Math.abs(item.amount))}
                </Text>
                <Text style={{ fontSize: 11, color: theme.colors.textTertiary }}>رصيد: {formatCurrency(item.balance_after)}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: theme.colors.textPrimary }}>{item.note || item.type}</Text>
                <Text style={{ fontSize: 11, color: theme.colors.textTertiary }}>{item.date}</Text>
              </View>
            </View>
          </View>
        )}
        ListEmptyComponent={<View style={{ padding: 32, alignItems: 'center' }}><Text style={{ color: theme.colors.textTertiary }}>لا توجد معاملات</Text></View>}
      />

      <Modal visible={showPayment} animationType="slide" transparent>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: theme.colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: insets.bottom + 20 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: theme.colors.textPrimary, textAlign: 'right', marginBottom: 6 }}>دفعة للمورد — {supplier.name}</Text>
            {supplier.balance > 0 && <Text style={{ fontSize: 13, color: theme.colors.error, textAlign: 'right', marginBottom: 14 }}>المستحق: {formatCurrency(supplier.balance)}</Text>}
            <TextInput value={payAmount} onChangeText={setPayAmount} keyboardType="numeric" placeholder="المبلغ" placeholderTextColor={theme.colors.textTertiary} style={{ height: 52, borderRadius: 10, borderWidth: 1.5, borderColor: '#6554C0', paddingHorizontal: 12, fontSize: 20, fontWeight: '700', textAlign: 'center', color: theme.colors.textPrimary, marginBottom: 10 }} />
            <TextInput value={payNote} onChangeText={setPayNote} placeholder="ملاحظة" placeholderTextColor={theme.colors.textTertiary} style={{ height: 44, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: 12, fontSize: 13, textAlign: 'right', color: theme.colors.textPrimary, marginBottom: 16 }} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity onPress={() => setShowPayment(false)} style={{ flex: 1, height: 48, backgroundColor: theme.colors.surfaceAlt, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handlePayment} style={{ flex: 2, height: 48, backgroundColor: '#6554C0', borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>تسجيل الدفعة</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
