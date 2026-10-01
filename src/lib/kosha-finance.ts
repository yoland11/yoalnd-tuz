export type KoshaCostCategory = "investment" | "operating" | "booking";

export type KoshaCostLine = {
  sourceKey: string;
  amount: number;
  status: string;
  bookingId?: number | null;
  category?: KoshaCostCategory;
};

export type KoshaFinancialSummaryInput = {
  investmentTotal: number;
  bookingRevenue: number;
  collectedRevenue: number;
  customerRemaining: number;
  operatingCosts: readonly KoshaCostLine[];
  bookingCosts: readonly KoshaCostLine[];
};

export type KoshaAssetAssignment = { koshaId: number; shared: boolean };

/** Dedicated physical assets belong to one Koshah; shared use is explicit on every assignment. */
export function canAssignKoshaAsset(
  koshaId: number,
  shared: boolean,
  existing: readonly KoshaAssetAssignment[],
): boolean {
  const otherAssignments = existing.filter((assignment) => assignment.koshaId !== koshaId);
  if (!otherAssignments.length) return true;
  return shared && otherAssignments.every((assignment) => assignment.shared);
}

export type KoshaFinancialSummary = {
  totalInvestment: number;
  bookingRevenue: number;
  collectedRevenue: number;
  customerRemaining: number;
  operatingCosts: number;
  bookingCosts: number;
  bookingProfit: number;
  recoveredInvestment: number;
  remainingInvestment: number;
  recoveryPercent: number;
};

export type KoshaExpenseClassificationInput = {
  koshaId?: number | null;
  costCategory?: KoshaCostCategory | null;
  bookingId?: number | null;
  bookingKoshaId?: number | null;
};

export function validateKoshaExpenseClassification(
  input: KoshaExpenseClassificationInput,
): string | null {
  const hasLink = input.koshaId != null || input.costCategory != null || input.bookingId != null;
  if (!hasLink) return null;
  if (!Number.isInteger(input.koshaId) || Number(input.koshaId) <= 0)
    return "الكوشة مطلوبة لتصنيف المصروف";
  if (!input.costCategory)
    return "تصنيف المصروف مطلوب عند ربطه بكوشة";
  if (input.costCategory === "booking" && (!Number.isInteger(input.bookingId) || Number(input.bookingId) <= 0))
    return "الحجز مطلوب لتسجيل تكلفة حجز";
  if (input.costCategory !== "booking" && input.bookingId != null)
    return "الحجز مسموح فقط لتكلفة الحجز";
  if (
    input.bookingId != null &&
    input.bookingKoshaId != null &&
    input.koshaId !== input.bookingKoshaId
  )
    return "الحجز لا يتبع الكوشة المختارة";
  return null;
}

function amount(value: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed * 100) / 100;
}

function postedCost(lines: readonly KoshaCostLine[], seen: Set<string>): number {
  let total = 0;
  for (const line of lines) {
    const sourceKey = String(line.sourceKey ?? "").trim();
    if (!sourceKey || seen.has(sourceKey) || line.status !== "executed") continue;
    seen.add(sourceKey);
    total += amount(line.amount);
  }
  return Math.round(total * 100) / 100;
}

/**
 * Derive management figures from normalized AJN source rows. This helper does
 * not read or write a ledger; sourceKey deduplicates the same transaction when
 * it appears through more than one analytical relation.
 */
export function deriveKoshaFinancialSummary(
  input: KoshaFinancialSummaryInput,
): KoshaFinancialSummary {
  const seen = new Set<string>();
  const operatingCosts = postedCost(input.operatingCosts, seen);
  const bookingCosts = postedCost(
    input.bookingCosts.filter((line) => line.category !== "investment"),
    seen,
  );
  const investment = amount(input.investmentTotal);
  const bookingRevenue = amount(input.bookingRevenue);
  const collectedRevenue = amount(input.collectedRevenue);
  const customerRemaining = amount(input.customerRemaining);
  const bookingProfit = Math.round((bookingRevenue - bookingCosts) * 100) / 100;
  const recoveredInvestment = Math.min(
    investment,
    Math.max(0, Math.round((collectedRevenue - bookingCosts - operatingCosts) * 100) / 100),
  );
  return {
    totalInvestment: investment,
    bookingRevenue,
    collectedRevenue,
    customerRemaining,
    operatingCosts,
    bookingCosts,
    bookingProfit,
    recoveredInvestment,
    remainingInvestment: Math.max(0, Math.round((investment - recoveredInvestment) * 100) / 100),
    recoveryPercent: investment > 0 ? Math.round((recoveredInvestment / investment) * 100) : 0,
  };
}
