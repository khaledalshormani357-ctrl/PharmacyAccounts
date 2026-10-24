import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import QRCode from 'react-native-qrcode-svg';
import { RTCPeerConnection, RTCSessionDescription } from 'react-native-webrtc';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { createBackup, restoreBackup } from '@/services/database';
import { useAlert } from '@/template';

const CHUNK_SIZE = 10000;

function waitForIce(peer: any): Promise<void> {
  if (peer.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise(resolve => {
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      peer.removeEventListener?.('icegatheringstatechange', check);
      resolve();
    };
    const check = () => { if (peer.iceGatheringState === 'complete') done(); };
    peer.addEventListener?.('icegatheringstatechange', check);
    peer.onicegatheringstatechange = check;
    setTimeout(done, 15000);
  });
}

export default function LocalTransferScreen() {
  const { theme } = useTheme();
  const colors = theme.colors;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showAlert } = useAlert();
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<'idle' | 'send' | 'receive'>('idle');
  const [signal, setSignal] = useState('');
  const [scanMode, setScanMode] = useState<'offer' | 'answer' | null>(null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('اختر إرسال أو استقبال للبدء.');
  const [progress, setProgress] = useState(0);
  const [pendingBackup, setPendingBackup] = useState<any>(null);
  const [pendingBytes, setPendingBytes] = useState(0);
  const peerRef = useRef<any>(null);
  const channelRef = useRef<any>(null);
  const scannedRef = useRef(false);
  const chunksRef = useRef<string[]>([]);
  const expectedChunksRef = useRef(0);

  const closePeer = () => {
    try { channelRef.current?.close(); } catch {}
    try { peerRef.current?.close(); } catch {}
    channelRef.current = null;
    peerRef.current = null;
    setConnected(false);
  };

  useEffect(() => () => {
    try { channelRef.current?.close(); } catch {}
    try { peerRef.current?.close(); } catch {}
  }, []);

  const handleDataMessage = (event: any) => {
    try {
      const message = JSON.parse(String(event.data || '{}'));
      if (message.type === 'start') {
        expectedChunksRef.current = Number(message.totalChunks) || 0;
        chunksRef.current = new Array(expectedChunksRef.current);
        setProgress(0);
        setPendingBytes(Number(message.bytes) || 0);
        setStatus('يتم استقبال النسخة الاحتياطية عبر الاتصال المباشر…');
        return;
      }
      if (message.type === 'chunk') {
        if (!Number.isInteger(message.index) || message.index < 0 || message.index >= expectedChunksRef.current) return;
        chunksRef.current[message.index] = String(message.data || '');
        const received = chunksRef.current.filter(value => typeof value === 'string').length;
        setProgress(expectedChunksRef.current ? Math.round(received / expectedChunksRef.current * 100) : 0);
        if (expectedChunksRef.current > 0 && received === expectedChunksRef.current) {
          const raw = chunksRef.current.join('');
          const parsed = JSON.parse(raw);
          if (!parsed || !Array.isArray(parsed.products) || !Array.isArray(parsed.batches) || !Array.isArray(parsed.sales)) {
            throw new Error('بنية النسخة المستلمة غير صالحة');
          }
          setPendingBackup(parsed);
          setStatus('اكتمل الاستقبال. راجع الملف ثم اضغط اعتماد الاستعادة.');
        }
      }
    } catch (error: any) {
      setStatus('تعذر استقبال البيانات: ' + (error?.message || 'رسالة غير صالحة'));
    }
  };

  const createSender = async () => {
    closePeer();
    scannedRef.current = false;
    setBusy(true);
    try {
      const peer: any = new RTCPeerConnection({ iceServers: [] });
      peerRef.current = peer;
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') setStatus('انقطع الاتصال. تأكد أن الهاتفين على شبكة Wi-Fi نفسها ثم أعد المحاولة.');
      };
      const channel = peer.createDataChannel('pharmacy-local-backup');
      channelRef.current = channel;
      channel.onopen = () => { setConnected(true); setStatus('اتصل الهاتفان مباشرة وبأمان. يمكنك إرسال النسخة الآن.'); };
      channel.onmessage = handleDataMessage;
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await waitForIce(peer);
      const sdp = peer.localDescription?.sdp;
      if (!sdp) throw new Error('تعذر إنشاء رمز الاتصال');
      setSignal(JSON.stringify({ type: 'offer', sdp }));
      setMode('send');
      setScanMode(null);
      setStatus('اعرض رمز العرض للهاتف المستقبِل، ثم اضغط «مسح رمز الإجابة».');
    } catch (error: any) {
      setStatus(error?.message || 'تعذر بدء الإرسال');
      closePeer();
    } finally {
      setBusy(false);
    }
  };

  const startReceiverScan = async () => {
    if (!permission?.granted) {
      const response = await requestPermission();
      if (!response.granted) {
        showAlert('إذن الكاميرا مطلوب', 'اسمح باستخدام الكاميرا لمسح رمز الاتصال بين الهاتفين.');
        return;
      }
    }
    closePeer();
    scannedRef.current = false;
    setMode('receive');
    setSignal('');
    setScanMode('offer');
    setStatus('امسح رمز العرض الظاهر على هاتف الإرسال.');
  };

  const scanAnswer = async () => {
    if (!permission?.granted) {
      const response = await requestPermission();
      if (!response.granted) {
        showAlert('إذن الكاميرا مطلوب', 'اسمح باستخدام الكاميرا لمسح رمز الإجابة.');
        return;
      }
    }
    scannedRef.current = false;
    setScanMode('answer');
    setStatus('امسح رمز الإجابة الظاهر على هاتف الاستقبال.');
  };

  const handleScan = async (data: string) => {
    if (!scanMode || scannedRef.current) return;
    scannedRef.current = true;
    setScanMode(null);
    try {
      const packet = JSON.parse(data);
      if (scanMode === 'offer' && packet.type === 'offer' && typeof packet.sdp === 'string') {
        setBusy(true);
        const peer: any = new RTCPeerConnection({ iceServers: [] });
        peerRef.current = peer;
        peer.ondatachannel = (event: any) => {
          channelRef.current = event.channel;
          event.channel.onopen = () => { setConnected(true); setStatus('تم الاتصال المباشر. انتظر وصول النسخة من هاتف الإرسال.'); };
          event.channel.onmessage = handleDataMessage;
        };
        await peer.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: packet.sdp }));
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        await waitForIce(peer);
        const sdp = peer.localDescription?.sdp;
        if (!sdp) throw new Error('تعذر إنشاء رمز الإجابة');
        setSignal(JSON.stringify({ type: 'answer', sdp }));
        setStatus('اعرض رمز الإجابة على هذا الهاتف وامسحه من هاتف الإرسال.');
      } else if (scanMode === 'answer' && packet.type === 'answer' && typeof packet.sdp === 'string' && mode === 'send') {
        if (!peerRef.current) throw new Error('جلسة الإرسال غير موجودة؛ أعد بدء الإرسال.');
        await peerRef.current.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: packet.sdp }));
        setStatus('تم تبادل رموز الاتصال. جارٍ إنشاء الاتصال المباشر…');
      } else {
        throw new Error('هذا الرمز ليس رمز الاتصال المتوقع لهذه الخطوة.');
      }
    } catch (error: any) {
      scannedRef.current = false;
      setStatus(error?.message || 'تعذر قراءة رمز الاتصال');
    } finally {
      setBusy(false);
    }
  };

  const sendBackup = async () => {
    const channel = channelRef.current;
    if (!channel || channel.readyState !== 'open') {
      showAlert('الاتصال غير جاهز', 'انتظر حتى يظهر أن الهاتفين متصلان مباشرة.');
      return;
    }
    setBusy(true);
    try {
      const json = JSON.stringify(createBackup());
      const totalChunks = Math.ceil(json.length / CHUNK_SIZE);
      channel.send(JSON.stringify({ type: 'start', totalChunks, bytes: json.length }));
      for (let index = 0; index < totalChunks; index += 1) {
        channel.send(JSON.stringify({ type: 'chunk', index, data: json.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE) }));
        setProgress(Math.round((index + 1) / totalChunks * 100));
        while (channel.bufferedAmount > 128 * 1024) {
          await new Promise(resolve => setTimeout(resolve, 30));
        }
      }
      setStatus('تم إرسال ملف النسخة. انتظر تأكيد اكتمال الاستقبال على الهاتف الآخر.');
    } catch (error: any) {
      setStatus(error?.message || 'فشل إرسال النسخة');
    } finally {
      setBusy(false);
    }
  };

  const confirmRestore = () => {
    if (!pendingBackup) return;
    showAlert('استعادة نسخة من الهاتف الآخر', 'سيتم استبدال بيانات الصيدلية الحالية بالنسخة المستلمة. أنشئ نسخة احتياطية من هذا الهاتف أولاً. هل تريد المتابعة؟', [
      { text: 'إلغاء', style: 'cancel' },
      { text: 'استعادة', style: 'destructive', onPress: async () => {
        try {
          const result = await restoreBackup(pendingBackup);
          if (result.success) {
            setPendingBackup(null);
            setStatus('تمت استعادة النسخة وحفظها محلياً.');
            showAlert('اكتملت الاستعادة', 'تم نقل البيانات من الهاتف الآخر. إعدادات PIN المحلية لهذا الجهاز لا يتم استبدالها.');
          } else showAlert('فشلت الاستعادة', result.error || 'تعذر اعتماد النسخة.');
        } catch (error: any) {
          showAlert('فشلت الاستعادة', error?.message || 'تعذر حفظ النسخة المستلمة.');
        }
      }},
    ]);
  };

  const card = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, marginBottom: 12 };
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
      <View style={{ backgroundColor: colors.primary, padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <TouchableOpacity onPress={() => router.back()}><MaterialIcons name="arrow-forward" size={23} color="#FFFFFF" /></TouchableOpacity>
        <Text style={{ color: '#FFFFFF', fontSize: 17, fontWeight: '800' }}>النقل المباشر بين الهاتفين</Text>
        <MaterialIcons name="swap-horiz" size={23} color="#FFFFFF" />
      </View>
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 36 }}>
        <View style={card}>
          <Text style={{ color: colors.textPrimary, textAlign: 'right', fontWeight: '800', fontSize: 15 }}>نقل محلي مباشر بدون سحابة</Text>
          <Text style={{ color: colors.textSecondary, textAlign: 'right', lineHeight: 21, marginTop: 6 }}>ضع الهاتفين على شبكة Wi-Fi نفسها أو نقطة اتصال محلية. يتبادل الهاتفان رموز اتصال QR، ثم تُرسل النسخة الاحتياطية عبر قناة WebRTC مشفرة مباشرة بينهما. لا تُرسل البيانات إلى Supabase أو خدمة وسيطة.</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <TouchableOpacity disabled={busy} onPress={() => { void createSender(); }} style={{ flex: 1, backgroundColor: colors.primary, borderRadius: 9, padding: 12, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
              <MaterialIcons name="upload" size={22} color="#FFFFFF" />
              <Text style={{ color: '#FFFFFF', fontWeight: '800', marginTop: 4 }}>إرسال من هذا الهاتف</Text>
            </TouchableOpacity>
            <TouchableOpacity disabled={busy} onPress={() => { void startReceiverScan(); }} style={{ flex: 1, borderWidth: 1, borderColor: colors.primary, borderRadius: 9, padding: 12, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
              <MaterialIcons name="download" size={22} color={colors.primary} />
              <Text style={{ color: colors.primary, fontWeight: '800', marginTop: 4 }}>استقبال على هذا الهاتف</Text>
            </TouchableOpacity>
          </View>
        </View>
        {scanMode ? <View style={card}>
          <Text style={{ color: colors.textPrimary, textAlign: 'right', fontWeight: '800', marginBottom: 8 }}>{scanMode === 'offer' ? 'امسح رمز العرض' : 'امسح رمز الإجابة'}</Text>
          <CameraView style={{ width: '100%', height: 300, borderRadius: 10, overflow: 'hidden' }} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={({ data }) => { void handleScan(data); }} />
          <TouchableOpacity onPress={() => setScanMode(null)} style={{ padding: 10, alignItems: 'center' }}><Text style={{ color: colors.primary, fontWeight: '700' }}>إلغاء المسح</Text></TouchableOpacity>
        </View> : null}
        {signal && !scanMode ? <View style={[card, { alignItems: 'center' }]}>
          <Text style={{ color: colors.textPrimary, textAlign: 'right', alignSelf: 'stretch', fontWeight: '800', marginBottom: 12 }}>{mode === 'send' ? 'رمز العرض / رمز الإجابة' : 'رمز الإجابة — امسحه من هاتف الإرسال'}</Text>
          <View style={{ backgroundColor: '#FFFFFF', padding: 10, borderRadius: 10 }}><QRCode value={signal} size={240} ecl="L" /></View>
          <Text style={{ color: colors.textSecondary, textAlign: 'center', fontSize: 11, marginTop: 10, lineHeight: 17 }}>ابق هذه الشاشة مفتوحة حتى يكتمل تبادل رموز الاتصال.</Text>
          {mode === 'send' && !connected ? <TouchableOpacity onPress={() => { void scanAnswer(); }} style={{ backgroundColor: colors.primary, borderRadius: 9, padding: 12, alignItems: 'center', alignSelf: 'stretch', marginTop: 12 }}><Text style={{ color: '#FFFFFF', fontWeight: '800' }}>مسح رمز الإجابة</Text></TouchableOpacity> : null}
          {mode === 'send' && connected ? <TouchableOpacity disabled={busy} onPress={() => { void sendBackup(); }} style={{ backgroundColor: colors.primary, borderRadius: 9, padding: 12, alignItems: 'center', alignSelf: 'stretch', marginTop: 12, opacity: busy ? 0.6 : 1 }}><Text style={{ color: '#FFFFFF', fontWeight: '800' }}>{busy ? 'جارٍ الإرسال…' : 'إرسال النسخة الاحتياطية'}</Text></TouchableOpacity> : null}
        </View> : null}
        <View style={card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
            <Text style={{ color: colors.textPrimary, fontWeight: '800' }}>حالة النقل</Text>
            <MaterialIcons name={connected ? 'wifi' : 'info-outline'} size={20} color={connected ? colors.success : colors.textTertiary} />
          </View>
          <Text style={{ color: colors.textSecondary, textAlign: 'right', lineHeight: 21, marginTop: 7 }}>{status}</Text>
          {progress > 0 ? <Text style={{ color: colors.primary, textAlign: 'right', marginTop: 6, fontWeight: '800' }}>التقدم: {progress}%</Text> : null}
          {pendingBytes > 0 ? <Text style={{ color: colors.textTertiary, textAlign: 'right', marginTop: 4, fontSize: 11 }}>حجم البيانات النصية: {Math.round(pendingBytes / 1024)} كيلوبايت</Text> : null}
        </View>
        {pendingBackup ? <View style={card}>
          <Text style={{ color: colors.textPrimary, textAlign: 'right', fontWeight: '800' }}>تم استلام نسخة قابلة للمراجعة</Text>
          <Text style={{ color: colors.textSecondary, textAlign: 'right', lineHeight: 20, marginTop: 6 }}>الأصناف: {pendingBackup.products?.length || 0} · الدفعات: {pendingBackup.batches?.length || 0} · المبيعات: {pendingBackup.sales?.length || 0} · المشتريات: {pendingBackup.purchases?.length || 0}</Text>
          <TouchableOpacity onPress={confirmRestore} style={{ backgroundColor: colors.error, borderRadius: 9, padding: 13, alignItems: 'center', marginTop: 12 }}><Text style={{ color: '#FFFFFF', fontWeight: '800' }}>اعتماد الاستعادة واستبدال البيانات الحالية</Text></TouchableOpacity>
        </View> : null}
        <TouchableOpacity onPress={() => { closePeer(); setSignal(''); setMode('idle'); setScanMode(null); setPendingBackup(null); setProgress(0); setStatus('اختر إرسال أو استقبال للبدء.'); }} style={{ padding: 12, alignItems: 'center' }}>
          <Text style={{ color: colors.textTertiary, fontWeight: '700' }}>إنهاء جلسة النقل</Text>
        </TouchableOpacity>
        <Text style={{ color: colors.textTertiary, textAlign: 'center', fontSize: 11, lineHeight: 17 }}>النسخة المستلمة قد تستبدل بيانات الجهاز بالكامل. أنشئ نسخة من الجهاز المستقبل قبل اعتماد الاستعادة. لا تُضمّن كلمات المرور أو رموز PIN في ملف النقل.</Text>
      </ScrollView>
    </View>
  );
}
