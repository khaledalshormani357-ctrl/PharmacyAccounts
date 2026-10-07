import React, { useState } from 'react';
import { ActivityIndicator, Alert, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { printPdfDocument, sharePdfDocument } from '@/services/pdfReport';

interface PdfActionsProps {
  buildHtml: () => string;
  title: string;
  color?: string;
  onError?: (message: string) => void;
}

/** Compact header actions that create a PDF for sharing or open native printing. */
export function PdfActions({ buildHtml, title, color = '#FFFFFF', onError }: PdfActionsProps) {
  const [action, setAction] = useState<'share' | 'print' | null>(null);

  const run = async (nextAction: 'share' | 'print') => {
    setAction(nextAction);
    try {
      const options = { html: buildHtml(), title };
      if (nextAction === 'share') await sharePdfDocument(options);
      else await printPdfDocument(options);
    } catch (error: any) {
      const message = error?.message || 'تعذر إنشاء مستند PDF';
      console.error('PDF action failed:', error);
      if (onError) onError(message);
      else Alert.alert('خطأ', message);
    } finally {
      setAction(null);
    }
  };

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <TouchableOpacity
        onPress={() => run('print')}
        disabled={action !== null}
        accessibilityRole="button"
        accessibilityLabel="طباعة المستند أو حفظه PDF"
        style={{ width: 34, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.42)', opacity: action && action !== 'print' ? 0.55 : 1 }}
      >
        {action === 'print' ? <ActivityIndicator size="small" color={color} /> : <MaterialIcons name="print" size={19} color={color} />}
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => run('share')}
        disabled={action !== null}
        accessibilityRole="button"
        accessibilityLabel="مشاركة ملف PDF"
        style={{ width: 34, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)', opacity: action && action !== 'share' ? 0.55 : 1 }}
      >
        {action === 'share' ? <ActivityIndicator size="small" color={color} /> : <MaterialIcons name="picture-as-pdf" size={19} color={color} />}
      </TouchableOpacity>
    </View>
  );
}
