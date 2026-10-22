import React, { useCallback, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, KeyboardAvoidingView, Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { addExpenseCategory, getExpenseCategories, removeExpenseCategory, getExpenses } from '@/services/database';
import { useAlert } from '@/template';

export default function ExpenseAccountsScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showAlert } = useAlert();
  const [name, setName] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [usedCategories, setUsedCategories] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    setCategories(getExpenseCategories());
    setUsedCategories(new Set(getExpenses().map(expense => expense.category)));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const add = () => {
    const result = addExpenseCategory(name);
    if (!result.ok) {
      showAlert('تعذر إضافة الحساب', result.message || 'تحقق من الاسم');
      return;
    }
    setName('');
    load();
    showAlert('تمت الإضافة', 'أُضيف حساب المصروفات ويمكن اختياره عند تسجيل مصروف جديد.');
  };

  const remove = (category: string) => {
    showAlert('حذف حساب المصروفات', 'هل تريد إزالة هذا الحساب من قائمة الحسابات؟', [
      { text: 'إلغاء', style: 'cancel' },
      { text: 'إزالة', style: 'destructive', onPress: () => {
        const result = removeExpenseCategory(category);
        if (!result.ok) showAlert('لا يمكن الحذف', result.message || 'تعذر حذف الحساب');
        load();
      }},
    ]);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ backgroundColor: theme.colors.primary, paddingTop: insets.top + 10, paddingBottom: 14, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="رجوع">
          <MaterialIcons name="arrow-forward" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: 'flex-end', marginRight: 12 }}>
          <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '800' }}>دليل حسابات المصروفات</Text>
          <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 3 }}>إدارة التصنيفات المستخدمة في تسجيل المصروفات</Text>
        </View>
        <MaterialIcons name="account-tree" size={24} color="#FFFFFF" />
      </View>

      <View style={{ padding: 14 }}>
        <View style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 14, padding: 14 }}>
          <Text style={{ color: theme.colors.textPrimary, fontSize: 14, fontWeight: '700', textAlign: 'right', marginBottom: 9 }}>إضافة حساب جديد</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="اسم الحساب، مثل: إنترنت أو رسوم حكومية"
            placeholderTextColor={theme.colors.textTertiary}
            returnKeyType="done"
            onSubmitEditing={add}
            maxLength={50}
            style={{ color: theme.colors.textPrimary, backgroundColor: theme.colors.background, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, textAlign: 'right', marginBottom: 10 }}
          />
          <TouchableOpacity onPress={add} style={{ backgroundColor: theme.colors.primary, paddingVertical: 12, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
            <MaterialIcons name="add" size={19} color="#FFFFFF" />
            <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>إضافة الحساب</Text>
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, marginBottom: 8 }}>
          <Text style={{ color: theme.colors.textPrimary, fontWeight: '800', fontSize: 15 }}>الحسابات ({categories.length})</Text>
          <TouchableOpacity onPress={() => router.push('/add-expense')} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <MaterialIcons name="add-circle-outline" size={18} color={theme.colors.primary} />
            <Text style={{ color: theme.colors.primary, fontWeight: '600', fontSize: 12 }}>تسجيل مصروف</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={categories}
        keyExtractor={item => item}
        contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: insets.bottom + 24 }}
        ListEmptyComponent={<Text style={{ textAlign: 'center', color: theme.colors.textTertiary, padding: 24 }}>لا توجد حسابات.</Text>}
        renderItem={({ item }) => {
          const used = usedCategories.has(item);
          return (
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: 12, paddingVertical: 12, marginBottom: 8 }}>
              <View style={{ width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.primary + '18' }}>
                <MaterialIcons name="account-balance-wallet" size={20} color={theme.colors.primary} />
              </View>
              <View style={{ flex: 1, marginHorizontal: 10 }}>
                <Text style={{ color: theme.colors.textPrimary, textAlign: 'right', fontWeight: '700', fontSize: 14 }}>{item}</Text>
                <Text style={{ color: theme.colors.textTertiary, textAlign: 'right', fontSize: 11, marginTop: 3 }}>{used ? 'مرتبط بمصروفات سابقة — لا يمكن حذفه' : 'متاح للاستخدام في المصروفات'}</Text>
              </View>
              {!used && !['إيجار', 'رواتب', 'مرافق', 'صيانة', 'مستلزمات', 'مواصلات', 'تسويق', 'أخرى'].includes(item) ? (
                <TouchableOpacity onPress={() => remove(item)} accessibilityLabel={'حذف ' + item} style={{ padding: 8 }}>
                  <MaterialIcons name="delete-outline" size={21} color={theme.colors.error} />
                </TouchableOpacity>
              ) : <MaterialIcons name={used ? 'lock-outline' : 'check-circle-outline'} size={20} color={theme.colors.textTertiary} />}
            </View>
          );
        }}
      />
    </KeyboardAvoidingView>
  );
}
