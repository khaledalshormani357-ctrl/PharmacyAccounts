import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter, useSegments } from 'expo-router';
import { useTheme } from '@/contexts/ThemeContext';

export function AssistantFloatingButton() {
  const router = useRouter();
  const segments = useSegments();
  const { theme } = useTheme();
  const current = String(segments[segments.length - 1] || '');
  if (['assistant', 'login', 'setup', 'reset-password'].includes(current)) return null;
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel="فتح المساعد الذكي للصيدلي"
      onPress={() => router.push('/assistant' as any)}
      style={{ position: 'absolute', right: 15, bottom: 88, zIndex: 1000, elevation: 12, minWidth: 54, height: 54, borderRadius: 27, paddingHorizontal: 13, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, shadowColor: '#000000', shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } }}
    >
      <MaterialIcons name="psychology" size={24} color="#FFFFFF" />
      <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 11 }}>المساعد</Text>
    </TouchableOpacity>
  );
}
