import { usePrint } from "@/components/print/print-provider";
import { buildBrandedReceiptHtml, type BrandedReceiptSize } from "@/lib/branded-receipt";
import type { ReceiptBrand } from "@/lib/receipt-brand";
import { formatCurrency } from "@/lib/money";
import { clean, displayDate } from "@/components/booking-thermal-receipt";
import { RETURN_STATUS_LABELS, returnConditionLabel, returnReasonLabel } from "@/lib/sales-returns";

/**
 * وصل مرتجع مبيعات — branded A5 (+ WhatsApp image) and 80mm. Renders the saved return
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

const qty = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(value);
const directSettlements = (data: SalesReturnPrintData) => data.settlements.filter((settlement) => !settlement.parentSettlementId);
const sourceInvoices = (data: SalesReturnPrintData) => [...new Set(data.items.map((item) => item.invoiceNo))];

/** Branded A5 or 80mm return receipt; the QR carries the return number. */
export function buildSalesReturnHtml(data: SalesReturnPrintData, size: BrandedReceiptSize, brand?: ReceiptBrand) {
  const settlements = directSettlements(data).map((settlement) => {
    const line = settlementLine(settlement);
    return { label: line.label, value: `${formatCurrency(settlement.amount)} — ${line.state}` };
  });
  return buildBrandedReceiptHtml({
    documentTitle: `وصل مرتجع ${data.returnNo}`,
    title: "وصل مرتجع مبيعات",
    icon: "undo",
    facts: [
      { label: "رقم المرتجع", value: data.returnNo, icon: "receipt" },
      { label: "رقم العكس", value: data.reversalNo, icon: "hash" },
      { label: "العميل", value: data.customerName, icon: "user" },
      { label: "الهاتف", value: data.customerPhone, icon: "phone" },
      { label: "تاريخ المرتجع", value: displayDate(data.returnDate), icon: "calendar" },
      { label: "الحالة", value: RETURN_STATUS_LABELS[data.status] ?? data.status, icon: "layers" },
      { label: "سبب الإرجاع", value: returnReasonLabel(data.reasonCode), icon: "note" },
      { label: "الموظف", value: data.employeeName, icon: "id" },
      { label: "الفواتير المرتبطة", value: sourceInvoices(data).join("، "), icon: "receipt", wide: true },
    ],
    items: {
      columns: [
        { key: "i", label: "#", role: "index" },
        { key: "name", label: "المنتج", role: "name" },
        { key: "qty", label: "الكمية", role: "number", wideOnly: true },
        { key: "unit", label: "سعر القطعة الأصلي", role: "number", wideOnly: true },
        { key: "condition", label: "الحالة", wideOnly: true },
        { key: "amount", label: "المبلغ", role: "total" },
      ],
      rows: data.items.map((item) => ({
        cells: { name: item.productName, qty: qty(item.quantity), unit: formatCurrency(item.netUnitAmount), condition: returnConditionLabel(item.condition), amount: formatCurrency(item.amount) },
        sub: `الفاتورة ${item.invoiceNo}`,
      })),
    },
    totals: [{ label: "إجمالي المرتجع", value: formatCurrency(data.totalAmount), tone: "strong" }],
    totalsNote: `${qty(data.totalQuantity)} قطعة من ${sourceInvoices(data).length} فاتورة`,
    sections: [settlements.length
      ? { title: "التسوية المالية", facts: settlements.map((row) => ({ ...row, wide: true })) }
      : { title: "التسوية المالية", text: "لم تُنفّذ التسوية المالية بعد." }],
    notes: clean(data.notes) || null,
    signatures: size === "a5" ? ["توقيع العميل", "توقيع المستلم"] : undefined,
    qr: { url: data.returnNo, caption: data.returnNo },
  }, size, brand);
}

/** Opens the shared print dialog (A5 + WhatsApp image, 80mm). Printing posts nothing. */
export function useSalesReturnPrint() {
  const { print } = usePrint();
  return async (data: SalesReturnPrintData) => {
    print({
      documentLabel: `وصل مرتجع ${data.returnNo}`,
      formats: [
        { id: "a5", buildHtml: () => buildSalesReturnHtml(data, "a5"), imageName: `وصل مرتجع ${data.returnNo}` },
        { id: "thermal80", buildHtml: () => buildSalesReturnHtml(data, "80mm") },
      ],
    });
  };
}
