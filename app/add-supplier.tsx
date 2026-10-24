// Smart Pharmacy ERP — Add Supplier
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTheme } from '@/contexts/ThemeContext';
import { addSupplier, getSupplier, updateSupplier } from '@/services/database';
import { useAlert } from '@/template';

export default function AddSupplierScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editingId = id ? Number(id) : null;
  const { showAlert } = useAlert();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [openingBalance, setOpeningBalance] = useState('0');

  useEffect(() => {
    if (!editingId || !Number.isFinite(editingId)) return;
    const supplier = getSupplier(editingId);
    if (!supplier) return;
    setName(supplier.name); setPhone(supplier.phone || ''); setAddress(supplier.address || ''); setNotes(supplier.notes || '');
  }, [editingId]);

  const handleSave = () => {
    if (!name.trim()) { showAlert('تنبيه', 'أدخل اسم المورد'); return; }
    const opening = Number(openingBalance);
    if (!Number.isFinite(opening) || opening < 0) { showAlert('تنبيه', 'أدخل رصيداً افتتاحياً صحيحاً وغير سالب'); return; }
    try {
      if (editingId && Number.isFinite(editingId)) updateSupplier(editingId, { name: name.trim(), phone: phone.trim() || null, address: address.trim() || null, notes: notes.trim() || null });
      else addSupplier({ name: name.trim(), phone: phone.trim() || undefined, address: address.trim() || undefined, opening_balance: opening, notes: notes.trim() || undefined });
      router.back();
    } catch (error) { showAlert('تعذر الحفظ', error instanceof Error ? error.message : 'حدث خطأ غير متوقع'); }
  };

  const inputStyle = { height: 48, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: 12, fontSize: 14, textAlign: 'right' as const, backgroundColor: theme.colors.surface, color: theme.colors.textPrimary };
  const labelStyle = { fontSize: 12, fontWeight: '600' as const, color: theme.colors.textSecondary, textAlign: 'right' as const, marginBottom: 6 };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ backgroundColor: '#6554C0', paddingTop: insets.top + 10, paddingBottom: 14, paddingHorizontal: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <TouchableOpacity onPress={handleSave} style={{ backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 }}>
          <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '700' }}>حفظ</Text>
        </TouchableOpacity>
        <Text style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF' }}>{editingId ? 'تعديل المورد' : 'مورد جديد'}</Text>
        <TouchableOpacity onPress={() => router.back()}><MaterialIcons name="close" size={22} color="#FFFFFF" /></TouchableOpacity>
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
          <Text style={labelStyle}>اسم المورد *</Text>
          <TextInput style={inputStyle} value={name} onChangeText={setName} placeholder="اسم الشركة أو المورد" placeholderTextColor={theme.colors.textTertiary} />
          <Text style={labelStyle}>رقم الهاتف</Text>
          <TextInput style={inputStyle} value={phone} onChangeText={setPhone} placeholder="+966..." placeholderTextColor={theme.colors.textTertiary} keyboardType="phone-pad" />
          <Text style={labelStyle}>العنوان</Text>
          <TextInput style={inputStyle} value={address} onChangeText={setAddress} placeholder="العنوان" placeholderTextColor={theme.colors.textTertiary} />
          {!editingId && <><Text style={labelStyle}>الرصيد الافتتاحي (ديون سابقة)</Text><TextInput style={inputStyle} value={openingBalance} onChangeText={setOpeningBalance} placeholder="0" placeholderTextColor={theme.colors.textTertiary} keyboardType="decimal-pad" /></>}
          <Text style={labelStyle}>ملاحظات</Text>
          <TextInput style={[inputStyle, { height: 72, textAlignVertical: 'top', paddingTop: 10 }]} value={notes} onChangeText={setNotes} placeholder="ملاحظات إضافية" placeholderTextColor={theme.colors.textTertiary} multiline />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
