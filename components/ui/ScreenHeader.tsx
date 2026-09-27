// Smart Pharmacy ERP — ScreenHeader Component
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';

interface ScreenHeaderProps {
  title: string;
  onBack?: () => void;
  rightAction?: React.ReactNode;
  backgroundColor?: string;
}

export default function ScreenHeader({ title, onBack, rightAction, backgroundColor }: ScreenHeaderProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ backgroundColor: backgroundColor || theme.colors.primary, paddingTop: insets.top + 10, paddingBottom: 14, paddingHorizontal: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <View style={{ minWidth: 40 }}>
        {rightAction}
      </View>
      <Text style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF' }}>{title}</Text>
      {onBack ? (
        <TouchableOpacity onPress={onBack} style={{ width: 36, height: 36, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
          <MaterialIcons name="arrow-forward" size={20} color="#FFFFFF" />
        </TouchableOpacity>
      ) : <View style={{ width: 36 }} />}
    </View>
  );
}
