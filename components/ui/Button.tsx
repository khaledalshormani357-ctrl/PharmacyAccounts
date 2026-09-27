// Smart Pharmacy ERP — Button Component
import React from 'react';
import { TouchableOpacity, Text, ViewStyle, TextStyle, View } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  icon?: React.ReactNode;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
}

export default function Button({ title, onPress, variant = 'primary', icon, disabled, fullWidth, style }: ButtonProps) {
  const { theme } = useTheme();

  const bgColor = variant === 'primary' ? theme.colors.primary
    : variant === 'secondary' ? theme.colors.secondary
    : variant === 'outline' ? 'transparent'
    : 'transparent';

  const textColor = (variant === 'outline' || variant === 'ghost') ? theme.colors.primary : '#FFFFFF';

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.75}
      style={[{
        height: 48,
        borderRadius: 10,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingHorizontal: 16,
        backgroundColor: bgColor,
        borderWidth: variant === 'outline' ? 1.5 : 0,
        borderColor: theme.colors.primary,
        opacity: disabled ? 0.5 : 1,
        alignSelf: fullWidth ? undefined : 'flex-start',
        width: fullWidth ? '100%' : undefined,
      }, style]}
    >
      {icon}
      <Text style={{ fontSize: 14, fontWeight: '600', color: textColor }}>{title}</Text>
    </TouchableOpacity>
  );
}
