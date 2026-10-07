// Smart Pharmacy ERP — Arabic PDF, share, and print service
import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { formatCurrency } from '@/constants/i18n';

export interface PdfReportSummary {
  cashSales: number;
  creditSales: number;
  totalSales: number;
  collections: number;
  totalExpenses: number;
  totalPurchases: number;
  grossProfit?: number;
  netCash: number;
  transactionCount: number;
  cogs?: number;
}

export interface PdfReportData {
  pharmacyName: string;
  periodLabel: string;
  dateRange: string;
  summary: PdfReportSummary;
  expensesByCategory: { category: string; total: number }[];
}

export interface PdfInvoiceLine {
  name: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  discount?: number;
  total: number;
  details?: string;
}

export interface PdfInvoiceData {
  pharmacyName: string;
  kind: 'sale' | 'purchase';
  invoiceNumber: string;
  date: string;
  partyName?: string | null;
  partyLabel?: string;
  paymentLabel?: string;
  cancelled?: boolean;
  cancelReason?: string | null;
  subtotal: number;
  discount: number;
  total: number;
  amountPaid: number;
  remaining: number;
  changeGiven?: number;
  grossProfit?: number;
  notes?: string | null;
  items: PdfInvoiceLine[];
}

export interface PdfAccountTransaction {
  date: string;
  type: string;
  description?: string | null;
  amount: number;
  balanceAfter: number;
}

export interface PdfAccountStatementData {
  pharmacyName: string;
  title: string;
  accountName: string;
  phone?: string | null;
  balance: number;
  balanceLabel: string;
  totalPrimary: number;
  totalPrimaryLabel: string;
  totalPayments: number;
  transactions: PdfAccountTransaction[];
}

export interface PdfTableReportData {
  pharmacyName: string;
  title: string;
  periodLabel?: string;
  dateRange?: string;
  accent?: string;
  summary?: { label: string; value: string | number; tone?: 'positive' | 'negative' | 'neutral' }[];
  columns: string[];
  rows: (string | number)[][];
  emptyMessage?: string;
  footerNote?: string;
}

