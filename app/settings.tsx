// Smart Pharmacy ERP — Settings Screen
import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Switch, Image } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { getSetting, setSetting, getOpeningBalance, addOpeningBalance, flushDatabaseWrites } from '@/services/database';
import { useAlert } from '@/template';
import { PinSetup } from '@/components/ui';
import * as ImagePicker from 'expo-image-picker';

export default function SettingsScreen() {
  const { theme, mode, toggleTheme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showAlert } = useAlert();

  const [pharmacyName, setPharmacyName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [pharmacyPhone, setPharmacyPhone] = useState('');
  const [pharmacyAddress, setPharmacyAddress] = useState('');
  const [receiptHeader, setReceiptHeader] = useState('');
  const [receiptFooter, setReceiptFooter] = useState('');
  const [pharmacyLogoUri, setPharmacyLogoUri] = useState<string | null>(null);
  const [currency, setCurrency] = useState('ريال يمني');
  const [currencySymbol, setCurrencySymbol] = useState('ر.ي');
  const [pinEnabled, setPinEnabled] = useState(false);
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [pinAction, setPinAction] = useState<'setup' | 'change'>('setup');
  const [saved, setSaved] = useState(false);
  const [openingBalance, setOpeningBalance] = useState('');
  const [openingBalanceTotal, setOpeningBalanceTotal] = useState(0);

  useEffect(() => {
    setPharmacyName(getSetting('pharmacy_name') || '');
    setOwnerName(getSetting('owner_name') || '');
    setPharmacyPhone(getSetting('pharmacy_phone') || '');
    setPharmacyAddress(getSetting('pharmacy_address') || '');
    setReceiptHeader(getSetting('receipt_header') || '');
    setReceiptFooter(getSetting('receipt_footer') || '');
    setPharmacyLogoUri(getSetting('pharmacy_logo_uri') || null);
    setCurrency(getSetting('currency') || 'ريال يمني');
    setCurrencySymbol(getSetting('currency_symbol') || 'ر.ي');
    setPinEnabled(getSetting('pin_enabled') === 'true');
    setOpeningBalanceTotal(getOpeningBalance());
  }, []);

  const handleSave = async () => {
    setSetting('pharmacy_name', pharmacyName.trim());
    setSetting('owner_name', ownerName.trim());
    setSetting('pharmacy_phone', pharmacyPhone.trim());
    setSetting('pharmacy_address', pharmacyAddress.trim());
    setSetting('receipt_header', receiptHeader.trim());
    setSetting('receipt_footer', receiptFooter.trim());
    setSetting('pharmacy_logo_uri', pharmacyLogoUri || '');
    setSetting('currency', currency.trim());
    setSetting('currency_symbol', currencySymbol.trim());
    try {
      await flushDatabaseWrites();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      showAlert('تم', 'تم حفظ الإعدادات على هذا الجهاز');
    } catch {
      showAlert('تعذر تأكيد الحفظ', 'لم يتم تأكيد حفظ الإعدادات على الجهاز. حاول مرة أخرى.');
    }
  };

  const choosePharmacyLogo = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.65, base64: true,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      const asset = result.assets[0];
      // Store a self-contained image so print HTML can render it without a device file path.
      setPharmacyLogoUri(asset.base64 ? `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}` : asset.uri);
    }
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
          <Text style={labelStyle}>رقم هاتف الصيدلية</Text>
          <TextInput style={[inputStyle, { marginBottom: 12 }]} value={pharmacyPhone} onChangeText={setPharmacyPhone} keyboardType="phone-pad" placeholder="رقم التواصل" placeholderTextColor={theme.colors.textTertiary} />
          <Text style={labelStyle}>عنوان الصيدلية</Text>
          <TextInput style={[inputStyle, { marginBottom: 12 }]} value={pharmacyAddress} onChangeText={setPharmacyAddress} placeholder="المدينة والشارع" placeholderTextColor={theme.colors.textTertiary} />
          <Text style={labelStyle}>شعار الصيدلية</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <TouchableOpacity onPress={choosePharmacyLogo} style={{ backgroundColor: theme.colors.surfaceAlt, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <MaterialIcons name="photo-library" size={18} color={theme.colors.primary} />
              <Text style={{ color: theme.colors.primary, fontSize: 12, fontWeight: '700' }}>{pharmacyLogoUri ? 'تغيير الشعار' : 'اختيار شعار'}</Text>
            </TouchableOpacity>
            {pharmacyLogoUri ? <Image source={{ uri: pharmacyLogoUri }} style={{ width: 58, height: 58, borderRadius: 8 }} resizeMode="contain" /> : <View style={{ width: 58, height: 58, borderRadius: 8, backgroundColor: theme.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}><MaterialIcons name="local-pharmacy" size={26} color={theme.colors.textTertiary} /></View>}
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={labelStyle}>رمز العملة</Text>
              <TextInput style={inputStyle} value={currencySymbol} onChangeText={setCurrencySymbol} placeholder="ر.ي" placeholderTextColor={theme.colors.textTertiary} />
            </View>
            <View style={{ flex: 2 }}>
              <Text style={labelStyle}>العملة</Text>
              <TextInput style={inputStyle} value={currency} onChangeText={setCurrency} placeholder="ريال يمني" placeholderTextColor={theme.colors.textTertiary} />
            </View>
          </View>
        </View>

        <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.textPrimary, textAlign: 'right', marginBottom: 12, borderRightWidth: 3, borderRightColor: theme.colors.primary, paddingRight: 8 }}>النص الدعائي للفواتير والتقارير</Text>
        <View style={{ backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, padding: 14, marginBottom: 14 }}>
          <Text style={labelStyle}>نص أعلى المستند (اختياري)</Text>
          <TextInput style={[inputStyle, { minHeight: 64, height: 64, marginBottom: 12, paddingTop: 10 }]} multiline value={receiptHeader} onChangeText={setReceiptHeader} placeholder="عبارة أو معلومات تظهر أعلى الفاتورة" placeholderTextColor={theme.colors.textTertiary} />
          <Text style={labelStyle}>نص أسفل المستند (اختياري)</Text>
          <TextInput style={[inputStyle, { minHeight: 76, height: 76, paddingTop: 10 }]} multiline value={receiptFooter} onChangeText={setReceiptFooter} placeholder="عبارة دعائية، أرقام التواصل أو تعليمات للعميل" placeholderTextColor={theme.colors.textTertiary} />
          <Text style={{ color: theme.colors.textTertiary, fontSize: 11, textAlign: 'right', marginTop: 7 }}>تُحفظ هذه النصوص ضمن إعدادات الجهاز. ظهورها يعتمد على قالب المستند المستخدم.</Text>
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
