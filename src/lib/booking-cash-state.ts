export type BookingCashState = "matched" | "empty" | "mismatch" | "missing_in_cash" | "overpaid";

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Compares what a booking records as paid with what the cash box approved. The booking holds at
 * most its own total, as in reconcilePaymentState, so money above the total is reported separately.
 */
export function bookingCashState({ total, recorded, approved }: { total: number; recorded: number; approved: number }) {
  const difference = round(recorded - Math.min(total, approved));
  const overpaid = round(Math.max(approved - total, 0));
  let state: BookingCashState;
  if (Math.abs(difference) >= 0.01) state = approved > 0 ? "mismatch" : "missing_in_cash";
  else if (overpaid > 0) state = "overpaid";
  else state = approved > 0 ? "matched" : "empty";
  return { state, difference, overpaid };
}
