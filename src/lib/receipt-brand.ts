/**
 * The company identity printed on every branded receipt: name, tagline,
 * address, phones and Instagram. Stored as the `receiptBrand` site setting and
 * edited from الإعدادات → «هوية الوصولات». The logo is the site logo setting.
 *
 * A field that was never saved uses the default below (the owner's own receipt
 * sample, Nov 2026). A field saved empty stays empty, so the owner can hide it.
 */

export type ReceiptBrandFields = {
  name: string;
  tagline: string;
  address: string;
  phones: string[];
  /** Instagram account name without "@" (letters, digits, "." and "_"). */
  instagram: string;
};

export type ReceiptBrand = ReceiptBrandFields & { logoUrl: string };

export const DEFAULT_RECEIPT_BRAND: ReceiptBrandFields = {
  name: "مجموعة علي جان نهاد",
  tagline: "لتنظيم كافة المناسبات",
  address: "طوزخورماتو – الشارع العام – مقابل طوز مول",
  phones: ["07729000122", "07725762520"],
  instagram: "koshat_alijan",
};

const MAX_TEXT = 160;
const HANDLE = /^[A-Za-z0-9._]{1,30}$/;

/** "@name", "name" or an instagram.com link → "name"; anything else → "". */
export function instagramHandle(value: unknown): string {
  let raw = String(value ?? "").trim();
  if (!raw) return "";
  const link = raw.match(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^/?#]+)/i);
  if (link) raw = link[1];
  raw = raw.replace(/^@+/, "");
  return HANDLE.test(raw) ? raw : "";
}

export function instagramUrl(handle: string): string {
  const clean = instagramHandle(handle);
  return clean ? `https://www.instagram.com/${clean}/` : "";
}

const text = (value: unknown, fallback: string) =>
  value === undefined || value === null ? fallback : String(value).trim().slice(0, MAX_TEXT);

/** Saved setting (possibly partial or legacy-missing) → complete receipt identity. */
export function normalizeReceiptBrand(raw: unknown): ReceiptBrandFields {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const phones = Array.isArray(source.phones)
    ? source.phones.map((phone) => String(phone ?? "").trim().slice(0, 30)).filter(Boolean).slice(0, 4)
    : [...DEFAULT_RECEIPT_BRAND.phones];
  return {
    name: text(source.name, DEFAULT_RECEIPT_BRAND.name),
    tagline: text(source.tagline, DEFAULT_RECEIPT_BRAND.tagline),
    address: text(source.address, DEFAULT_RECEIPT_BRAND.address),
    phones,
    instagram: source.instagram === undefined || source.instagram === null
      ? DEFAULT_RECEIPT_BRAND.instagram
      : instagramHandle(source.instagram),
  };
}

/** The settings form refuses an Instagram value it cannot turn into an account name. */
export function receiptBrandProblem(fields: ReceiptBrandFields): string | null {
  if (fields.instagram && !instagramHandle(fields.instagram)) return "اسم حساب الإنستغرام غير صالح";
  if (fields.phones.length > 4) return "أقصى عدد للأرقام على الوصل 4";
  return null;
}

let current: ReceiptBrand | null = null;

/** Set once the public settings are loaded (PrintProvider keeps it in sync). */
export function setCurrentReceiptBrand(brand: ReceiptBrand) {
  current = brand;
}

/**
 * The identity receipt builders print when the caller passes none. Before the
 * settings arrive it uses the server-rendered settings, then the defaults.
 */
export function currentReceiptBrand(): ReceiptBrand {
  if (current) return current;
  const injected = typeof window === "undefined" ? undefined : (window as any).__AJN_PUBLIC_SETTINGS__;
  return {
    ...normalizeReceiptBrand(injected?.receipt_brand),
    logoUrl: String(injected?.logo_url ?? "") || "/images/logo-fallback.svg",
  };
}
