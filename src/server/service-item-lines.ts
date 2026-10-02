export type ServiceLineInput = {
  quantity: number;
  unitPrice: number;
  discount?: number;
};

export function calculateServiceLine(input: ServiceLineInput) {
  const quantity = Number(input.quantity);
  const unitPrice = Number(input.unitPrice);
  const requestedDiscount = Number(input.discount ?? 0);
  if (
    !Number.isFinite(quantity) || quantity <= 0 ||
    !Number.isFinite(unitPrice) || unitPrice < 0 ||
    !Number.isFinite(requestedDiscount) || requestedDiscount < 0
  ) return null;
  const gross = Math.round(quantity * unitPrice * 100) / 100;
  const discount = Math.min(Math.round(requestedDiscount * 100) / 100, gross);
  return { quantity, unitPrice, discount, total: Math.max(gross - discount, 0) };
}

/** Null snapshots mean a historical invoice line: preserve the old stock behavior. */
export function invoiceLineTracksInventory(snapshot: boolean | null | undefined) {
  return snapshot !== false;
}

export function serviceOrderTotal(baseAmount: number, serviceLineTotals: number[]) {
  const base = Number(baseAmount);
  if (!Number.isFinite(base) || base < 0 || serviceLineTotals.some((value) => !Number.isFinite(value) || value < 0)) return null;
  return Math.round((base + serviceLineTotals.reduce((sum, value) => sum + value, 0)) * 100) / 100;
}
