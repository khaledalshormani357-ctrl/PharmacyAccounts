// Smart Pharmacy ERP — Audit Log Screen
import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { getAuditLogs, AuditLog } from '@/services/database';

const ACTION_COLORS: Record<string, string> = {
  SALE_CREATE: '#00875A', SALE_CANCEL: '#DE350B',
  PURCHASE_CREATE: '#6554C0', PURCHASE_CANCEL: '#DE350B',
  PRODUCT_CREATE: '#00B8D9', PRODUCT_UPDATE: '#0052CC',
  EXPENSE_CREATE: '#DE350B', EXPENSE_DELETE: '#BF2600',
  CUSTOMER_PAYMENT: '#00875A', SUPPLIER_PAYMENT: '#6554C0',
  STOCK_ADJUST: '#F59E0B', LOGIN: '#0052CC', SETUP_COMPLETE: '#00875A',
  RESTORE: '#FF5630', SHIFT_CLOSE: '#172B4D',
};

const ACTION_LABELS: Record<string, string> = {
  SALE_CREATE: 'إنشاء فاتورة بيع', SALE_CANCEL: 'إلغاء فاتورة بيع',
  PURCHASE_CREATE: 'إنشاء فاتورة شراء', PRODUCT_CREATE: 'إضافة صنف',
  PRODUCT_UPDATE: 'تعديل صنف', EXPENSE_CREATE: 'إضافة مصروف',
  EXPENSE_DELETE: 'حذف مصروف', CUSTOMER_PAYMENT: 'تسجيل سداد عميل',
  SUPPLIER_PAYMENT: 'دفعة للمورد', STOCK_ADJUST: 'تعديل مخزون',
  LOGIN: 'تسجيل دخول', SETUP_COMPLETE: 'إعداد النظام',
  RESTORE: 'استعادة نسخة', SHIFT_CLOSE: 'إغلاق وردية',
};

export default function AuditLogScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [logs, setLogs] = useState<AuditLog[]>([]);

  useFocusEffect(useCallback(() => { setLogs(getAuditLogs({ limit: 100 })); }, []));

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ backgroundColor: '#172B4D', paddingTop: insets.top + 10, paddingBottom: 14, paddingHorizontal: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <TouchableOpacity onPress={() => router.back()} style={{ width: 34, height: 34, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
            <MaterialIcons name="arrow-forward" size={20} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF' }}>سجل التدقيق</Text>
          <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>{logs.length} حدث</Text>
        </View>
      </View>

      <FlatList
        data={logs}
        keyExtractor={l => String(l.id)}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 32 }}
        renderItem={({ item }) => {
          const color = ACTION_COLORS[item.action] || theme.colors.textSecondary;
          const label = ACTION_LABELS[item.action] || item.action;
          return (
            <View style={{ backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.divider, paddingHorizontal: 14, paddingVertical: 12 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ alignItems: 'flex-start' }}>
                  <View style={{ backgroundColor: color + '18', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginBottom: 4 }}>
                    <Text style={{ fontSize: 10, fontWeight: '600', color }}>{label}</Text>
                  </View>
                  <Text style={{ fontSize: 11, color: theme.colors.textTertiary }}>{item.created_at.slice(0, 16)}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', flex: 1, marginLeft: 10 }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: theme.colors.textPrimary, textAlign: 'right' }}>
                    {item.entity} {item.entity_id ? `#${item.entity_id}` : ''}
                  </Text>
                  {item.reason ? <Text style={{ fontSize: 11, color: theme.colors.textTertiary, textAlign: 'right', marginTop: 2 }}>السبب: {item.reason}</Text> : null}
                </View>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={<View style={{ padding: 40, alignItems: 'center' }}><MaterialIcons name="history" size={48} color={theme.colors.textTertiary} /><Text style={{ fontSize: 14, color: theme.colors.textTertiary, marginTop: 12 }}>لا توجد سجلات</Text></View>}
      />
    </View>
  );
}