export interface PdfDocumentOptions {
  html: string;
  title: string;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function money(value: number): string {
  return escapeHtml(formatCurrency(Number.isFinite(value) ? value : 0));
}

function pageFooter(): string {
  return `<div class="footer">تم الإنشاء بواسطة نظام صيدلية ذكية · ${escapeHtml(new Date().toLocaleDateString('ar-SA'))}</div>`;
}

function buildDocument(params: {
  pharmacyName: string;
  title: string;
  subtitle?: string;
  accent?: string;
  body: string;
}): string {
  const { pharmacyName, title, subtitle, body } = params;
  const accent = /^#(?:[0-9a-fA-F]{3}){1,2}$/.test(params.accent || '') ? params.accent! : '#0052CC';
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} — ${escapeHtml(pharmacyName)}</title>
  <style>
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #F4F5F7; color: #172B4D; direction: rtl; font-family: Tahoma, Arial, sans-serif; font-size: 13px; line-height: 1.55; }
    .page { width: 100%; max-width: 190mm; margin: 0 auto; background: #fff; }
    .header { padding: 24px 28px 20px; color: #fff; text-align: center; background: linear-gradient(135deg, ${accent}, #172B4D); }
    .header h1 { margin: 0; font-size: 22px; font-weight: 800; }
    .header .pharmacy { margin: 6px 0 0; font-size: 14px; opacity: .9; }
    .header .subtitle { display: inline-block; margin-top: 12px; padding: 4px 14px; border: 1px solid rgba(255,255,255,.32); border-radius: 999px; font-size: 12px; }
    .content { padding: 22px 26px 8px; }
    .section { margin-bottom: 18px; border: 1px solid #E2E8F0; border-radius: 9px; overflow: hidden; }
    .section-title { padding: 10px 12px; color: #172B4D; font-size: 14px; font-weight: 800; background: #F8FAFC; border-bottom: 1px solid #E2E8F0; }
    .summary-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; padding: 12px; }
    .metric { padding: 10px; text-align: center; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 7px; }
    .metric .label { color: #5E6C84; font-size: 11px; }
    .metric .value { margin-top: 3px; color: #172B4D; direction: ltr; font-size: 15px; font-weight: 800; }
    .positive { color: #00875A !important; } .negative { color: #DE350B !important; } .muted { color: #5E6C84; }
    table { width: 100%; border-collapse: collapse; }
    th { padding: 9px 7px; color: #5E6C84; font-size: 11px; font-weight: 700; text-align: right; background: #F8FAFC; border-bottom: 1px solid #E2E8F0; }
    td { padding: 9px 7px; vertical-align: top; border-bottom: 1px solid #EDF2F7; }
    tr:last-child td { border-bottom: 0; }
    td.number, th.number { direction: ltr; text-align: left; white-space: nowrap; font-weight: 700; }
    .totals { width: min(100%, 360px); margin-right: auto; }
    .totals td { padding: 7px 10px; } .totals .total-row td { color: #172B4D; font-size: 15px; font-weight: 800; background: #F0F7FF; }
    .notice { margin-bottom: 14px; padding: 10px 12px; color: #9B2C2C; background: #FFF5F5; border: 1px solid #FEB2B2; border-radius: 7px; font-weight: 700; }
    .note { padding: 11px 12px; color: #4A5568; background: #FFFDF2; border: 1px solid #F6E05E; border-radius: 7px; white-space: pre-line; }
    .empty { padding: 24px; color: #718096; text-align: center; }
    .footer { padding: 16px 22px; color: #718096; text-align: center; font-size: 10px; }
    @media print { body { background: #fff; } .page { max-width: none; } .header { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    @media (max-width: 520px) { .content { padding: 16px 12px 4px; } .header { padding: 20px 14px 16px; } .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  </style>
</head>
<body>
  <main class="page">
    <header class="header">
      <h1>${escapeHtml(title)}</h1>
      <div class="pharmacy">${escapeHtml(pharmacyName || 'صيدليتي')}</div>
      ${subtitle ? `<div class="subtitle">${escapeHtml(subtitle)}</div>` : ''}
    </header>
    <div class="content">${body}</div>
    ${pageFooter()}
  </main>
</body>
</html>`;
}

function openWebPrintWindow(html: string): void {
  if (typeof window === 'undefined') throw new Error('الطباعة غير متاحة في هذه البيئة');
  const printWindow = window.open('', '_blank');
  if (!printWindow) throw new Error('تعذر فتح نافذة الطباعة. اسمح بالنوافذ المنبثقة ثم أعد المحاولة.');
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  window.setTimeout(() => printWindow.print(), 350);
}

/** Generates a real PDF and opens the operating system share sheet on Android/iOS. */
export async function sharePdfDocument({ html, title }: PdfDocumentOptions): Promise<void> {
  if (Platform.OS === 'web') {
    openWebPrintWindow(html);
    return;
  }

  const { uri } = await Print.printToFileAsync({ html, base64: false });
  const available = await Sharing.isAvailableAsync();
  if (!available) throw new Error('المشاركة غير متاحة على هذا الجهاز');
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    dialogTitle: title,
    UTI: 'com.adobe.pdf',
  });
}

/** Opens the platform print dialog. Devices may save the rendered document as a PDF. */
export async function printPdfDocument({ html }: PdfDocumentOptions): Promise<void> {
  if (Platform.OS === 'web') {
    openWebPrintWindow(html);
    return;
  }

  await Print.printAsync({ html });
}

export function buildReportHtml(data: PdfReportData): string {
  const { pharmacyName, periodLabel, dateRange, summary, expensesByCategory } = data;
  const grossProfit = summary.grossProfit ?? (summary.totalSales - (summary.cogs ?? 0));
  const expenseRows = expensesByCategory.length
    ? expensesByCategory.map((item) => `<tr><td>${escapeHtml(item.category)}</td><td class="number negative">${money(item.total)}</td></tr>`).join('')
    : '<tr><td colspan="2" class="empty">لا توجد مصروفات في هذه الفترة</td></tr>';

  const summaryRows = [
    ['مبيعات نقدية', money(summary.cashSales), 'positive'],
    ['مبيعات آجلة', money(summary.creditSales), ''],
    ['تحصيلات', money(summary.collections), 'positive'],
    ['تكلفة البضاعة', money(summary.cogs ?? 0), 'muted'],
    ['إجمالي المبيعات', money(summary.totalSales), 'positive'],
    ['إجمالي الربح', money(grossProfit), grossProfit >= 0 ? 'positive' : 'negative'],
  ].map(([label, value, tone]) => `<tr><td>${label}</td><td class="number ${tone}">${value}</td></tr>`).join('');

  return buildDocument({
    pharmacyName,
    title: 'التقرير المالي',
    subtitle: `${periodLabel} · ${dateRange}`,
    accent: '#0052CC',
    body: `
      <div class="summary-grid">
        <div class="metric"><div class="label">صافي الحركة</div><div class="value ${summary.netCash >= 0 ? 'positive' : 'negative'}">${money(summary.netCash)}</div></div>
        <div class="metric"><div class="label">عدد الفواتير</div><div class="value">${escapeHtml(summary.transactionCount)}</div></div>
        <div class="metric"><div class="label">إجمالي المصروفات</div><div class="value negative">${money(summary.totalExpenses)}</div></div>
      </div>
      <section class="section"><div class="section-title">ملخص المبيعات</div><table><tbody>${summaryRows}</tbody></table></section>
      <section class="section"><div class="section-title">المصروفات والمشتريات</div><table><tbody>
        <tr><td>إجمالي المصروفات</td><td class="number negative">${money(summary.totalExpenses)}</td></tr>
        <tr><td>إجمالي المشتريات</td><td class="number">${money(summary.totalPurchases)}</td></tr>
        <tr><td><strong>إجمالي التدفقات الخارجة</strong></td><td class="number negative"><strong>${money(summary.totalExpenses + summary.totalPurchases)}</strong></td></tr>
      </tbody></table></section>
      <section class="section"><div class="section-title">المصروفات حسب الفئة</div><table><thead><tr><th>الفئة</th><th class="number">القيمة</th></tr></thead><tbody>${expenseRows}</tbody></table></section>
    `,
  });
}

export function buildInvoiceHtml(data: PdfInvoiceData): string {
  const isSale = data.kind === 'sale';
  const title = isSale ? 'فاتورة مبيعات' : 'فاتورة مشتريات';
  const partyLabel = data.partyLabel || (isSale ? 'العميل' : 'المورد');
  const itemRows = data.items.length
    ? data.items.map((item, index) => `<tr>
        <td>${index + 1}</td>
        <td><strong>${escapeHtml(item.name)}</strong>${item.details ? `<br><span class="muted">${escapeHtml(item.details)}</span>` : ''}</td>
        <td>${escapeHtml(item.quantity)} ${escapeHtml(item.unit || '')}</td>
        <td class="number">${money(item.unitPrice)}</td>
        <td class="number">${item.discount ? money(item.discount) : '—'}</td>
        <td class="number">${money(item.total)}</td>
      </tr>`).join('')
    : '<tr><td colspan="6" class="empty">لا توجد أصناف في الفاتورة</td></tr>';

  const typeText = data.paymentLabel || (isSale ? 'بيع' : 'شراء');
  return buildDocument({
    pharmacyName: data.pharmacyName,
    title,
    subtitle: `${data.invoiceNumber} · ${data.date}`,
    accent: isSale ? '#00875A' : '#6554C0',
    body: `
      ${data.cancelled ? `<div class="notice">هذه الفاتورة ملغاة${data.cancelReason ? ` — ${escapeHtml(data.cancelReason)}` : ''}</div>` : ''}
      <section class="section"><div class="section-title">بيانات الفاتورة</div><div class="summary-grid">
        <div class="metric"><div class="label">رقم الفاتورة</div><div class="value">${escapeHtml(data.invoiceNumber)}</div></div>
        <div class="metric"><div class="label">${escapeHtml(partyLabel)}</div><div class="value">${escapeHtml(data.partyName || (isSale ? 'عميل نقدي' : 'مورد مباشر'))}</div></div>
        <div class="metric"><div class="label">نوع العملية</div><div class="value">${escapeHtml(typeText)}</div></div>
      </div></section>
      <section class="section"><div class="section-title">الأصناف</div><table><thead><tr><th>#</th><th>الصنف</th><th>الكمية</th><th class="number">السعر</th><th class="number">الخصم</th><th class="number">الإجمالي</th></tr></thead><tbody>${itemRows}</tbody></table></section>
      <section class="section"><div class="section-title">الإجماليات</div><table class="totals"><tbody>
        <tr><td>المجموع الفرعي</td><td class="number">${money(data.subtotal)}</td></tr>
        ${data.discount > 0 ? `<tr><td>الخصم</td><td class="number negative">${money(data.discount)}</td></tr>` : ''}
        <tr class="total-row"><td>الإجمالي النهائي</td><td class="number">${money(data.total)}</td></tr>
        <tr><td>المدفوع</td><td class="number positive">${money(data.amountPaid)}</td></tr>
        ${data.changeGiven && data.changeGiven > 0 ? `<tr><td>الباقي للعميل</td><td class="number">${money(data.changeGiven)}</td></tr>` : ''}
        ${data.remaining > 0 ? `<tr><td>المتبقي</td><td class="number negative">${money(data.remaining)}</td></tr>` : ''}
        ${isSale && typeof data.grossProfit === 'number' ? `<tr><td>إجمالي الربح</td><td class="number ${data.grossProfit >= 0 ? 'positive' : 'negative'}">${money(data.grossProfit)}</td></tr>` : ''}
      </tbody></table></section>
      ${data.notes ? `<div class="note"><strong>ملاحظات:</strong> ${escapeHtml(data.notes)}</div>` : ''}
    `,
  });
}

export function buildAccountStatementHtml(data: PdfAccountStatementData): string {
  const rows = data.transactions.length
    ? data.transactions.map((transaction) => `<tr>
        <td>${escapeHtml(transaction.date)}</td>
        <td>${escapeHtml(transaction.type)}</td>
        <td>${escapeHtml(transaction.description || '—')}</td>
        <td class="number ${transaction.amount >= 0 ? 'negative' : 'positive'}">${transaction.amount > 0 ? '+' : '−'}${money(Math.abs(transaction.amount))}</td>
        <td class="number">${money(Math.abs(transaction.balanceAfter))}</td>
      </tr>`).join('')
    : '<tr><td colspan="5" class="empty">لا توجد معاملات مسجلة</td></tr>';

  return buildDocument({
    pharmacyName: data.pharmacyName,
    title: data.title,
    subtitle: `حتى ${new Date().toLocaleDateString('ar-SA')}`,
    accent: '#0052CC',
    body: `
      <section class="section"><div class="section-title">بيانات الحساب</div><div class="summary-grid">
        <div class="metric"><div class="label">صاحب الحساب</div><div class="value">${escapeHtml(data.accountName)}</div></div>
        <div class="metric"><div class="label">${escapeHtml(data.balanceLabel)}</div><div class="value ${data.balance > 0 ? 'negative' : 'positive'}">${money(Math.abs(data.balance))}</div></div>
        <div class="metric"><div class="label">رقم الهاتف</div><div class="value">${escapeHtml(data.phone || 'غير مسجل')}</div></div>
      </div></section>
      <section class="section"><div class="section-title">ملخص الحساب</div><div class="summary-grid">
        <div class="metric"><div class="label">${escapeHtml(data.totalPrimaryLabel)}</div><div class="value">${money(data.totalPrimary)}</div></div>
        <div class="metric"><div class="label">إجمالي المدفوعات</div><div class="value positive">${money(data.totalPayments)}</div></div>
        <div class="metric"><div class="label">عدد المعاملات</div><div class="value">${data.transactions.length}</div></div>
      </div></section>
      <section class="section"><div class="section-title">المعاملات</div><table><thead><tr><th>التاريخ</th><th>النوع</th><th>البيان</th><th class="number">المبلغ</th><th class="number">الرصيد بعد الحركة</th></tr></thead><tbody>${rows}</tbody></table></section>
    `,
  });
}

export function buildTableReportHtml(data: PdfTableReportData): string {
  const rows = data.rows.length
    ? data.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${data.columns.length}" class="empty">${escapeHtml(data.emptyMessage || 'لا توجد بيانات ضمن الفلتر الحالي')}</td></tr>`;
  const summary = data.summary?.length
    ? `<section class="section"><div class="section-title">ملخص</div><div class="summary-grid">${data.summary.map((item) => `<div class="metric"><div class="label">${escapeHtml(item.label)}</div><div class="value ${item.tone === 'positive' ? 'positive' : item.tone === 'negative' ? 'negative' : ''}">${escapeHtml(item.value)}</div></div>`).join('')}</div></section>`
    : '';

  return buildDocument({
    pharmacyName: data.pharmacyName,
    title: data.title,
    subtitle: [data.periodLabel, data.dateRange].filter(Boolean).join(' · '),
    accent: data.accent || '#0052CC',
    body: `${summary}<section class="section"><div class="section-title">تفاصيل التقرير</div><table><thead><tr>${data.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></section>${data.footerNote ? `<div class="note">${escapeHtml(data.footerNote)}</div>` : ''}`,
  });
}

/** Backward-compatible helper retained for existing report callers. */
export async function generateAndSharePdf(data: PdfReportData): Promise<void> {
  await sharePdfDocument({ html: buildReportHtml(data), title: `تقرير ${data.pharmacyName}` });
}
