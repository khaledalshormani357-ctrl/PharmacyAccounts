// Smart Pharmacy ERP — AI Assistant Screen
import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import {
  getDashboardKpis, getReportSummary, getExpiryRadar, getDeadStock,
  getReorderSuggestions, getCustomers, getSuppliers, getInventoryList,
  getSetting, getToday,
} from '@/services/database';
import { formatCurrency, getToday as getTodayStr } from '@/constants/i18n';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

const QUICK_QUESTIONS = [
  'ما مبيعات اليوم؟',
  'ما الأصناف القريبة من الانتهاء؟',
  'ما الأصناف التي تحتاج إعادة طلب؟',
  'ما الأصناف الراكدة؟',
  'كم لنا عند العملاء؟',
  'كم علينا للموردين؟',
  'ما أكثر الأصناف مبيعاً؟',
  'ما رصيد الصندوق؟',
];

function answerLocally(question: string): string {
  const q = question.toLowerCase();
  const todayStr = getTodayStr();
  const pharmacyName = getSetting('pharmacy_name') || 'الصيدلية';

  if (q.includes('مبيعات') && (q.includes('اليوم') || q.includes('يومي'))) {
    const kpis = getDashboardKpis();
    return `مبيعات اليوم في ${pharmacyName}:\n` +
      `• نقدي: ${formatCurrency(kpis.todayCashSales)}\n` +
      `• آجل: ${formatCurrency(kpis.todayCreditSales)}\n` +
      `• الإجمالي: ${formatCurrency(kpis.todaySales)}\n` +
      `• الربح الإجمالي: ${formatCurrency(kpis.todayGrossProfit)}`;
  }

  if (q.includes('انتهاء') || q.includes('منتهي') || q.includes('صلاحية')) {
    const radar = getExpiryRadar();
    if (radar.length === 0) return 'لا توجد أصناف قاربت أو انتهت صلاحيتها. ممتاز!';
    const expired = radar.filter(r => r.group === 'expired');
    const expiring30 = radar.filter(r => r.group === '30');
    let result = `تقرير الصلاحيات:\n`;
    if (expired.length > 0) result += `• منتهية الصلاحية: ${expired.length} دفعة\n  ${expired.slice(0, 3).map(r => r.product_name).join('، ')}\n`;
    if (expiring30.length > 0) result += `• تنتهي خلال 30 يوم: ${expiring30.length} دفعة\n  ${expiring30.slice(0, 3).map(r => r.product_name).join('، ')}\n`;
    result += `• إجمالي في خطر: ${radar.length} دفعة`;
    return result;
  }

  if (q.includes('إعادة طلب') || q.includes('نقص') || q.includes('ينقص') || q.includes('راكد'.includes(q) ? '' : 'يحتاج')) {
    const suggestions = getReorderSuggestions();
    if (suggestions.length === 0) return 'جميع الأصناف في مستويات كافية. لا يوجد ما يحتاج إعادة طلب حالياً.';
    const outOfStock = suggestions.filter(s => s.current_stock === 0);
    const low = suggestions.filter(s => s.current_stock > 0);
    let result = `مقترحات إعادة الطلب:\n`;
    if (outOfStock.length > 0) result += `• نافد المخزون (${outOfStock.length}):\n  ${outOfStock.slice(0, 5).map(s => s.trade_name).join('، ')}\n`;
    if (low.length > 0) result += `• منخفض المخزون (${low.length}):\n  ${low.slice(0, 5).map(s => s.trade_name).join('، ')}\n`;
    return result;
  }

  if (q.includes('راكد')) {
    const dead = getDeadStock(90);
    if (dead.length === 0) return 'لا يوجد مخزون راكد (لا حركة خلال 90 يوم). ممتاز!';
    const totalValue = dead.reduce((s, i) => s + i.total_quantity * i.selling_price, 0);
    return `المخزون الراكد (90 يوم):\n• ${dead.length} صنف بدون حركة\n• إجمالي القيمة: ${formatCurrency(totalValue)}\n• أبرزها: ${dead.slice(0, 3).map(i => i.trade_name).join('، ')}`;
  }

  if (q.includes('عملاء') || q.includes('ديون') || q.includes('مدينون')) {
    const customers = getCustomers();
    const debtors = customers.filter(c => c.balance > 0);
    const totalDebt = debtors.reduce((s, c) => s + c.balance, 0);
    if (debtors.length === 0) return 'لا توجد ديون على عملاء حالياً.';
    return `ديون العملاء:\n• عدد المدينين: ${debtors.length}\n• إجمالي الديون: ${formatCurrency(totalDebt)}\n• أكبر الديون: ${debtors.sort((a, b) => b.balance - a.balance).slice(0, 3).map(c => `${c.name} (${formatCurrency(c.balance)})`).join('، ')}`;
  }

  if (q.includes('موردين') || q.includes('موردون') || q.includes('مستحق')) {
    const suppliers = getSuppliers();
    const owing = suppliers.filter(s => s.balance > 0);
    const totalOwed = owing.reduce((s, sup) => s + sup.balance, 0);
    if (owing.length === 0) return 'لا توجد مستحقات للموردين حالياً.';
    return `مستحقات الموردين:\n• عدد الموردين الدائنين: ${owing.length}\n• إجمالي المستحقات: ${formatCurrency(totalOwed)}\n• أكبر المستحقات: ${owing.sort((a, b) => b.balance - a.balance).slice(0, 3).map(s => `${s.name} (${formatCurrency(s.balance)})`).join('، ')}`;
  }

  if (q.includes('رصيد') && q.includes('صندوق')) {
    const kpis = getDashboardKpis();
    return `رصيد الصندوق الحالي: ${formatCurrency(kpis.cashBalance)}`;
  }

  if (q.includes('مبيعاً') || q.includes('أكثر مبيع') || q.includes('أفضل')) {
    return 'لعرض أكثر الأصناف مبيعاً، تفضل بزيارة شاشة تحليل ABC في قائمة المزيد.';
  }

  if (q.includes('ملخص') || q.includes('تقرير')) {
    const kpis = getDashboardKpis();
    return `ملخص ${pharmacyName} اليوم:\n` +
      `• مبيعات اليوم: ${formatCurrency(kpis.todaySales)}\n` +
      `• ربح اليوم: ${formatCurrency(kpis.todayGrossProfit)}\n` +
      `• رصيد الصندوق: ${formatCurrency(kpis.cashBalance)}\n` +
      `• مصروفات اليوم: ${formatCurrency(kpis.todayExpenses)}\n` +
      `• ديون العملاء: ${formatCurrency(kpis.totalCustomerDebt)}\n` +
      `• مستحقات الموردين: ${formatCurrency(kpis.totalSupplierDebt)}`;
  }

  return `لا أملك إجابة محددة على هذا السؤال.\n\nيمكنك الاستفسار عن:\n• مبيعات اليوم\n• رادار انتهاء الصلاحية\n• مقترحات إعادة الطلب\n• ديون العملاء\n• مستحقات الموردين\n• المخزون الراكد\n• رصيد الصندوق`;
}

