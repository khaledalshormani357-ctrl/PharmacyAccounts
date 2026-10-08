import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getSharedSupabaseClient } from '@/template/core/client';
import { clearBiometricLogin } from '@/services/biometric-login';

function singleParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default function ResetPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string | string[]; token_hash?: string | string[]; type?: string | string[] }>();
  const [checking, setChecking] = useState(true);
  const [canChangePassword, setCanChangePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const exchanged = useRef(false);

  const establishRecoverySession = useCallback(async (rawUrl?: string | null) => {
    if (exchanged.current) return;
    const parsed = rawUrl ? Linking.parse(rawUrl) : null;
    const codeFromUrl = parsed?.queryParams?.code;
    const tokenFromUrl = parsed?.queryParams?.token_hash;
    const typeFromUrl = parsed?.queryParams?.type;
    const code = singleParam(params.code) ?? (Array.isArray(codeFromUrl) ? codeFromUrl[0] : codeFromUrl);
    const tokenHash = singleParam(params.token_hash) ?? (Array.isArray(tokenFromUrl) ? tokenFromUrl[0] : tokenFromUrl);
    const tokenType = singleParam(params.type) ?? (Array.isArray(typeFromUrl) ? typeFromUrl[0] : typeFromUrl);

    try {
      const client = getSharedSupabaseClient();
      if (code) {
        exchanged.current = true;
        const { error } = await client.auth.exchangeCodeForSession(String(code));
        if (error) throw error;
      } else if (tokenHash && tokenType === 'recovery') {
        exchanged.current = true;
        const { error } = await client.auth.verifyOtp({ token_hash: String(tokenHash), type: 'recovery' });
        if (error) throw error;
      }

      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      if (!data.session) {
        setMessage('رابط الاستعادة غير صالح أو انتهت صلاحيته. اطلب رابطًا جديدًا من شاشة تسجيل الدخول.');
        setCanChangePassword(false);
      } else {
        setCanChangePassword(true);
        setMessage('أنشئ كلمة مرور جديدة لحسابك.');
      }
    } catch (error) {
      exchanged.current = true;
      setMessage(error instanceof Error && error.message.toLowerCase().includes('expired')
        ? 'انتهت صلاحية رابط الاستعادة. اطلب رابطًا جديدًا.'
        : 'تعذر التحقق من رابط الاستعادة. افتح أحدث رسالة وصلتك أو اطلب رابطًا جديدًا.');
      setCanChangePassword(false);
    } finally {
      setChecking(false);
    }
  }, [params.code, params.token_hash, params.type]);

  useEffect(() => {
    let active = true;
    const processUrl = async (url?: string | null) => {
      if (!active) return;
      await establishRecoverySession(url);
    };
    const subscription = Linking.addEventListener('url', event => { void processUrl(event.url); });
    void Linking.getInitialURL().then(processUrl).catch(() => processUrl(null));
    return () => {
      active = false;
      subscription.remove();
    };
  }, [establishRecoverySession]);

  const handleUpdatePassword = async () => {
    if (password.length < 8) {
      setMessage('استخدم كلمة مرور من 8 أحرف على الأقل.');
      return;
    }
    if (password !== confirmPassword) {
      setMessage('كلمتا المرور غير متطابقتين.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const { error } = await getSharedSupabaseClient().auth.updateUser({ password });
      if (error) throw error;
      await clearBiometricLogin();
      router.replace('/(tabs)');
    } catch {
      setMessage('تعذر تحديث كلمة المرور. أعد فتح رابط الاستعادة أو اطلب رابطًا جديدًا.');
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = {
    height: 56,
    borderWidth: 1,
    borderColor: '#D9E2EF',
    borderRadius: 15,
    paddingHorizontal: 16,
    textAlign: 'right' as const,
    color: '#172B4D',
    backgroundColor: '#F9FBFE',
    fontSize: 16,
    marginBottom: 14,
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#F3F6FA' }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignSelf: 'center', width: '100%', maxWidth: 480, backgroundColor: '#FFFFFF', borderRadius: 28, padding: 26, shadowColor: '#17345C', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.1, shadowRadius: 26, elevation: 6 }}>
          <View style={{ width: 72, height: 72, borderRadius: 24, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', backgroundColor: '#EAF2FF', marginBottom: 18 }}>
            <MaterialIcons name="lock-reset" size={36} color="#2476E8" />
          </View>
          <Text style={{ color: '#17437F', fontSize: 26, fontWeight: '800', textAlign: 'center' }}>إعادة تعيين كلمة المرور</Text>
          <Text style={{ color: '#778394', fontSize: 14, lineHeight: 22, textAlign: 'center', marginTop: 8, marginBottom: 24 }}>
            {checking ? 'جارٍ التحقق من رابط الاستعادة…' : message}
          </Text>
          {checking ? (
            <ActivityIndicator color="#2476E8" size="large" />
          ) : canChangePassword ? (
            <>
              <TextInput value={password} onChangeText={setPassword} placeholder="كلمة المرور الجديدة" placeholderTextColor="#929EAD" secureTextEntry={!showPassword} autoCapitalize="none" textContentType="newPassword" style={inputStyle} />
              <View style={{ position: 'relative', justifyContent: 'center' }}>
                <TextInput value={confirmPassword} onChangeText={setConfirmPassword} placeholder="تأكيد كلمة المرور" placeholderTextColor="#929EAD" secureTextEntry={!showPassword} autoCapitalize="none" textContentType="newPassword" style={inputStyle} />
                <TouchableOpacity onPress={() => setShowPassword(value => !value)} accessibilityRole="button" accessibilityLabel={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'} style={{ position: 'absolute', left: 14, top: 16 }}>
                  <MaterialIcons name={showPassword ? 'visibility-off' : 'visibility'} size={22} color="#7D8998" />
                </TouchableOpacity>
              </View>
              <TouchableOpacity onPress={handleUpdatePassword} disabled={busy} style={{ height: 56, borderRadius: 15, backgroundColor: '#2476E8', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, opacity: busy ? 0.7 : 1 }}>
                {busy ? <ActivityIndicator color="#FFFFFF" /> : <MaterialIcons name="check-circle-outline" size={22} color="#FFFFFF" />}
                {!busy && <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '800' }}>حفظ كلمة المرور الجديدة</Text>}
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity onPress={() => router.replace('/login' as never)} style={{ height: 54, borderRadius: 15, borderWidth: 1.5, borderColor: '#2476E8', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#2476E8', fontSize: 15, fontWeight: '700' }}>العودة إلى تسجيل الدخول</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
