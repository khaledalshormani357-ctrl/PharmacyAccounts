// Smart Pharmacy ERP — EmptyState Component
import React from 'react';
import { View, Text } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';

interface EmptyStateProps {
  icon: any;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export default function EmptyState({ icon, title, subtitle, action }: EmptyStateProps) {
  const { theme } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 40, paddingHorizontal: 24 }}>
      <MaterialIcons name={icon} size={48} color={theme.colors.textTertiary} />
      <Text style={{ fontSize: 15, fontWeight: '600', color: theme.colors.textSecondary, marginTop: 14, textAlign: 'center' }}>{title}</Text>
      {subtitle ? <Text style={{ fontSize: 13, color: theme.colors.textTertiary, marginTop: 6, textAlign: 'center' }}>{subtitle}</Text> : null}
      {action ? <View style={{ marginTop: 16 }}>{action}</View> : null}
    </View>
  );
}