export default function AssistantScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '0',
      role: 'assistant',
      text: `مرحباً! أنا المساعد الذكي لـ ${getSetting('pharmacy_name') || 'صيدليتك'}.\n\nيمكنني الإجابة على أسئلتك حول أداء الصيدلية. البيانات مستمدة من نظامك مباشرة.`,
      timestamp: new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const sendMessage = useCallback((text: string) => {
    if (!text.trim()) return;
    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      text: text.trim(),
      timestamp: new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    setTimeout(() => {
      const answer = answerLocally(text);
      setMessages(prev => [...prev, {
        id: Date.now().toString() + 'a',
        role: 'assistant',
        text: answer,
        timestamp: new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
      }]);
      setLoading(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }, 500);
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ backgroundColor: '#6554C0', paddingTop: insets.top + 10, paddingBottom: 14, paddingHorizontal: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <TouchableOpacity onPress={() => router.back()} style={{ width: 34, height: 34, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
            <MaterialIcons name="arrow-forward" size={20} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF' }}>المساعد الذكي</Text>
            <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>يعمل على بيانات صيدليتك</Text>
          </View>
          <View style={{ width: 34 }} />
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0}>
        <ScrollView
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: 14, paddingBottom: 8 }}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {messages.map(msg => (
            <View key={msg.id} style={{ marginBottom: 14, alignItems: msg.role === 'user' ? 'flex-start' : 'flex-end' }}>
              <View style={{ maxWidth: '82%', backgroundColor: msg.role === 'user' ? '#6554C0' : theme.colors.surface, borderRadius: 14, borderBottomRightRadius: msg.role === 'assistant' ? 4 : 14, borderBottomLeftRadius: msg.role === 'user' ? 4 : 14, padding: 12, borderWidth: msg.role === 'assistant' ? 1 : 0, borderColor: theme.colors.border }}>
                <Text style={{ fontSize: 14, color: msg.role === 'user' ? '#FFFFFF' : theme.colors.textPrimary, textAlign: 'right', lineHeight: 22 }}>{msg.text}</Text>
                <Text style={{ fontSize: 10, color: msg.role === 'user' ? 'rgba(255,255,255,0.6)' : theme.colors.textTertiary, textAlign: msg.role === 'user' ? 'left' : 'right', marginTop: 4 }}>{msg.timestamp}</Text>
              </View>
            </View>
          ))}
          {loading && (
            <View style={{ alignItems: 'flex-end', marginBottom: 14 }}>
              <View style={{ backgroundColor: theme.colors.surface, borderRadius: 14, borderBottomRightRadius: 4, padding: 14, borderWidth: 1, borderColor: theme.colors.border }}>
                <ActivityIndicator size="small" color="#6554C0" />
              </View>
            </View>
          )}
        </ScrollView>

        {/* Quick Questions */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.colors.border }} contentContainerStyle={{ paddingHorizontal: 12, gap: 8, flexDirection: 'row' }}>
          {QUICK_QUESTIONS.map(q => (
            <TouchableOpacity key={q} onPress={() => sendMessage(q)} style={{ backgroundColor: '#EAE6FF', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: '#C0B6F2' }}>
              <Text style={{ fontSize: 12, color: '#6554C0', fontWeight: '500' }}>{q}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, backgroundColor: theme.colors.surface, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingBottom: insets.bottom + 8, gap: 10 }}>
          <TouchableOpacity onPress={() => sendMessage(input)} disabled={!input.trim() || loading} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: input.trim() ? '#6554C0' : theme.colors.border, alignItems: 'center', justifyContent: 'center' }}>
            <MaterialIcons name="send" size={20} color="#FFFFFF" style={{ transform: [{ scaleX: -1 }] }} />
          </TouchableOpacity>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="اكتب سؤالك هنا..."
            placeholderTextColor={theme.colors.textTertiary}
            onSubmitEditing={() => sendMessage(input)}
            style={{ flex: 1, height: 44, backgroundColor: theme.colors.surfaceAlt, borderRadius: 22, paddingHorizontal: 16, fontSize: 14, textAlign: 'right', color: theme.colors.textPrimary }}
          />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
