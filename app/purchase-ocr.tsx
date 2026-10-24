import React, { useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '@/contexts/ThemeContext';
import { useAlert } from '@/template';

type OCRLine = {
  name: string;
  quantity: number;
  unit?: string;
  purchase_price: number;
  batch_number?: string;
  expiry_date?: string;
  free_quantity?: number;
  discount?: number;
};
type InvoiceDraft = {
  invoice_number?: string;
  date?: string;
  supplier_name?: string;
  invoice_discount?: number;
  amount_paid?: number;
  items: OCRLine[];
};

function parseJsonResponse(value: string): InvoiceDraft {
  const cleaned = value.trim().replace(/^\u0060\u0060\u0060(?:json)?\s*/i, '').replace(/\u0060\u0060\u0060$/i, '');
  const parsed = JSON.parse(cleaned);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.items)) throw new Error('استجابة OCR لا تحتوي قائمة أصناف صالحة');
  return {
    invoice_number: String(parsed.invoice_number || ''),
    date: String(parsed.date || ''),
    supplier_name: String(parsed.supplier_name || ''),
    invoice_discount: Number(parsed.invoice_discount || 0),
    amount_paid: Number(parsed.amount_paid || 0),
    items: parsed.items.filter((item: any) => item && String(item.name || '').trim()).map((item: any) => ({
      name: String(item.name).trim(),
      quantity: Number(item.quantity || 0),
      unit: String(item.unit || ''),
      purchase_price: Number(item.purchase_price || 0),
      batch_number: String(item.batch_number || ''),
      expiry_date: String(item.expiry_date || ''),
      free_quantity: Number(item.free_quantity || 0),
      discount: Number(item.discount || 0),
    })),
  };
}

