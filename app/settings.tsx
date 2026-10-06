// Smart Pharmacy ERP — Settings Screen
import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Switch } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { getSetting, setSetting, getOpeningBalance, addOpeningBalance } from '@/services/database';
import { useAlert } from '@/template';
import { PinSetup } from '@/components/ui';

export default function SettingsScreen() {
  const { theme, mode, toggleTheme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showAlert } = useAlert();

  const [pharmacyName, setPharmacyName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [currency, setCurrency] = useState('ريال سعودي');
  const [currencySymbol, setCurrencySymbol] = useState('ر.س');
  const [pinEnabled, setPinEnabled] = useState(false);
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [pinAction, setPinAction] = useState<'setup' | 'change'>('setup');
  const [saved, setSaved] = useState(false);
  const [openingBalance, setOpeningBalance] = useState('');
  const [openingBalanceTotal, setOpeningBalanceTotal] = useState(0);

  useEffect(() => {
    setPharmacyName(getSetting('pharmacy_name') || '');
    setOwnerName(getSetting('owner_name') || '');
    setCurrency(getSetting('currency') || 'ريال سعودي');
    setCurrencySymbol(getSetting('currency_symbol') || 'ر.س');
    setPinEnabled(getSetting('pin_enabled') === 'true');
    setOpeningBalanceTotal(getOpeningBalance());
  }, []);

  const handleSave = () => {
    setSetting('pharmacy_name', pharmacyName.trim());
    setSetting('owner_name', ownerName.trim());
    setSetting('currency', currency.trim());
    setSetting('currency_symbol', currencySymbol.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    showAlert('تم', 'تم حفظ الإعدادات');
  };

  const handleOpeningBalance = () => {
    const amount = parseFloat(openingBalance);
    if (!Number.isFinite(amount) || amount <= 0) { showAlert('تنبيه', 'أدخل مبلغاً صحيحاً أكبر من صفر'); return; }
    addOpeningBalance(amount);
    setOpeningBalance('');
    setOpeningBalanceTotal(getOpeningBalance());
    showAlert('تم', 'تم تسجيل الرصيد الافتتاحي في الصندوق');
  };

  const handlePinToggle = (val: boolean) => {
    if (val) {
      setPinAction('setup');
      setShowPinSetup(true);
    } else {
      showAlert('تعطيل قفل PIN', 'هل تريد تعطيل قفل PIN؟', [
        { text: 'إلغاء', style: 'cancel' },
        { text: 'تعطيل', style: 'destructive', onPress: () => { setSetting('pin_enabled', 'false'); setSetting('pin_code', ''); setPinEnabled(false); } },
      ]);
    }
  };

  const handlePinSaved = (pin: string) => {
    setSetting('pin_code', pin);
    setSetting('pin_enabled', 'true');
    setPinEnabled(true);
    setShowPinSetup(false);
    showAlert('تم', 'تم تفعيل قفل PIN');
  };

  const inputStyle = { height: 46, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: 12, fontSize: 14, textAlign: 'right' as const, backgroundColor: theme.colors.surface, color: theme.colors.textPrimary };
  const labelStyle = { fontSize: 12, fontWeight: '600' as const, color: theme.colors.textSecondary, textAlign: 'right' as const, marginBottom: 6 };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ backgroundColor: theme.colors.primary, paddingTop: insets.top + 10, paddingBottom: 14, paddingHorizontal: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <TouchableOpacity onPress={handleSave} style={{ backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 }}>
            <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '700' }}>حفظ</Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF' }}>الإعدادات</Text>
          <TouchableOpacity onPress={() => router.back()}>
            <MaterialIcons name="close" size={22} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 14, paddingBottom: 40 }}>

        {/* Pharmacy Info */}
        <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.textPrimary, textAlign: 'right', marginBottom: 12, borderRightWidth: 3, borderRightColor: theme.colors.primary, paddingRight: 8 }}>معلومات الصيدلية</Text>
        <View style={{ backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, padding: 14, marginBottom: 14 }}>
          <Text style={labelStyle}>اسم الصيدلية</Text>
          <TextInput style={[inputStyle, { marginBottom: 12 }]} value={pharmacyName} onChangeText={setPharmacyName} placeholder="صيدلية الشفاء" placeholderTextColor={theme.colors.textTertiary} />
          <Text style={labelStyle}>اسم المالك</Text>
          <TextInput style={[inputStyle, { marginBottom: 12 }]} value={ownerName} onChangeText={setOwnerName} placeholder="الاسم الكامل" placeholderTextColor={theme.colors.textTertiary} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={labelStyle}>رمز العملة</Text>
              <TextInput style={inputStyle} value={currencySymbol} onChangeText={setCurrencySymbol} placeholder="ر.س" placeholderTextColor={theme.colors.textTertiary} />
            </View>
            <View style={{ flex: 2 }}>
              <Text style={labelStyle}>العملة</Text>
              <TextInput style={inputStyle} value={currency} onChangeText={setCurrency} placeholder="ريال سعودي" placeholderTextColor={theme.colors.textTertiary} />
            </View>
          </View>
        </View>

        <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.textPrimary, textAlign: 'right', marginBottom: 12, borderRightWidth: 3, borderRightColor: theme.colors.primary, paddingRight: 8 }}>الرصيد الافتتاحي</Text>
        <View style={{ backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, padding: 14, marginBottom: 14 }}>
          <Text style={{ fontSize: 12, color: theme.colors.textSecondary, textAlign: 'right', marginBottom: 8 }}>الإجمالي المسجل: {openingBalanceTotal.toFixed(2)} {currencySymbol}</Text>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <TouchableOpacity onPress={handleOpeningBalance} style={{ backgroundColor: theme.colors.primary, borderRadius: 8, paddingHorizontal: 13, paddingVertical: 12 }}><Text style={{ color: '#FFFFFF', fontWeight: '700' }}>إضافة</Text></TouchableOpacity>
            <TextInput style={[inputStyle, { flex: 1 }]} value={openingBalance} onChangeText={setOpeningBalance} keyboardType="decimal-pad" placeholder="مبلغ جديد" placeholderTextColor={theme.colors.textTertiary} />
          </View>
        </View>

        {/* Theme */}
        <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.textPrimary, textAlign: 'right', marginBottom: 12, borderRightWidth: 3, borderRightColor: theme.colors.primary, paddingRight: 8 }}>المظهر</Text>
        <View style={{ backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, padding: 14, marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Switch value={mode === 'dark'} onValueChange={toggleTheme} trackColor={{ true: theme.colors.primary }} />
            <Text style={{ fontSize: 14, color: theme.colors.textPrimary }}>الوضع الداكن</Text>
          </View>
        </View>

        {/* Security */}
        <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.textPrimary, textAlign: 'right', marginBottom: 12, borderRightWidth: 3, borderRightColor: theme.colors.primary, paddingRight: 8 }}>الأمان</Text>
        <View style={{ backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, padding: 14, marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: pinEnabled ? 14 : 0 }}>
            <Switch value={pinEnabled} onValueChange={handlePinToggle} trackColor={{ true: theme.colors.primary }} />
            <Text style={{ fontSize: 14, color: theme.colors.textPrimary }}>قفل PIN عند بدء التشغيل</Text>
          </View>
          {pinEnabled && (
            <TouchableOpacity
              onPress={() => { setPinAction('change'); setShowPinSetup(true); }}
              style={{ backgroundColor: theme.colors.primaryLight, borderRadius: 8, padding: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <MaterialIcons name="chevron-left" size={18} color={theme.colors.primary} />
              <Text style={{ fontSize: 14, color: theme.colors.primary, fontWeight: '600' }}>تغيير رمز PIN</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Navigation */}
        <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.textPrimary, textAlign: 'right', marginBottom: 12, borderRightWidth: 3, borderRightColor: theme.colors.primary, paddingRight: 8 }}>الأدوات</Text>
        <View style={{ backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, overflow: 'hidden', marginBottom: 14 }}>
          {[
            { label: 'النسخ الاحتياطي', icon: 'backup', route: '/backup', color: '#00875A' },
            { label: 'سجل التدقيق', icon: 'history', route: '/audit-log', color: '#172B4D' },
            { label: 'المستخدمون', icon: 'manage-accounts', route: '/users', color: '#0052CC' },
          ].map((item, i) => (
            <TouchableOpacity key={item.label} onPress={() => router.push(item.route as any)} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 14, borderBottomWidth: i < 2 ? 1 : 0, borderBottomColor: theme.colors.divider }}>
              <MaterialIcons name="chevron-left" size={18} color={theme.colors.textTertiary} />
              <Text style={{ flex: 1, fontSize: 14, color: theme.colors.textPrimary, textAlign: 'right', marginHorizontal: 10 }}>{item.label}</Text>
              <View style={{ width: 34, height: 34, borderRadius: 8, backgroundColor: item.color + '18', alignItems: 'center', justifyContent: 'center' }}>
                <MaterialIcons name={item.icon as any} size={18} color={item.color} />
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* App Info */}
        <View style={{ alignItems: 'center', padding: 16 }}>
          <MaterialIcons name="local-pharmacy" size={32} color={theme.colors.primary} />
          <Text style={{ fontSize: 16, fontWeight: '700', color: theme.colors.textPrimary, marginTop: 8 }}>صيدلية ذكية</Text>
          <Text style={{ fontSize: 12, color: theme.colors.textTertiary, marginTop: 4 }}>الإصدار 1.0.0 — نظام ERP للصيدليات</Text>
        </View>
      </ScrollView>

      {showPinSetup && (
        <PinSetup
          onSave={handlePinSaved}
          onCancel={() => setShowPinSetup(false)}
          title={pinAction === 'change' ? 'تغيير رمز PIN' : 'إعداد رمز PIN'}
        />
      )}
    </View>
  );
}
