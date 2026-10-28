import QRCode from "qrcode";
import { usePrint } from "@/components/print/print-provider";
import { sheetReportCss, thermalReceiptCss } from "@/views/admin/print-helpers";
import { formatCurrency } from "@/lib/money";
import { clean, displayDate, esc } from "@/components/booking-thermal-receipt";
import { RETURN_STATUS_LABELS, returnConditionLabel, returnReasonLabel } from "@/lib/sales-returns";

/**
 * وصل مرتجع مبيعات — A4 (detailed) and 80mm (compact). Renders the saved return
 * as the server reported it; it computes nothing financial and posts nothing.
 * A refund still awaiting approval is printed as pending, never as paid.
 */
export type SalesReturnPrintData = {
  returnNo: string;
  reversalNo?: string | null;
  status: string;
  returnDate: string;
  customerName: string;
  customerPhone?: string | null;
  employeeName?: string | null;
  reasonCode: string;
  notes?: string | null;
  totalQuantity: number;
  totalAmount: number;
  items: { productName: string; unit?: string | null; quantity: number; netUnitAmount: number; amount: number; invoiceNo: string; condition: string }[];
  settlements: { kind: string; amount: number; status: string; invoiceNo?: string | null; transactionStatus?: string | null; isExchange?: boolean; parentSettlementId?: number | null }[];
};

export function settlementLine(settlement: SalesReturnPrintData["settlements"][number]) {
  if (settlement.kind === "invoice_credit")
    return { label: `خصم من المديونية${settlement.invoiceNo ? ` (${settlement.invoiceNo})` : ""}`, state: settlement.status === "reversed" ? "معكوس" : "منفذ" };
  if (settlement.kind === "customer_credit")
    return { label: settlement.isExchange ? "رصيد للاستبدال" : "رصيد دائن للعميل", state: settlement.status === "reversed" ? "معكوس" : "متاح للاستخدام" };
  const state =
    settlement.status === "cancelled" ? "ملغي"
      : settlement.transactionStatus === "executed" ? "تم الدفع"
        : settlement.transactionStatus === "rejected" || settlement.transactionStatus === "cancelled" ? "مرفوض"
          : "بانتظار الموافقة — لم يُدفع بعد";
  return { label: "استرجاع مبلغ", state };
}

const printedAt = () => new Intl.DateTimeFormat("en-CA", { dateStyle: "short", timeStyle: "short" }).format(new Date());
const qty = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(value);
const directSettlements = (data: SalesReturnPrintData) => data.settlements.filter((settlement) => !settlement.parentSettlementId);
const sourceInvoices = (data: SalesReturnPrintData) => [...new Set(data.items.map((item) => item.invoiceNo))];

