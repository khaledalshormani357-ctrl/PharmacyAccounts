// Smart Pharmacy ERP — Multi-cashbox ledger
import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Calendar, LocaleConfig } from 'react-native-calendars';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import {
  addCashboxOpeningBalance, addCashboxPayment, addCashboxReceipt, CASHBOXES,
  closeCashboxDay, getCashBalance, getCashboxBalances, getCashTransactions, getOpenShift,
  getSetting, transferCashBetweenBoxes,
} from '@/services/database';
import type { CashboxBalance, CashboxId, CashTransaction, CashboxMutationResult, Shift } from '@/services/database';
import { formatCurrency, getToday } from '@/constants/i18n';
import { useAlert } from '@/template';
import { PdfActions } from '@/components/PdfActions';
import { buildTableReportHtml } from '@/services/pdfReport';

const BLUE = '#2479E5';
LocaleConfig.locales.ar = {
  monthNames: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
  monthNamesShort: ['ينا', 'فبر', 'مار', 'أبر', 'ماي', 'يون', 'يول', 'أغس', 'سبت', 'أكت', 'نوف', 'ديس'],
  dayNames: ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
  dayNamesShort: ['أحد', 'إثن', 'ثلا', 'أرب', 'خمي', 'جمع', 'سبت'],
  today: 'اليوم',
};
LocaleConfig.defaultLocale = 'ar';
const BOX_FILTERS: { id: CashboxId | 'all'; label: string }[] = [
  { id: 'all', label: 'جميع الصناديق' },
  { id: 'daily', label: 'صندوق اليومية' },
  { id: 'pharmacy', label: 'صندوق الصيدلية' },
  { id: 'bank', label: 'صندوق الصراف / البنك' },
];
const MOVEMENT_FILTERS: { id: 'all' | 'in' | 'out'; label: string }[] = [
  { id: 'all', label: 'جميع الحركات' },
  { id: 'in', label: 'المقبوضات' },
  { id: 'out', label: 'المدفوعات' },
];
const TX_TYPE_LABELS: Record<string, string> = {
  SALE_CASH: 'بيع نقدي', COLLECTION: 'تحصيل دين', PURCHASE_PAYMENT: 'دفع للمورد',
  SUPPLIER_PAYMENT: 'دفعة لمورد', EXPENSE: 'مصروف', WITHDRAWAL: 'سحب نقدي',
  CUSTOMER_REFUND: 'رد نقدي للعميل', PURCHASE_RETURN: 'استرداد من المورد',
  DEPOSIT: 'إيداع', OPENING: 'رصيد افتتاحي', CLOSING: 'إقفال', ADJUSTMENT: 'تسوية',
  RECEIPT: 'سند قبض', PAYMENT: 'سند صرف', TRANSFER_IN: 'تحويل وارد', TRANSFER_OUT: 'تحويل صادر',
};

type BoxFilter = CashboxId | 'all';
type MovementFilter = 'all' | 'in' | 'out';
type CashboxAction = 'receipt' | 'payment' | 'opening' | 'transfer' | 'close' | null;

function cashboxName(id?: CashboxId): string {
  return CASHBOXES.find(box => box.id === (id ?? 'daily'))?.label ?? 'صندوق اليومية';
}

function transactionCashboxId(transaction: CashTransaction): CashboxId {
  return transaction.cashbox_id ?? 'daily';
}

function parseAmount(value: string): number {
  const normalized = value
    .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٬,]/g, '')
    .replace(/[٫]/g, '.')
    .trim();
  return Number(normalized);
}

function labelForAction(action: CashboxAction): string {
  if (action === 'receipt') return 'سند قبض جديد';
  if (action === 'payment') return 'سند صرف جديد';
  if (action === 'opening') return 'الأرصدة الافتتاحية للصناديق';
  if (action === 'transfer') return 'ترحيل نقدية بين الصناديق';
  return 'إقفال صندوق اليومية';
}

