export type CustomerLinkResolution =
  | "linked"
  | "missing_data"
  | "no_match"
  | "single_match"
  | "multiple_matches";

/** A legacy phone produces a suggestion only; only a confirmed link writes customer_id. */
export function customerLinkResolution(input: {
  customerId: number | null | undefined;
  normalizedPhone: string | null;
  candidateCount: number;
}): CustomerLinkResolution {
  if (input.customerId) return "linked";
  if (!input.normalizedPhone) return "missing_data";
  if (input.candidateCount === 0) return "no_match";
  return input.candidateCount === 1 ? "single_match" : "multiple_matches";
}

export function salesInvoicePaymentProjection(total: number, currentPaid: number, amount: number) {
  const paid = Math.round((Math.max(0, currentPaid) + Math.max(0, amount)) * 100) / 100;
  const remaining = Math.max(Math.round((Math.max(0, total) - paid) * 100) / 100, 0);
  const paymentStatus = paid <= 0 ? "unpaid" : paid < total ? "partial" : paid === total ? "paid" : "overpaid";
  return { paid, remaining, paymentStatus } as const;
}
