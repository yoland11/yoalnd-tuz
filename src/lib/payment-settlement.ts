const CASH_PAYMENT_METHODS = new Set([
  "cash",
  "paid",
  "نقد",
  "نقدي",
  "نقداً",
  "نقدا",
]);

function finiteMoney(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? "0"));
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
}

export function isCashPaymentMethod(value: unknown): boolean {
  return CASH_PAYMENT_METHODS.has(String(value ?? "").trim().toLowerCase());
}

export function settlePaymentAmounts(
  totalValue: unknown,
  paidValue: unknown,
  preferredStatus?: unknown,
  paymentMethod?: unknown,
) {
  const total = finiteMoney(totalValue);
  const requestedPaid = finiteMoney(paidValue);
  const forceCashSettlement = isCashPaymentMethod(paymentMethod);
  const paid = forceCashSettlement
    ? total
    : preferredStatus === "paid" && requestedPaid === 0 && total > 0
      ? total
      : Math.min(requestedPaid, total || requestedPaid);
  const remaining = Math.max(total - paid, 0);
  const status = forceCashSettlement || preferredStatus === "paid" || (total > 0 && remaining === 0)
    ? "paid"
    : preferredStatus === "partial" || paid > 0
      ? "partial"
      : "unpaid";

  return { paid, remaining, status } as const;
}
