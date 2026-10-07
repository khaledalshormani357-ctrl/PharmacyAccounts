// Smart Pharmacy ERP — Cashbox Screen
import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, Modal, TextInput } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { getCashBalance, getCashTransactions, addCashDeposit, addCashWithdrawal, getSetting, CashTransaction } from '@/services/database';
import { formatCurrency } from '@/constants/i18n';
import { useAlert } from '@/template';
import { PdfActions } from '@/components/PdfActions';
import { buildTableReportHtml } from '@/services/pdfReport';

const TX_TYPE_LABELS: Record<string, string> = {
  SALE_CASH: 'بيع نقدي', COLLECTION: 'تحصيل دين', PURCHASE_PAYMENT: 'دفع للمورد',
  SUPPLIER_PAYMENT: 'دفع للمورد', EXPENSE: 'مصروف', WITHDRAWAL: 'سحب',
  CUSTOMER_REFUND: 'رد نقدي للعميل', PURCHASE_RETURN: 'استرداد نقدي من المورد',
  DEPOSIT: 'إيداع', OPENING: 'رصيد افتتاحي', CLOSING: 'إغلاق', ADJUSTMENT: 'تسوية',
};

export default function CashboxScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showAlert } = useAlert();
  const [balance, setBalance] = useState(0);
  const [transactions, setTransactions] = useState<CashTransaction[]>([]);
  const [showModal, setShowModal] = useState<'deposit' | 'withdrawal' | null>(null);
  const [modalAmount, setModalAmount] = useState('');
  const [modalNote, setModalNote] = useState('');

  const load = useCallback(() => {
    setBalance(getCashBalance());
    setTransactions(getCashTransactions({ limit: 50 }));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleAction = () => {
    const amount = parseFloat(modalAmount);
    if (!amount || amount <= 0) { showAlert('تنبيه', 'أدخل مبلغاً صحيحاً'); return; }
    if (showModal === 'deposit') addCashDeposit(amount, modalNote || 'إيداع');
    else if (showModal === 'withdrawal') addCashWithdrawal(amount, modalNote || 'سحب');
    setShowModal(null); setModalAmount(''); setModalNote('');
    load();
  };
  const buildCashboxPdf = () => {
    const totalIncoming = transactions.filter(transaction => transaction.amount > 0).reduce((sum, transaction) => sum + transaction.amount, 0);
    const totalOutgoing = transactions.filter(transaction => transaction.amount < 0).reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);
    return buildTableReportHtml({
      pharmacyName: getSetting('pharmacy_name') || 'صيدليتي',
      title: 'تقرير حركة الصندوق',
      periodLabel: 'آخر 50 حركة',
      accent: '#00875A',
      summary: [
        { label: 'الرصيد الحالي', value: formatCurrency(balance), tone: balance >= 0 ? 'positive' : 'negative' },
        { label: 'إجمالي الوارد', value: formatCurrency(totalIncoming), tone: 'positive' },
        { label: 'إجمالي الصادر', value: formatCurrency(totalOutgoing), tone: 'negative' },
      ],
      columns: ['التاريخ', 'نوع الحركة', 'البيان', 'المبلغ'],
      rows: transactions.map(transaction => [transaction.date, TX_TYPE_LABELS[transaction.type] || transaction.type, transaction.note || '—', `${transaction.amount > 0 ? '+' : '−'}${formatCurrency(Math.abs(transaction.amount))}`]),
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ backgroundColor: '#00875A', paddingTop: insets.top + 10, paddingBottom: 20, paddingHorizontal: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <TouchableOpacity onPress={() => router.back()} style={{ width: 34, height: 34, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
            <MaterialIcons name="arrow-forward" size={20} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF' }}>الصندوق</Text>
          <PdfActions buildHtml={buildCashboxPdf} title="تقرير حركة الصندوق" onError={(message) => showAlert('خطأ', message)} />
        </View>
        <View style={{ alignItems: 'center', marginBottom: 16 }}>
          <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>الرصيد الحالي</Text>
          <Text style={{ fontSize: 36, fontWeight: '800', color: balance >= 0 ? '#AAFFCC' : '#FFAAAA' }}>{formatCurrency(balance)}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity onPress={() => setShowModal('deposit')} style={{ flex: 1, height: 44, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <MaterialIcons name="add" size={18} color="#FFFFFF" />
            <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '600' }}>إيداع</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowModal('withdrawal')} style={{ flex: 1, height: 44, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <MaterialIcons name="remove" size={18} color="#FFFFFF" />
            <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '600' }}>سحب</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={transactions}
        keyExtractor={t => String(t.id)}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 32 }}
        renderItem={({ item }) => (
          <View style={{ backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.divider, paddingHorizontal: 14, paddingVertical: 12 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: item.amount > 0 ? theme.colors.success : theme.colors.error }}>
                {item.amount > 0 ? '+' : ''}{formatCurrency(item.amount)}
              </Text>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: theme.colors.textPrimary }}>{TX_TYPE_LABELS[item.type] || item.type}</Text>
                {item.note ? <Text style={{ fontSize: 11, color: theme.colors.textTertiary }}>{item.note}</Text> : null}
                <Text style={{ fontSize: 11, color: theme.colors.textTertiary, marginTop: 2 }}>{item.date}</Text>
              </View>
            </View>
          </View>
        )}
        ListEmptyComponent={<View style={{ padding: 40, alignItems: 'center' }}><MaterialIcons name="account-balance" size={48} color={theme.colors.textTertiary} /><Text style={{ fontSize: 14, color: theme.colors.textTertiary, marginTop: 12 }}>لا توجد حركات</Text></View>}
      />

      <Modal visible={!!showModal} animationType="slide" transparent>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: theme.colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: insets.bottom + 20 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: theme.colors.textPrimary, textAlign: 'right', marginBottom: 14 }}>{showModal === 'deposit' ? 'إيداع في الصندوق' : 'سحب من الصندوق'}</Text>
            <TextInput value={modalAmount} onChangeText={setModalAmount} keyboardType="numeric" placeholder="المبلغ" placeholderTextColor={theme.colors.textTertiary}
              style={{ height: 54, borderRadius: 10, borderWidth: 1.5, borderColor: '#00875A', paddingHorizontal: 12, fontSize: 22, fontWeight: '700', textAlign: 'center', color: theme.colors.textPrimary, marginBottom: 10 }} />
            <TextInput value={modalNote} onChangeText={setModalNote} placeholder="السبب / الملاحظة" placeholderTextColor={theme.colors.textTertiary}
              style={{ height: 44, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: 12, fontSize: 13, textAlign: 'right', color: theme.colors.textPrimary, marginBottom: 16 }} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity onPress={() => setShowModal(null)} style={{ flex: 1, height: 48, backgroundColor: theme.colors.surfaceAlt, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleAction} style={{ flex: 2, height: 48, backgroundColor: '#00875A', borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>تأكيد</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
