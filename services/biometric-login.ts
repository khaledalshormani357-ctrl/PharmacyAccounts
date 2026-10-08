import { Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

const CREDENTIALS_KEY = 'pharmacy-ai.biometric-credentials.v1';
const ENABLED_KEY = 'pharmacy-ai.biometric-login-enabled.v1';
const secureOptions = {
  requireAuthentication: true,
  authenticationPrompt: 'استخدم بصمة الجهاز للدخول إلى صيدلية الذكاء',
};

export interface BiometricCredentials {
  email: string;
  password: string;
}

export interface BiometricLoginStatus {
  available: boolean;
  enabled: boolean;
}

export async function getBiometricLoginStatus(): Promise<BiometricLoginStatus> {
  if (Platform.OS === 'web') return { available: false, enabled: false };
  try {
    const [secureAvailable, hardware, enrolled] = await Promise.all([
      SecureStore.isAvailableAsync(),
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    if (!secureAvailable || !hardware || !enrolled) return { available: false, enabled: false };
    const enabled = (await SecureStore.getItemAsync(ENABLED_KEY)) === 'true';
    return { available: true, enabled };
  } catch {
    return { available: false, enabled: false };
  }
}

export async function saveBiometricLogin(credentials: BiometricCredentials): Promise<void> {
  await SecureStore.setItemAsync(CREDENTIALS_KEY, JSON.stringify(credentials), secureOptions);
  await SecureStore.setItemAsync(ENABLED_KEY, 'true');
}

export async function getBiometricCredentials(): Promise<BiometricCredentials | null> {
  const value = await SecureStore.getItemAsync(CREDENTIALS_KEY, secureOptions);
  if (!value) return null;
  let parsed: Partial<BiometricCredentials>;
  try {
    parsed = JSON.parse(value) as Partial<BiometricCredentials>;
  } catch {
    return null;
  }
  if (typeof parsed.email !== 'string' || typeof parsed.password !== 'string' || !parsed.email || !parsed.password) return null;
  return { email: parsed.email, password: parsed.password };
}

export async function clearBiometricLogin(): Promise<void> {
  await SecureStore.deleteItemAsync(ENABLED_KEY).catch(() => undefined);
  await SecureStore.deleteItemAsync(CREDENTIALS_KEY).catch(() => undefined);
}
