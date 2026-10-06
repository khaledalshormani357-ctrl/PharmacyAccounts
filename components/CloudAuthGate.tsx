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
  const onLogin = segments[0] === 'login';

  useEffect(() => {
    if (!initialized || loading) return;
    if (!user && !onLogin) router.replace('/login');
    if (user && onLogin) router.replace('/(tabs)');
  }, [initialized, loading, user, onLogin, router]);

  if (!initialized || loading || (!user && !onLogin)) {
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
