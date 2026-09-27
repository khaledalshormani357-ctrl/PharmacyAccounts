// Powered by OnSpace.AI — PIN Lock Screen
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Vibration,
  Animated,
  StyleSheet,
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { AR } from '@/constants/i18n';

const PIN_LENGTH = 4;
const MAX_ATTEMPTS = 5;

interface PinLockProps {
  correctPin: string;
  onUnlock: () => void;
  pharmacyName?: string;
}

export function PinLock({ correctPin, onUnlock, pharmacyName }: PinLockProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [pin, setPin] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [error, setError] = useState('');
  const [locked, setLocked] = useState(false);
  const [lockTimer, setLockTimer] = useState(0);
  const shakeAnim = new Animated.Value(0);

  // Countdown timer when locked out
  useEffect(() => {
    if (locked && lockTimer > 0) {
      const interval = setInterval(() => {
        setLockTimer(t => {
          if (t <= 1) {
            clearInterval(interval);
            setLocked(false);
            setAttempts(0);
            setError('');
            return 0;
          }
          return t - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [locked, lockTimer]);

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
    if (locked) return;
    if (pin.length >= PIN_LENGTH) return;
    const newPin = pin + digit;
    setPin(newPin);
    setError('');

    if (newPin.length === PIN_LENGTH) {
      setTimeout(() => {
        if (newPin === correctPin) {
          onUnlock();
        } else {
          const newAttempts = attempts + 1;
          setAttempts(newAttempts);
          setPin('');
          shake();
          if (Platform.OS !== 'web') Vibration.vibrate(300);

          if (newAttempts >= MAX_ATTEMPTS) {
            setLocked(true);
            setLockTimer(30);
            setError('تم قفل التطبيق لمدة 30 ثانية');
          } else {
            setError(`رقم PIN غير صحيح — ${MAX_ATTEMPTS - newAttempts} محاولة متبقية`);
          }
        }
      }, 200);
    }
  }, [pin, locked, attempts, correctPin, onUnlock, shake]);

  const handleDelete = useCallback(() => {
    if (locked) return;
    setPin(p => p.slice(0, -1));
    setError('');
  }, [locked]);

  const KEYS = [
    ['١', '1'], ['٢', '2'], ['٣', '3'],
    ['٤', '4'], ['٥', '5'], ['٦', '6'],
    ['٧', '7'], ['٨', '8'], ['٩', '9'],
    ['', ''], ['٠', '0'], ['del', 'del'],
  ];

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* Top branding */}
      <View style={[styles.header, { paddingTop: insets.top + 32 }]}>
        <View style={[styles.iconContainer, { backgroundColor: theme.colors.primaryLight }]}>
          <MaterialIcons name="local-pharmacy" size={36} color={theme.colors.primary} />
        </View>
        <Text style={[styles.appName, { color: theme.colors.textPrimary }]}>
          {pharmacyName || AR.appName}
        </Text>
        <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
          {locked ? `مقفل — انتظر ${lockTimer} ثانية` : 'أدخل رقم PIN'}
        </Text>
      </View>

      {/* PIN dots */}
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

      {/* Error message */}
      <View style={styles.errorContainer}>
        {error ? (
          <Text style={[styles.errorText, { color: theme.colors.error }]}>{error}</Text>
        ) : null}
      </View>

      {/* Keypad */}
      <View style={[styles.keypad, { paddingBottom: insets.bottom + 24 }]}>
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
                      styles.keyAction,
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
                  disabled={locked}
                  style={[
                    styles.key,
                    {
                      backgroundColor: locked ? theme.colors.surfaceAlt : theme.colors.surface,
                      borderColor: theme.colors.border,
                      opacity: locked ? 0.5 : 1,
                    },
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
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  header: {
    alignItems: 'center',
    gap: 12,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  appName: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    marginTop: 4,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 20,
    marginTop: 8,
  },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
  },
  errorContainer: {
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
  },
  keypad: {
    width: '100%',
    paddingHorizontal: 32,
    gap: 12,
  },
  keyRow: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
  },
  key: {
    flex: 1,
    height: 68,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    gap: 2,
  },
  keyAction: {
    flex: 1,
    height: 68,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  keyEmpty: {
    flex: 1,
    height: 68,
  },
  keyDigit: {
    fontSize: 22,
    fontWeight: '600',
    lineHeight: 28,
  },
  keyDigitSub: {
    fontSize: 11,
    lineHeight: 14,
  },
});
