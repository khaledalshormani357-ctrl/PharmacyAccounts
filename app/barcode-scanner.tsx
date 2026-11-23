// Smart Pharmacy ERP — Barcode Scanner
import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';

const BARCODE_TYPES = ['ean13', 'ean8', 'code128', 'code39', 'qr', 'upc_a', 'upc_e'] as const;

export default function BarcodeScannerScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ target?: string }>();
  const target = params.target === 'product' ? 'product' : 'pos';
  const [permission, requestPermission] = useCameraPermissions();
  const scannedRef = useRef(false);
  const [scanned, setScanned] = useState(false);

  const handleScan = ({ data }: { data: string }) => {
    // Single-scan guard: ignore every further scan once one is accepted.
    if (scannedRef.current || scanned) return;
    scannedRef.current = true;
    setScanned(true);
    const encoded = encodeURIComponent(data);
    if (target === 'product') {
      router.replace(`/add-product?barcode=${encoded}`);
    } else {
      router.replace(`/pos?barcode=${encoded}`);
    }
  };

  if (!permission) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, paddingTop: insets.top }}>
        <View style={{ backgroundColor: theme.colors.primary, padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <TouchableOpacity onPress={() => router.back()}>
            <MaterialIcons name="arrow-forward" size={23} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={{ color: '#FFFFFF', fontSize: 17, fontWeight: '800' }}>مسح الباركود</Text>
          <MaterialIcons name="qr-code-scanner" size={23} color="#FFFFFF" />
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <MaterialIcons name="no-photography" size={48} color={theme.colors.textTertiary} />
          <Text style={{ fontSize: 15, fontWeight: '700', color: theme.colors.textPrimary, textAlign: 'center', marginTop: 16 }}>
            نحتاج إلى إذن الكاميرا لمسح الباركود
          </Text>
          <Text style={{ fontSize: 13, color: theme.colors.textSecondary, textAlign: 'center', lineHeight: 20, marginTop: 8 }}>
            تم رفض إذن الكاميرا. اسمح بالوصول إلى الكاميرا من إعدادات التطبيق أو اضغط زر السماح أدناه.
          </Text>
          <TouchableOpacity
            onPress={() => { void requestPermission(); }}
            style={{ backgroundColor: theme.colors.primary, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 12, marginTop: 20 }}
          >
            <Text style={{ color: '#FFFFFF', fontWeight: '800' }}>السماح بالكاميرا</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.back()} style={{ padding: 12, marginTop: 8 }}>
            <Text style={{ color: theme.colors.primary, fontWeight: '700' }}>رجوع</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000000', paddingTop: insets.top }}>
      <View style={{ backgroundColor: theme.colors.primary, padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <TouchableOpacity onPress={() => router.back()}>
          <MaterialIcons name="arrow-forward" size={23} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={{ color: '#FFFFFF', fontSize: 17, fontWeight: '800' }}>مسح الباركود</Text>
        <MaterialIcons name="qr-code-scanner" size={23} color="#FFFFFF" />
      </View>
      <CameraView
        style={{ flex: 1 }}
        barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
        onBarcodeScanned={handleScan}
      />
      <View style={{ backgroundColor: '#000000', padding: 16, paddingBottom: insets.bottom + 16, alignItems: 'center' }}>
        <Text style={{ color: '#FFFFFF', fontSize: 14, textAlign: 'center' }}>
          {scanned ? 'تم المسح…' : 'وجّه الكاميرا نحو الباركود'}
        </Text>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 10, marginTop: 4 }}>
          <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>إلغاء</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
