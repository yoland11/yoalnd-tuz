/**
 * Department detection for bookings, orders and invoices.
 *
 * Pure functions only — no database access — so every rule here is directly testable and
 * the Store sync, the Kosha portal filter and the backfill scanner all reach the same
 * verdict from the same code.
 *
 * Detection is identifier-first, in the priority the business asked for:
 *   1. category id linked to the Sound category
 *   2. department / departmentCode carried in category metadata
 *   3. category slug
 *   4. legacy normalized category names (صوتيات / الصوتيات / Sound / Audio)
 *
 * Product titles are the last resort and never on their own promote a booking: a passing
 * mention of "مايك" in a customer note must not reroute an order.
 */

export type Department = "kosha" | "sound" | "photography";

/** Arabic presentation forms and diacritics that make string comparison unreliable. */
const ARABIC_DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;

/**
 * Normalizes a taxonomy value for comparison: strips diacritics and tatweel, unifies
 * alef/ya/ta-marbuta variants, drops the definite article, and collapses separators.
 * "الصَّوتيّات" and "Sound - Systems" both reduce to comparable forms.
 */
export function normalizeTaxonomy(value: unknown): string {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(ARABIC_DIACRITICS, "")
    .replace(TATWEEL, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[_\-/\\.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Leading definite article, so "الصوتيات" matches "صوتيات".
  return raw.startsWith("ال") ? raw.slice(2) : raw;
}

/** Canonical department tokens accepted from slugs, codes and metadata. */
const DEPARTMENT_CODES: Record<Department, string[]> = {
  sound: ["sound", "sounds", "audio", "sound systems", "sound system", "صوتيات", "صوت", "انظمه صوتيه"],
  kosha: ["kosha", "koshas", "kosha booking", "كوشات", "كوشه"],
  photography: ["photography", "photo", "photos", "تصوير", "فوتوغرافي"],
};

/** True when a slug / code / metadata value names the given department. */
export function matchesDepartment(value: unknown, department: Department): boolean {
  const normalized = normalizeTaxonomy(value);
  if (!normalized) return false;
  return DEPARTMENT_CODES[department].some(
    (code) => normalized === code || normalized.startsWith(`${code} `) || normalized.endsWith(` ${code}`),
  );
}

export type CategoryRow = {
  id: number;
  slug?: string | null;
  name?: string | null;
  nameAr?: string | null;
  imageMetadata?: unknown;
};

/**
 * Resolves the set of category ids belonging to a department.
 *
 * Replaces the previous exact `nameAr === "صوتيات"` lookup, which silently disabled
 * identifier-based detection the moment somebody renamed the category to "الصوتيات".
 */
export function resolveDepartmentCategoryIds(
  categories: CategoryRow[],
  department: Department,
): Set<number> {
  const ids = new Set<number>();
  for (const category of categories) {
    const metadata =
      category.imageMetadata && typeof category.imageMetadata === "object"
        ? (category.imageMetadata as Record<string, unknown>)
        : {};
    const signals = [
      // Priority 2: explicit department identifiers in metadata.
      metadata.departmentId,
      metadata.departmentCode,
      metadata.department,
      metadata.serviceType,
      metadata.type,
      // Priority 3: slug.
      category.slug,
      // Priority 4: legacy names.
      category.name,
      category.nameAr,
    ];
    if (signals.some((signal) => matchesDepartment(signal, department))) ids.add(category.id);
  }
  return ids;
}

export type ProductRow = {
  id?: number | string | null;
  categoryId?: number | string | null;
  subcategoryId?: number | string | null;
  subcategoryIds?: unknown;
  category?: string | null;
  subcategory?: string | null;
};

/** Every category id a product is linked through. */
export function productCategoryIds(product: ProductRow): number[] {
  return [
    product.categoryId,
    product.subcategoryId,
    ...(Array.isArray(product.subcategoryIds) ? product.subcategoryIds : []),
  ]
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
}

/**
 * Priority 1 + the denormalized category strings carried on the product row itself.
 * The string check exists because legacy rows predate category ids entirely.
 */
export function isProductInDepartment(
  product: ProductRow,
  departmentCategoryIds: Set<number>,
  department: Department,
): boolean {
  if (productCategoryIds(product).some((id) => departmentCategoryIds.has(id))) return true;
  return [product.category, product.subcategory].some((value) => matchesDepartment(value, department));
}

export function filterProductsByDepartment<T extends ProductRow>(
  products: T[],
  departmentCategoryIds: Set<number>,
  department: Department,
): T[] {
  return products.filter((product) => isProductInDepartment(product, departmentCategoryIds, department));
}

export type BookingServiceRow = {
  type?: string | null;
  name?: string | null;
  nameAr?: string | null;
  isActive?: boolean | null;
};

const GENERIC_EVENT_SERVICE_CODES = [
  "setup",
  "setups",
  "event setup",
  "execution",
  "event execution",
  "تجهيز",
  "تجهيزات",
  "تنفيذ",
  "تنفيذ مناسبات",
];

/**
 * Resolves the existing active service row used to host a Store Sound booking.
 * A dedicated Sound service wins. Older AJN databases only have the generic
 * setup/execution service, so that row is the compatible fallback while the
 * booking itself remains explicitly stamped with `departments: ["sound"]`.
 */
export function resolveSoundBookingService<T extends BookingServiceRow>(
  services: T[],
): T | null {
  const active = services.filter((service) => service.isActive !== false);
  const dedicated = active.find((service) =>
    [service.type, service.name, service.nameAr].some((value) =>
      matchesDepartment(value, "sound"),
    ),
  );
  if (dedicated) return dedicated;

  return (
    active.find((service) =>
      [service.type, service.name, service.nameAr].some((value) => {
        const normalized = normalizeTaxonomy(value);
        return GENERIC_EVENT_SERVICE_CODES.some(
          (code) =>
            normalized === code ||
            normalized.startsWith(`${code} `) ||
            normalized.endsWith(` ${code}`),
        );
      }),
    ) ?? null
  );
}

export type BookingSignals = {
  /** Product ids referenced by the booking, resolved against the department index. */
  productIds?: Array<number | string | null | undefined>;
  /** Structured taxonomy values: service type, department field, package/category names. */
  taxonomy?: Array<unknown>;
  /** Free-text item names. Corroborating only — never promotes on its own. */
  itemNames?: Array<unknown>;
};

/**
 * Decides which departments a booking belongs to.
 *
 * A booking may belong to several at once; mixed bookings stay one booking with several
 * departments, which is what keeps a Kosha+Sound job from being split in two.
 */
export function detectBookingDepartments(input: {
  signals: BookingSignals;
  /** productId → the departments that product belongs to. */
  productDepartments?: Map<number, Department[]>;
}): Department[] {
  const found = new Set<Department>();
  const departments: Department[] = ["kosha", "sound", "photography"];

  // Priority 1 — product identifiers. Strongest signal, no text involved.
  for (const raw of input.signals.productIds ?? []) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) continue;
    for (const department of input.productDepartments?.get(id) ?? []) found.add(department);
  }

  // Priorities 2-4 — structured taxonomy fields.
  for (const value of input.signals.taxonomy ?? []) {
    for (const department of departments) {
      if (matchesDepartment(value, department)) found.add(department);
    }
  }

  // Last resort — item names, used only when nothing structured matched at all, so a
  // correctly-tagged booking is never re-classified by a stray product title.
  if (!found.size) {
    for (const value of input.signals.itemNames ?? []) {
      for (const department of departments) {
        if (matchesDepartment(value, department)) found.add(department);
      }
    }
  }

  return departments.filter((department) => found.has(department));
}

/** Stable idempotency key for the booking linked to an external source record. */
export function bookingLinkKey(sourceType: string, sourceId: number | string): string {
  return `booking-link:${String(sourceType).trim().toLowerCase()}:${String(sourceId).trim()}`;
}

/** Badge text for the portals. Mixed bookings read "كوشات + صوتيات". */
export function departmentBadge(departments: Department[]): string {
  const labels: Record<Department, string> = {
    kosha: "كوشات",
    sound: "صوتيات",
    photography: "تصوير",
  };
  const ordered: Department[] = ["kosha", "sound", "photography"];
  const parts = ordered.filter((department) => departments.includes(department)).map((d) => labels[d]);
  return parts.join(" + ");
}
