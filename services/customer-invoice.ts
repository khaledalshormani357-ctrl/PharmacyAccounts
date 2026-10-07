export interface CustomerInvoiceLine {
  name: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  discount?: number;
  total: number;
}

/** Whitelist-only invoice view model: intentionally has no cost, COGS, profit, or margin fields. */
export interface CustomerSaleInvoiceModel {
  pharmacyName: string;
  invoiceNumber: string;
  date: string;
  customerName?: string | null;
  paymentLabel?: string;
  cancelled?: boolean;
  cancelReason?: string | null;
  subtotal: number;
  discount: number;
  total: number;
  amountPaid: number;
  remaining: number;
  changeGiven?: number;
  notes?: string | null;
  items: CustomerInvoiceLine[];
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

/** Returns only customer-safe invoice markup; unknown input properties are never rendered. */
export function buildCustomerSaleInvoiceBody(
  data: CustomerSaleInvoiceModel,
  money: (amount: number) => string,
): string {
  const itemRows = data.items.length
    ? data.items.map((item, index) => `<tr><td>${index + 1}</td><td><strong>${escapeHtml(item.name)}</strong></td><td>${escapeHtml(item.quantity)} ${escapeHtml(item.unit || '')}</td><td>${escapeHtml(money(item.unitPrice))}</td><td>${item.discount ? escapeHtml(money(item.discount)) : '—'}</td><td>${escapeHtml(money(item.total))}</td></tr>`).join('')
    : '<tr><td colspan="6">لا توجد أصناف في الفاتورة</td></tr>';
  return `
    ${data.cancelled ? `<div class="notice">هذه الفاتورة ملغاة${data.cancelReason ? ` — ${escapeHtml(data.cancelReason)}` : ''}</div>` : ''}
    <section class="section"><div class="section-title">بيانات الفاتورة</div><div class="summary-grid">
      <div class="metric"><div class="label">رقم الفاتورة</div><div class="value">${escapeHtml(data.invoiceNumber)}</div></div>
      <div class="metric"><div class="label">العميل</div><div class="value">${escapeHtml(data.customerName || 'عميل نقدي')}</div></div>
      <div class="metric"><div class="label">نوع العملية</div><div class="value">${escapeHtml(data.paymentLabel || 'بيع')}</div></div>
    </div></section>
    <section class="section"><div class="section-title">الأصناف</div><table><thead><tr><th>#</th><th>الصنف</th><th>الكمية</th><th class="number">السعر</th><th class="number">الخصم</th><th class="number">الإجمالي</th></tr></thead><tbody>${itemRows}</tbody></table></section>
    <section class="section"><div class="section-title">الإجماليات</div><table class="totals"><tbody>
      <tr><td>المجموع الفرعي</td><td class="number">${escapeHtml(money(data.subtotal))}</td></tr>
      ${data.discount > 0 ? `<tr><td>الخصم</td><td class="number negative">${escapeHtml(money(data.discount))}</td></tr>` : ''}
      <tr class="total-row"><td>الإجمالي النهائي</td><td class="number">${escapeHtml(money(data.total))}</td></tr>
      <tr><td>المدفوع</td><td class="number positive">${escapeHtml(money(data.amountPaid))}</td></tr>
      ${data.changeGiven && data.changeGiven > 0 ? `<tr><td>الباقي للعميل</td><td class="number">${escapeHtml(money(data.changeGiven))}</td></tr>` : ''}
      ${data.remaining > 0 ? `<tr><td>المتبقي</td><td class="number negative">${escapeHtml(money(data.remaining))}</td></tr>` : ''}
    </tbody></table></section>
    ${data.notes ? `<div class="note"><strong>ملاحظات:</strong> ${escapeHtml(data.notes)}</div>` : ''}
  `;
}
