// Smart Pharmacy ERP — Root Layout
import { AlertProvider } from '@/template';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext';
import { useEffect, useState, useCallback } from 'react';
import { I18nManager, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { getSetting, isSetupDone } from '@/services/database';
import { PinLock } from '@/components/ui';

function AppShell() {
  const { theme } = useTheme();
  const [pinChecked, setPinChecked] = useState(false);
  const [pinRequired, setPinRequired] = useState(false);
  const [pinCode, setPinCode] = useState('');
  const [pharmacyName, setPharmacyName] = useState('صيدلية ذكية');

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

  if (pinRequired && !pinChecked) {
    return (
      <PinLock correctPin={pinCode} onUnlock={handleUnlock} pharmacyName={pharmacyName} />
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, animation: 'slide_from_left' }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="setup" options={{ headerShown: false }} />
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
        <Stack.Screen name="sale-detail" options={{ headerShown: false }} />
        <Stack.Screen name="purchase-detail" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  useEffect(() => {
    if (Platform.OS !== 'web' && !I18nManager.isRTL) {
      I18nManager.allowRTL(true);
      I18nManager.forceRTL(true);
    }
  }, []);

  return (
    <AlertProvider>
      <SafeAreaProvider>
        <ThemeProvider>
          <AppShell />
        </ThemeProvider>
      </SafeAreaProvider>
    </AlertProvider>
  );
}
