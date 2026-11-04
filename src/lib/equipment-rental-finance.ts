export class EquipmentRentalFinanceError extends Error { constructor(message: string) { super(message); this.name = "EquipmentRentalFinanceError"; } }
export type EquipmentRentalMoneyKind = "rent_payment" | "rent_refund" | "deposit_collect" | "deposit_refund" | "deposit_apply" | "charge";
export type EquipmentRentalMoneyRow = { kind: string; amount: number; approvalStatus: string; reversal?: boolean };
const rounded = (value: number) => Math.round(value * 100) / 100;
export function equipmentRentalEffect(kind: EquipmentRentalMoneyKind, reversal = false) {
  const noncash = kind === "deposit_apply" || kind === "charge";
  const incoming = kind === "rent_payment" || kind === "deposit_collect" || kind === "charge";
  const cashDirection = noncash ? "noncash" as const : incoming !== reversal ? "inflow" as const : "outflow" as const;
  const accountingClassification = kind.startsWith("deposit_")
    ? noncash ? "liability_settlement" as const : incoming !== reversal ? "liability_inflow" as const : "liability_repayment" as const
    : kind === "charge" ? "receivable_charge" as const : "revenue" as const;
  return { cashDirection, accountingClassification, direction: incoming !== reversal ? "revenue" as const : "expense" as const };
}

/** The original rental header already includes approved charges. Deposits are
 * separate liability movements; only an executed apply settles the receivable. */
export function equipmentRentalBalances(total: number, rows: readonly EquipmentRentalMoneyRow[], allocated = 0) {
  let paid = allocated, depositCollected = 0, depositRefunded = 0, depositApplied = 0;
  let pendingRent = 0, pendingRentRefund = 0, pendingDeposit = 0;
  for (const row of rows) {
    const signed = row.amount * (row.reversal ? -1 : 1);
    if (row.approvalStatus === "pending") {
      if (row.kind === "rent_payment" || row.kind === "deposit_apply") pendingRent += row.amount;
      if (row.kind === "rent_refund") pendingRentRefund += row.amount;
      if (row.kind === "deposit_apply" || row.kind === "deposit_refund") pendingDeposit += row.amount;
    }
    if (row.approvalStatus !== "executed") continue;
    if (row.kind === "rent_payment") paid += signed;
    if (row.kind === "rent_refund") paid -= signed;
    if (row.kind === "deposit_collect") depositCollected += signed;
    if (row.kind === "deposit_refund") depositRefunded += signed;
    if (row.kind === "deposit_apply") { depositApplied += signed; paid += signed; }
  }
  // Original receipt-voucher allocations retain their own refund/reversal path.
  // Do not spend that same refundable pool through a rental refund as well.
  return { total: rounded(total), paid: rounded(paid), refundablePaid: rounded(Math.max(paid - allocated, 0)), remaining: rounded(Math.max(total - paid, 0)), depositCollected: rounded(depositCollected), depositRefunded: rounded(depositRefunded), depositApplied: rounded(depositApplied), depositHeld: rounded(depositCollected - depositRefunded - depositApplied), pendingRent: rounded(pendingRent), pendingRentRefund: rounded(pendingRentRefund), pendingDeposit: rounded(pendingDeposit) };
}

export function assertEquipmentRentalRequestBalance(balance: ReturnType<typeof equipmentRentalBalances>, kind: EquipmentRentalMoneyKind, amount: number) {
  if (!Number.isFinite(amount) || amount <= 0 || amount > 9_999_999_999.99 || Math.abs(rounded(amount) - amount) > 0.000001) throw new EquipmentRentalFinanceError("مبلغ غير صالح؛ استخدم منزلتين عشريتين كحد أقصى");
  if ((kind === "rent_payment" || kind === "deposit_apply") && amount > balance.remaining - balance.pendingRent + 0.005) throw new EquipmentRentalFinanceError("المبلغ يتجاوز الرصيد المتبقي بعد الطلبات المعلقة");
  if (kind === "rent_refund" && amount > balance.refundablePaid - balance.pendingRentRefund + 0.005) throw new EquipmentRentalFinanceError("الاسترداد يتجاوز الدفعات المتاحة؛ دفعات سند القبض تُسترد من سندها الأصلي");
  if ((kind === "deposit_refund" || kind === "deposit_apply") && amount > balance.depositHeld - balance.pendingDeposit + 0.005) throw new EquipmentRentalFinanceError("المبلغ يتجاوز التأمين المحتجز بعد الطلبات المعلقة");
}
