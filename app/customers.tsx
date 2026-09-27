// Smart Pharmacy ERP — Customers Screen
import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, FlatList, TextInput, RefreshControl } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { getCustomers, deleteCustomer, Customer } from '@/services/database';
import { formatCurrency, AR } from '@/constants/i18n';
import { useAlert } from '@/template';

export default function CustomersScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showAlert } = useAlert();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    try { setCustomers(getCustomers(search || undefined)); } catch {}
  }, [search]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const totalDebt = customers.reduce((s, c) => s + Math.max(0, c.balance), 0);

  const handleDelete = (c: Customer) => {
    showAlert(`حذف ${c.name}`, AR.deleteWarning, [
      { text: AR.cancel, style: 'cancel' },
      { text: AR.delete, style: 'destructive', onPress: () => { deleteCustomer(c.id); load(); } },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ backgroundColor: '#0052CC', paddingTop: insets.top + 10, paddingBottom: 14, paddingHorizontal: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity onPress={() => router.push('/add-customer')} style={{ backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <MaterialIcons name="person-add" size={16} color="#FFFFFF" />
              <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '600' }}>عميل جديد</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.back()} style={{ width: 34, height: 34, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
              <MaterialIcons name="arrow-forward" size={20} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          <Text style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF' }}>العملاء</Text>
        </View>
        <View style={{ backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 10, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, height: 38 }}>
          <MaterialIcons name="search" size={18} color="rgba(255,255,255,0.8)" />
          <TextInput value={search} onChangeText={setSearch} onSubmitEditing={load} placeholder="ابحث عن عميل..." placeholderTextColor="rgba(255,255,255,0.6)" style={{ flex: 1, fontSize: 13, textAlign: 'right', color: '#FFFFFF', marginRight: 6 }} />
        </View>
      </View>

      {totalDebt > 0 && (
        <View style={{ backgroundColor: '#DEEBFF', paddingHorizontal: 14, paddingVertical: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontSize: 14, fontWeight: '800', color: '#0052CC' }}>{formatCurrency(totalDebt)}</Text>
          <Text style={{ fontSize: 13, color: '#0052CC' }}>إجمالي ديون العملاء</Text>
        </View>
      )}

      <FlatList
        data={customers}
        keyExtractor={c => String(c.id)}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); setRefreshing(false); }} colors={['#0052CC']} />}
        contentContainerStyle={{ paddingBottom: 24 }}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => router.push({ pathname: '/customer-detail', params: { id: item.id } })}
            onLongPress={() => handleDelete(item)}
            activeOpacity={0.75}
            style={{ backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.divider, paddingHorizontal: 14, paddingVertical: 13 }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <MaterialIcons name="chevron-left" size={16} color={theme.colors.textTertiary} />
              <View style={{ flex: 1, marginHorizontal: 10 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ alignItems: 'flex-start' }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: item.balance > 0 ? theme.colors.error : theme.colors.success }}>
                      {item.balance > 0 ? formatCurrency(item.balance) : 'سوي'}
                    </Text>
                    {item.balance > 0 && <Text style={{ fontSize: 10, color: theme.colors.error }}>مدين</Text>}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ fontSize: 15, fontWeight: '600', color: theme.colors.textPrimary }}>{item.name}</Text>
                      <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: '#0052CC18', alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ fontSize: 15, fontWeight: '700', color: '#0052CC' }}>{item.name.charAt(0)}</Text>
                      </View>
                    </View>
                    {item.phone ? <Text style={{ fontSize: 12, color: theme.colors.textTertiary }}>{item.phone}</Text> : null}
                  </View>
                </View>
              </View>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={{ padding: 40, alignItems: 'center' }}>
            <MaterialIcons name="people" size={48} color={theme.colors.textTertiary} />
            <Text style={{ fontSize: 15, color: theme.colors.textTertiary, marginTop: 12 }}>لا يوجد عملاء</Text>
            <TouchableOpacity onPress={() => router.push('/add-customer')} style={{ marginTop: 14, backgroundColor: '#0052CC', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 }}>
              <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '600' }}>أضف عميلاً</Text>
            </TouchableOpacity>
          </View>
        }
      />
    </View>
  );
}
