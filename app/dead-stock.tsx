// Smart Pharmacy ERP — Dead Stock
import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, ScrollView } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { getDeadStock, InventoryItem } from '@/services/database';
import { formatCurrency } from '@/constants/i18n';

const PERIODS = [
  { days: 60, label: '60 يوم' },
  { days: 90, label: '90 يوم' },
  { days: 120, label: '120 يوم' },
  { days: 180, label: '180 يوم' },
];

export default function DeadStockScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [days, setDays] = useState(90);

  useFocusEffect(useCallback(() => { setItems(getDeadStock(days)); }, [days]));

  const totalValue = items.reduce((s, i) => s + i.total_quantity * i.selling_price, 0);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ backgroundColor: '#6554C0', paddingTop: insets.top + 10, paddingBottom: 14, paddingHorizontal: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <TouchableOpacity onPress={() => router.back()} style={{ width: 34, height: 34, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
            <MaterialIcons name="arrow-forward" size={20} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF' }}>المخزون الراكد</Text>
          <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)' }}>{items.length} صنف</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, flexDirection: 'row' }}>
          {PERIODS.map(p => (
            <TouchableOpacity key={p.days} onPress={() => setDays(p.days)} style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: days === p.days ? '#FFFFFF' : 'rgba(255,255,255,0.15)' }}>
              <Text style={{ fontSize: 12, fontWeight: '600', color: days === p.days ? '#6554C0' : '#FFFFFF' }}>لا حركة {p.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {items.length > 0 && (
        <View style={{ backgroundColor: '#EAE6FF', paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#C0B6F2' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#6554C0' }}>{formatCurrency(totalValue)}</Text>
            <Text style={{ fontSize: 13, color: '#5E6C84' }}>قيمة المخزون الراكد</Text>
          </View>
        </View>
      )}

      <FlatList
        data={items}
        keyExtractor={i => String(i.product_id)}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 32 }}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => router.push({ pathname: '/product-detail', params: { id: item.product_id } })}
            activeOpacity={0.75}
            style={{ backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.divider, paddingHorizontal: 14, paddingVertical: 12 }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <View style={{ alignItems: 'flex-start' }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: theme.colors.textPrimary }}>{item.total_quantity} {item.inventory_unit}</Text>
                <Text style={{ fontSize: 12, color: theme.colors.textTertiary }}>قيمة: {formatCurrency(item.total_quantity * item.selling_price)}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: theme.colors.textPrimary }}>{item.trade_name}</Text>
                {item.generic_name ? <Text style={{ fontSize: 12, color: theme.colors.textTertiary }}>{item.generic_name}</Text> : null}
                <View style={{ backgroundColor: '#EAE6FF', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, marginTop: 4 }}>
                  <Text style={{ fontSize: 10, fontWeight: '600', color: '#6554C0' }}>راكد</Text>
                </View>
              </View>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={{ padding: 48, alignItems: 'center' }}>
            <MaterialIcons name="trending-up" size={56} color={theme.colors.success} />
            <Text style={{ fontSize: 16, fontWeight: '700', color: theme.colors.success, marginTop: 14 }}>ممتاز!</Text>
            <Text style={{ fontSize: 13, color: theme.colors.textTertiary, marginTop: 6 }}>لا يوجد مخزون راكد خلال {days} يوماً</Text>
          </View>
        }
      />
    </View>
  );
}
