// Smart Pharmacy ERP — Input Component
import React from 'react';
import { TextInput, View, Text, TextInputProps, ViewStyle } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  containerStyle?: ViewStyle;
}

export default function Input({ label, error, containerStyle, ...props }: InputProps) {
  const { theme } = useTheme();
  return (
    <View style={containerStyle}>
      {label ? <Text style={{ fontSize: 12, fontWeight: '600', color: theme.colors.textSecondary, textAlign: 'right', marginBottom: 6 }}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={theme.colors.textTertiary}
        {...props}
        style={[{
          height: 48,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: error ? theme.colors.error : theme.colors.border,
          paddingHorizontal: 12,
          fontSize: 14,
          textAlign: 'right',
          backgroundColor: theme.colors.surface,
          color: theme.colors.textPrimary,
        }, props.style]}
      />
      {error ? <Text style={{ fontSize: 11, color: theme.colors.error, textAlign: 'right', marginTop: 4 }}>{error}</Text> : null}
    </View>
  );
}
