// Smart Pharmacy ERP — First Setup Screen
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { completeSetup } from '@/services/database';
import { useAlert } from '@/template';

export default function SetupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { showAlert } = useAlert();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  const [pharmacyName, setPharmacyName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [currency, setCurrency] = useState('ريال سعودي');
  const [currencySymbol, setCurrencySymbol] = useState('ر.س');
  const [adminUser, setAdminUser] = useState('admin');
  const [adminPass, setAdminPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [openingCash, setOpeningCash] = useState('');

  const handleComplete = async () => {
    if (!pharmacyName.trim()) { showAlert('تنبيه', 'أدخل اسم الصيدلية'); return; }
    if (!adminUser.trim()) { showAlert('تنبيه', 'أدخل اسم المستخدم'); return; }
    if (!adminPass || adminPass.length < 4) { showAlert('تنبيه', 'كلمة المرور يجب أن تكون 4 أحرف على الأقل'); return; }
    if (adminPass !== confirmPass) { showAlert('تنبيه', 'كلمتا المرور غير متطابقتان'); return; }

    setLoading(true);
    try {
      completeSetup({
        pharmacy_name: pharmacyName.trim(),
        owner_name: ownerName.trim(),
        currency,
        currency_symbol: currencySymbol,
        admin_username: adminUser.trim(),
        admin_password: adminPass,
        opening_cash: parseFloat(openingCash) || 0,
      });
      router.replace('/(tabs)');
    } catch (e: any) {
      showAlert('خطأ', e?.message || 'فشل الإعداد');
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    height: 50,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#DFE1E6',
    paddingHorizontal: 14,
    fontSize: 15,
    textAlign: 'right' as const,
    backgroundColor: '#FFFFFF',
    color: '#172B4D',
    marginBottom: 14,
  };

  const labelStyle = { fontSize: 13, fontWeight: '600' as const, color: '#5E6C84', marginBottom: 6, textAlign: 'right' as const };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <StatusBar style="light" />
      <View style={{ flex: 1, backgroundColor: '#00875A' }}>
        {/* Header */}
        <View style={{ paddingTop: insets.top + 20, paddingHorizontal: 24, paddingBottom: 28, alignItems: 'center' }}>
          <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
            <MaterialIcons name="local-pharmacy" size={36} color="#FFFFFF" />
          </View>
          <Text style={{ fontSize: 22, fontWeight: '800', color: '#FFFFFF', marginBottom: 4 }}>صيدلية ذكية</Text>
          <Text style={{ fontSize: 14, color: 'rgba(255,255,255,0.8)' }}>الإعداد الأولي للنظام</Text>
          {/* Steps */}
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 16 }}>
            {[1, 2].map(s => (
              <View key={s} style={{ width: s === step ? 24 : 8, height: 8, borderRadius: 4, backgroundColor: s <= step ? '#FFFFFF' : 'rgba(255,255,255,0.3)' }} />
            ))}
          </View>
        </View>

        <ScrollView
          style={{ flex: 1, backgroundColor: '#F4F5F7', borderTopLeftRadius: 24, borderTopRightRadius: 24 }}
          contentContainerStyle={{ padding: 24, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {step === 1 ? (
            <>
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#172B4D', textAlign: 'right', marginBottom: 20 }}>
                معلومات الصيدلية
              </Text>
              <Text style={labelStyle}>اسم الصيدلية *</Text>
              <TextInput
                style={inputStyle}
                value={pharmacyName}
                onChangeText={setPharmacyName}
                placeholder="مثال: صيدلية الشفاء"
                placeholderTextColor="#C1C7D0"
              />
              <Text style={labelStyle}>اسم المالك</Text>
              <TextInput
                style={inputStyle}
                value={ownerName}
                onChangeText={setOwnerName}
                placeholder="الاسم الكامل"
                placeholderTextColor="#C1C7D0"
              />
              <Text style={labelStyle}>العملة</Text>
              <TextInput
                style={inputStyle}
                value={currency}
                onChangeText={setCurrency}
                placeholder="ريال سعودي"
                placeholderTextColor="#C1C7D0"
              />
              <Text style={labelStyle}>رمز العملة</Text>
              <TextInput
                style={inputStyle}
                value={currencySymbol}
                onChangeText={setCurrencySymbol}
                placeholder="ر.س"
                placeholderTextColor="#C1C7D0"
              />

              <TouchableOpacity
                onPress={() => {
                  if (!pharmacyName.trim()) { showAlert('تنبيه', 'أدخل اسم الصيدلية'); return; }
                  setStep(2);
                }}
                style={{ height: 52, backgroundColor: '#00875A', borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 8 }}
              >
                <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '700' }}>التالي</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#172B4D', textAlign: 'right', marginBottom: 20 }}>
                إعداد حساب المدير
              </Text>
              <Text style={labelStyle}>اسم المستخدم *</Text>
              <TextInput
                style={inputStyle}
                value={adminUser}
                onChangeText={setAdminUser}
                placeholder="admin"
                placeholderTextColor="#C1C7D0"
                autoCapitalize="none"
              />
              <Text style={labelStyle}>كلمة المرور *</Text>
              <TextInput
                style={inputStyle}
                value={adminPass}
                onChangeText={setAdminPass}
                placeholder="••••••••"
                placeholderTextColor="#C1C7D0"
                secureTextEntry
              />
              <Text style={labelStyle}>تأكيد كلمة المرور *</Text>
              <TextInput
                style={inputStyle}
                value={confirmPass}
                onChangeText={setConfirmPass}
                placeholder="••••••••"
                placeholderTextColor="#C1C7D0"
                secureTextEntry
              />
              <Text style={labelStyle}>الرصيد الافتتاحي (اختياري)</Text>
              <TextInput
                style={inputStyle}
                value={openingCash}
                onChangeText={setOpeningCash}
                placeholder="0.00"
                placeholderTextColor="#C1C7D0"
                keyboardType="numeric"
              />

              <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
                <TouchableOpacity
                  onPress={() => setStep(1)}
                  style={{ flex: 1, height: 52, backgroundColor: '#DFE1E6', borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={{ color: '#172B4D', fontSize: 15, fontWeight: '600' }}>السابق</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleComplete}
                  disabled={loading}
                  style={{ flex: 2, height: 52, backgroundColor: '#00875A', borderRadius: 12, alignItems: 'center', justifyContent: 'center', opacity: loading ? 0.7 : 1 }}
                >
                  {loading
                    ? <ActivityIndicator color="#FFFFFF" />
                    : <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '700' }}>بدء النظام</Text>
                  }
                </TouchableOpacity>
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}