function thermalHtml(data: SalesReturnPrintData, qr: string | null) {
  const kv = (label: string, value: unknown, num = false) => {
    const text = clean(value);
    return text ? `<div class="kv"><span>${esc(label)}</span><b class="v${num ? " num" : ""}">${esc(text)}</b></div>` : "";
  };
  const items = data.items
    .map((item) => `<div class="ret-item"><div class="ret-name">${esc(item.productName)}</div><div class="ret-meta"><span class="num">${esc(qty(item.quantity))} × ${esc(formatCurrency(item.netUnitAmount))}</span><b class="num">${esc(formatCurrency(item.amount))}</b></div><div class="ret-sub">${esc(item.invoiceNo)} · ${esc(returnConditionLabel(item.condition))}</div></div>`)
    .join("");
  const settlements = directSettlements(data)
    .map((settlement) => {
      const line = settlementLine(settlement);
      return `<div class="kv"><span>${esc(line.label)}<br><small>${esc(line.state)}</small></span><b class="v num">${esc(formatCurrency(settlement.amount))}</b></div>`;
    })
    .join("");
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>وصل مرتجع ${esc(data.returnNo)}</title><style>${thermalReceiptCss("80mm")}
    .return-slip .kv { align-items: baseline; }
    .return-slip .kv .v { max-width: 58%; overflow-wrap: anywhere; }
    .return-slip .kv small { font-weight: 600; font-size: 10px; }
    .return-slip .ret-item { padding: 3px 0; border-bottom: 1px dashed #000; }
    .return-slip .ret-name { font-weight: 800; }
    .return-slip .ret-meta { display: flex; justify-content: space-between; gap: 6px; }
    .return-slip .ret-sub { font-size: 10px; }
    .return-slip .grand span:first-child { font-weight: 800; }
    .return-slip .qr { display: block; width: 32mm; height: 32mm; margin: 4px auto 0; }
  </style></head><body><div class="receipt return-slip">
    <div class="r-head"><div class="r-company">AJN — مجموعة علي جان نهاد</div><div class="r-sub">وصل مرتجع مبيعات</div></div>
    <hr class="rule">
    ${kv("رقم المرتجع", data.returnNo, true)}
    ${data.reversalNo ? kv("رقم العكس", data.reversalNo, true) : ""}
    ${kv("الحالة", RETURN_STATUS_LABELS[data.status] ?? data.status)}
    ${kv("التاريخ", displayDate(data.returnDate), true)}
    ${kv("العميل", data.customerName)}
    ${kv("الهاتف", data.customerPhone, true)}
    ${kv("الموظف", data.employeeName)}
    <hr class="rule dashed">
    ${items}
    <div class="grand"><span>إجمالي المرتجع</span><span class="num">${esc(formatCurrency(data.totalAmount))}</span></div>
    ${kv("الكمية", qty(data.totalQuantity), true)}
    ${kv("الفواتير", sourceInvoices(data).join("، "))}
    ${settlements ? `<hr class="rule dashed">${settlements}` : `<div class="kv"><span>التسوية</span><b class="v">لم تُنفّذ بعد</b></div>`}
    <hr class="rule dashed">
    ${kv("تاريخ الطباعة", printedAt(), true)}
    ${qr ? `<img class="qr" src="${qr}" alt="">` : ""}
    <div class="thanks">شكراً لاختياركم مجموعة علي جان نهاد</div>
  </div></body></html>`;
}

function a4Html(data: SalesReturnPrintData, qr: string | null) {
  const rows = data.items
    .map((item, index) => `<tr><td class="num">${index + 1}</td><td>${esc(item.productName)}${item.unit ? ` <small>(${esc(item.unit)})</small>` : ""}</td><td class="num">${esc(qty(item.quantity))}</td><td class="num">${esc(formatCurrency(item.netUnitAmount))}</td><td class="num">${esc(formatCurrency(item.amount))}</td><td class="num">${esc(item.invoiceNo)}</td><td>${esc(returnConditionLabel(item.condition))}</td></tr>`)
    .join("");
  const settlements = directSettlements(data)
    .map((settlement) => {
      const line = settlementLine(settlement);
      return `<tr><td>${esc(line.label)}</td><td class="num">${esc(formatCurrency(settlement.amount))}</td><td>${esc(line.state)}</td></tr>`;
    })
    .join("");
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>وصل مرتجع ${esc(data.returnNo)}</title><style>${sheetReportCss("a4")}
    .r-meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 12px 0; }
    .r-meta div { border: 1px solid #111; padding: 7px 9px; }
    .r-meta span { display: block; color: #555; font-size: 10px; margin-bottom: 3px; }
    .r-meta b { font-size: 12px; overflow-wrap: anywhere; }
    .r-total { display: flex; justify-content: space-between; align-items: baseline; border: 2px solid #000; padding: 10px 14px; margin: 10px 0; }
    .r-total b { font-size: 20px; font-variant-numeric: tabular-nums; }
    .r-foot { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; margin-top: 18px; }
    .r-sign { display: grid; grid-template-columns: repeat(2, 1fr); gap: 40px; flex: 1; }
    .r-sign div { border-top: 1px solid #000; padding-top: 6px; text-align: center; font-size: 11px; font-weight: 700; }
    .r-qr { width: 30mm; height: 30mm; }
    .num { font-variant-numeric: tabular-nums; }
    h3 { margin: 14px 0 6px; font-size: 13px; }
  </style></head><body><main class="report-sheet">
    <header class="report-head">
      <div><div class="report-company">مجموعة علي جان نهاد</div><div class="report-title">وصل مرتجع مبيعات</div></div>
      <div class="report-meta">رقم المرتجع: <b class="num">${esc(data.returnNo)}</b>${data.reversalNo ? `<br>رقم العكس: <b class="num">${esc(data.reversalNo)}</b>` : ""}<br>تاريخ الطباعة: <span class="num">${esc(printedAt())}</span></div>
    </header>
    <section class="r-meta">
      <div><span>العميل</span><b>${esc(data.customerName)}</b></div>
      <div><span>الهاتف</span><b class="num">${esc(data.customerPhone || "—")}</b></div>
      <div><span>تاريخ المرتجع</span><b class="num">${esc(displayDate(data.returnDate))}</b></div>
      <div><span>الحالة</span><b>${esc(RETURN_STATUS_LABELS[data.status] ?? data.status)}</b></div>
      <div><span>سبب الإرجاع</span><b>${esc(returnReasonLabel(data.reasonCode))}</b></div>
      <div><span>الموظف</span><b>${esc(data.employeeName || "—")}</b></div>
    </section>
    <table class="report-table"><thead><tr><th>#</th><th>المنتج</th><th>الكمية</th><th>سعر القطعة الأصلي</th><th>المبلغ</th><th>الفاتورة الأصلية</th><th>الحالة</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="r-total"><span>إجمالي المرتجع — <span class="num">${esc(qty(data.totalQuantity))}</span> قطعة من ${sourceInvoices(data).length} فاتورة</span><b>${esc(formatCurrency(data.totalAmount))}</b></div>
    <h3>التسوية المالية</h3>
    ${settlements ? `<table class="report-table"><thead><tr><th>نوع التسوية</th><th>المبلغ</th><th>الحالة الفعلية</th></tr></thead><tbody>${settlements}</tbody></table>` : `<p>لم تُنفّذ التسوية المالية بعد.</p>`}
    ${clean(data.notes) ? `<h3>ملاحظات</h3><p>${esc(data.notes)}</p>` : ""}
    <div class="r-foot"><section class="r-sign"><div>توقيع العميل</div><div>توقيع المستلم</div></section>${qr ? `<img class="r-qr" src="${qr}" alt="">` : ""}</div>
    <footer class="report-footer">الفواتير المرتبطة: ${esc(sourceInvoices(data).join("، "))}</footer>
  </main></body></html>`;
}

export function buildSalesReturnHtml(data: SalesReturnPrintData, size: "a4" | "80mm", qr: string | null = null) {
  return size === "a4" ? a4Html(data, qr) : thermalHtml(data, qr);
}

/** Opens the shared print dialog (A4 + 80mm). Printing posts nothing. */
export function useSalesReturnPrint() {
  const { print } = usePrint();
  return async (data: SalesReturnPrintData) => {
    const qr = await QRCode.toDataURL(data.returnNo, { width: 240, margin: 0, errorCorrectionLevel: "M" }).catch(() => null);
    print({
      documentLabel: `وصل مرتجع ${data.returnNo}`,
      formats: [
        { id: "a4", buildHtml: () => buildSalesReturnHtml(data, "a4", qr) },
        { id: "thermal80", buildHtml: () => buildSalesReturnHtml(data, "80mm", qr) },
      ],
    });
  };
}
