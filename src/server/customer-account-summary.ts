/**
 * Pure customer-account accounting math (no database, no IO).
 *
 * Separated from the query layer so the fold that produces a customer's single
 * financial truth is unit-testable in isolation — mirroring how the canonical
 * payment-state engine keeps its reconciliation logic auditable.
 */

export type CustomerAccountSourceType =
  | "sales_invoice"
  | "order"
  | "service_order"
  | "kosha_booking";

export type CustomerAccountDocument = {
  sourceType: CustomerAccountSourceType;
  sourceId: number;
  reference: string;
  date: string | null;
  total: number;
  /** Approved/posted paid = total − reconciled remaining (never client input). */
  paid: number;
  remaining: number;
  paymentStatus: string;
  /** true = matched by canonical customer_id; false = matched by exact phone fallback. */
  linkedById: boolean;
};

export type CustomerAccountSummary = {
  customerId: number;
  /** Σ document totals owed to AJN by this customer (across all sources). */
  totalReceivable: number;
  /** Σ approved/posted money received against those documents. */
  totalPaid: number;
  /** The one "في الذمة" figure = Σ reconciled remaining. */
  currentBalance: number;
  documentCount: number;
  /**
   * Documents included via the exact-phone fallback because they still carry no
   * canonical customer_id. A data-quality signal (Phase 16) — surfaced, never
   * hidden — so unlinked history is visible instead of silently dropped.
   */
  unlinkedByPhoneCount: number;
  sources: CustomerAccountDocument[];
};

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Pure fold of reconciled document snapshots into a customer account summary.
 * Side-effect-free so the accounting math is unit-testable without a DB.
 */
export function summarizeCustomerAccount(
  customerId: number,
  documents: CustomerAccountDocument[],
): CustomerAccountSummary {
  let totalReceivable = 0;
  let totalPaid = 0;
  let currentBalance = 0;
  let unlinkedByPhoneCount = 0;
  for (const document of documents) {
    totalReceivable += document.total;
    totalPaid += document.paid;
    currentBalance += document.remaining;
    if (!document.linkedById) unlinkedByPhoneCount += 1;
  }
  return {
    customerId,
    totalReceivable: round2(totalReceivable),
    totalPaid: round2(totalPaid),
    currentBalance: round2(currentBalance),
    documentCount: documents.length,
    unlinkedByPhoneCount,
    sources: documents,
  };
}
