// Smart Pharmacy ERP — Root Layout
import { AlertProvider } from '@/template';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { useEffect, useState, useCallback } from 'react';
import { StatusBar } from 'expo-status-bar';
import { databaseReady, getSetting } from '@/services/database';
import { PinLock } from '@/components/ui';
import { CloudAuthGate } from '@/components/CloudAuthGate';
import { AnimatedBrandSplash } from '@/components/AnimatedBrandSplash';
import * as SplashScreen from 'expo-splash-screen';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

function AppShell() {
  const [pinChecked, setPinChecked] = useState(false);
  const [pinRequired, setPinRequired] = useState(false);
  const [pinCode, setPinCode] = useState('');
  const [pharmacyName, setPharmacyName] = useState('صيدلية ذكية');
  const [showBrandSplash, setShowBrandSplash] = useState(true);
  const hideBrandSplash = useCallback(() => setShowBrandSplash(false), []);

  useEffect(() => {
    try {
      const pinEnabled = getSetting('pin_enabled');
      const storedPin = getSetting('pin_code');
      const name = getSetting('pharmacy_name');
      if (name) setPharmacyName(name);
      if (pinEnabled === 'true' && storedPin && storedPin.length === 4) {
        setPinCode(storedPin);
        setPinRequired(true);
      } else {
        setPinChecked(true);
      }
    } catch {
      setPinChecked(true);
    }
  }, []);

  const handleUnlock = useCallback(() => {
    setPinRequired(false);
    setPinChecked(true);
  }, []);

  return (
    <>
      <StatusBar style="light" />
      {pinRequired && !pinChecked ? (
        <PinLock correctPin={pinCode} onUnlock={handleUnlock} pharmacyName={pharmacyName} />
      ) : (
        <Stack screenOptions={{ headerShown: false, animation: 'slide_from_left' }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="setup" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="reset-password" options={{ headerShown: false }} />
        <Stack.Screen name="pos" options={{ headerShown: false }} />
        <Stack.Screen name="add-product" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="product-detail" options={{ headerShown: false }} />
        <Stack.Screen name="inventory" options={{ headerShown: false }} />
        <Stack.Screen name="add-sale" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="add-expense" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="add-purchase" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="add-customer" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="add-supplier" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="customers" options={{ headerShown: false }} />
        <Stack.Screen name="customer-detail" options={{ headerShown: false }} />
        <Stack.Screen name="suppliers" options={{ headerShown: false }} />
        <Stack.Screen name="supplier-detail" options={{ headerShown: false }} />
        <Stack.Screen name="expenses" options={{ headerShown: false }} />
        <Stack.Screen name="cashbox" options={{ headerShown: false }} />
        <Stack.Screen name="shifts" options={{ headerShown: false }} />
        <Stack.Screen name="expiry-radar" options={{ headerShown: false }} />
        <Stack.Screen name="dead-stock" options={{ headerShown: false }} />
        <Stack.Screen name="reorder" options={{ headerShown: false }} />
        <Stack.Screen name="abc-analysis" options={{ headerShown: false }} />
        <Stack.Screen name="audit-log" options={{ headerShown: false }} />
        <Stack.Screen name="backup" options={{ headerShown: false }} />
        <Stack.Screen name="assistant" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ headerShown: false }} />
        <Stack.Screen name="users" options={{ headerShown: false }} />
        <Stack.Screen name="sale-detail" options={{ headerShown: false }} />
        <Stack.Screen name="purchase-detail" options={{ headerShown: false }} />
        <Stack.Screen name="returns" options={{ headerShown: false }} />
        <Stack.Screen name="new-return" options={{ headerShown: false }} />
        <Stack.Screen name="return-detail" options={{ headerShown: false }} />
        </Stack>
      )}
      {showBrandSplash && <AnimatedBrandSplash onFinish={hideBrandSplash} />}
    </>
  );
}

export default function RootLayout() {
  const [storageReady, setStorageReady] = useState(false);

  useEffect(() => {
    databaseReady.finally(() => setStorageReady(true));
  }, []);

  if (!storageReady) return null;

  return (
    <AlertProvider>
      <CloudAuthGate>
        <SafeAreaProvider>
      <ThemeProvider>
            <AppShell />
          </ThemeProvider>
        </SafeAreaProvider>
      </CloudAuthGate>
    </AlertProvider>
  );
}
