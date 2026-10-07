// Smart Pharmacy ERP — Shifts Screen
import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, Modal, TextInput } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { getShifts, getOpenShift, openShift, closeShift, getSetting, Shift } from '@/services/database';
import { formatCurrency, formatDateTime } from '@/constants/i18n';
import { useAlert } from '@/template';
import { PdfActions } from '@/components/PdfActions';
import { buildTableReportHtml } from '@/services/pdfReport';

export default function ShiftsScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showAlert } = useAlert();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [openShiftData, setOpenShiftData] = useState<Shift | null>(null);
  const [showOpenModal, setShowOpenModal] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [openingCash, setOpeningCash] = useState('');
  const [actualCash, setActualCash] = useState('');
  const [closeReason, setCloseReason] = useState('');

  const load = useCallback(() => {
    setShifts(getShifts(20));
    setOpenShiftData(getOpenShift());
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleOpenShift = () => {
    const cash = parseFloat(openingCash) || 0;
    openShift({ opening_cash: cash });
    setShowOpenModal(false); setOpeningCash('');
    load();
    showAlert('تم', 'تم فتح الوردية');
  };

  const handleCloseShift = () => {
    if (!openShiftData) return;
    const cash = parseFloat(actualCash);
    if (isNaN(cash)) { showAlert('تنبيه', 'أدخل الرصيد الفعلي'); return; }
    closeShift(openShiftData.id, cash, closeReason);
    setShowCloseModal(false); setActualCash(''); setCloseReason('');
    load();
    showAlert('تم', 'تم إغلاق الوردية');
  };
  const buildShiftsPdf = () => buildTableReportHtml({
    pharmacyName: getSetting('pharmacy_name') || 'صيدليتي',
    title: 'تقرير الورديات',
    periodLabel: 'آخر 20 وردية',
    accent: '#0052CC',
    summary: [
      { label: 'عدد الورديات', value: shifts.length },
      { label: 'الوردية المفتوحة', value: openShiftData ? 'نعم' : 'لا', tone: openShiftData ? 'positive' : 'neutral' },
      { label: 'إجمالي المبيعات', value: formatCurrency(shifts.reduce((sum, shift) => sum + shift.total_sales, 0)), tone: 'positive' },
    ],
    columns: ['الحالة', 'وقت الفتح', 'وقت الإغلاق', 'المبيعات', 'المصروفات', 'النقد الفعلي', 'الفرق'],
    rows: shifts.map(shift => [shift.status === 'OPEN' ? 'مفتوحة' : 'مغلقة', shift.opened_at, shift.closed_at || '—', formatCurrency(shift.total_sales), formatCurrency(shift.total_expenses), shift.actual_cash === null ? '—' : formatCurrency(shift.actual_cash), shift.difference === null ? '—' : formatCurrency(shift.difference)]),
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ backgroundColor: '#0052CC', paddingTop: insets.top + 10, paddingBottom: 14, paddingHorizontal: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <TouchableOpacity onPress={() => router.back()} style={{ width: 34, height: 34, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
              <MaterialIcons name="arrow-forward" size={20} color="#FFFFFF" />
            </TouchableOpacity>
            <PdfActions buildHtml={buildShiftsPdf} title="تقرير الورديات" onError={(message) => showAlert('خطأ', message)} />
          </View>
          <Text style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF' }}>الورديات</Text>
          {openShiftData ? (
            <TouchableOpacity onPress={() => setShowCloseModal(true)} style={{ backgroundColor: '#FF5630', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}>
              <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '600' }}>إغلاق</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={() => setShowOpenModal(true)} style={{ backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}>
              <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '600' }}>فتح وردية</Text>
            </TouchableOpacity>
          )}
        </View>

        {openShiftData && (
          <View style={{ backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 10, padding: 12 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ backgroundColor: '#36B37E', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '600' }}>مفتوحة</Text>
              </View>
              <Text style={{ fontSize: 13, fontWeight: '600', color: '#FFFFFF' }}>الوردية الحالية</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginTop: 10 }}>
              <View style={{ alignItems: 'center' }}>
                <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>الافتتاح</Text>
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFFFFF' }}>{formatCurrency(openShiftData.opening_cash)}</Text>
              </View>
              <View style={{ alignItems: 'center' }}>
                <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>المبيعات</Text>
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#AAFFCC' }}>{formatCurrency(openShiftData.total_sales)}</Text>
              </View>
              <View style={{ alignItems: 'center' }}>
                <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>المصروفات</Text>
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFAAAA' }}>{formatCurrency(openShiftData.total_expenses)}</Text>
              </View>
            </View>
          </View>
        )}
      </View>

      <FlatList
        data={shifts}
        keyExtractor={s => String(s.id)}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 32 }}
        renderItem={({ item }) => (
          <View style={{ backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.divider, paddingHorizontal: 14, paddingVertical: 12 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <View style={{ backgroundColor: item.status === 'OPEN' ? '#36B37E20' : theme.colors.surfaceAlt, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ fontSize: 11, fontWeight: '600', color: item.status === 'OPEN' ? '#36B37E' : theme.colors.textTertiary }}>
                  {item.status === 'OPEN' ? 'مفتوحة' : 'مغلقة'}
                </Text>
              </View>
              <Text style={{ fontSize: 12, color: theme.colors.textTertiary }}>{item.opened_at.slice(0, 16)}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
              <View style={{ alignItems: 'center' }}>
                <Text style={{ fontSize: 10, color: theme.colors.textTertiary }}>مبيعات</Text>
                <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.success }}>{formatCurrency(item.total_sales)}</Text>
              </View>
              <View style={{ alignItems: 'center' }}>
                <Text style={{ fontSize: 10, color: theme.colors.textTertiary }}>مصروفات</Text>
                <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.error }}>{formatCurrency(item.total_expenses)}</Text>
              </View>
              {item.status === 'CLOSED' && item.difference !== null && (
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ fontSize: 10, color: theme.colors.textTertiary }}>الفرق</Text>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: item.difference === 0 ? theme.colors.success : theme.colors.error }}>{formatCurrency(item.difference)}</Text>
                </View>
              )}
              <View style={{ alignItems: 'center' }}>
                <Text style={{ fontSize: 10, color: theme.colors.textTertiary }}>الافتتاح</Text>
                <Text style={{ fontSize: 13, fontWeight: '600', color: theme.colors.textPrimary }}>{formatCurrency(item.opening_cash)}</Text>
              </View>
            </View>
          </View>
        )}
        ListEmptyComponent={<View style={{ padding: 40, alignItems: 'center' }}><MaterialIcons name="work" size={48} color={theme.colors.textTertiary} /><Text style={{ fontSize: 14, color: theme.colors.textTertiary, marginTop: 12 }}>لا توجد ورديات</Text></View>}
      />

      {/* Open Shift Modal */}
      <Modal visible={showOpenModal} animationType="slide" transparent>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: theme.colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: insets.bottom + 20 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: theme.colors.textPrimary, textAlign: 'right', marginBottom: 14 }}>فتح وردية جديدة</Text>
            <Text style={{ fontSize: 12, color: theme.colors.textSecondary, textAlign: 'right', marginBottom: 6 }}>رصيد الافتتاح</Text>
            <TextInput value={openingCash} onChangeText={setOpeningCash} keyboardType="numeric" placeholder="0.00" placeholderTextColor={theme.colors.textTertiary}
              style={{ height: 52, borderRadius: 10, borderWidth: 1.5, borderColor: '#0052CC', fontSize: 22, fontWeight: '700', textAlign: 'center', color: theme.colors.textPrimary, marginBottom: 16 }} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity onPress={() => setShowOpenModal(false)} style={{ flex: 1, height: 48, backgroundColor: theme.colors.surfaceAlt, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontWeight: '600', color: theme.colors.textPrimary }}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleOpenShift} style={{ flex: 2, height: 48, backgroundColor: '#0052CC', borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>فتح الوردية</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Close Shift Modal */}
      <Modal visible={showCloseModal} animationType="slide" transparent>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: theme.colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: insets.bottom + 20 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: theme.colors.textPrimary, textAlign: 'right', marginBottom: 14 }}>إغلاق الوردية</Text>
            <Text style={{ fontSize: 12, color: theme.colors.textSecondary, textAlign: 'right', marginBottom: 6 }}>الرصيد الفعلي في الصندوق</Text>
            <TextInput value={actualCash} onChangeText={setActualCash} keyboardType="numeric" placeholder="0.00" placeholderTextColor={theme.colors.textTertiary}
              style={{ height: 52, borderRadius: 10, borderWidth: 1.5, borderColor: '#FF5630', fontSize: 22, fontWeight: '700', textAlign: 'center', color: theme.colors.textPrimary, marginBottom: 10 }} />
            <TextInput value={closeReason} onChangeText={setCloseReason} placeholder="سبب الفرق (إن وجد)" placeholderTextColor={theme.colors.textTertiary}
              style={{ height: 44, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: 12, fontSize: 13, textAlign: 'right', color: theme.colors.textPrimary, marginBottom: 16 }} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity onPress={() => setShowCloseModal(false)} style={{ flex: 1, height: 48, backgroundColor: theme.colors.surfaceAlt, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontWeight: '600', color: theme.colors.textPrimary }}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleCloseShift} style={{ flex: 2, height: 48, backgroundColor: '#FF5630', borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>إغلاق الوردية</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
