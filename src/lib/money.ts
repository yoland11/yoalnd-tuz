export type MoneyValue = number | string | null | undefined;

const IQD_LABEL = "د.ع";
const moneyFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function normalizeMoneyDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/(?:د\.?\s*ع|دينار(?:\s+عراقي)?|IQD)/gi, "")
    .replace(/[٬,،\s]/g, "")
    .replace(/٫/g, ".")
    .trim();
}

export function moneyNumber(value: MoneyValue): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(normalizeMoneyDigits(String(value ?? "")));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Formats an IQD amount with western digits and thousands separators, without a currency label. */
export function formatMoney(value: MoneyValue): string {
  return moneyFormatter.format(moneyNumber(value));
}

/** Formats an IQD amount once, including the shared currency label. */
export function formatCurrency(value: MoneyValue): string {
  return `${formatMoney(value)} ${IQD_LABEL}`;
}

export { IQD_LABEL };
