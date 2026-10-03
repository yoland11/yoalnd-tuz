/**
 * Returns the payment list only when the salary-management API response has
 * the documented array shape. `null` means the payload is malformed, not an
 * empty payment history.
 */
export function readSalaryManagementPayments(value: unknown): unknown[] | null {
  if (!value || typeof value !== "object" || !Array.isArray((value as { payments?: unknown }).payments)) {
    return null;
  }

  return (value as { payments: unknown[] }).payments;
}
