// Smart Pharmacy ERP — Expenses Screen
import React, { useState, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, RefreshControl, ScrollView, Modal } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { getExpenses, deleteExpense, getExpensesByCategory, getSetting, getExpenseCategories, addExpenseCategory, removeExpenseCategory, Expense } from '@/services/database';
import { formatCurrency, formatDate, getToday, getDateRange } from '@/constants/i18n';
import { useAlert } from '@/template';
import { PdfActions } from '@/components/PdfActions';
import { buildTableReportHtml } from '@/services/pdfReport';

const PERIODS = [
  { key: 'today', label: 'اليوم' },
  { key: 'week', label: 'هذا الأسبوع' },
  { key: 'month', label: 'الشهر' },
];

export default function ExpensesScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showAlert } = useAlert();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [byCategory, setByCategory] = useState<{ category: string; total: number }[]>([]);
  const [period, setPeriod] = useState('today');
  const [refreshing, setRefreshing] = useState(false);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [accountName, setAccountName] = useState('');
  const [accountCategories, setAccountCategories] = useState<string[]>(getExpenseCategories());
  const refreshAccounts = () => setAccountCategories(getExpenseCategories());
  const addAccount = () => { const result = addExpenseCategory(accountName); if (!result.ok) { showAlert('تعذر إضافة الحساب', result.message || 'تحقق من الاسم'); return; } setAccountName(''); refreshAccounts(); };
  const deleteAccount = (name: string) => showAlert('إزالة حساب المصروفات', 'لا يمكن إزالة حساب مرتبط بمصروف سابق.', [{ text: 'إلغاء', style: 'cancel' }, { text: 'إزالة', style: 'destructive', onPress: () => { const result = removeExpenseCategory(name); if (!result.ok) showAlert('تعذر الإزالة', result.message || 'الحساب غير قابل للإزالة'); refreshAccounts(); } }]);

  const load = useCallback(() => {
    const { from, to } = getDateRange(period);
    setExpenses(getExpenses({ dateFrom: from, dateTo: to }));
    setByCategory(getExpensesByCategory(from, to));
  }, [period]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const total = expenses.reduce((s, e) => s + e.amount, 0);
  const buildExpensesPdf = () => {
    const { from, to } = getDateRange(period);
    const periodLabel = PERIODS.find(item => item.key === period)?.label || period;
    return buildTableReportHtml({
      pharmacyName: getSetting('pharmacy_name') || 'صيدليتي',
      title: 'تقرير المصروفات',
      periodLabel,
      dateRange: from === to ? from : `${from} — ${to}`,
      accent: theme.colors.error,
      summary: [
        { label: 'إجمالي المصروفات', value: formatCurrency(total), tone: 'negative' },
        { label: 'عدد القيود', value: expenses.length },
        { label: 'عدد الفئات', value: byCategory.length },
      ],
      columns: ['الفئة', 'الملاحظة', 'التاريخ', 'المبلغ'],
      rows: expenses.map(expense => [expense.category, expense.note || '—', formatDate(expense.date), formatCurrency(expense.amount)]),
    });
  };

  const handleDelete = (e: Expense) => {
    showAlert('حذف المصروف', 'هل تريد حذف هذا المصروف؟', [
      { text: 'لا', style: 'cancel' },
      { text: 'حذف', style: 'destructive', onPress: () => { deleteExpense(e.id); load(); } },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ backgroundColor: theme.colors.error, paddingTop: insets.top + 10, paddingBottom: 14, paddingHorizontal: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <TouchableOpacity onPress={() => { refreshAccounts(); setAccountsOpen(true); }} style={{ backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 }}>
            <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '700' }}>دليل الحسابات</Text>
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity onPress={() => router.push('/add-expense')} style={{ backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <MaterialIcons name="add" size={16} color="#FFFFFF" />
              <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '600' }}>مصروف جديد</Text>
            </TouchableOpacity>
            <PdfActions buildHtml={buildExpensesPdf} title="تقرير المصروفات" onError={(message) => showAlert('خطأ', message)} />
            <TouchableOpacity onPress={() => router.back()} style={{ width: 34, height: 34, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
              <MaterialIcons name="arrow-forward" size={20} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          <Text style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF' }}>المصروفات</Text>
        </View>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ fontSize: 28, fontWeight: '800', color: '#FFFFFF' }}>{formatCurrency(total)}</Text>
          <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 4 }}>إجمالي الفترة</Text>
        </View>
      </View>

      <View style={{ backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 8, flexDirection: 'row' }}>
          {PERIODS.map(p => (
            <TouchableOpacity key={p.key} onPress={() => setPeriod(p.key)} style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: period === p.key ? theme.colors.error : theme.colors.surfaceAlt, borderWidth: 1, borderColor: period === p.key ? theme.colors.error : theme.colors.border }}>
              <Text style={{ fontSize: 12, fontWeight: '500', color: period === p.key ? '#FFFFFF' : theme.colors.textSecondary }}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* By category */}
      {byCategory.length > 0 && (
        <View style={{ backgroundColor: theme.colors.surface, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, flexDirection: 'row' }}>
            {byCategory.map((cat, i) => (
              <View key={cat.category} style={{ backgroundColor: theme.colors.errorLight, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center', minWidth: 80 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.error }}>{formatCurrency(cat.total)}</Text>
                <Text style={{ fontSize: 10, color: theme.colors.textSecondary, marginTop: 2 }}>{cat.category}</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      <FlatList
        data={expenses}
        keyExtractor={e => String(e.id)}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); setRefreshing(false); }} colors={[theme.colors.error]} />}
        contentContainerStyle={{ paddingBottom: 32 }}
        renderItem={({ item }) => (
          <TouchableOpacity
            onLongPress={() => handleDelete(item)}
            activeOpacity={0.9}
            style={{ backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.divider, paddingHorizontal: 14, paddingVertical: 13 }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: theme.colors.error }}>{formatCurrency(item.amount)}</Text>
              <View style={{ alignItems: 'flex-end' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: theme.colors.textPrimary }}>{item.category}</Text>
                  <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: theme.colors.errorLight, alignItems: 'center', justifyContent: 'center' }}>
                    <MaterialIcons name="money-off" size={16} color={theme.colors.error} />
                  </View>
                </View>
                {item.note ? <Text style={{ fontSize: 12, color: theme.colors.textTertiary, marginTop: 2 }}>{item.note}</Text> : null}
                <Text style={{ fontSize: 11, color: theme.colors.textTertiary, marginTop: 2 }}>{formatDate(item.date)}</Text>
              </View>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={{ padding: 40, alignItems: 'center' }}>
            <MaterialIcons name="money-off" size={48} color={theme.colors.textTertiary} />
            <Text style={{ fontSize: 15, color: theme.colors.textTertiary, marginTop: 12 }}>لا توجد مصروفات</Text>
          </View>
        }
      />
      <Modal visible={accountsOpen} animationType="slide" transparent onRequestClose={() => setAccountsOpen(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' }}>
          <View style={{ maxHeight: '85%', backgroundColor: theme.colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: insets.bottom + 16 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <TouchableOpacity onPress={() => setAccountsOpen(false)}><MaterialIcons name="close" size={24} color={theme.colors.textPrimary} /></TouchableOpacity>
              <Text style={{ color: theme.colors.textPrimary, fontSize: 18, fontWeight: '800' }}>دليل حسابات المصروفات</Text>
            </View>
            <TextInput value={accountName} onChangeText={setAccountName} placeholder="اسم الحساب الجديد" placeholderTextColor={theme.colors.textTertiary} style={{ color: theme.colors.textPrimary, textAlign: 'right', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, padding: 12, marginBottom: 8 }} />
            <TouchableOpacity onPress={addAccount} style={{ backgroundColor: theme.colors.primary, borderRadius: 10, padding: 12, alignItems: 'center', marginBottom: 12 }}><Text style={{ color: '#fff', fontWeight: '700' }}>إضافة حساب</Text></TouchableOpacity>
            <FlatList data={accountCategories} keyExtractor={item => item} renderItem={({ item }) => <View style={{ flexDirection: 'row', alignItems: 'center', padding: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
              <TouchableOpacity onPress={() => deleteAccount(item)}><MaterialIcons name="delete-outline" size={21} color={theme.colors.error} /></TouchableOpacity>
              <Text style={{ flex: 1, textAlign: 'right', color: theme.colors.textPrimary, marginRight: 10 }}>{item}</Text>
            </View>} />
          </View>
        </View>
      </Modal>
    </View>
  );
}
