import React, { ReactNode, useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useRouter, useSegments } from 'expo-router';
import { AuthProvider, useAuth } from '@/template';

const supabaseConfigured = Boolean(
  process.env.EXPO_PUBLIC_SUPABASE_URL && process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
);

function CloudAuthContent({ children }: { children: ReactNode }) {
  const { user, loading, initialized } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const firstSegment = segments[0] as string | undefined;
  const onLogin = firstSegment === 'login';
  const onPasswordReset = firstSegment === 'reset-password';

  useEffect(() => {
    if (!initialized || loading) return;
    if (!user && !onLogin && !onPasswordReset) router.replace('/login' as never);
    if (user && onLogin) router.replace('/(tabs)');
  }, [initialized, loading, user, onLogin, onPasswordReset, router]);

  if (!initialized || loading || (!user && !onLogin && !onPasswordReset)) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F4F5F7' }}>
        <ActivityIndicator size="large" color="#00875A" />
      </View>
    );
  }

  return <>{children}</>;
}

export function CloudAuthGate({ children }: { children: ReactNode }) {
  if (!supabaseConfigured) return <>{children}</>;
  return (
    <AuthProvider>
      <CloudAuthContent>{children}</CloudAuthContent>
    </AuthProvider>
  );
}
