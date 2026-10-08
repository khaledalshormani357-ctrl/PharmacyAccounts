import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getSharedSupabaseClient } from '@/template/core/client';
import { useAuth } from '@/template';
import { clearBiometricLogin, getBiometricCredentials, getBiometricLoginStatus, saveBiometricLogin } from '@/services/biometric-login';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type BusyAction = 'login' | 'biometric' | 'forgot' | null;

function friendlyAuthError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes('invalid login credentials')) return 'البريد الإلكتروني أو كلمة المرور غير صحيحة.';
  if (normalized.includes('email not confirmed')) return 'يرجى تأكيد البريد الإلكتروني أولًا من رسالة التفعيل.';
  if (normalized.includes('network') || normalized.includes('timeout') || normalized.includes('fetch')) return 'تعذر الاتصال بالخادم. تحقق من الإنترنت ثم أعد المحاولة.';
  if (normalized.includes('too many requests')) return 'تجاوزت عدد المحاولات المسموح. انتظر قليلًا ثم أعد المحاولة.';
  return 'تعذر تسجيل الدخول. تحقق من البيانات أو حاول مرة أخرى.';
}

export default function LoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signInWithPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [enableBiometricAfterLogin, setEnableBiometricAfterLogin] = useState(false);
  const [helpVisible, setHelpVisible] = useState(false);

  useEffect(() => {
    let mounted = true;
    void getBiometricLoginStatus().then(status => {
      if (!mounted) return;
      setBiometricAvailable(status.available);
      setBiometricEnabled(status.enabled);
      setEnableBiometricAfterLogin(status.enabled);
    });
    return () => { mounted = false; };
  }, []);

  const validateEmail = () => {
    const value = email.trim();
    if (!emailPattern.test(value)) {
      setError('أدخل البريد الإلكتروني المرتبط بحسابك بصيغة صحيحة.');
      setNotice('');
      return null;
    }
    return value;
  };

  const finishSignIn = async (loginEmail: string, loginPassword: string, fromBiometric = false) => {
    const result = await signInWithPassword(loginEmail, loginPassword);
    if (result.error) {
      setError(friendlyAuthError(result.error));
      setNotice('');
      if (fromBiometric) {
        await clearBiometricLogin();
        setBiometricEnabled(false);
        setEnableBiometricAfterLogin(false);
      }
      return false;
    }

    if (!fromBiometric && enableBiometricAfterLogin && biometricAvailable) {
      try {
        await saveBiometricLogin({ email: loginEmail, password: loginPassword });
        setBiometricEnabled(true);
      } catch {
        await clearBiometricLogin();
        setBiometricEnabled(false);
        setNotice('تم تسجيل الدخول، لكن تعذر تفعيل الدخول بالبصمة على هذا الجهاز. يمكنك المحاولة لاحقًا.');
      }
    } else if (!fromBiometric && biometricEnabled) {
      await clearBiometricLogin();
      setBiometricEnabled(false);
    }

    router.replace('/(tabs)');
    return true;
  };

  const handleLogin = async () => {
    const loginEmail = validateEmail();
    if (!loginEmail) return;
    if (!password) {
      setError('أدخل كلمة المرور.');
      setNotice('');
      return;
    }
    setBusy('login');
    setError('');
    setNotice('');
    try {
      await finishSignIn(loginEmail, password);
    } catch {
      setError('تعذر الاتصال بالخادم. تحقق من الإنترنت والبيانات ثم أعد المحاولة.');
    } finally {
      setBusy(null);
    }
  };

  const handleBiometricLogin = async () => {
    setError('');
    setNotice('');
    if (!biometricAvailable) {
      setError('الدخول بالبصمة غير مدعوم أو لم تُسجّل بصمة/وسيلة حيوية على هذا الجهاز.');
      return;
    }
    if (!biometricEnabled) {
      setError('سجّل الدخول بالبريد وكلمة المرور أولًا، ثم فعّل خيار الدخول بالبصمة على هذا الجهاز.');
      return;
    }
    setBusy('biometric');
    try {
      const credentials = await getBiometricCredentials();
      if (!credentials) {
        await clearBiometricLogin();
        setBiometricEnabled(false);
        setEnableBiometricAfterLogin(false);
        setError('بيانات الدخول بالبصمة غير متاحة. سجّل الدخول يدويًا وفعّلها من جديد.');
        return;
      }
      setEmail(credentials.email);
      await finishSignIn(credentials.email, credentials.password, true);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message.toLowerCase() : '';
      setError(message.includes('cancel') ? 'تم إلغاء التحقق بالبصمة.' : 'تعذر التحقق بالبصمة. جرّب الدخول بكلمة المرور.');
    } finally {
      setBusy(null);
    }
  };

  const handleForgotPassword = async () => {
    const recoveryEmail = validateEmail();
    if (!recoveryEmail) return;
    setBusy('forgot');
    setError('');
    setNotice('');
    try {
      const redirectTo = Linking.createURL('reset-password');
      const { error: resetError } = await getSharedSupabaseClient().auth.resetPasswordForEmail(recoveryEmail, { redirectTo });
      if (resetError) throw resetError;
      setNotice('إذا كان البريد مسجلًا، فستصلك رسالة تحتوي على رابط آمن لإعادة تعيين كلمة المرور.');
    } catch {
      setError('تعذر إرسال رابط الاستعادة الآن. تحقق من الاتصال وحاول مجددًا.');
    } finally {
      setBusy(null);
    }
  };

  const isBusy = busy !== null;

  return (
    <View style={{ flex: 1, backgroundColor: '#F3F6FA' }}>
      <StatusBar style="dark" backgroundColor="#F3F6FA" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 22, paddingTop: Math.max(20, insets.top + 10), paddingBottom: Math.max(100, insets.bottom + 90) }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={{ width: '100%', maxWidth: 470, alignSelf: 'center', backgroundColor: '#FFFFFF', borderRadius: 30, paddingHorizontal: 24, paddingTop: 32, paddingBottom: 28, borderWidth: 1, borderColor: 'rgba(19,55,98,0.05)', shadowColor: '#17345C', shadowOffset: { width: 0, height: 14 }, shadowOpacity: 0.11, shadowRadius: 30, elevation: 7 }}>
            <View style={{ alignItems: 'center', marginBottom: 28 }}>
              <View style={{ width: 104, height: 104, borderRadius: 52, backgroundColor: '#EAF2FF', alignItems: 'center', justifyContent: 'center', marginBottom: 18, borderWidth: 1, borderColor: '#DCE9FF' }}>
                <Image source={require('../assets/images/pharmacy-ai-mark.png')} resizeMode="contain" style={{ width: 80, height: 80 }} accessibilityLabel="شعار صيدلية الذكاء" />
              </View>
              <Text style={{ color: '#17437F', fontSize: 29, fontWeight: '800', textAlign: 'center' }}>تسجيل الدخول</Text>
              <Text style={{ color: '#7A8492', fontSize: 15, lineHeight: 23, textAlign: 'center', marginTop: 8 }}>
                أدخل بيانات حسابك للوصول إلى نظام{ '\n' }صيدلية الذكاء
              </Text>
            </View>

            <Text style={styles.fieldLabel}>البريد الإلكتروني</Text>
            <View style={styles.field}>
              <MaterialIcons name="person-outline" size={23} color="#7B8796" />
              <TextInput
                value={email}
                onChangeText={value => { setEmail(value); setError(''); setNotice(''); }}
                placeholder="name@example.com"
                placeholderTextColor="#9AA4B2"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                returnKeyType="next"
                accessibilityLabel="البريد الإلكتروني"
                style={styles.textInput}
              />
            </View>

            <Text style={[styles.fieldLabel, { marginTop: 14 }]}>كلمة المرور</Text>
            <View style={styles.field}>
              <MaterialIcons name="lock-outline" size={23} color="#7B8796" />
              <TextInput
                value={password}
                onChangeText={value => { setPassword(value); setError(''); }}
                placeholder="كلمة المرور"
                placeholderTextColor="#9AA4B2"
                secureTextEntry={!passwordVisible}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="current-password"
                textContentType="password"
                returnKeyType="go"
                onSubmitEditing={handleLogin}
                accessibilityLabel="كلمة المرور"
                style={styles.textInput}
              />
              <TouchableOpacity onPress={() => setPasswordVisible(value => !value)} accessibilityRole="button" accessibilityLabel={passwordVisible ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'} hitSlop={8}>
                <MaterialIcons name={passwordVisible ? 'visibility-off' : 'visibility'} size={23} color="#7B8796" />
              </TouchableOpacity>
            </View>

            <TouchableOpacity onPress={handleForgotPassword} disabled={isBusy} accessibilityRole="button" style={{ alignSelf: 'flex-start', paddingVertical: 12, opacity: isBusy ? 0.6 : 1 }}>
              {busy === 'forgot' ? <ActivityIndicator size="small" color="#1E6FD8" /> : <Text style={{ color: '#246FC6', fontSize: 15, fontWeight: '700' }}>نسيت كلمة المرور؟</Text>}
            </TouchableOpacity>

            {!!error && (
              <View accessibilityRole="alert" style={styles.messageBox}>
                <MaterialIcons name="error-outline" size={19} color="#C43D4B" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}
            {!!notice && (
              <View accessibilityRole="summary" style={[styles.messageBox, { backgroundColor: '#EFFAF4', borderColor: '#C7EED6' }]}>
                <MaterialIcons name="check-circle-outline" size={19} color="#2D8A5B" />
                <Text style={[styles.errorText, { color: '#28734E' }]}>{notice}</Text>
              </View>
            )}

            {biometricAvailable && (
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginTop: 3, marginBottom: 15, paddingHorizontal: 2 }}>
                <View style={{ flex: 1, flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
                  <MaterialIcons name="fingerprint" size={21} color="#4177B9" />
                  <Text style={{ color: '#526174', fontSize: 13, textAlign: 'right', flexShrink: 1 }}>تفعيل الدخول بالبصمة على هذا الجهاز</Text>
                </View>
                <Switch
                  value={enableBiometricAfterLogin}
                  onValueChange={setEnableBiometricAfterLogin}
                  trackColor={{ false: '#D4DBE5', true: '#9BC0F5' }}
                  thumbColor={enableBiometricAfterLogin ? '#2476E8' : '#F5F7FA'}
                  accessibilityLabel="تفعيل الدخول بالبصمة"
                />
              </View>
            )}

            <TouchableOpacity onPress={handleLogin} disabled={isBusy} accessibilityRole="button" style={[styles.primaryButton, { opacity: isBusy ? 0.75 : 1 }]}>
              {busy === 'login' ? <ActivityIndicator color="#FFFFFF" /> : (
                <>
                  <MaterialIcons name="login" size={22} color="#FFFFFF" />
                  <Text style={styles.primaryButtonText}>دخول للنظام</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={handleBiometricLogin} disabled={isBusy} accessibilityRole="button" style={[styles.biometricButton, { opacity: isBusy ? 0.65 : 1 }]}>
              {busy === 'biometric' ? <ActivityIndicator color="#246FC6" /> : (
                <>
                  <MaterialIcons name="fingerprint" size={25} color="#246FC6" />
                  <Text style={styles.biometricButtonText}>الدخول بالبصمة</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <TouchableOpacity
        onPress={() => setHelpVisible(true)}
        accessibilityRole="button"
        accessibilityLabel="مساعدة تسجيل الدخول"
        style={{ position: 'absolute', left: 20, bottom: Math.max(20, insets.bottom + 12), width: 58, height: 58, borderRadius: 19, backgroundColor: '#2476E8', alignItems: 'center', justifyContent: 'center', shadowColor: '#155DC0', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 8 }}
      >
        <MaterialIcons name="smart-toy" size={29} color="#FFFFFF" />
      </TouchableOpacity>

      <Modal visible={helpVisible} transparent animationType="fade" onRequestClose={() => setHelpVisible(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(11,24,43,0.42)', justifyContent: 'flex-end', padding: 16 }}>
          <View style={{ width: '100%', maxWidth: 500, alignSelf: 'center', backgroundColor: '#FFFFFF', borderRadius: 24, padding: 22, marginBottom: Math.max(10, insets.bottom) }}>
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 40, height: 40, borderRadius: 14, backgroundColor: '#EAF2FF', alignItems: 'center', justifyContent: 'center' }}>
                  <MaterialIcons name="support-agent" size={23} color="#2476E8" />
                </View>
                <Text style={{ color: '#17437F', fontSize: 18, fontWeight: '800' }}>مساعدة تسجيل الدخول</Text>
              </View>
              <TouchableOpacity onPress={() => setHelpVisible(false)} accessibilityLabel="إغلاق المساعدة">
                <MaterialIcons name="close" size={22} color="#7B8796" />
              </TouchableOpacity>
            </View>
            <Text style={{ color: '#596779', fontSize: 14, lineHeight: 23, textAlign: 'right' }}>
              استخدم البريد الإلكتروني المسجل لدى مسؤول النظام. إذا نسيت كلمة المرور، أدخل بريدك ثم اضغط «نسيت كلمة المرور؟». للدخول بالبصمة، سجّل الدخول مرة واحدة وفعّل الخيار على هذا الجهاز.
            </Text>
            <TouchableOpacity onPress={() => setHelpVisible(false)} style={{ marginTop: 18, height: 48, borderRadius: 14, backgroundColor: '#2476E8', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 15 }}>حسنًا</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = {
  fieldLabel: {
    color: '#687789',
    fontSize: 13,
    fontWeight: '700' as const,
    textAlign: 'right' as const,
    marginBottom: 7,
    paddingHorizontal: 2,
  },
  field: {
    minHeight: 58,
    flexDirection: 'row-reverse' as const,
    alignItems: 'center' as const,
    gap: 11,
    backgroundColor: '#F9FBFD',
    borderWidth: 1.3,
    borderColor: '#DCE3EC',
    borderRadius: 16,
    paddingHorizontal: 15,
  },
  textInput: {
    flex: 1,
    minHeight: 56,
    color: '#25374D',
    fontSize: 16,
    textAlign: 'right' as const,
    writingDirection: 'rtl' as const,
    paddingVertical: 0,
  },
  messageBox: {
    flexDirection: 'row-reverse' as const,
    alignItems: 'flex-start' as const,
    gap: 8,
    padding: 11,
    borderRadius: 12,
    backgroundColor: '#FFF1F1',
    borderWidth: 1,
    borderColor: '#F3D1D4',
    marginBottom: 12,
  },
  errorText: {
    flex: 1,
    color: '#B83340',
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'right' as const,
  },
  primaryButton: {
    minHeight: 58,
    backgroundColor: '#2476E8',
    borderRadius: 16,
    flexDirection: 'row-reverse' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 10,
    shadowColor: '#1764CB',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 9,
    elevation: 3,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800' as const,
  },
  biometricButton: {
    minHeight: 56,
    marginTop: 12,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#3279D3',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row-reverse' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 9,
  },
  biometricButtonText: {
    color: '#246FC6',
    fontSize: 15,
    fontWeight: '700' as const,
  },
};
