// Smart Pharmacy ERP — Tab Layout
import { MaterialIcons } from '@expo/vector-icons';
import { Tabs, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Platform } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useEffect } from 'react';
import { isSetupDone } from '@/services/database';

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const router = useRouter();

  useEffect(() => {
    if (!isSetupDone()) {
      router.replace('/setup');
    }
  }, []);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          height: Platform.select({ ios: insets.bottom + 58, android: insets.bottom + 58, default: 66 }),
          paddingTop: 6,
          paddingBottom: Platform.select({ ios: insets.bottom + 6, android: insets.bottom + 6, default: 6 }),
          paddingHorizontal: 4,
          backgroundColor: theme.colors.surface,
          borderTopWidth: 1,
          borderTopColor: theme.colors.border,
        },
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textTertiary,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600', marginTop: -2 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'الرئيسية',
          tabBarIcon: ({ color, size }) => <MaterialIcons name="home" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="sales"
        options={{
          title: 'المبيعات',
          tabBarIcon: ({ color, size }) => <MaterialIcons name="point-of-sale" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="purchases"
        options={{
          title: 'المشتريات',
          tabBarIcon: ({ color, size }) => <MaterialIcons name="shopping-cart" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: 'التقارير',
          tabBarIcon: ({ color, size }) => <MaterialIcons name="bar-chart" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'المزيد',
          tabBarIcon: ({ color, size }) => <MaterialIcons name="apps" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
