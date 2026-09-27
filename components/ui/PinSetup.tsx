// Powered by OnSpace.AI — PIN Setup/Change Modal
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  Modal,
  StyleSheet,
  Platform,
  Vibration,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';

const PIN_LENGTH = 4;

type Step = 'enter_new' | 'confirm_new' | 'verify_old';

interface PinSetupProps {
  visible: boolean;
  mode: 'set' | 'change' | 'disable';
  currentPin?: string;
  onComplete: (newPin: string | null) => void;
  onCancel: () => void;
}

export function PinSetup({ visible, mode, currentPin, onComplete, onCancel }: PinSetupProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>(mode === 'change' || mode === 'disable' ? 'verify_old' : 'enter_new');
  const [newPin, setNewPin] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const shakeAnim = new Animated.Value(0);

  const reset = () => {
    setStep(mode === 'change' || mode === 'disable' ? 'verify_old' : 'enter_new');
    setNewPin('');
    setPin('');
    setError('');
  };

  const shake = useCallback(() => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  }, [shakeAnim]);

  const handlePress = useCallback((digit: string) => {
    if (pin.length >= PIN_LENGTH) return;
    const newVal = pin + digit;
    setPin(newVal);
    setError('');

    if (newVal.length === PIN_LENGTH) {
      setTimeout(() => {
        if (step === 'verify_old') {
          if (newVal === currentPin) {
            if (mode === 'disable') {
              onComplete(null);
              reset();
            } else {
              setStep('enter_new');
              setPin('');
            }
          } else {
            shake();
            if (Platform.OS !== 'web') Vibration.vibrate(300);
            setPin('');
            setError('رقم PIN الحالي غير صحيح');
          }
        } else if (step === 'enter_new') {
          setNewPin(newVal);
          setStep('confirm_new');
          setPin('');
        } else if (step === 'confirm_new') {
          if (newVal === newPin) {
            onComplete(newVal);
            reset();
          } else {
            shake();
            if (Platform.OS !== 'web') Vibration.vibrate(300);
            setPin('');
            setError('رقم PIN غير متطابق، حاول مرة أخرى');
          }
        }
      }, 200);
    }
  }, [pin, step, newPin, currentPin, mode, onComplete, shake]);

  const handleDelete = useCallback(() => {
    setPin(p => p.slice(0, -1));
    setError('');
  }, []);

  const getStepTitle = () => {
    if (step === 'verify_old') return 'أدخل رقم PIN الحالي';
    if (step === 'enter_new') return mode === 'set' ? 'أدخل رقم PIN الجديد (4 أرقام)' : 'أدخل رقم PIN الجديد';
    return 'أكد رقم PIN الجديد';
  };

  const KEYS = [
    ['١', '1'], ['٢', '2'], ['٣', '3'],
    ['٤', '4'], ['٥', '5'], ['٦', '6'],
    ['٧', '7'], ['٨', '8'], ['٩', '9'],
    ['', ''], ['٠', '0'], ['del', 'del'],
  ];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
      <View style={[styles.container, { backgroundColor: theme.colors.background, paddingBottom: insets.bottom + 16 }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: theme.colors.border, paddingTop: insets.top > 0 ? insets.top : 16 }]}>
          <TouchableOpacity onPress={() => { onCancel(); reset(); }} style={styles.cancelBtn}>
            <Text style={{ fontSize: 15, color: theme.colors.error }}>إلغاء</Text>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>إعداد PIN</Text>
          <View style={{ width: 60 }} />
        </View>

        {/* Step indicator */}
        <View style={styles.stepRow}>
          {['verify_old', 'enter_new', 'confirm_new']
            .filter(s => mode === 'set' ? s !== 'verify_old' : true)
            .map((s, i) => (
              <View
                key={s}
                style={[
                  styles.stepDot,
                  {
                    backgroundColor: step === s ? theme.colors.primary
                      : (i < ['verify_old', 'enter_new', 'confirm_new'].indexOf(step))
                        ? theme.colors.success
                        : theme.colors.border,
                  },
                ]}
              />
            ))}
        </View>

        {/* Title */}
        <Text style={[styles.title, { color: theme.colors.textPrimary }]}>{getStepTitle()}</Text>

        {/* Dots */}
        <Animated.View style={[styles.dotsRow, { transform: [{ translateX: shakeAnim }] }]}>
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                {
                  backgroundColor: i < pin.length
                    ? (error ? theme.colors.error : theme.colors.primary)
                    : theme.colors.border,
                  borderColor: i < pin.length
                    ? (error ? theme.colors.error : theme.colors.primary)
                    : theme.colors.border,
                  transform: [{ scale: i < pin.length ? 1.15 : 1 }],
                },
              ]}
            />
          ))}
        </Animated.View>

        {/* Error */}
        <View style={styles.errorContainer}>
          {error ? (
            <Text style={[styles.errorText, { color: theme.colors.error }]}>{error}</Text>
          ) : null}
        </View>

        {/* Keypad */}
        <View style={styles.keypad}>
          {[0, 1, 2, 3].map(row => (
            <View key={row} style={styles.keyRow}>
              {KEYS.slice(row * 3, row * 3 + 3).map(([arabic, value], col) => {
                if (value === '') return <View key={col} style={styles.keyEmpty} />;

                if (value === 'del') {
                  return (
                    <TouchableOpacity
                      key={col}
                      onPress={handleDelete}
                      activeOpacity={0.65}
                      style={[
                        styles.key,
                        { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
                      ]}
                    >
                      <MaterialIcons name="backspace" size={22} color={theme.colors.textSecondary} />
                    </TouchableOpacity>
                  );
                }

                return (
                  <TouchableOpacity
                    key={col}
                    onPress={() => handlePress(value)}
                    activeOpacity={0.7}
                    style={[
                      styles.key,
                      { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
                    ]}
                  >
                    <Text style={[styles.keyDigit, { color: theme.colors.textPrimary }]}>{arabic}</Text>
                    <Text style={[styles.keyDigitSub, { color: theme.colors.textTertiary }]}>{value}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
  },
  header: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  cancelBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    minWidth: 60,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  stepRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 24,
    marginBottom: 8,
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  title: {
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
    marginVertical: 16,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 20,
    marginBottom: 8,
  },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
  },
  errorContainer: {
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  errorText: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
  },
  keypad: {
    width: '100%',
    paddingHorizontal: 32,
    gap: 10,
    marginTop: 8,
  },
  keyRow: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
  },
  key: {
    flex: 1,
    height: 62,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    gap: 2,
  },
  keyEmpty: {
    flex: 1,
    height: 62,
  },
  keyDigit: {
    fontSize: 20,
    fontWeight: '600',
    lineHeight: 26,
  },
  keyDigitSub: {
    fontSize: 10,
    lineHeight: 13,
  },
});
