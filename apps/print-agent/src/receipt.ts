import QRCode from "qrcode";
import type { PrintPayload } from "./contracts.js";

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function money(value: string) {
  const amount = Number(value);
  return `${new Intl.NumberFormat("ar-IQ", { maximumFractionDigits: 2 }).format(Number.isFinite(amount) ? amount : 0)} د.ع`;
}

function paymentLabel(value: string) {
  return ({ cash: "نقدي", card: "بطاقة", transfer: "تحويل", credit: "آجل" } as Record<string, string>)[value] ?? value;
}

function paymentStatusLabel(value: string) {
  return ({ paid: "مدفوع بالكامل", partial: "مدفوع جزئياً", unpaid: "غير مدفوع", overpaid: "دفع أكثر من المطلوب" } as Record<string, string>)[value] ?? value;
}

/** Fixed, local template: the agent never executes caller-supplied HTML or printer commands. */
export async function salesInvoiceReceiptHtml(payload: PrintPayload) {
  const is58 = payload.paperSize === "58mm";
  const invoice = payload.invoice;
  const qr = invoice.qrUrl ? await QRCode.toDataURL(invoice.qrUrl, { margin: 1, width: is58 ? 168 : 210, errorCorrectionLevel: "M" }) : null;
  const rows = invoice.items.map((item) => is58
    ? `<tr><td class="name" colspan="2">${escapeHtml(item.name)}</td></tr><tr><td class="num">${escapeHtml(item.quantity)} × ${money(item.unitPrice)}</td><td class="num left">${money(item.total)}</td></tr>`
    : `<tr><td class="name">${escapeHtml(item.name)}</td><td class="num">${escapeHtml(item.quantity)}</td><td class="num">${money(item.unitPrice)}</td><td class="num left">${money(item.total)}</td></tr>`).join("");
  const optional = [
    Number(invoice.discountAmount) > 0 ? `<div class="row"><span>الخصم</span><span class="num">- ${money(invoice.discountAmount)}</span></div>` : "",
    Number(invoice.taxAmount) > 0 ? `<div class="row"><span>الضريبة</span><span class="num">${money(invoice.taxAmount)}</span></div>` : "",
  ].join("");
  return `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><style>
    @page{size:${payload.paperSize} auto;margin:0}*{box-sizing:border-box;color:#000!important;text-shadow:none!important;box-shadow:none!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}html,body{margin:0;background:#fff;font-family:Tahoma,Arial,sans-serif;font-size:${is58 ? "12px" : "13px"};font-weight:600;line-height:1.35}.receipt{padding:${is58 ? "1.5mm" : "2.5mm"}}.head{text-align:center}.company{font-size:1.45em;font-weight:900}.sub{font-weight:700}.rule{border:0;border-top:1.5px solid #000;margin:5px 0}.dash{border-top-style:dashed}.kv,.row,.grand,.pay{display:flex;justify-content:space-between;gap:8px;margin:2px 0;font-weight:700}.num{font-variant-numeric:tabular-nums}.left{text-align:left}.items{width:100%;border-collapse:collapse;margin:4px 0}.items th{border-top:2px solid #000;border-bottom:2px solid #000;padding:3px;text-align:center;font-weight:900}.items td{border-bottom:1px solid #000;padding:3px;text-align:center;vertical-align:top}.items .name{text-align:right;font-weight:800}.grand{border:2.5px solid #000;padding:5px;font-size:1.3em;font-weight:900;margin:5px 0}.pay.remain{border:1.5px solid #000;padding:3px;font-size:1.15em}.qr{text-align:center;margin-top:7px;break-inside:avoid}.qr img{width:${is58 ? 168 : 210}px;height:${is58 ? 168 : 210}px;image-rendering:pixelated}.thanks{text-align:center;font-weight:800;margin-top:5px}@media print{*{color:#000!important}}</style></head><body><main class="receipt">
    <header class="head"><div class="company">مجموعة علي جان نهاد</div><div class="sub">لتنظيم المناسبات</div><div class="sub">فاتورة مبيعات</div></header><hr class="rule">
    <div class="kv"><span>رقم الفاتورة</span><span class="num">${escapeHtml(invoice.invoiceNo)}</span></div><div class="kv"><span>التاريخ</span><span class="num">${escapeHtml(invoice.date)}</span></div>
    ${invoice.customerName ? `<div class="kv"><span>العميل</span><span>${escapeHtml(invoice.customerName)}</span></div>` : ""}${invoice.customerPhone ? `<div class="kv"><span>الهاتف</span><span class="num">${escapeHtml(invoice.customerPhone)}</span></div>` : ""}<div class="kv"><span>الدفع</span><span>${escapeHtml(paymentLabel(invoice.paymentMethod))}</span></div><hr class="rule dash">
    <table class="items"><thead>${is58 ? "<tr><th class=\"name\">الصنف</th><th>الإجمالي</th></tr>" : "<tr><th class=\"name\">الصنف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr>"}</thead><tbody>${rows}</tbody></table><hr class="rule">
    <section>${optional}<div class="row"><span>المجموع الفرعي</span><span class="num">${money(invoice.subtotal)}</span></div><div class="grand"><span>الإجمالي</span><span class="num">${money(invoice.total)}</span></div><div class="pay"><span>المدفوع</span><span class="num">${money(invoice.paidAmount)}</span></div><div class="pay remain"><span>المتبقي</span><span class="num">${money(invoice.remainingAmount)}</span></div><div class="kv"><span>حالة الدفع</span><span>${escapeHtml(paymentStatusLabel(invoice.paymentStatus))}</span></div></section>
    ${invoice.notes?.trim() ? `<hr class="rule dash"><div class="kv"><span>ملاحظات</span><span>${escapeHtml(invoice.notes.trim())}</span></div>` : ""}${qr ? `<div class="qr"><img src="${qr}" alt="QR"><div class="num">${escapeHtml(invoice.invoiceNo)}</div></div>` : ""}<footer class="thanks">شكراً لاختياركم مجموعة علي جان نهاد</footer>
  </main></body></html>`;
}