export default function PurchaseInvoiceOCRScreen() {
  const { theme } = useTheme();
  const colors = theme.colors;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showAlert } = useAlert();
  const [imageUri, setImageUri] = useState('');
  const [imageBase64, setImageBase64] = useState('');
  const [mimeType, setMimeType] = useState('image/jpeg');
  const [draft, setDraft] = useState<InvoiceDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [rawText, setRawText] = useState('');

  const chooseImage = async (camera: boolean) => {
    try {
      const result = camera
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 0.85, base64: true })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 0.85, base64: true });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      if (!asset.base64) {
        showAlert('تعذر قراءة الصورة', 'اختر صورة بصيغة مدعومة وحاول مجدداً.');
        return;
      }
      setImageUri(asset.uri);
      setImageBase64(asset.base64);
      setMimeType(asset.mimeType || 'image/jpeg');
      setDraft(null);
      setRawText('');
    } catch (error: any) {
      showAlert('تعذر فتح الصورة', error?.message || 'تحقق من أذونات الكاميرا والصور.');
    }
  };

  const analyze = async () => {
    if (!imageBase64) {
      showAlert('اختر صورة أولاً', 'التقط صورة فاتورة أو اختر صورة من المعرض.');
      return;
    }
    setBusy(true);
    try {
      const apiKey = await SecureStore.getItemAsync('gemini_api_key');
      if (!apiKey?.trim()) {
        showAlert('إعداد المساعد الذكي', 'أضف مفتاح Gemini API من الإعدادات أولاً. لا تُرسل الصورة قبل إعداد المفتاح.');
        return;
      }
      const prompt = [
        'أنت مساعد إدخال فواتير مشتريات لصيدلية. اقرأ صورة الفاتورة واستخرج البيانات الظاهرة فقط ولا تخمن القيم غير الواضحة.',
        'أجب بكائن JSON فقط، بالمفاتيح: invoice_number (string), date (YYYY-MM-DD أو فارغ), supplier_name (string), invoice_discount (number), amount_paid (number), items (array).',
        'كل عنصر: name (اسم الدواء كما هو مكتوب), quantity (number), unit (string), purchase_price (سعر الوحدة كما في الفاتورة), batch_number (string), expiry_date (YYYY-MM-DD أو فارغ), free_quantity (number), discount (number).',
        'إذا كانت قيمة غير مقروءة فاستخدم سلسلة فارغة أو 0 ولا تخترعها. العملة كما هي ولا تحولها. هذه مسودة للمراجعة فقط.',
      ].join('\n');
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + encodeURIComponent(apiKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: imageBase64 } }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
        }),
      });
      const body: any = await response.json();
      if (!response.ok) throw new Error(body?.error?.message || 'تعذر الاتصال بخدمة Gemini');
      const text = body?.candidates?.[0]?.content?.parts?.map((part: any) => part.text || '').join('') || '';
      if (!text) throw new Error('لم تُرجع خدمة OCR نصاً قابلاً للقراءة');
      setRawText(text);
      const parsed = parseJsonResponse(text);
      setDraft(parsed);
      if (!parsed.items.length) showAlert('لم تُكتشف أصناف', 'لم أستطع قراءة سطور الأصناف بوضوح. جرّب صورة أوضح أو أدخل الفاتورة يدوياً.');
    } catch (error: any) {
      showAlert('فشل تحليل الفاتورة', error?.message || 'تعذر تحليل الصورة. تحقق من الإنترنت وصلاحية المفتاح وحصة الاستخدام.');
    } finally {
      setBusy(false);
    }
  };

  const continueToPurchase = async () => {
    if (!draft?.items?.length) return;
    try {
      await AsyncStorage.setItem('pharmacy_purchase_ocr_draft', JSON.stringify(draft));
      router.push('/add-purchase?ocrDraft=1' as any);
    } catch (error: any) {
      showAlert('تعذر حفظ المسودة', error?.message || 'لم أتمكن من حفظ مسودة OCR محلياً.');
    }
  };

  const card = { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 13, marginBottom: 11 };
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
      <View style={{ backgroundColor: colors.primary, padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <TouchableOpacity onPress={() => router.back()}><MaterialIcons name="arrow-forward" size={23} color="#FFFFFF" /></TouchableOpacity>
        <Text style={{ color: '#FFFFFF', fontSize: 17, fontWeight: '800' }}>قراءة فاتورة شراء بالذكاء الاصطناعي</Text>
        <MaterialIcons name="document-scanner" size={23} color="#FFFFFF" />
      </View>
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 36 }}>
        <View style={card}>
          <Text style={{ color: colors.textPrimary, textAlign: 'right', fontWeight: '800', fontSize: 15 }}>١. تصوير الفاتورة أو اختيار صورة</Text>
          <Text style={{ color: colors.textSecondary, textAlign: 'right', lineHeight: 20, marginTop: 5, marginBottom: 12 }}>التقط صورة واضحة تشمل أسماء الأدوية والكميات والأسعار والتشغيلات والصلاحية. لا تُرحّل أي بيانات تلقائياً.</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity onPress={() => { void chooseImage(true); }} style={{ flex: 1, backgroundColor: colors.primary, borderRadius: 9, padding: 12, alignItems: 'center' }}>
              <MaterialIcons name="photo-camera" size={22} color="#FFFFFF" />
              <Text style={{ color: '#FFFFFF', fontWeight: '700', marginTop: 4 }}>فتح الكاميرا</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { void chooseImage(false); }} style={{ flex: 1, borderWidth: 1, borderColor: colors.primary, borderRadius: 9, padding: 12, alignItems: 'center' }}>
              <MaterialIcons name="photo-library" size={22} color={colors.primary} />
              <Text style={{ color: colors.primary, fontWeight: '700', marginTop: 4 }}>من المعرض</Text>
            </TouchableOpacity>
          </View>
          {imageUri ? <Image source={{ uri: imageUri }} resizeMode="contain" style={{ width: '100%', height: 260, marginTop: 12, borderRadius: 8, backgroundColor: colors.surfaceAlt }} /> : null}
          <TouchableOpacity disabled={!imageBase64 || busy} onPress={() => { void analyze(); }} style={{ backgroundColor: colors.primary, borderRadius: 9, padding: 13, marginTop: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, opacity: !imageBase64 || busy ? 0.55 : 1 }}>
            {busy ? <ActivityIndicator color="#FFFFFF" /> : <MaterialIcons name="auto-awesome" size={20} color="#FFFFFF" />}
            <Text style={{ color: '#FFFFFF', fontWeight: '800' }}>{busy ? 'جارٍ قراءة الفاتورة…' : 'تحليل الصورة واستخراج الأصناف'}</Text>
          </TouchableOpacity>
        </View>
        {draft ? <View style={card}>
          <Text style={{ color: colors.textPrimary, textAlign: 'right', fontWeight: '800', fontSize: 15 }}>٢. مراجعة البيانات المستخرجة</Text>
          <Text style={{ color: colors.textSecondary, textAlign: 'right', marginTop: 7 }}>رقم الفاتورة: {draft.invoice_number || 'غير مقروء'}</Text>
          <Text style={{ color: colors.textSecondary, textAlign: 'right', marginTop: 4 }}>التاريخ: {draft.date || 'غير مقروء'}</Text>
          <Text style={{ color: colors.textSecondary, textAlign: 'right', marginTop: 4 }}>المورد: {draft.supplier_name || 'غير محدد'}</Text>
          <Text style={{ color: colors.textPrimary, textAlign: 'right', fontWeight: '700', marginTop: 12, marginBottom: 6 }}>الأصناف: {draft.items.length}</Text>
          {draft.items.map((item, index) => <View key={String(index)} style={{ borderTopWidth: 1, borderTopColor: colors.divider, paddingVertical: 9 }}>
            <Text style={{ color: colors.textPrimary, textAlign: 'right', fontWeight: '700' }}>{index + 1}. {item.name}</Text>
            <Text style={{ color: colors.textSecondary, textAlign: 'right', fontSize: 12, marginTop: 3 }}>الكمية: {item.quantity} {item.unit || ''} · السعر: {item.purchase_price} · التشغيلة: {item.batch_number || '—'} · الصلاحية: {item.expiry_date || '—'}</Text>
          </View>)}
          <Text style={{ color: colors.warning, textAlign: 'right', lineHeight: 19, fontSize: 12, marginTop: 8 }}>تحقق من كل اسم وكمية وسعر وصلاحية داخل فاتورة الشراء قبل الحفظ؛ OCR قد يخطئ في الأرقام أو الأسماء.</Text>
          <TouchableOpacity onPress={() => { void continueToPurchase(); }} style={{ backgroundColor: colors.primary, borderRadius: 9, padding: 13, alignItems: 'center', marginTop: 12 }}>
            <Text style={{ color: '#FFFFFF', fontWeight: '800' }}>متابعة إلى مسودة فاتورة الشراء</Text>
          </TouchableOpacity>
        </View> : null}
        <Text style={{ color: colors.textTertiary, textAlign: 'center', fontSize: 11, lineHeight: 17, paddingHorizontal: 8 }}>تحتاج هذه الميزة إلى الإنترنت ومفتاح Gemini مضبوط من الإعدادات. تُرسل صورة الفاتورة إلى Google Gemini للتحليل، ولا يتم اعتماد فاتورة أو تغيير المخزون إلا بعد مراجعتك وحفظك من شاشة المشتريات.</Text>
      </ScrollView>
    </View>
  );
}
