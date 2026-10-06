import React, { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from '@/template';

export default function LoginScreen() {
  const router = useRouter();
  const { signInWithPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      setError('أدخل البريد الإلكتروني وكلمة المرور');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await signInWithPassword(email.trim(), password);
      if (result.error) setError(result.error);
      else router.replace('/(tabs)');
    } catch {
      setError('تعذر الاتصال بالخادم، تحقق من الإنترنت والبيانات');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#00875A' }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <StatusBar style="light" />
      <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
        <View style={{ alignItems: 'center', marginBottom: 32 }}>
          <View style={{ width: 76, height: 76, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <Text style={{ fontSize: 38 }}>✚</Text>
          </View>
          <Text style={{ color: '#FFFFFF', fontSize: 28, fontWeight: '800' }}>Pharmacy Accounts</Text>
          <Text style={{ color: 'rgba(255,255,255,0.82)', fontSize: 14, marginTop: 6 }}>إدارة الصيدلية بوضوح وأمان</Text>
        </View>
        <View style={{ backgroundColor: '#FFFFFF', borderRadius: 20, padding: 20 }}>
          <Text style={{ color: '#172B4D', fontSize: 20, fontWeight: '800', textAlign: 'right', marginBottom: 18 }}>تسجيل الدخول</Text>
          <Text style={{ color: '#5E6C84', fontSize: 13, textAlign: 'right', marginBottom: 6 }}>البريد الإلكتروني</Text>
          <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="admin@example.com" placeholderTextColor="#9CA3AF" style={{ height: 50, borderWidth: 1, borderColor: '#DFE1E6', borderRadius: 10, paddingHorizontal: 14, textAlign: 'left', color: '#172B4D', marginBottom: 14 }} />
          <Text style={{ color: '#5E6C84', fontSize: 13, textAlign: 'right', marginBottom: 6 }}>كلمة المرور</Text>
          <TextInput value={password} onChangeText={setPassword} secureTextEntry placeholder="كلمة المرور" placeholderTextColor="#9CA3AF" style={{ height: 50, borderWidth: 1, borderColor: '#DFE1E6', borderRadius: 10, paddingHorizontal: 14, textAlign: 'left', color: '#172B4D', marginBottom: 14 }} />
          {!!error && <Text style={{ color: '#DE350B', textAlign: 'right', fontSize: 13, marginBottom: 12 }}>{error}</Text>}
          <TouchableOpacity onPress={handleLogin} disabled={loading} style={{ height: 52, borderRadius: 11, backgroundColor: '#00875A', alignItems: 'center', justifyContent: 'center', opacity: loading ? 0.7 : 1 }}>
            {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '800' }}>دخول</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
