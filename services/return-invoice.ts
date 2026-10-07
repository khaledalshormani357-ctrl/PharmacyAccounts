export interface ReturnInvoiceLine {
  name: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  total: number;
}

export interface ReturnInvoiceBodyData {
  kind: 'sale' | 'purchase';
  returnNumber: string;
  originalInvoiceNumber: string;
  date: string;
  partyName: string;
  settlementLabel: string;
  notes?: string | null;
  total: number;
  items: ReturnInvoiceLine[];
  formatMoney?: (value: number) => string;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function defaultMoney(value: number): string {
  return new Intl.NumberFormat('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number.isFinite(value) ? value : 0);
}

/** Only customer-/supplier-facing fields are accepted; no cost, COGS or profit fields. */
export function buildReturnInvoiceBody(data: ReturnInvoiceBodyData): string {
  const sales = data.kind === 'sale';
  const partyLabel = sales ? 'العميل' : 'المورد';
  const title = sales ? 'مرتجع مبيعات' : 'مرتجع مشتريات';
  const money = (value: number) => escapeHtml((data.formatMoney ?? defaultMoney)(value));
  const rows = data.items.length ? data.items.map((item, index) => `<tr>
    <td>${index + 1}</td><td><strong>${escapeHtml(item.name)}</strong></td>
    <td>${escapeHtml(item.quantity)} ${escapeHtml(item.unit)}</td>
    <td class="number">${money(item.unitPrice)}</td><td class="number">${money(item.total)}</td>
  </tr>`).join('') : '<tr><td colspan="5" class="empty">لا توجد أصناف</td></tr>';
  return `
    <div class="notice">${title} مستقل — الفاتورة الأصلية ${escapeHtml(data.originalInvoiceNumber)} لم تُلغَ.</div>
    <section class="section"><div class="section-title">بيانات المرتجع</div><div class="summary-grid">
      <div class="metric"><div class="label">رقم المرتجع</div><div class="value">${escapeHtml(data.returnNumber)}</div></div>
      <div class="metric"><div class="label">الفاتورة الأصلية</div><div class="value">${escapeHtml(data.originalInvoiceNumber)}</div></div>
      <div class="metric"><div class="label">التاريخ</div><div class="value">${escapeHtml(data.date)}</div></div>
      <div class="metric"><div class="label">${partyLabel}</div><div class="value">${escapeHtml(data.partyName || 'غير محدد')}</div></div>
      <div class="metric"><div class="label">طريقة التسوية</div><div class="value">${escapeHtml(data.settlementLabel)}</div></div>
    </div></section>
    <section class="section"><div class="section-title">الأصناف المرتجعة</div><table><thead><tr><th>#</th><th>الصنف</th><th>الكمية والوحدة</th><th class="number">السعر</th><th class="number">الإجمالي</th></tr></thead><tbody>${rows}</tbody></table></section>
    <section class="section"><table class="totals"><tbody><tr class="total-row"><td>إجمالي المرتجع</td><td class="number">${money(data.total)}</td></tr></tbody></table></section>
    ${data.notes ? `<div class="note"><strong>ملاحظات:</strong> ${escapeHtml(data.notes)}</div>` : ''}
  `;
}
