import {formatMoney, parseMoney} from "./money";
import {PartnershipValidationError} from "./types";

export type PayoutCoverage = {
  rightId: number;
  conversionAllocationId: number;
  amount: string;
};

type CoverageIdentity = Pick<PayoutCoverage, "rightId" | "conversionAllocationId">;
type PayoutBudget = CoverageIdentity & {availableAmount: string};
type PayoutCapacity = {
  amount: string;
  availableAmount: string;
  ownPendingAmount: string;
  reservedAmount: string;
};

function fail(message: string): never {
  throw new PartnershipValidationError(message);
}

function positiveMoney(value: string): bigint {
  const amount = parseMoney(value);
  if (amount <= 0n) fail("يجب أن يكون مبلغ الصرف أو التغطية أكبر من صفر");
  return amount;
}

function validateIdentities(rows: readonly CoverageIdentity[]): void {
  if (!Array.isArray(rows) || rows.length > 500) fail("قائمة تغطية الصرف غير صالحة أو تتجاوز الحد المسموح");
  const rightIds = new Set<number>();
  const conversionIds = new Set<number>();
  for (const row of rows) {
    if (!row || !Number.isSafeInteger(row.rightId) || row.rightId <= 0 ||
        !Number.isSafeInteger(row.conversionAllocationId) || row.conversionAllocationId <= 0) {
      fail("هوية استحقاق الصرف أو أصل التحويل غير صالحة");
    }
    if (rightIds.has(row.rightId) || conversionIds.has(row.conversionAllocationId)) {
      fail("استحقاق الصرف أو أصل التحويل مكرر في التغطية");
    }
    rightIds.add(row.rightId);
    conversionIds.add(row.conversionAllocationId);
  }
}

/** Plan only the existing converted portion, in stable parent order. Any
 * uncovered remainder is externally funded; no wallet balance is invented.
 * The server must prove the origin and eligibility of every supplied budget. */
export function buildPayoutCoverage(amount: string, budgets: readonly PayoutBudget[]): PayoutCoverage[] {
  let remaining = positiveMoney(amount);
  validateIdentities(budgets);
  // Parse every budget before allocating, including rows after capacity is met.
  const ordered = budgets.map((budget) => ({
    rightId: budget.rightId,
    conversionAllocationId: budget.conversionAllocationId,
    available: parseMoney(budget.availableAmount),
  })).sort((a, b) => a.conversionAllocationId - b.conversionAllocationId);
  const coverage: PayoutCoverage[] = [];
  for (const budget of ordered) {
    if (remaining === 0n) break;
    const allocated = budget.available < remaining ? budget.available : remaining;
    if (allocated === 0n) continue;
    coverage.push({
      rightId: budget.rightId,
      conversionAllocationId: budget.conversionAllocationId,
      amount: formatMoney(allocated),
    });
    remaining -= allocated;
  }
  return coverage;
}

function validateCapacity(input: PayoutCapacity): bigint {
  const amount = positiveMoney(input.amount);
  const available = parseMoney(input.availableAmount);
  const ownPending = parseMoney(input.ownPendingAmount);
  const reserved = parseMoney(input.reservedAmount);
  if (ownPending > reserved) fail("حجز الصرف الحالي يتجاوز المبلغ المحجوز المثبت");
  if (amount > available + ownPending) fail("مبلغ الصرف أو تغطيته يتجاوز المتاح بعد الحجوزات");
  return amount;
}

/** Exact admission arithmetic, NOT authorization. The server must first prove
 * each right, conversion origin and this payout's exact pending allocation.
 * availableAmount already excludes every pending reservation. Only the proven
 * ownPendingAmount may be added back; total reservedAmount is never excluded. */
export function validatePayoutCapacity(input: PayoutCapacity & {
  coverage: readonly (PayoutCoverage & Omit<PayoutCapacity, "amount">)[];
}): void {
  const amount = validateCapacity(input);
  validateIdentities(input.coverage);
  let covered = 0n;
  for (const row of input.coverage) covered += validateCapacity(row);
  if (covered > amount) fail("مجموع تغطية التحويلات يتجاوز مبلغ الصرف الأصلي");
}
