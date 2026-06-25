export function normalizePhoneDigits(value: string | null | undefined): string {
  const arabic = "٠١٢٣٤٥٦٧٨٩";
  const persian = "۰۱۲۳۴۵۶۷۸۹";
  return String(value ?? "")
    .replace(/[٠-٩]/g, (d) => String(arabic.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(persian.indexOf(d)))
    .replace(/\D/g, "");
}

export function normalizeIraqiPhone(value: string | null | undefined): string | null {
  let digits = normalizePhoneDigits(value);
  if (!digits) return null;
  if (digits.startsWith("00964")) digits = digits.slice(2);
  if (digits.startsWith("9640")) digits = `964${digits.slice(4)}`;
  else if (digits.startsWith("0")) digits = `964${digits.slice(1)}`;
  else if (digits.startsWith("7")) digits = `964${digits}`;
  if (!digits.startsWith("964")) return null;
  return /^9647\d{9}$/.test(digits) ? digits : null;
}

export function toWhatsAppPhone(value: string | null | undefined): string | null {
  return normalizeIraqiPhone(value);
}

export function formatIraqiPhone(value: string | null | undefined): string {
  const normalized = normalizeIraqiPhone(value);
  if (normalized) return `0${normalized.slice(3)}`;
  return formatIraqiPhoneInput(value);
}

export function formatIraqiPhoneInput(value: string | null | undefined): string {
  let digits = normalizePhoneDigits(value);
  if (digits.startsWith("00964")) digits = digits.slice(2);
  if (digits.startsWith("9640")) return `0${digits.slice(4)}`.slice(0, 11);
  if (digits.startsWith("964")) return `0${digits.slice(3)}`.slice(0, 11);
  if (digits.startsWith("7")) return `0${digits}`.slice(0, 11);
  return digits.slice(0, 11);
}

export function isValidIraqiPhone(value: string | null | undefined): boolean {
  return normalizeIraqiPhone(value) !== null;
}

export function iraqiPhoneVariants(value: string | null | undefined): string[] {
  const normalized = normalizeIraqiPhone(value);
  const digits = normalizePhoneDigits(value);
  const variants = new Set<string>();
  if (normalized) {
    variants.add(normalized);
    variants.add(`0${normalized.slice(3)}`);
    variants.add(`+${normalized}`);
    variants.add(`00${normalized}`);
  }
  if (digits) variants.add(digits);
  return [...variants].filter(Boolean);
}
