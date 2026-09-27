// Smart Pharmacy ERP — PDF Report Service (web-safe, no native imports at module level)
import { Platform, Share } from 'react-native';
import { formatCurrency } from '@/constants/i18n';

export interface PdfReportSummary {
  cashSales: number; creditSales: number; totalSales: number;
  collections: number; totalExpenses: number; totalPurchases: number;
  grossProfit?: number; netCash: number; transactionCount: number; cogs?: number;
}

export interface PdfReportData {
  pharmacyName: string;
  periodLabel: string;
  dateRange: string;
  summary: PdfReportSummary;
  expensesByCategory: { category: string; total: number }[];
}

export function buildReportHtml(data: PdfReportData): string {
  const { pharmacyName, periodLabel, dateRange, summary, expensesByCategory } = data;
  const totalOut = summary.totalExpenses + summary.totalPurchases;
  const isProfit = summary.netCash >= 0;
  const profitColor = isProfit ? '#00875A' : '#EF4444';
  const grossProfit = summary.grossProfit ?? (summary.totalSales - (summary.cogs ?? 0));

  const catRows = expensesByCategory.length > 0
    ? expensesByCategory.map(c => `<tr><td class="num">${formatCurrency(c.total)}</td><td>${c.category}</td></tr>`).join('')
    : '<tr><td colspan="2" class="center muted">لا توجد مصروفات</td></tr>';

  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"/><title>${pharmacyName}</title>
<style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:'Segoe UI',Arial,sans-serif;direction:rtl;text-align:right;background:#F4F5F7;color:#172B4D;font-size:14px;}
.page{max-width:680px;margin:0 auto;background:#fff;}.header{background:linear-gradient(135deg,#00875A 0%,#006644 100%);color:#fff;padding:28px 32px 24px;text-align:center;}
.header h1{font-size:22px;font-weight:800;}.header .period{display:inline-block;margin-top:10px;background:rgba(255,255,255,0.18);border-radius:20px;padding:4px 16px;font-size:13px;}
.hero{text-align:center;padding:20px 32px;border-bottom:1px solid #E2E8F0;background:${isProfit ? '#E3F5EF' : '#FEE2E2'};}
.hero .amount{font-size:36px;font-weight:800;color:${profitColor};}
.section{padding:20px 32px;border-bottom:1px solid #E2E8F0;}.section-title{font-size:15px;font-weight:700;margin-bottom:14px;border-bottom:2px solid #E2E8F0;padding-bottom:8px;}
table{width:100%;border-collapse:collapse;}tr{border-bottom:1px solid #F1F5F9;}td{padding:10px 4px;font-size:14px;}td.num{font-weight:700;direction:ltr;text-align:left;}
td.green{color:#00875A;}td.red{color:#EF4444;}td.bold{font-weight:700;font-size:15px;}.footer{text-align:center;padding:16px;font-size:12px;color:#94A3B8;background:#F8FAFC;}</style></head>
<body><div class="page">
<div class="header"><h1>🏥 ${pharmacyName}</h1><div class="period">📅 ${periodLabel} · ${dateRange}</div></div>
<div class="hero"><div style="font-size:13px;color:#64748B;margin-bottom:4px">صافي الحركة</div><div class="amount">${formatCurrency(summary.netCash)}</div></div>
<div class="section"><div class="section-title">📊 تقرير المبيعات</div><table>
<tr><td>مبيعات نقدية</td><td class="num green">${formatCurrency(summary.cashSales)}</td></tr>
<tr><td>مبيعات آجلة</td><td class="num" style="color:#F59E0B">${formatCurrency(summary.creditSales)}</td></tr>
<tr><td>تحصيل ديون</td><td class="num" style="color:#0052CC">${formatCurrency(summary.collections)}</td></tr>
<tr><td class="bold">إجمالي المبيعات</td><td class="num green bold">${formatCurrency(summary.totalSales)}</td></tr>
<tr><td class="bold">إجمالي الربح</td><td class="num bold" style="color:#00875A">${formatCurrency(grossProfit)}</td></tr>
</table></div>
<div class="section"><div class="section-title">📉 المصروفات والمشتريات</div><table>
<tr><td>إجمالي المصروفات</td><td class="num red">${formatCurrency(summary.totalExpenses)}</td></tr>
<tr><td>إجمالي المشتريات</td><td class="num" style="color:#6554C0">${formatCurrency(summary.totalPurchases)}</td></tr>
<tr><td class="bold">الإجمالي</td><td class="num red bold">${formatCurrency(totalOut)}</td></tr>
</table></div>
${expensesByCategory.length > 0 ? `<div class="section"><div class="section-title">🏷️ المصروفات حسب الفئة</div><table>${catRows}</table></div>` : ''}
<div class="footer">تم الإنشاء بواسطة نظام صيدلية ذكية · ${new Date().toLocaleDateString('ar-SA')}</div>
</div></body></html>`;
}

export async function generateAndSharePdf(data: PdfReportData): Promise<void> {
  const html = buildReportHtml(data);

  if (Platform.OS === 'web') {
    const win = typeof window !== 'undefined' ? window.open('', '_blank') : null;
    if (win) {
      win.document.write(html);
      win.document.close();
      win.focus();
      setTimeout(() => win.print(), 500);
    }
    return;
  }

  // Native: load expo-print and expo-sharing at runtime (avoids static Metro analysis)
  const requireNative = new Function('mod', 'return require(mod)');
  try {
    const Print = requireNative('expo-print');
    const Sharing = requireNative('expo-sharing');
    const { uri } = await Print.printToFileAsync({ html, base64: false });
    const isAvailable = await Sharing.isAvailableAsync();
    if (isAvailable) {
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `تقرير ${data.pharmacyName}`, UTI: 'com.adobe.pdf' });
    } else {
      await Share.share({ title: `تقرير ${data.pharmacyName}`, message: `تقرير ${data.periodLabel}: صافي الحركة ${formatCurrency(data.summary.netCash)}` });
    }
  } catch {
    await Share.share({ title: `تقرير ${data.pharmacyName}`, message: `${data.periodLabel} (${data.dateRange})\nالمبيعات: ${formatCurrency(data.summary.totalSales)}\nصافي الحركة: ${formatCurrency(data.summary.netCash)}` });
  }
}
