export const INVOICE_PAYMENT_STATUSES = [
  "unpaid",
  "partial",
  "paid",
  "overpaid",
] as const;

export type InvoicePaymentStatus = (typeof INVOICE_PAYMENT_STATUSES)[number];

export const INVOICE_PAYMENT_STATUS_OPTIONS: Array<{
  value: "" | InvoicePaymentStatus;
  label: string;
}> = [
  { value: "", label: "الكل" },
  { value: "unpaid", label: "غير مدفوع" },
  { value: "partial", label: "مدفوع جزئياً" },
  { value: "paid", label: "مدفوع بالكامل" },
  { value: "overpaid", label: "مدفوع أكثر من المطلوب" },
];

export const INVOICE_PAYMENT_STATUS_LABELS: Record<InvoicePaymentStatus, string> = {
  unpaid: "غير مدفوع",
  partial: "مدفوع جزئياً",
  paid: "مدفوع بالكامل",
  overpaid: "مدفوع أكثر من المطلوب",
};

export function deriveInvoicePaymentStatus(
  paidAmount: unknown,
  invoiceTotal: unknown,
): InvoicePaymentStatus {
  const paid = Number(paidAmount) || 0;
  const total = Number(invoiceTotal) || 0;
  if (paid === 0) return "unpaid";
  if (paid < total) return "partial";
  if (paid === total) return "paid";
  return "overpaid";
}

export function invoiceRemainingBalance(paidAmount: unknown, invoiceTotal: unknown) {
  const paid = Number(paidAmount) || 0;
  const total = Number(invoiceTotal) || 0;
  return Math.max(total - paid, 0);
}

