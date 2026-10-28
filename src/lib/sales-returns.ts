/**
 * Pure rules for grouped multi-invoice sales returns. No I/O: the server feeds
 * locked database facts in, and the browser uses the same functions for its
 * live preview, so both always agree.
 *
 * Quantities are handled in thousandths (numeric(12,3)) and money in hundredths
 * (numeric(16,2)) as integers, so repeated partial returns never drift.
 */

export const RETURN_REASONS = [
  { code: "damaged", label: "منتج تالف" },
  { code: "wrong_color", label: "لون غير مناسب" },
  { code: "wrong_size", label: "قياس غير مناسب" },
  { code: "excess_quantity", label: "كمية زائدة" },
  { code: "order_error", label: "خطأ بالطلب" },
  { code: "spec_mismatch", label: "اختلاف عن المواصفات" },
  { code: "other", label: "سبب آخر" },
] as const;
export type ReturnReasonCode = (typeof RETURN_REASONS)[number]["code"];
export const returnReasonLabel = (code: string | null | undefined) =>
  RETURN_REASONS.find((reason) => reason.code === code)?.label ?? (code || "—");

export const RETURN_CONDITIONS = [
  { code: "good", label: "سليم" },
  { code: "inspection", label: "يحتاج فحص" },
  { code: "damaged", label: "تالف" },
  { code: "unsellable", label: "غير قابل للبيع" },
] as const;
export type ReturnCondition = (typeof RETURN_CONDITIONS)[number]["code"];
export const returnConditionLabel = (code: string | null | undefined) =>
  RETURN_CONDITIONS.find((condition) => condition.code === code)?.label ?? (code || "—");

export const RETURN_STATUS_LABELS: Record<string, string> = {
  draft: "مسودة",
  pending_approval: "بانتظار الموافقة",
  approved: "معتمد",
  rejected: "مرفوض",
  cancelled: "ملغي",
  completed: "مكتمل",
  reversed: "معكوس",
};
/** Statuses whose quantities are reserved or consumed on the original lines. */
export const ACTIVE_RETURN_STATUSES = ["pending_approval", "approved", "completed"] as const;

export const INVENTORY_STATE_LABELS: Record<string, string> = {
  pending: "بانتظار قبول المخزون",
  restocked: "أعيد للمخزون القابل للبيع",
  inspection: "محجوز للفحص",
  damaged: "تالف — خارج البيع",
  unsellable: "غير قابل للبيع",
  not_tracked: "لا يتبع المخزون",
  reversed: "معكوس",
};

export class SalesReturnRuleError extends Error {
  constructor(message: string, public status = 422) {
    super(message);
    this.name = "SalesReturnRuleError";
  }
}

export const toMilli = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 1000);
};
export const fromMilli = (value: number) => value / 1000;
export const toCents = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100);
};
export const fromCents = (value: number) => value / 100;

/** Products are grouped by catalog identity and unit, never merged across units. */
export function returnProductKey(line: { productId: number | null; productName: string; unit?: string | null }) {
  const unit = (line.unit ?? "").trim().toLowerCase();
  if (line.productId) return `p:${line.productId}|u:${unit}`.slice(0, 200);
  return `n:${line.productName.trim().replace(/\s+/g, " ").toLowerCase()}|u:${unit}`.slice(0, 200);
}

export type ReturnInvoiceFacts = {
  /** Sum of every line's own total (after its line discount). */
  linesNetTotal: number;
  /** Sum of every line's own discount. */
  linesDiscountTotal: number;
  /** invoice.discount_amount — includes the line discounts (as saved by the sales screen). */
  discountAmount: number;
  taxAmount: number;
};

/**
 * The refundable value of a whole original line: its own net total, less its
 * proportional share of the invoice-level discount, plus its share of tax.
 * Delivery and offer fees are not product value and are never refunded here.
 */
export function lineRefundableCents(line: { total: number }, invoice: ReturnInvoiceFacts) {
  const lineNet = toCents(line.total);
  const netTotal = toCents(invoice.linesNetTotal);
  if (lineNet <= 0 || netTotal <= 0) return Math.max(lineNet, 0);
  const invoiceLevelDiscount = Math.max(toCents(invoice.discountAmount) - toCents(invoice.linesDiscountTotal), 0);
  const tax = Math.max(toCents(invoice.taxAmount), 0);
  const discountShare = Math.round((invoiceLevelDiscount * lineNet) / netTotal);
  const taxShare = Math.round((tax * lineNet) / netTotal);
  return Math.max(lineNet - discountShare + taxShare, 0);
}

/**
 * Amount for returning `quantityMilli` of a line. Proportional to the line's
 * refundable value; the return that closes the line out takes the exact
 * remainder, so the cumulative refund equals the original line value.
 */
export function returnAmountCents(input: {
  lineQuantityMilli: number;
  lineRefundableCents: number;
  quantityMilli: number;
  consumedQuantityMilli: number;
  consumedAmountCents: number;
}) {
  const { lineQuantityMilli, lineRefundableCents: refundable, quantityMilli, consumedQuantityMilli, consumedAmountCents } = input;
  if (lineQuantityMilli <= 0 || quantityMilli <= 0) return 0;
  const remainingValue = Math.max(refundable - consumedAmountCents, 0);
  if (consumedQuantityMilli + quantityMilli >= lineQuantityMilli) return remainingValue;
  return Math.min(Math.round((refundable * quantityMilli) / lineQuantityMilli), remainingValue);
}

