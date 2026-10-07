// Smart Pharmacy ERP — Reorder Suggestions
import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { getReorderSuggestions, getSetting, ReorderSuggestion } from '@/services/database';
import { PdfActions } from '@/components/PdfActions';
import { buildTableReportHtml } from '@/services/pdfReport';

export default function ReorderScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [suggestions, setSuggestions] = useState<ReorderSuggestion[]>([]);

  useFocusEffect(useCallback(() => { setSuggestions(getReorderSuggestions()); }, []));
  const buildReorderPdf = () => buildTableReportHtml({
    pharmacyName: getSetting('pharmacy_name') || 'صيدليتي',
    title: 'تقرير مقترحات إعادة الطلب',
    accent: '#0052CC',
    summary: [
      { label: 'الأصناف المقترحة', value: suggestions.length, tone: 'negative' },
      { label: 'الأصناف النافدة', value: suggestions.filter(item => item.current_stock === 0).length, tone: 'negative' },
    ],
    columns: ['الصنف', 'الرصيد الحالي', 'الحد الأدنى', 'الكمية المقترحة', 'السبب'],
    rows: suggestions.map(item => [item.trade_name, `${item.current_stock} ${item.inventory_unit}`, `${item.minimum_stock} ${item.inventory_unit}`, `${item.suggested_quantity} ${item.inventory_unit}`, item.reason]),
    footerNote: 'هذه مقترحات شراء وتحتاج إلى مراجعة قبل اعتمادها.',
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ backgroundColor: '#0052CC', paddingTop: insets.top + 10, paddingBottom: 14, paddingHorizontal: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <TouchableOpacity onPress={() => router.back()} style={{ width: 34, height: 34, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
              <MaterialIcons name="arrow-forward" size={20} color="#FFFFFF" />
            </TouchableOpacity>
            <PdfActions buildHtml={buildReorderPdf} title="تقرير مقترحات إعادة الطلب" />
          </View>
          <Text style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF' }}>مقترحات إعادة الطلب</Text>
          <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)' }}>{suggestions.length} صنف</Text>
        </View>
      </View>

      {suggestions.length > 0 && (
        <View style={{ backgroundColor: '#DEEBFF', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#B3D4FF' }}>
          <Text style={{ fontSize: 13, color: '#0052CC', textAlign: 'right' }}>
            يوجد {suggestions.length} صنفاً يحتاج إلى إعادة طلب. هذه مقترحات فقط — يتطلب تأكيد.
          </Text>
        </View>
      )}

      <FlatList
        data={suggestions}
        keyExtractor={s => String(s.product_id)}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 32 }}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => router.push({ pathname: '/product-detail', params: { id: item.product_id } })}
            activeOpacity={0.75}
            style={{ backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.divider, paddingHorizontal: 14, paddingVertical: 14 }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ alignItems: 'flex-start', gap: 4 }}>
                <View style={{ backgroundColor: '#DEEBFF', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 }}>
                  <Text style={{ fontSize: 14, fontWeight: '800', color: '#0052CC' }}>اطلب {item.suggested_quantity} {item.inventory_unit}</Text>
                </View>
                <Text style={{ fontSize: 11, color: theme.colors.textTertiary }}>الرصيد الحالي: {item.current_stock}</Text>
                <Text style={{ fontSize: 11, color: theme.colors.textTertiary }}>الحد الأدنى: {item.minimum_stock}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: theme.colors.textPrimary }}>{item.trade_name}</Text>
                <View style={{ backgroundColor: item.current_stock === 0 ? theme.colors.errorLight : theme.colors.warningLight, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginTop: 4 }}>
                  <Text style={{ fontSize: 11, fontWeight: '600', color: item.current_stock === 0 ? theme.colors.error : theme.colors.warning }}>{item.reason}</Text>
                </View>
              </View>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={{ padding: 48, alignItems: 'center' }}>
            <MaterialIcons name="check-circle" size={56} color={theme.colors.success} />
            <Text style={{ fontSize: 16, fontWeight: '700', color: theme.colors.success, marginTop: 14 }}>ممتاز!</Text>
            <Text style={{ fontSize: 13, color: theme.colors.textTertiary, marginTop: 6 }}>جميع الأصناف في مستويات كافية</Text>
          </View>
        }
      />
    </View>
  );
}
