// Smart Pharmacy ERP — Customer Detail + Statement
import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, Modal, FlatList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { useTheme } from '@/contexts/ThemeContext';
import { getCustomer, getCustomerTransactions, recordCustomerPayment, Customer, CustomerTransaction } from '@/services/database';
import { formatCurrency, formatDate, AR } from '@/constants/i18n';
import { useAlert } from '@/template';

export default function CustomerDetailScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showAlert } = useAlert();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [transactions, setTransactions] = useState<CustomerTransaction[]>([]);
  const [showPayment, setShowPayment] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payNote, setPayNote] = useState('');

  const load = useCallback(() => {
    if (!id) return;
    const cid = parseInt(id);
    setCustomer(getCustomer(cid));
    setTransactions(getCustomerTransactions(cid));
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handlePayment = () => {
    const amount = parseFloat(payAmount);
    if (!amount || amount <= 0) { showAlert('تنبيه', 'أدخل مبلغاً صحيحاً'); return; }
    recordCustomerPayment(parseInt(id!), amount, payNote || 'سداد دين');
    setShowPayment(false);
    setPayAmount('');
    setPayNote('');
    load();
    showAlert('تم', `تم تسجيل سداد ${formatCurrency(amount)}`);
  };

  if (!customer) return null;

  const totalSales = transactions.filter(t => t.type === 'sale').reduce((s, t) => s + t.amount, 0);
  const totalPayments = transactions.filter(t => t.type === 'payment').reduce((s, t) => s + Math.abs(t.amount), 0);

  const txTypeLabel = (t: CustomerTransaction['type']) => {
    const map: Record<string, string> = { sale: 'بيع', payment: 'سداد', return: 'مرتجع', adjustment: 'تسوية' };
    return map[t] || t;
  };
  const txTypeColor = (t: CustomerTransaction['type']) => {
    if (t === 'sale') return theme.colors.secondary;
    if (t === 'payment') return theme.colors.success;
    return theme.colors.textSecondary;
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ backgroundColor: '#0052CC', paddingTop: insets.top + 10, paddingBottom: 16, paddingHorizontal: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <TouchableOpacity onPress={() => router.back()} style={{ width: 34, height: 34, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
            <MaterialIcons name="arrow-forward" size={20} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={{ fontSize: 16, fontWeight: '700', color: '#FFFFFF' }}>{customer.name}</Text>
          <TouchableOpacity onPress={() => setShowPayment(true)} style={{ backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}>
            <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '600' }}>تسجيل سداد</Text>
          </TouchableOpacity>
        </View>

        <View style={{ backgroundColor: 'rgba(0,0,0,0.15)', borderRadius: 12, padding: 12 }}>
          {customer.phone ? <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', textAlign: 'right', marginBottom: 8 }}>📞 {customer.phone}</Text> : null}
          <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>إجمالي المبيعات</Text>
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF' }}>{formatCurrency(totalSales)}</Text>
            </View>
            <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.2)' }} />
            <View style={{ alignItems: 'center' }}>
              <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>رصيد حالي</Text>
              <Text style={{ fontSize: 22, fontWeight: '800', color: customer.balance > 0 ? '#FFAAAA' : '#AAFFCC' }}>
                {formatCurrency(Math.abs(customer.balance))}
              </Text>
              <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>{customer.balance > 0 ? 'مدين' : customer.balance < 0 ? 'له رصيد' : 'سوي'}</Text>
            </View>
            <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.2)' }} />
            <View style={{ alignItems: 'center' }}>
              <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>إجمالي السداد</Text>
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#AAFFCC' }}>{formatCurrency(totalPayments)}</Text>
            </View>
          </View>
        </View>
      </View>

      {customer.balance > 0 && (
        <TouchableOpacity onPress={() => setShowPayment(true)} style={{ backgroundColor: '#0052CC', margin: 14, borderRadius: 10, padding: 12, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
          <MaterialIcons name="payments" size={18} color="#FFFFFF" />
          <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '700' }}>تسجيل سداد — متبقي {formatCurrency(customer.balance)}</Text>
        </TouchableOpacity>
      )}

      <View style={{ paddingHorizontal: 14, paddingTop: customer.balance <= 0 ? 14 : 0, paddingBottom: 8 }}>
        <Text style={{ fontSize: 13, fontWeight: '600', color: theme.colors.textSecondary, textAlign: 'right' }}>كشف الحساب ({transactions.length} معاملة)</Text>
      </View>

      <FlatList
        data={transactions}
        keyExtractor={t => String(t.id)}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 32 }}
        renderItem={({ item }) => (
          <View style={{ backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.divider, paddingHorizontal: 14, paddingVertical: 12 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: item.amount > 0 ? theme.colors.error : theme.colors.success }}>
                  {item.amount > 0 ? '+' : ''}{formatCurrency(Math.abs(item.amount))}
                </Text>
                <Text style={{ fontSize: 11, color: theme.colors.textTertiary }}>رصيد: {formatCurrency(item.balance_after)}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: theme.colors.textPrimary }}>{item.note || txTypeLabel(item.type)}</Text>
                <View style={{ backgroundColor: txTypeColor(item.type) + '18', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
                  <Text style={{ fontSize: 10, fontWeight: '600', color: txTypeColor(item.type) }}>{txTypeLabel(item.type)}</Text>
                </View>
              </View>
            </View>
            <Text style={{ fontSize: 11, color: theme.colors.textTertiary, textAlign: 'left' }}>{item.date}</Text>
          </View>
        )}
        ListEmptyComponent={<View style={{ padding: 32, alignItems: 'center' }}><Text style={{ color: theme.colors.textTertiary }}>لا توجد معاملات</Text></View>}
      />

      {/* Payment Modal */}
      <Modal visible={showPayment} animationType="slide" transparent>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: theme.colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: insets.bottom + 20 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: theme.colors.textPrimary, textAlign: 'right', marginBottom: 6 }}>تسجيل سداد — {customer.name}</Text>
            {customer.balance > 0 && <Text style={{ fontSize: 13, color: theme.colors.error, textAlign: 'right', marginBottom: 14 }}>المبلغ المستحق: {formatCurrency(customer.balance)}</Text>}
            <TextInput value={payAmount} onChangeText={setPayAmount} keyboardType="numeric" placeholder="المبلغ" placeholderTextColor={theme.colors.textTertiary} style={{ height: 52, borderRadius: 10, borderWidth: 1.5, borderColor: '#0052CC', paddingHorizontal: 12, fontSize: 20, fontWeight: '700', textAlign: 'center', color: theme.colors.textPrimary, marginBottom: 10 }} />
            <TextInput value={payNote} onChangeText={setPayNote} placeholder="ملاحظة (اختياري)" placeholderTextColor={theme.colors.textTertiary} style={{ height: 44, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: 12, fontSize: 13, textAlign: 'right', color: theme.colors.textPrimary, marginBottom: 16 }} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity onPress={() => setShowPayment(false)} style={{ flex: 1, height: 48, backgroundColor: theme.colors.surfaceAlt, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handlePayment} style={{ flex: 2, height: 48, backgroundColor: '#0052CC', borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>تسجيل السداد</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
