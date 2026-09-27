// Smart Pharmacy ERP — KpiCard Component
import React from 'react';
import { View, Text } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import { formatCurrency } from '@/constants/i18n';

interface KpiCardProps {
  label: string;
  value: number;
  icon: any;
  color: string;
  bgColor?: string;
}

export default function KpiCard({ label, value, icon, color, bgColor }: KpiCardProps) {
  const { theme } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: bgColor || theme.colors.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: theme.colors.border }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: color + '18', alignItems: 'center', justifyContent: 'center' }}>
          <MaterialIcons name={icon} size={16} color={color} />
        </View>
        <Text style={{ fontSize: 16, fontWeight: '800', color, textAlign: 'right' }} numberOfLines={1}>{formatCurrency(value)}</Text>
      </View>
      <Text style={{ fontSize: 11, fontWeight: '500', color: theme.colors.textTertiary, textAlign: 'right', marginTop: 6 }}>{label}</Text>
    </View>
  );
}
