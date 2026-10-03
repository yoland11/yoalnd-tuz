export type AccountingReferenceTransaction = {
  reference: string;
  date: string;
  serviceType: string;
  total: number;
  paid: number;
  remaining: number;
  paymentHistory?: Array<{ date: string; amount: number; reference?: string }>;
  href?: string | null;
};

export function findAccountingReferenceTransaction<T extends AccountingReferenceTransaction>(
  reference: string,
  transactions: readonly T[],
): T | null {
  const normalizedReference = reference.trim().toLocaleLowerCase("en-US");
  if (!normalizedReference) return null;

  return transactions.find(
    (transaction) =>
      transaction.reference.trim().toLocaleLowerCase("en-US") === normalizedReference,
  ) ?? null;
}