export default function CashboxScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showAlert } = useAlert();
  const [balances, setBalances] = useState<CashboxBalance[]>(() => getCashboxBalances());
  const [transactions, setTransactions] = useState<CashTransaction[]>([]);
  const [openShift, setOpenShift] = useState<Shift | null>(null);
  const [boxFilter, setBoxFilter] = useState<BoxFilter>('all');
  const [movementFilter, setMovementFilter] = useState<MovementFilter>('all');
  const [searchText, setSearchText] = useState('');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [action, setAction] = useState<CashboxAction>(null);
  const [formBox, setFormBox] = useState<CashboxId>('daily');
  const [sourceBox, setSourceBox] = useState<CashboxId>('daily');
  const [destinationBox, setDestinationBox] = useState<CashboxId>('pharmacy');
  const [amountText, setAmountText] = useState('');
  const [note, setNote] = useState('');
  const [countedCash, setCountedCash] = useState('');
  const [closeReason, setCloseReason] = useState('');

  const load = useCallback(() => {
    setBalances(getCashboxBalances());
    setTransactions(getCashTransactions());
    setOpenShift(getOpenShift());
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filteredTransactions = useMemo(() => {
    const query = searchText.trim().toLocaleLowerCase('ar');
    return transactions.filter(transaction => {
      if (boxFilter !== 'all' && transactionCashboxId(transaction) !== boxFilter) return false;
      if (movementFilter === 'in' && transaction.amount <= 0) return false;
      if (movementFilter === 'out' && transaction.amount >= 0) return false;
      if (selectedDate && transaction.date.slice(0, 10) !== selectedDate) return false;
      if (query) {
        const haystack = [
          transaction.id, transaction.reference_id ?? '', transaction.note ?? '',
          transaction.type, TX_TYPE_LABELS[transaction.type] ?? '', cashboxName(transactionCashboxId(transaction)),
        ].join(' ').toLocaleLowerCase('ar');
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [transactions, boxFilter, movementFilter, searchText, selectedDate]);

  const totalBalance = balances.reduce((sum, box) => sum + box.balance, 0);
  const visibleIncoming = filteredTransactions.filter(transaction => transaction.amount > 0)
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const visibleOutgoing = filteredTransactions.filter(transaction => transaction.amount < 0)
    .reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);

  const openForm = (nextAction: Exclude<CashboxAction, null>) => {
    setMenuVisible(false);
    setAmountText('');
    setNote('');
    if (nextAction === 'transfer') {
      const preferred = boxFilter === 'all' ? 'daily' : boxFilter;
      const second = CASHBOXES.find(box => box.id !== preferred)?.id ?? 'pharmacy';
      setSourceBox(preferred);
      setDestinationBox(second);
    } else if (nextAction === 'close') {
      const current = getOpenShift();
      setOpenShift(current);
      setCountedCash(String(getCashBalance('daily')));
      setCloseReason('');
    } else {
      setFormBox(boxFilter === 'all' ? 'daily' : boxFilter);
    }
    setAction(nextAction);
  };

  const handleExpense = () => {
    const cashboxId = boxFilter === 'all' ? 'daily' : boxFilter;
    router.push({ pathname: '/add-expense', params: { cashboxId } } as any);
  };

  const closeForm = () => {
    setAction(null);
    setAmountText('');
    setNote('');
    setCountedCash('');
    setCloseReason('');
  };

  const handleSubmit = () => {
    if (!action) return;
    if (action === 'close') {
      const actual = parseAmount(countedCash);
      if (!Number.isFinite(actual) || actual < 0) {
        showAlert('تنبيه', 'أدخل الرصيد الفعلي للصندوق كرقم صحيح.');
        return;
      }
      const closed = closeCashboxDay(actual, closeReason.trim());
      if (!closed.success) {
        showAlert('تعذر الإقفال', closed.error);
        load();
        return;
      }
      closeForm();
      load();
      const shiftStatus = closed.shiftClosed ? ' وتم إقفال الوردية المفتوحة.' : ' لم تكن هناك وردية مفتوحة.';
      showAlert('تم إقفال صندوق اليومية', `الرصيد المتوقع ${formatCurrency(closed.expectedCash)}، والفرق ${formatCurrency(closed.difference)}.${shiftStatus}`);
      return;
    }

    const amount = parseAmount(amountText);
    if (!Number.isFinite(amount) || amount <= 0) {
      showAlert('تنبيه', 'أدخل مبلغًا أكبر من صفر.');
      return;
    }

    let result: CashboxMutationResult;
    if (action === 'receipt') {
      result = addCashboxReceipt(amount, formBox, note.trim() || 'سند قبض يدوي');
    } else if (action === 'payment') {
      result = addCashboxPayment(amount, formBox, note.trim() || 'سند صرف يدوي');
    } else if (action === 'opening') {
      result = addCashboxOpeningBalance(amount, formBox, note.trim() || 'رصيد افتتاحي');
    } else {
      result = transferCashBetweenBoxes(sourceBox, destinationBox, amount, note.trim());
    }

    if (!result.success) {
      showAlert('تعذر الحفظ', result.error);
      return;
    }
    const successTitle = action === 'receipt' ? 'تم تسجيل سند القبض'
      : action === 'payment' ? 'تم تسجيل سند الصرف'
        : action === 'opening' ? 'تم تسجيل الرصيد الافتتاحي' : 'تم تحويل النقدية';
    closeForm();
    load();
    showAlert('تم', successTitle);
  };

  const buildCashboxPdf = () => {
    const selectedBalance = boxFilter === 'all'
      ? totalBalance
      : balances.find(box => box.id === boxFilter)?.balance ?? 0;
    const periodLabel = selectedDate ? `تاريخ ${selectedDate}` : 'كل التواريخ';
    return buildTableReportHtml({
      pharmacyName: getSetting('pharmacy_name') || 'صيدليتي',
      title: 'تقرير حركة الصناديق',
      periodLabel: `${boxFilter === 'all' ? 'جميع الصناديق' : cashboxName(boxFilter)} — ${periodLabel}`,
      accent: BLUE,
      summary: [
        { label: 'الرصيد الحالي', value: formatCurrency(selectedBalance), tone: selectedBalance >= 0 ? 'positive' : 'negative' },
        { label: 'المقبوضات الظاهرة', value: formatCurrency(visibleIncoming), tone: 'positive' },
        { label: 'المدفوعات الظاهرة', value: formatCurrency(visibleOutgoing), tone: 'negative' },
      ],
      columns: ['رقم الحركة', 'التاريخ', 'الصندوق', 'نوع الحركة', 'البيان', 'المبلغ'],
      rows: filteredTransactions.map(transaction => [
        `#${transaction.id}`, transaction.date, cashboxName(transactionCashboxId(transaction)),
        TX_TYPE_LABELS[transaction.type] || transaction.type, transaction.note || '—',
        `${transaction.amount > 0 ? '+' : transaction.amount < 0 ? '−' : ''}${formatCurrency(Math.abs(transaction.amount))}`,
      ]),
    });
  };

  const selectedOpeningBalance = balances.find(box => box.id === formBox)?.openingBalance ?? 0;
  const selectedBoxHasActivity = transactions.some(transaction => transactionCashboxId(transaction) === formBox && transaction.amount !== 0);
  const openingBalanceBlocked = action === 'opening' && selectedBoxHasActivity;
  const selectedActionColor = action === 'receipt' ? '#378D45'
    : action === 'payment' ? '#CA3035'
      : action === 'opening' ? BLUE : action === 'transfer' ? '#6574CD' : '#CA3035';

  const renderCashboxChips = (value: CashboxId, onChange: (id: CashboxId) => void) => (
    <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-start' }}>
      {CASHBOXES.map(box => {
        const selected = value === box.id;
        return (
          <TouchableOpacity
            key={box.id}
            onPress={() => onChange(box.id)}
            style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: selected ? 1.5 : 1, borderColor: selected ? BLUE : theme.colors.border, backgroundColor: selected ? `${BLUE}15` : theme.colors.surface }}
          >
            {selected ? <MaterialIcons name="check" size={15} color={BLUE} /> : null}
            <Text style={{ color: selected ? BLUE : theme.colors.textSecondary, fontSize: 12, fontWeight: selected ? '700' : '500' }}>{box.shortLabel}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <FlatList
        data={filteredTransactions}
        keyExtractor={transaction => String(transaction.id)}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: insets.bottom + 82 }}
        ListHeaderComponent={(
          <View>
            <View style={{ backgroundColor: theme.colors.surface, paddingTop: insets.top + 6, paddingBottom: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' }}>
                <TouchableOpacity onPress={() => router.back()} accessibilityLabel="رجوع" style={{ width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}>
                  <MaterialIcons name="arrow-forward" size={25} color={theme.colors.textPrimary} />
                </TouchableOpacity>
                <Text style={{ color: theme.colors.textPrimary, fontSize: 18, fontWeight: '800' }}>الصناديق والحركات المالية</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <PdfActions buildHtml={buildCashboxPdf} title="تقرير حركة الصناديق" onError={message => showAlert('خطأ', message)} />
                  <TouchableOpacity onPress={() => setMenuVisible(true)} accessibilityLabel="خيارات الصناديق" style={{ width: 38, height: 38, alignItems: 'center', justifyContent: 'center' }}>
                    <MaterialIcons name="more-vert" size={24} color={theme.colors.textPrimary} />
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            <View style={{ marginHorizontal: 16, marginTop: 14, marginBottom: 14, padding: 18, borderRadius: 25, backgroundColor: BLUE, elevation: 5, shadowColor: '#174A9C', shadowOpacity: 0.19, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } }}>
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
                  <MaterialIcons name="account-balance-wallet" size={23} color="#D8E9FF" />
                  <Text style={{ color: '#EAF3FF', fontSize: 15, fontWeight: '700' }}>الرصيد النقدي</Text>
                </View>
                <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 11 }}>{filteredTransactions.length} حركة</Text>
              </View>
              <Text style={{ color: '#FFFFFF', fontSize: 34, fontWeight: '900', textAlign: 'right', marginTop: 7, marginBottom: 15 }}>
                {formatCurrency(totalBalance)}
              </Text>
              <View style={{ flexDirection: 'row-reverse', borderRadius: 18, paddingVertical: 10, paddingHorizontal: 8, backgroundColor: 'rgba(255,255,255,0.17)' }}>
                <View style={{ flex: 1, alignItems: 'center', borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.25)' }}>
                  <Text style={{ color: '#DCEBFF', fontSize: 12, marginBottom: 4 }}>المقبوضات الظاهرة  ↓</Text>
                  <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '800' }}>{formatCurrency(visibleIncoming)}</Text>
                </View>
                <View style={{ flex: 1, alignItems: 'center' }}>
                  <Text style={{ color: '#DCEBFF', fontSize: 12, marginBottom: 4 }}>المدفوعات الظاهرة  ↑</Text>
                  <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '800' }}>{formatCurrency(visibleOutgoing)}</Text>
                </View>
              </View>
            </View>

            <View style={{ flexDirection: 'row-reverse', gap: 10, marginHorizontal: 16, marginBottom: 14 }}>
              <QuickAction label="سند قبض" icon="south" color="#388E43" onPress={() => openForm('receipt')} />
              <QuickAction label="سند صرف" icon="north" color="#CE3035" onPress={() => openForm('payment')} />
              <QuickAction label="مصروف" icon="money-off" color="#E94B1B" onPress={handleExpense} />
            </View>

            <View style={{ marginHorizontal: 16, marginBottom: 14, paddingVertical: 13, paddingHorizontal: 8, borderRadius: 22, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface }}>
              <View style={{ flexDirection: 'row-reverse' }}>
                {balances.map((box, index) => (
                  <View key={box.id} style={{ flex: 1, alignItems: 'center', paddingHorizontal: 3, borderLeftWidth: index < balances.length - 1 ? 1 : 0, borderLeftColor: theme.colors.divider }}>
                    <Text numberOfLines={1} style={{ color: theme.colors.textSecondary, fontSize: 11, textAlign: 'center', marginBottom: 5 }}>{box.label}</Text>
                    <Text numberOfLines={1} style={{ color: BLUE, fontSize: 15, fontWeight: '800', textAlign: 'center' }}>{formatCurrency(box.balance)}</Text>
                    <Text style={{ color: theme.colors.textTertiary, fontSize: 10, marginTop: 3 }}>افتتاحي: {formatCurrency(box.openingBalance)}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 12 }}>
              <TouchableOpacity onPress={() => setCalendarVisible(true)} style={{ width: 64, height: 58, borderRadius: 17, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center' }}>
                <MaterialIcons name="calendar-month" size={25} color={theme.colors.textSecondary} />
              </TouchableOpacity>
              <View style={{ flex: 1, height: 58, borderRadius: 17, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, flexDirection: 'row-reverse', alignItems: 'center', paddingHorizontal: 14 }}>
                <MaterialIcons name="search" size={23} color={theme.colors.textTertiary} />
                <TextInput
                  value={searchText}
                  onChangeText={setSearchText}
                  placeholder="بحث باسم السند، البيان أو الرقم..."
                  placeholderTextColor={theme.colors.textTertiary}
                  style={{ flex: 1, color: theme.colors.textPrimary, textAlign: 'right', fontSize: 14, marginRight: 8, paddingVertical: 0 }}
                  returnKeyType="search"
                />
                {searchText ? <TouchableOpacity onPress={() => setSearchText('')}><MaterialIcons name="close" size={19} color={theme.colors.textTertiary} /></TouchableOpacity> : null}
              </View>
            </View>
            {selectedDate ? (
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6, marginHorizontal: 18, marginBottom: 9 }}>
                <MaterialIcons name="event" size={15} color={BLUE} />
                <Text style={{ color: BLUE, fontSize: 12, fontWeight: '600' }}>{selectedDate}</Text>
                <TouchableOpacity onPress={() => setSelectedDate(null)} style={{ padding: 2 }}><MaterialIcons name="cancel" size={17} color={theme.colors.textTertiary} /></TouchableOpacity>
              </View>
            ) : null}

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row-reverse', gap: 8, paddingHorizontal: 16, paddingBottom: 10 }}>
              {BOX_FILTERS.map(filter => {
                const selected = boxFilter === filter.id;
                return (
                  <TouchableOpacity key={filter.id} onPress={() => setBoxFilter(filter.id)} style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 5, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 14, borderWidth: selected ? 1.5 : 1, borderColor: selected ? BLUE : theme.colors.border, backgroundColor: selected ? `${BLUE}17` : theme.colors.surface }}>
                    {selected ? <MaterialIcons name="check" size={16} color={BLUE} /> : null}
                    <Text style={{ color: selected ? BLUE : theme.colors.textSecondary, fontSize: 12, fontWeight: selected ? '700' : '500' }}>{filter.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row-reverse', gap: 8, paddingHorizontal: 16, paddingBottom: 12 }}>
              {MOVEMENT_FILTERS.map(filter => {
                const selected = movementFilter === filter.id;
                return (
                  <TouchableOpacity key={filter.id} onPress={() => setMovementFilter(filter.id)} style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 5, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 14, borderWidth: selected ? 1.5 : 1, borderColor: selected ? BLUE : theme.colors.border, backgroundColor: selected ? `${BLUE}17` : theme.colors.surface }}>
                    {selected ? <MaterialIcons name="check" size={15} color={BLUE} /> : null}
                    <Text style={{ color: selected ? BLUE : theme.colors.textSecondary, fontSize: 12, fontWeight: selected ? '700' : '500' }}>{filter.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <Text style={{ color: theme.colors.textTertiary, fontSize: 12, textAlign: 'right', marginHorizontal: 18, marginBottom: 5 }}>الحركات المالية ({filteredTransactions.length})</Text>
          </View>
        )}
        renderItem={({ item }) => {
          const incoming = item.amount > 0;
          const color = item.amount === 0 ? theme.colors.textSecondary : incoming ? '#27834A' : '#CF3C3C';
          return (
            <View style={{ marginHorizontal: 16, marginTop: 7, padding: 13, borderRadius: 16, borderWidth: 1, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }}>
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: `${color}16` }}>
                  <MaterialIcons name={incoming ? 'south' : item.amount < 0 ? 'north' : 'receipt-long'} size={20} color={color} />
                </View>
                <View style={{ flex: 1, alignItems: 'flex-end' }}>
                  <Text style={{ color: theme.colors.textPrimary, fontSize: 13, fontWeight: '700' }}>{TX_TYPE_LABELS[item.type] || item.type}</Text>
                  <Text numberOfLines={1} style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 3, maxWidth: '100%' }}>{item.note || '—'}</Text>
                  <Text style={{ color: theme.colors.textTertiary, fontSize: 10, marginTop: 4 }}>
                    {item.date}  •  #{item.id}  •  {cashboxName(transactionCashboxId(item))}
                  </Text>
                </View>
                <Text style={{ color, fontSize: 14, fontWeight: '800' }}>
                  {item.amount > 0 ? '+' : item.amount < 0 ? '−' : ''}{formatCurrency(Math.abs(item.amount))}
                </Text>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={(
          <View style={{ alignItems: 'center', paddingHorizontal: 30, paddingTop: 46, paddingBottom: 30 }}>
            <MaterialIcons name="receipt-long" size={58} color={theme.colors.textTertiary} />
            <Text style={{ color: theme.colors.textTertiary, fontSize: 14, textAlign: 'center', marginTop: 15, lineHeight: 24 }}>
              لا توجد حركات مالية مطابقة للبحث أو الصندوق المختار
            </Text>
          </View>
        )}
      />

      <TouchableOpacity onPress={() => router.push('/assistant' as any)} accessibilityLabel="المساعد الذكي" style={{ position: 'absolute', left: 17, bottom: insets.bottom + 13, width: 62, height: 62, borderRadius: 21, backgroundColor: BLUE, alignItems: 'center', justifyContent: 'center', elevation: 7, shadowColor: '#174A9C', shadowOpacity: 0.24, shadowRadius: 9, shadowOffset: { width: 0, height: 4 } }}>
        <MaterialIcons name="smart-toy" size={29} color="#FFFFFF" />
      </TouchableOpacity>

      <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={() => setMenuVisible(false)}>
        <Pressable onPress={() => setMenuVisible(false)} style={{ flex: 1, backgroundColor: 'rgba(16,24,40,0.12)' }}>
          <Pressable onPress={() => undefined} style={{ position: 'absolute', top: insets.top + 53, right: 16, width: 300, borderRadius: 14, backgroundColor: theme.colors.surface, paddingVertical: 7, elevation: 12, shadowColor: '#101828', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 7 } }}>
            <MenuAction icon="edit" label="الأرصدة الافتتاحية للصناديق" onPress={() => openForm('opening')} color={theme.colors.textPrimary} />
            <MenuAction icon="compare-arrows" label="ترحيل نقدية بين الصناديق" onPress={() => openForm('transfer')} color={theme.colors.textPrimary} />
            <MenuAction icon="lock-clock" label="إقفال صندوق اليومية" onPress={() => openForm('close')} color={theme.colors.textPrimary} />
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={!!action} transparent animationType="slide" onRequestClose={closeForm}>
        <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.43)' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={{ flex: 1 }} onPress={closeForm} />
          <View style={{ backgroundColor: theme.colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 19, paddingTop: 18, paddingBottom: insets.bottom + 17 }}>
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <Text style={{ color: theme.colors.textPrimary, fontSize: 17, fontWeight: '800', textAlign: 'right' }}>{labelForAction(action)}</Text>
              <TouchableOpacity onPress={closeForm} style={{ width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceAlt }}><MaterialIcons name="close" size={20} color={theme.colors.textSecondary} /></TouchableOpacity>
            </View>

            {action === 'transfer' ? (
              <>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12, textAlign: 'right', marginBottom: 8 }}>من الصندوق</Text>
                {renderCashboxChips(sourceBox, setSourceBox)}
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12, textAlign: 'right', marginTop: 13, marginBottom: 8 }}>إلى الصندوق</Text>
                {renderCashboxChips(destinationBox, setDestinationBox)}
                <Text style={{ color: theme.colors.textTertiary, fontSize: 11, textAlign: 'right', marginTop: 8 }}>
                  الرصيد المتاح: {formatCurrency(getCashBalance(sourceBox))}
                </Text>
              </>
            ) : action !== 'close' ? (
              <>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12, textAlign: 'right', marginBottom: 8 }}>الصندوق</Text>
                {renderCashboxChips(formBox, setFormBox)}
                {action === 'opening' && selectedOpeningBalance > 0 ? (
                  <Text style={{ color: '#B54708', fontSize: 12, textAlign: 'right', marginTop: 9, lineHeight: 19 }}>
                    لهذا الصندوق رصيد افتتاحي مسجل: {formatCurrency(selectedOpeningBalance)}. استخدم سند قبض أو سند صرف للحركات اللاحقة.
                  </Text>
                ) : null}
                {action === 'opening' && selectedOpeningBalance <= 0 && selectedBoxHasActivity ? (
                  <Text style={{ color: '#B54708', fontSize: 12, textAlign: 'right', marginTop: 9, lineHeight: 19 }}>
                    الرصيد الافتتاحي يُسجّل قبل أول حركة في الصندوق؛ استخدم سند قبض أو سند صرف لإضافة نقدية لاحقًا.
                  </Text>
                ) : null}
              </>
            ) : (
              <View style={{ padding: 12, borderRadius: 13, backgroundColor: `${BLUE}12`, marginBottom: 12 }}>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12, textAlign: 'right' }}>الرصيد المتوقع في صندوق اليومية</Text>
                <Text style={{ color: BLUE, fontSize: 17, fontWeight: '800', textAlign: 'right', marginTop: 4 }}>{formatCurrency(getCashBalance('daily'))}</Text>
                {!openShift ? <Text style={{ color: theme.colors.textTertiary, fontSize: 11, textAlign: 'right', marginTop: 5 }}>لا توجد وردية مفتوحة؛ سيُحفظ سجل الإقفال دون تغيير الرصيد.</Text> : null}
              </View>
            )}

            {action === 'close' ? (
              <>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12, textAlign: 'right', marginTop: 8, marginBottom: 6 }}>النقد الفعلي بعد العد</Text>
                <TextInput value={countedCash} onChangeText={setCountedCash} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={theme.colors.textTertiary} style={inputStyle(theme, '#CA3035')} />
                <TextInput value={closeReason} onChangeText={setCloseReason} placeholder="ملاحظة أو سبب الفرق (اختياري)" placeholderTextColor={theme.colors.textTertiary} style={[inputStyle(theme, theme.colors.border), { textAlign: 'right', fontSize: 13, height: 47, marginTop: 9 }]} />
              </>
            ) : (
              <>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12, textAlign: 'right', marginTop: 15, marginBottom: 6 }}>المبلغ</Text>
                <TextInput value={amountText} onChangeText={setAmountText} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={theme.colors.textTertiary} style={inputStyle(theme, selectedActionColor)} />
                <TextInput value={note} onChangeText={setNote} placeholder={action === 'transfer' ? 'البيان / سبب التحويل (اختياري)' : 'البيان أو سبب الحركة'} placeholderTextColor={theme.colors.textTertiary} style={[inputStyle(theme, theme.colors.border), { textAlign: 'right', fontSize: 13, height: 47, marginTop: 9 }]} />
              </>
            )}

            <TouchableOpacity disabled={openingBalanceBlocked} onPress={handleSubmit} style={{ height: 51, backgroundColor: selectedActionColor, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginTop: 15, opacity: openingBalanceBlocked ? 0.45 : 1 }}>
              <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '800' }}>
                {action === 'close' ? 'تأكيد إقفال صندوق اليومية' : action === 'transfer' ? 'تأكيد التحويل' : 'حفظ الحركة'}
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={calendarVisible} transparent animationType="fade" onRequestClose={() => setCalendarVisible(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 18 }}>
          <View style={{ backgroundColor: theme.colors.surface, borderRadius: 20, overflow: 'hidden' }}>
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', padding: 15, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
              <Text style={{ color: theme.colors.textPrimary, fontSize: 16, fontWeight: '800' }}>تصفية حسب التاريخ</Text>
              <TouchableOpacity onPress={() => { setSelectedDate(null); setCalendarVisible(false); }}><Text style={{ color: BLUE, fontSize: 13, fontWeight: '700' }}>كل التواريخ</Text></TouchableOpacity>
            </View>
            <Calendar
              current={selectedDate || getToday()}
              firstDay={6}
              onDayPress={day => { setSelectedDate(day.dateString); setCalendarVisible(false); }}
              markedDates={selectedDate ? { [selectedDate]: { selected: true, selectedColor: BLUE } } : {}}
              theme={{
                backgroundColor: theme.colors.surface,
                calendarBackground: theme.colors.surface,
                textSectionTitleColor: theme.colors.textSecondary,
                selectedDayBackgroundColor: BLUE,
                selectedDayTextColor: '#FFFFFF',
                todayTextColor: BLUE,
                dayTextColor: theme.colors.textPrimary,
                textDisabledColor: theme.colors.textTertiary,
                monthTextColor: theme.colors.textPrimary,
                arrowColor: BLUE,
                textDayFontSize: 14,
                textMonthFontSize: 15,
                textDayHeaderFontSize: 11,
              }}
            />
            <TouchableOpacity onPress={() => { setSelectedDate(getToday()); setCalendarVisible(false); }} style={{ marginHorizontal: 15, marginBottom: 15, height: 43, borderRadius: 11, backgroundColor: `${BLUE}14`, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: BLUE, fontWeight: '700' }}>عرض حركات اليوم</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function QuickAction({ label, icon, color, onPress }: { label: string; icon: React.ComponentProps<typeof MaterialIcons>['name']; color: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={{ flex: 1, minHeight: 56, borderRadius: 19, backgroundColor: color, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 8, elevation: 2, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } }}>
      <MaterialIcons name={icon} size={20} color="#FFFFFF" />
      <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '800' }}>{label}</Text>
    </TouchableOpacity>
  );
}

function MenuAction({ icon, label, onPress, color }: { icon: React.ComponentProps<typeof MaterialIcons>['name']; label: string; onPress: () => void; color: string }) {
  return (
    <TouchableOpacity onPress={onPress} style={{ minHeight: 57, flexDirection: 'row-reverse', alignItems: 'center', gap: 12, paddingHorizontal: 15 }}>
      <MaterialIcons name={icon} size={22} color={color} />
      <Text style={{ color, fontSize: 14, fontWeight: '700', textAlign: 'right' }}>{label}</Text>
    </TouchableOpacity>
  );
}

function inputStyle(theme: ReturnType<typeof useTheme>['theme'], borderColor: string) {
  return {
    height: 56,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor,
    backgroundColor: theme.colors.surface,
    color: theme.colors.textPrimary,
    paddingHorizontal: 14,
    fontSize: 23,
    fontWeight: '800' as const,
    textAlign: 'center' as const,
  };
}
