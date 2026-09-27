// Smart Pharmacy ERP — Add Supplier
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '@/contexts/ThemeContext';
import { addSupplier } from '@/services/database';
import { useAlert } from '@/template';

export default function AddSupplierScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showAlert } = useAlert();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');

  const handleSave = () => {
    if (!name.trim()) { showAlert('تنبيه', 'أدخل اسم المورد'); return; }
    addSupplier({ name: name.trim(), phone: phone.trim() || undefined, address: address.trim() || undefined, notes: notes.trim() || undefined });
    router.back();
  };

  const inputStyle = { height: 48, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: 12, fontSize: 14, textAlign: 'right' as const, backgroundColor: theme.colors.surface, color: theme.colors.textPrimary };
  const labelStyle = { fontSize: 12, fontWeight: '600' as const, color: theme.colors.textSecondary, textAlign: 'right' as const, marginBottom: 6 };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ backgroundColor: '#6554C0', paddingTop: insets.top + 10, paddingBottom: 14, paddingHorizontal: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <TouchableOpacity onPress={handleSave} style={{ backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 }}>
          <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '700' }}>حفظ</Text>
        </TouchableOpacity>
        <Text style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF' }}>مورد جديد</Text>
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
          <Text style={labelStyle}>ملاحظات</Text>
          <TextInput style={[inputStyle, { height: 72, textAlignVertical: 'top', paddingTop: 10 }]} value={notes} onChangeText={setNotes} placeholder="ملاحظات إضافية" placeholderTextColor={theme.colors.textTertiary} multiline />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