export type ReturnableLine = {
  invoiceItemId: number;
  invoiceId: number;
  invoiceNo: string;
  invoiceDate: string;
  quantityMilli: number;
  /** Quantity already taken by active returns (pending, approved or completed). */
  consumedMilli: number;
};

export const availableMilli = (line: Pick<ReturnableLine, "quantityMilli" | "consumedMilli">) =>
  Math.max(line.quantityMilli - line.consumedMilli, 0);

/** Oldest invoice first, then the line order inside it: a stable, auditable FIFO. */
export function fifoOrder<T extends Pick<ReturnableLine, "invoiceDate" | "invoiceId" | "invoiceItemId">>(lines: readonly T[]) {
  return [...lines].sort(
    (a, b) => a.invoiceDate.localeCompare(b.invoiceDate) || a.invoiceId - b.invoiceId || a.invoiceItemId - b.invoiceItemId,
  );
}

export type ReturnAllocation = { invoiceItemId: number; quantityMilli: number };

export function allocateFifo(lines: readonly ReturnableLine[], requestedMilli: number): ReturnAllocation[] {
  if (!Number.isInteger(requestedMilli) || requestedMilli <= 0) throw new SalesReturnRuleError("كمية الإرجاع يجب أن تكون أكبر من صفر");
  let left = requestedMilli;
  const allocations: ReturnAllocation[] = [];
  for (const line of fifoOrder(lines)) {
    if (left <= 0) break;
    const take = Math.min(availableMilli(line), left);
    if (take > 0) {
      allocations.push({ invoiceItemId: line.invoiceItemId, quantityMilli: take });
      left -= take;
    }
  }
  if (left > 0) {
    const available = lines.reduce((sum, line) => sum + availableMilli(line), 0);
    throw new SalesReturnRuleError(`الكمية المطلوبة (${fromMilli(requestedMilli)}) أكبر من المتاح للإرجاع (${fromMilli(available)})`, 409);
  }
  return allocations;
}

/** A manual allocation must match the requested total and stay within every line. */
export function validateAllocation(lines: readonly ReturnableLine[], requestedMilli: number, allocations: readonly ReturnAllocation[]) {
  const byId = new Map(lines.map((line) => [line.invoiceItemId, line]));
  const seen = new Set<number>();
  let total = 0;
  for (const allocation of allocations) {
    const line = byId.get(allocation.invoiceItemId);
    if (!line) throw new SalesReturnRuleError("أحد بنود التوزيع لا يخص هذا المنتج أو هذا العميل", 409);
    if (seen.has(allocation.invoiceItemId)) throw new SalesReturnRuleError("بند الفاتورة مكرر في التوزيع");
    seen.add(allocation.invoiceItemId);
    if (!Number.isInteger(allocation.quantityMilli) || allocation.quantityMilli < 0) throw new SalesReturnRuleError("كمية التوزيع غير صالحة");
    if (allocation.quantityMilli > availableMilli(line))
      throw new SalesReturnRuleError(`الكمية الموزعة على ${line.invoiceNo} تتجاوز المتاح للإرجاع منها (${fromMilli(availableMilli(line))})`, 409);
    total += allocation.quantityMilli;
  }
  if (total !== requestedMilli)
    throw new SalesReturnRuleError(`الكمية الموزعة (${fromMilli(total)}) لا تساوي الكمية المطلوبة (${fromMilli(requestedMilli)})`);
  return allocations.filter((allocation) => allocation.quantityMilli > 0);
}

export type SettlementPlan = {
  invoiceCredit: number;
  customerCredit: number;
  refund: number;
  refundMethod?: "cash" | "transfer" | "card" | null;
  exchange?: boolean;
};

/** A settlement split may never exceed what is still unsettled on the return. */
export function validateSettlementPlan(plan: SettlementPlan, unsettledCents: number) {
  const parts = [plan.invoiceCredit, plan.customerCredit, plan.refund].map(toCents);
  if (parts.some((value) => value < 0)) throw new SalesReturnRuleError("مبالغ التسوية لا يمكن أن تكون سالبة");
  const total = parts.reduce((sum, value) => sum + value, 0);
  if (total <= 0) throw new SalesReturnRuleError("حدد مبلغاً واحداً على الأقل للتسوية");
  if (total > unsettledCents)
    throw new SalesReturnRuleError(`مجموع التسوية (${fromCents(total)}) أكبر من المبلغ غير المسوّى (${fromCents(unsettledCents)})`, 409);
  if (parts[2] > 0 && !plan.refundMethod) throw new SalesReturnRuleError("حدد طريقة استرجاع المبلغ");
  return { invoiceCreditCents: parts[0], customerCreditCents: parts[1], refundCents: parts[2], totalCents: total };
}

/** Spread a debt deduction over open invoices in order, never above a remaining balance. */
export function allocateInvoiceCredit(invoices: readonly { invoiceId: number; remainingCents: number }[], amountCents: number) {
  let left = amountCents;
  const rows: { invoiceId: number; amountCents: number }[] = [];
  for (const invoice of invoices) {
    if (left <= 0) break;
    const take = Math.min(Math.max(invoice.remainingCents, 0), left);
    if (take > 0) {
      rows.push({ invoiceId: invoice.invoiceId, amountCents: take });
      left -= take;
    }
  }
  if (left > 0) {
    const open = invoices.reduce((sum, invoice) => sum + Math.max(invoice.remainingCents, 0), 0);
    throw new SalesReturnRuleError(`مبلغ الخصم من المديونية (${fromCents(amountCents)}) أكبر من مديونية العميل المفتوحة (${fromCents(open)})`, 409);
  }
  return rows;
}
