import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator, FlatList, RefreshControl, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { getProductByCatalogSourceId } from '@/services/database';
import { getLocalDrugCatalog, refreshRemoteDrugCatalog, DrugCatalogRecord, DrugCatalogSource } from '@/services/drug-catalog';
import { searchDrugCatalog } from '@/services/drug-catalog-utils';

const PAGE_LIMIT = 60;

export default function DrugCatalogScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [records, setRecords] = useState<DrugCatalogRecord[]>([]);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<DrugCatalogSource>('empty');
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadCatalog = useCallback(async (force = false) => {
    if (force) setRefreshing(true);
    try {
      const local = await getLocalDrugCatalog();
      setRecords(local.records);
      setSource(local.source);
      setSyncedAt(local.syncedAt);
      setLoading(false);
      const remote = await refreshRemoteDrugCatalog(force);
      if (remote) {
        setRecords(remote.records);
        setSource(remote.source);
        setSyncedAt(remote.syncedAt);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void loadCatalog(false);
  }, [loadCatalog]));

  const matches = useMemo(() => searchDrugCatalog(records, query), [records, query]);
  const visibleRecords = useMemo(() => matches.slice(0, PAGE_LIMIT), [matches]);

  const sourceLabel = source === 'remote'
    ? 'متصل بكتالوج Supabase المشترك'
    : source === 'cache'
      ? 'نسخة محفوظة على الجهاز — تعمل دون إنترنت'
      : 'يلزم اتصال بالإنترنت للمزامنة الأولى';

  const onRefresh = useCallback(() => { void loadCatalog(true); }, [loadCatalog]);

  const openOrAdd = (item: DrugCatalogRecord) => {
    const existing = getProductByCatalogSourceId(item.source_id);
    if (existing) {
      router.push({ pathname: '/product-detail', params: { id: String(existing.id) } } as never);
      return;
    }
    router.push({ pathname: '/add-product', params: { catalogSourceId: item.source_id } } as never);
  };

  const renderItem = ({ item }: { item: DrugCatalogRecord }) => {
    const existing = getProductByCatalogSourceId(item.source_id);
    const details = [item.strength, item.dosage_form].filter(Boolean).join(' · ');
    const packageInfo = item.selling_unit && item.base_unit
      ? `${item.selling_unit}${item.pack_size && item.pack_size > 1 ? ` (${item.pack_size} ${item.base_unit})` : ''}`
      : null;
    return (
      <View style={{ backgroundColor: theme.colors.surface, marginHorizontal: 14, marginTop: 10, padding: 13, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.colors.textPrimary, fontSize: 16, fontWeight: '800', textAlign: 'right' }}>{item.trade_name_ar}</Text>
            {!!item.trade_name_en && <Text style={{ color: theme.colors.textSecondary, fontSize: 12, textAlign: 'right', marginTop: 2 }}>{item.trade_name_en}</Text>}
            {!!details && <Text style={{ color: theme.colors.textSecondary, fontSize: 12, textAlign: 'right', marginTop: 5 }}>{details}</Text>}
          </View>
          <View style={{ backgroundColor: theme.colors.surfaceAlt, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 6 }}>
            <Text style={{ color: theme.colors.textTertiary, fontSize: 10 }}>{item.source_code}</Text>
          </View>
        </View>

        {(item.generic_name || item.active_ingredient) && (
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12, textAlign: 'right', marginTop: 7 }}>
            {[item.generic_name, item.active_ingredient].filter(Boolean).join(' · ')}
          </Text>
        )}
        {(item.manufacturer_name || item.country_of_origin || item.category_ar) && (
          <Text style={{ color: theme.colors.textTertiary, fontSize: 11, textAlign: 'right', marginTop: 5 }}>
            {[item.manufacturer_name, item.country_of_origin, item.category_ar].filter(Boolean).join(' · ')}
          </Text>
        )}
        {packageInfo && (
          <Text style={{ color: theme.colors.primary, fontSize: 11, textAlign: 'right', marginTop: 5 }}>
            وحدة/عبوة المصدر — للمراجعة فقط: {packageInfo}
          </Text>
        )}

        <TouchableOpacity
          onPress={() => openOrAdd(item)}
          activeOpacity={0.8}
          style={{ backgroundColor: existing ? theme.colors.surfaceAlt : theme.colors.primary, borderRadius: 8, marginTop: 11, minHeight: 38, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 }}
        >
          <MaterialIcons name={existing ? 'inventory' : 'add-circle-outline'} size={17} color={existing ? theme.colors.textSecondary : '#FFFFFF'} />
          <Text style={{ color: existing ? theme.colors.textSecondary : '#FFFFFF', fontWeight: '700', fontSize: 12 }}>
            {existing ? 'مضاف للصيدلية — عرض الصنف' : 'إضافة للصيدلية'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ backgroundColor: '#006B5B', paddingTop: insets.top + 9, paddingHorizontal: 14, paddingBottom: 13 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <TouchableOpacity onPress={() => router.back()} style={{ width: 36, height: 36, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}>
            <MaterialIcons name="arrow-forward" size={21} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'flex-end', marginRight: 10 }}>
            <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '800' }}>كتالوج الأدوية</Text>
            <Text style={{ color: 'rgba(255,255,255,0.82)', fontSize: 11, marginTop: 2 }}>{records.length.toLocaleString('ar')} دواء مرجعي</Text>
          </View>
          <MaterialIcons name="local-pharmacy" size={27} color="#FFFFFF" />
        </View>
        <View style={{ height: 43, borderRadius: 10, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 }}>
          <MaterialIcons name="search" size={20} color="#5E6C84" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="ابحث بالاسم أو المادة أو التركيز أو الرمز"
            placeholderTextColor="#8993A4"
            style={{ flex: 1, color: '#172B4D', textAlign: 'right', marginHorizontal: 7, fontSize: 13 }}
            returnKeyType="search"
          />
          {!!query && <TouchableOpacity onPress={() => setQuery('')}><MaterialIcons name="close" size={18} color="#5E6C84" /></TouchableOpacity>}
        </View>
      </View>

      <FlatList
        data={visibleRecords}
        keyExtractor={item => item.source_id}
        renderItem={renderItem}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[theme.colors.primary]} />}
        ListHeaderComponent={(
          <View style={{ marginHorizontal: 14, marginTop: 11, padding: 11, borderRadius: 9, backgroundColor: theme.colors.surfaceAlt, borderWidth: 1, borderColor: theme.colors.border }}>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 11, textAlign: 'right' }}>{sourceLabel}</Text>
              <MaterialIcons name={source === 'remote' ? 'cloud-done' : 'cloud-off'} size={15} color={source === 'remote' ? theme.colors.success : theme.colors.textTertiary} />
            </View>
            <Text style={{ color: theme.colors.textTertiary, fontSize: 10, textAlign: 'right', marginTop: 5 }}>
              معلومات تعريفية من الملف؛ راجع الاسم والوحدة والعبوة قبل الإضافة. الأسعار والرصيد لا تأتي من الكتالوج.
            </Text>
            {syncedAt ? <Text style={{ color: theme.colors.textTertiary, fontSize: 9, textAlign: 'right', marginTop: 3 }}>آخر مزامنة: {new Date(syncedAt).toLocaleString('ar')}</Text> : null}
          </View>
        )}
        ListEmptyComponent={loading ? (
          <View style={{ alignItems: 'center', padding: 35 }}><ActivityIndicator color={theme.colors.primary} /><Text style={{ color: theme.colors.textTertiary, marginTop: 9 }}>تحميل قاعدة الأدوية…</Text></View>
        ) : (
          <View style={{ alignItems: 'center', padding: 35 }}><MaterialIcons name={records.length === 0 ? 'cloud-download' : 'search-off'} size={34} color={theme.colors.textTertiary} /><Text style={{ color: theme.colors.textTertiary, marginTop: 9, textAlign: 'center' }}>{records.length === 0 ? 'اتصل بالإنترنت لتحميل الكتالوج أول مرة؛ بعد ذلك يُحفظ محليًا للعمل دون اتصال.' : 'لا توجد نتائج مطابقة'}</Text></View>
        )}
        ListFooterComponent={matches.length > PAGE_LIMIT ? (
          <Text style={{ color: theme.colors.textTertiary, fontSize: 11, textAlign: 'center', paddingVertical: 14 }}>تُعرض أول {PAGE_LIMIT} نتيجة من {matches.length.toLocaleString('ar')}؛ حسّن عبارة البحث لعرض نتائج أدق.</Text>
        ) : <View style={{ height: 24 }} />}
      />
    </View>
  );
}
