// Smart Pharmacy ERP — Add Expense
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '@/contexts/ThemeContext';
import { addExpense, getExpenseCategories } from '@/services/database';
import { getToday } from '@/constants/i18n';
import { useAlert } from '@/template';

export default function AddExpenseScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showAlert } = useAlert();
  const [category, setCategory] = useState('أخرى');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(getToday());
  const [note, setNote] = useState('');
  const categories = getExpenseCategories();

  const handleSave = () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { showAlert('تنبيه', 'أدخل مبلغاً صحيحاً'); return; }
    addExpense({ category, amount: amt, date, note: note.trim() || undefined });
    router.back();
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ backgroundColor: theme.colors.error, paddingTop: insets.top + 10, paddingBottom: 14, paddingHorizontal: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <TouchableOpacity onPress={handleSave} style={{ backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 }}>
          <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '700' }}>حفظ</Text>
        </TouchableOpacity>
        <Text style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF' }}>مصروف جديد</Text>
        <TouchableOpacity onPress={() => router.back()}><MaterialIcons name="close" size={22} color="#FFFFFF" /></TouchableOpacity>
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
          {/* Amount Hero */}
          <View style={{ alignItems: 'center', paddingVertical: 20 }}>
            <Text style={{ fontSize: 13, color: theme.colors.textTertiary, marginBottom: 8 }}>المبلغ</Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
              placeholder="0.00"
              placeholderTextColor={theme.colors.textTertiary}
              style={{ fontSize: 36, fontWeight: '800', color: theme.colors.error, textAlign: 'center', width: '100%' }}
              autoFocus
            />
          </View>

          <Text style={{ fontSize: 12, fontWeight: '600', color: theme.colors.textSecondary, textAlign: 'right', marginBottom: 8 }}>الفئة</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16, justifyContent: 'flex-end' }}>
            {categories.map(c => (
              <TouchableOpacity key={c} onPress={() => setCategory(c)} style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: category === c ? theme.colors.error : theme.colors.surfaceAlt, borderWidth: 1, borderColor: category === c ? theme.colors.error : theme.colors.border }}>
                <Text style={{ fontSize: 13, fontWeight: '500', color: category === c ? '#FFFFFF' : theme.colors.textSecondary }}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={{ fontSize: 12, fontWeight: '600', color: theme.colors.textSecondary, textAlign: 'right', marginBottom: 6 }}>التاريخ</Text>
          <TextInput
            value={date}
            onChangeText={setDate}
            style={{ height: 48, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: 12, fontSize: 14, textAlign: 'center', backgroundColor: theme.colors.surface, color: theme.colors.textPrimary, marginBottom: 14 }}
          />

          <Text style={{ fontSize: 12, fontWeight: '600', color: theme.colors.textSecondary, textAlign: 'right', marginBottom: 6 }}>الوصف (اختياري)</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="ملاحظات"
            placeholderTextColor={theme.colors.textTertiary}
            style={{ height: 64, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: 12, paddingTop: 10, fontSize: 14, textAlign: 'right', backgroundColor: theme.colors.surface, color: theme.colors.textPrimary, marginBottom: 20 }}
            multiline
          />

          <TouchableOpacity
            onPress={handleSave}
            style={{ height: 52, backgroundColor: theme.colors.error, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#FFFFFF' }}>
              {amount ? `حفظ المصروف — ${amount}` : 'حفظ المصروف'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
