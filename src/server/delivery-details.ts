import { and, asc, desc, eq, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { z } from "zod/v4";
import {
  db,
  customerAddressesTable,
  deliveryDetailsTable,
  deliveryOrdersTable,
  deliveryOrderStatusHistoryTable,
  deliveryZonesTable,
  salesInvoicesTable,
  settingsTable,
  DELIVERY_METHODS,
  DELIVERY_TYPES,
  DELIVERY_STATUSES,
  DELIVERY_FEE_PAYERS,
  type DeliveryDetail,
  type DeliveryMethod,
  type DeliveryOrder,
  type DeliveryStatus,
  type DeliveryType,
  type DeliveryZone,
} from "@workspace/db";
import { normalizeIraqiPhone } from "@/lib/phone";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** How the delivery fee is treated financially. Global setting, per deployment. */
export const DELIVERY_ACCOUNTING_MODES = ["revenue", "payable", "expense"] as const;
export type DeliveryAccountingMode = (typeof DELIVERY_ACCOUNTING_MODES)[number];

export const DELIVERY_ACCOUNTING_MODE_LABELS: Record<string, string> = {
  revenue: "إيراد توصيل",
  payable: "مستحق لشركة التوصيل",
  expense: "على حساب المحل",
};

const DELIVERY_ACCOUNTING_SETTING_KEY = "deliveryAccountingMode";

export const DELIVERY_METHOD_LABELS: Record<string, string> = {
  pickup: "استلام من المحل",
  city: "توصيل داخل المدينة",
  province: "توصيل إلى محافظة",
};

export const DELIVERY_TYPE_LABELS: Record<string, string> = {
  standard: "عادي",
  express: "سريع",
  same_day: "نفس اليوم",
  office_pickup: "استلام من مكتب شركة التوصيل",
  door: "توصيل إلى باب المنزل",
};

export const DELIVERY_STATUS_LABELS: Record<string, string> = {
  pending_prep: "بانتظار التجهيز",
  ready_to_ship: "جاهز للإرسال",
  handed_to_company: "تم التسليم لشركة التوصيل",
  in_transit: "في الطريق",
  arrived_province: "وصل إلى المحافظة",
  out_for_delivery: "خرج للتسليم",
  delivered: "تم التسليم",
  failed: "تعذر التسليم",
  returned: "مرتجع",
  cancelled: "ملغي",
};

export const DELIVERY_FEE_PAYER_LABELS: Record<string, string> = {
  customer: "العميل",
  store: "المحل",
};

/** Statuses that close a delivery — no further transitions are accepted. */
export const TERMINAL_DELIVERY_STATUSES: readonly DeliveryStatus[] = [
  "delivered",
  "returned",
  "cancelled",
];

// ─── Validation ──────────────────────────────────────────────────────────────

const iraqiPhone = z
  .string()
  .trim()
  .refine((value) => normalizeIraqiPhone(value) !== null, {
    message: "رقم هاتف عراقي غير صحيح",
  })
  .transform((value) => normalizeIraqiPhone(value) as string);

const optionalIraqiPhone = z
  .string()
  .trim()
  .max(30)
  .optional()
  .nullable()
  .refine((value) => !value || normalizeIraqiPhone(value) !== null, {
    message: "رقم هاتف عراقي غير صحيح",
  })
  .transform((value) => (value ? normalizeIraqiPhone(value) : null));

const fee = z.coerce.number().min(0).max(999_999_999);

/**
 * Delivery payload as it arrives from the invoice / POS client.  The province
 * branch is validated separately by `provinceDeliverySchema` so that pickup and
 * in-city sales are never blocked by province-only requirements.
 */
export const deliveryInputSchema = z.object({
  method: z.enum(DELIVERY_METHODS).default("pickup"),
  provinceId: z.coerce.number().int().positive().optional().nullable(),
  customerAddressId: z.coerce.number().int().positive().optional().nullable(),
  saveAddressToCustomer: z.boolean().optional().default(false),
  city: z.string().trim().max(120).optional().default(""),
  district: z.string().trim().max(120).optional().default(""),
  area: z.string().trim().max(120).optional().default(""),
  landmark: z.string().trim().max(200).optional().default(""),
  fullAddress: z.string().trim().max(1000).optional().default(""),
  mapsUrl: z.string().trim().max(2000).optional().nullable(),
  receiverName: z.string().trim().max(160).optional().default(""),
  receiverPhone: z.string().trim().max(30).optional().nullable(),
  receiverAltPhone: optionalIraqiPhone,
  deliveryCompany: z.string().trim().max(160).optional().nullable(),
  deliveryType: z.enum(DELIVERY_TYPES).default("standard"),
  deliveryFee: fee.optional(),
  feeOverrideReason: z.string().trim().max(500).optional().nullable(),
  feePaidBy: z.enum(DELIVERY_FEE_PAYERS).default("customer"),
  codEnabled: z.boolean().optional().default(false),
  expectedShipDate: z.string().regex(DATE).optional().nullable(),
  expectedArrivalDate: z.string().regex(DATE).optional().nullable(),
  preferredTime: z.string().trim().max(40).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  isFragile: z.boolean().optional().default(false),
  needsRefrigeration: z.boolean().optional().default(false),
});

export type DeliveryInput = z.infer<typeof deliveryInputSchema>;

/**
 * The extra requirements that only apply once "توصيل إلى محافظة" is chosen.
 * Field names match `deliveryInputSchema` so the client can pin each message
 * beside the offending input.
 */
export const provinceDeliverySchema = z.object({
  provinceId: z.coerce
    .number({ error: "اختر المحافظة" })
    .int()
    .positive("اختر المحافظة"),
  city: z.string().trim().min(1, "أدخل القضاء / المدينة").max(120),
  area: z.string().trim().min(1, "أدخل الحي / المنطقة").max(120),
  fullAddress: z.string().trim().min(1, "أدخل العنوان التفصيلي").max(1000),
  receiverName: z.string().trim().min(1, "أدخل اسم المستلم").max(160),
  receiverPhone: iraqiPhone,
  deliveryType: z.enum(DELIVERY_TYPES, { error: "اختر نوع التوصيل" }),
  deliveryFee: fee,
});

/** Province registry + pricing, as managed from Delivery Settings. */
export const provinceCreateSchema = z.object({
  governorateAr: z.string().trim().min(1, "أدخل اسم المحافظة").max(120),
  governorate: z.string().trim().max(120).optional(),
  areas: z.array(z.string().trim().max(120)).optional().default([]),
  price: fee.optional().default(0),
  expressFee: fee.optional().default(0),
  sameDayFee: fee.optional().default(0),
  codFee: fee.optional().default(0),
  freeDeliveryThreshold: fee.optional().default(0),
  maxWeight: fee.optional().default(0),
  estimatedDays: z.coerce.number().int().min(0).max(365).optional().default(2),
  deliveryCompany: z.string().trim().max(160).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).optional().default(0),
  isActive: z.boolean().optional().default(true),
});

export const provinceUpdateSchema = provinceCreateSchema.partial();

export const provinceReorderSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1, "أرسل ترتيب المحافظات"),
});

export const deliveryQuoteSchema = z.object({
  provinceId: z.coerce.number().int().positive("اختر المحافظة"),
  deliveryType: z.enum(DELIVERY_TYPES).default("standard"),
  subtotal: z.coerce.number().min(0).default(0),
  codEnabled: z.boolean().optional().default(false),
});

// ─── Fee resolution ──────────────────────────────────────────────────────────

export type ResolvedDeliveryFee = {
  /** Fee owed for the chosen province + delivery type, after free-threshold. */
  deliveryFee: number;
  /** Fee before the free-delivery threshold was applied. */
  baseFee: number;
  codFee: number;
  estimatedDays: number;
  deliveryCompany: string | null;
  freeThresholdApplied: boolean;
};

/**
 * The single source of truth for what a province delivery costs.  Both the
 * quote endpoint and invoice creation go through here so a client can never
 * invent its own price.
 */
export function resolveDeliveryFee(
  zone: DeliveryZone,
  deliveryType: DeliveryType,
  subtotal: number,
  codEnabled: boolean,
): ResolvedDeliveryFee {
  const standard = Number.parseFloat(String(zone.price)) || 0;
  const express = Number.parseFloat(String(zone.expressFee)) || 0;
  const sameDay = Number.parseFloat(String(zone.sameDayFee)) || 0;
  const codFee = Number.parseFloat(String(zone.codFee)) || 0;
  const threshold = Number.parseFloat(String(zone.freeDeliveryThreshold)) || 0;

  // Express / same-day fall back to the standard fee when they are not priced,
  // so a half-configured province still quotes something sane.
  let baseFee: number;
  switch (deliveryType) {
    case "express":
      baseFee = express > 0 ? express : standard;
      break;
    case "same_day":
      baseFee = sameDay > 0 ? sameDay : standard;
      break;
    default:
      baseFee = standard;
  }

  const freeThresholdApplied = threshold > 0 && subtotal >= threshold;
  return {
    deliveryFee: freeThresholdApplied ? 0 : baseFee,
    baseFee,
    codFee: codEnabled ? codFee : 0,
    estimatedDays: zone.estimatedDays,
    deliveryCompany: zone.deliveryCompany ?? null,
    freeThresholdApplied,
  };
}

export async function findProvince(id: number): Promise<DeliveryZone | null> {
  const zone = await db.query.deliveryZonesTable.findFirst({
    where: eq(deliveryZonesTable.id, id),
  });
  return zone ?? null;
}

export async function listProvinces(activeOnly: boolean): Promise<DeliveryZone[]> {
  const zones = await db.query.deliveryZonesTable.findMany({
    orderBy: [asc(deliveryZonesTable.sortOrder), asc(deliveryZonesTable.governorateAr)],
  });
  return activeOnly ? zones.filter((zone) => zone.isActive) : zones;
}

/** Adds `days` calendar days to an ISO date, for the expected-arrival default. */
export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function formatProvince(zone: DeliveryZone) {
  return {
    id: zone.id,
    governorate: zone.governorate,
    governorateAr: zone.governorateAr,
    areas: zone.areas ?? [],
    price: Number.parseFloat(String(zone.price)) || 0,
    expressFee: Number.parseFloat(String(zone.expressFee)) || 0,
    sameDayFee: Number.parseFloat(String(zone.sameDayFee)) || 0,
    codFee: Number.parseFloat(String(zone.codFee)) || 0,
    freeDeliveryThreshold: Number.parseFloat(String(zone.freeDeliveryThreshold)) || 0,
    maxWeight: Number.parseFloat(String(zone.maxWeight)) || 0,
    estimatedDays: zone.estimatedDays,
    deliveryCompany: zone.deliveryCompany ?? null,
    sortOrder: zone.sortOrder,
    notes: zone.notes ?? null,
    isActive: zone.isActive,
  };
}

// ─── Runtime provisioning ────────────────────────────────────────────────────

/**
 * The 18 Iraqi governorates, seeded only when the zone table is empty so an
 * existing deployment's pricing is never overwritten.
 */
const IRAQI_PROVINCES: Array<{ ar: string; en: string }> = [
  { ar: "بغداد", en: "Baghdad" },
  { ar: "كركوك", en: "Kirkuk" },
  { ar: "صلاح الدين", en: "Salah al-Din" },
  { ar: "أربيل", en: "Erbil" },
  { ar: "السليمانية", en: "Sulaymaniyah" },
  { ar: "دهوك", en: "Duhok" },
  { ar: "نينوى", en: "Nineveh" },
  { ar: "ديالى", en: "Diyala" },
  { ar: "الأنبار", en: "Anbar" },
  { ar: "بابل", en: "Babil" },
  { ar: "كربلاء", en: "Karbala" },
  { ar: "النجف", en: "Najaf" },
  { ar: "واسط", en: "Wasit" },
  { ar: "القادسية", en: "Al-Qadisiyyah" },
  { ar: "المثنى", en: "Al-Muthanna" },
  { ar: "ذي قار", en: "Dhi Qar" },
  { ar: "ميسان", en: "Maysan" },
  { ar: "البصرة", en: "Basra" },
];

let deliveryDetailsMigrated = false;

/**
 * Provisions the province-delivery tables in the same runtime style the rest of
 * this codebase uses.  Every statement is additive and idempotent.
 */
export async function ensureDeliveryDetailsTables() {
  if (deliveryDetailsMigrated) return;
  try {
    await db.execute(sql`
      ALTER TABLE delivery_zones
        ADD COLUMN IF NOT EXISTS express_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS same_day_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS cod_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS free_delivery_threshold NUMERIC(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS delivery_company TEXT,
        ADD COLUMN IF NOT EXISTS max_weight NUMERIC(10,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS notes TEXT,
        ADD COLUMN IF NOT EXISTS priced_regions JSONB NOT NULL DEFAULT '[]'::jsonb;

      ALTER TABLE customer_addresses
        ADD COLUMN IF NOT EXISTS province_id INTEGER REFERENCES delivery_zones(id),
        ADD COLUMN IF NOT EXISTS district TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS area TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS alt_phone VARCHAR(20),
        ADD COLUMN IF NOT EXISTS maps_url TEXT;

      CREATE TABLE IF NOT EXISTS delivery_details (
        id SERIAL PRIMARY KEY,
        sales_invoice_id INTEGER REFERENCES sales_invoices(id) ON DELETE CASCADE,
        order_id INTEGER REFERENCES orders(id),
        customer_id INTEGER REFERENCES customers(id),
        customer_address_id INTEGER REFERENCES customer_addresses(id),
        province_id INTEGER REFERENCES delivery_zones(id),
        method VARCHAR(20) NOT NULL DEFAULT 'pickup',
        province_name TEXT NOT NULL DEFAULT '',
        city TEXT NOT NULL DEFAULT '',
        district TEXT NOT NULL DEFAULT '',
        area TEXT NOT NULL DEFAULT '',
        landmark TEXT NOT NULL DEFAULT '',
        full_address TEXT NOT NULL DEFAULT '',
        maps_url TEXT,
        receiver_name TEXT NOT NULL DEFAULT '',
        receiver_phone VARCHAR(20),
        receiver_alt_phone VARCHAR(20),
        delivery_company TEXT,
        delivery_type VARCHAR(20) NOT NULL DEFAULT 'standard',
        delivery_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
        base_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
        fee_overridden BOOLEAN NOT NULL DEFAULT false,
        fee_override_reason TEXT,
        fee_paid_by VARCHAR(20) NOT NULL DEFAULT 'customer',
        cod_enabled BOOLEAN NOT NULL DEFAULT false,
        cod_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
        cod_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        cod_collected_at TIMESTAMP,
        expected_ship_date DATE,
        expected_arrival_date DATE,
        preferred_time VARCHAR(40),
        notes TEXT,
        is_fragile BOOLEAN NOT NULL DEFAULT false,
        needs_refrigeration BOOLEAN NOT NULL DEFAULT false,
        created_by INTEGER REFERENCES staff(id),
        created_by_name TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS delivery_details_sales_invoice_unique
        ON delivery_details(sales_invoice_id) WHERE sales_invoice_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS delivery_details_province_idx ON delivery_details(province_id);
      CREATE INDEX IF NOT EXISTS delivery_details_customer_idx ON delivery_details(customer_id);

      CREATE TABLE IF NOT EXISTS delivery_orders (
        id SERIAL PRIMARY KEY,
        delivery_no VARCHAR(40) NOT NULL UNIQUE,
        delivery_details_id INTEGER REFERENCES delivery_details(id) ON DELETE CASCADE,
        sales_invoice_id INTEGER REFERENCES sales_invoices(id) ON DELETE CASCADE,
        order_id INTEGER REFERENCES orders(id),
        customer_id INTEGER REFERENCES customers(id),
        customer_address_id INTEGER REFERENCES customer_addresses(id),
        province_id INTEGER REFERENCES delivery_zones(id),
        financial_transaction_id INTEGER,
        qr_token VARCHAR(80),
        status VARCHAR(30) NOT NULL DEFAULT 'pending_prep',
        status_updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        delivered_at TIMESTAMP,
        returned_at TIMESTAMP,
        label_printed_at TIMESTAMP,
        label_print_count INTEGER NOT NULL DEFAULT 0,
        created_by INTEGER REFERENCES staff(id),
        created_by_name TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS delivery_orders_details_unique
        ON delivery_orders(delivery_details_id) WHERE delivery_details_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS delivery_orders_status_idx ON delivery_orders(status);
      CREATE INDEX IF NOT EXISTS delivery_orders_province_idx ON delivery_orders(province_id);

      CREATE TABLE IF NOT EXISTS delivery_order_status_history (
        id SERIAL PRIMARY KEY,
        delivery_order_id INTEGER NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
        status VARCHAR(30) NOT NULL,
        reason TEXT,
        notes TEXT,
        created_by INTEGER REFERENCES staff(id),
        created_by_name TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS delivery_order_history_order_idx
        ON delivery_order_status_history(delivery_order_id);

      -- Phase 3: return metadata on the delivery order.
      ALTER TABLE delivery_orders
        ADD COLUMN IF NOT EXISTS return_reason TEXT,
        ADD COLUMN IF NOT EXISTS returned_items JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS cancel_reason TEXT,
        ADD COLUMN IF NOT EXISTS cod_settled_at TIMESTAMP;

      -- Phase 3: COD settlement ledger. One settlement per delivery order.
      CREATE TABLE IF NOT EXISTS delivery_cod_settlements (
        id SERIAL PRIMARY KEY,
        delivery_order_id INTEGER NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
        sales_invoice_id INTEGER REFERENCES sales_invoices(id) ON DELETE SET NULL,
        customer_id INTEGER REFERENCES customers(id),
        delivery_company TEXT,
        expected_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        received_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        settlement_date DATE NOT NULL,
        reference_no TEXT,
        account VARCHAR(20) NOT NULL DEFAULT 'cash',
        accounting_mode VARCHAR(20) NOT NULL DEFAULT 'revenue',
        notes TEXT,
        attachment_url TEXT,
        receipt_voucher_id INTEGER,
        financial_transaction_id INTEGER,
        status VARCHAR(20) NOT NULL DEFAULT 'completed',
        created_by INTEGER REFERENCES staff(id),
        created_by_name TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS delivery_cod_settlements_order_unique
        ON delivery_cod_settlements(delivery_order_id);
    `);
    await seedProvinces();
    deliveryDetailsMigrated = true;
  } catch (err) {
    console.warn("delivery details provisioning failed", err);
    deliveryDetailsMigrated = true;
  }
}

/** Seeds the governorates only into an empty table — never overwrites pricing. */
async function seedProvinces() {
  const existing = await db.select({ id: deliveryZonesTable.id }).from(deliveryZonesTable).limit(1);
  if (existing.length > 0) return;
  await db.insert(deliveryZonesTable).values(
    IRAQI_PROVINCES.map((province, index) => ({
      governorate: province.en,
      governorateAr: province.ar,
      areas: [],
      pricedRegions: [],
      price: "0",
      estimatedDays: 2,
      isActive: true,
      sortOrder: index,
    })),
  );
}

// ─── Sales-invoice / POS integration ────────────────────────────────────────

const money = (value: unknown) => {
  const n = Number.parseFloat(String(value ?? 0));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

export type DeliveryPrep = {
  input: DeliveryInput;
  method: DeliveryMethod;
  province: DeliveryZone | null;
  /** Fee resolved from the province pricing before any manual override. */
  resolvedFee: number;
  codFee: number;
  estimatedDays: number;
  expectedShipDate: string | null;
  expectedArrivalDate: string | null;
  receiverPhone: string | null;
};

/**
 * Validates a delivery payload from the invoice/POS client and resolves the
 * province fee. Returns `data: null` for pickup with no payload. Province
 * deliveries enforce the required-field set and a real, active province. The
 * caller decides whether a manual fee override is permitted.
 */
export async function prepareInvoiceDelivery(
  raw: unknown,
  subtotal: number,
): Promise<{ ok: true; data: DeliveryPrep | null } | { ok: false; message: string }> {
  if (raw == null) return { ok: true, data: null };
  const parsed = deliveryInputSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, message: issue ? `${issue.path.join(".")}: ${issue.message}` : "بيانات توصيل غير صحيحة" };
  }
  const input = parsed.data;

  if (input.method !== "province") {
    // Store pickup or in-city — no province pricing is resolved. An in-city fee,
    // if any, arrives as an explicit deliveryFee on the payload.
    return {
      ok: true,
      data: {
        input,
        method: input.method,
        province: null,
        resolvedFee: input.method === "city" ? money(input.deliveryFee) : 0,
        codFee: 0,
        estimatedDays: 0,
        expectedShipDate: input.expectedShipDate ?? null,
        expectedArrivalDate: input.expectedArrivalDate ?? null,
        receiverPhone: input.receiverPhone ? normalizeIraqiPhone(input.receiverPhone) : null,
      },
    };
  }

  // Province branch — enforce the required fields (fee is computed, not trusted).
  const check = provinceDeliverySchema.safeParse({ ...input, deliveryFee: 0 });
  if (!check.success) {
    const issue = check.error.issues[0];
    return { ok: false, message: issue ? issue.message : "أكمل بيانات التوصيل إلى المحافظة" };
  }
  const zone = input.provinceId ? await findProvince(input.provinceId) : null;
  if (!zone) return { ok: false, message: "المحافظة غير موجودة" };
  if (!zone.isActive) return { ok: false, message: "المحافظة غير مفعّلة للتوصيل" };

  const quote = resolveDeliveryFee(zone, input.deliveryType, subtotal, input.codEnabled);
  const today = new Date().toISOString().slice(0, 10);
  return {
    ok: true,
    data: {
      input,
      method: "province",
      province: zone,
      resolvedFee: quote.deliveryFee,
      codFee: quote.codFee,
      estimatedDays: quote.estimatedDays,
      expectedShipDate: input.expectedShipDate ?? today,
      expectedArrivalDate: input.expectedArrivalDate ?? addDays(today, quote.estimatedDays),
      receiverPhone: check.data.receiverPhone,
    },
  };
}

function deliveryNo(id: number, date: Date): string {
  const y = date.getFullYear().toString().slice(-2);
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `DLV-${y}${m}-${String(id).padStart(5, "0")}`;
}

export type PersistDeliveryOptions = {
  salesInvoiceId: number;
  prep: DeliveryPrep;
  /** Fee actually charged after the caller's override decision. */
  finalFee: number;
  overridden: boolean;
  overrideReason: string | null;
  /** Expected cash-on-delivery amount (remaining balance) when COD is on. */
  codAmount: number;
  customerId: number | null;
  actor: { id: number | null; name: string };
};

/**
 * Persists the delivery detail for an invoice and generates exactly one linked
 * delivery order. Idempotent per invoice — the unique index on
 * `delivery_details.sales_invoice_id` prevents duplicates, and an existing row
 * is returned rather than re-created.
 */
export async function persistInvoiceDelivery(
  opts: PersistDeliveryOptions,
): Promise<{ deliveryDetail: DeliveryDetail; deliveryOrder: DeliveryOrder | null; created: boolean }> {
  await ensureDeliveryDetailsTables();
  const { prep, actor } = opts;
  const input = prep.input;

  const existing = await db.query.deliveryDetailsTable.findFirst({
    where: eq(deliveryDetailsTable.salesInvoiceId, opts.salesInvoiceId),
  });
  if (existing) {
    const order = await db.query.deliveryOrdersTable.findFirst({
      where: eq(deliveryOrdersTable.deliveryDetailsId, existing.id),
    });
    return { deliveryDetail: existing, deliveryOrder: order ?? null, created: false };
  }

  const codEnabled = input.codEnabled ?? false;
  const [detail] = await db
    .insert(deliveryDetailsTable)
    .values({
      salesInvoiceId: opts.salesInvoiceId,
      customerId: opts.customerId,
      customerAddressId: input.customerAddressId ?? null,
      provinceId: prep.province?.id ?? null,
      method: prep.method,
      provinceName: prep.province?.governorateAr ?? "",
      city: input.city ?? "",
      district: input.district ?? "",
      area: input.area ?? "",
      landmark: input.landmark ?? "",
      fullAddress: input.fullAddress ?? "",
      mapsUrl: input.mapsUrl ?? null,
      receiverName: input.receiverName ?? "",
      receiverPhone: prep.receiverPhone,
      receiverAltPhone: input.receiverAltPhone ?? null,
      deliveryCompany: input.deliveryCompany ?? prep.province?.deliveryCompany ?? null,
      deliveryType: input.deliveryType,
      deliveryFee: String(money(opts.finalFee)),
      baseFee: String(money(prep.resolvedFee)),
      feeOverridden: opts.overridden,
      feeOverrideReason: opts.overrideReason,
      feePaidBy: input.feePaidBy,
      codEnabled,
      codFee: String(money(prep.codFee)),
      codAmount: String(money(opts.codAmount)),
      expectedShipDate: prep.expectedShipDate,
      expectedArrivalDate: prep.expectedArrivalDate,
      preferredTime: input.preferredTime ?? null,
      notes: input.notes ?? null,
      isFragile: input.isFragile ?? false,
      needsRefrigeration: input.needsRefrigeration ?? false,
      createdBy: actor.id,
      createdByName: actor.name,
    })
    .returning();

  // One delivery order per detail. Only province deliveries ship; pickup/in-city
  // still record the detail but need no shippable order.
  let order: DeliveryOrder | null = null;
  if (prep.method === "province") {
    const [created] = await db
      .insert(deliveryOrdersTable)
      .values({
        deliveryNo: `DLV-TEMP-${randomBytes(6).toString("hex")}`,
        deliveryDetailsId: detail.id,
        salesInvoiceId: opts.salesInvoiceId,
        customerId: opts.customerId,
        customerAddressId: input.customerAddressId ?? null,
        provinceId: prep.province?.id ?? null,
        status: "pending_prep",
        createdBy: actor.id,
        createdByName: actor.name,
      })
      .returning();
    const [renamed] = await db
      .update(deliveryOrdersTable)
      .set({ deliveryNo: deliveryNo(created.id, new Date(created.createdAt)) })
      .where(eq(deliveryOrdersTable.id, created.id))
      .returning();
    order = renamed ?? created;
    await db.insert(deliveryOrderStatusHistoryTable).values({
      deliveryOrderId: order.id,
      status: "pending_prep",
      notes: "أُنشئ تلقائياً عند إصدار الفاتورة",
      createdBy: actor.id,
      createdByName: actor.name,
    });
  }

  // Optionally persist the address to the customer's address book.
  if (input.saveAddressToCustomer && opts.customerId && prep.method === "province") {
    await db.insert(customerAddressesTable).values({
      customerId: opts.customerId,
      type: "delivery",
      fullName: input.receiverName ?? "",
      phone: prep.receiverPhone ?? "",
      provinceId: prep.province?.id ?? null,
      governorate: prep.province?.governorateAr ?? "",
      city: input.city ?? "",
      district: input.district ?? "",
      area: input.area ?? "",
      address: input.fullAddress ?? "",
      landmark: input.landmark ?? "",
      altPhone: input.receiverAltPhone ?? null,
      mapsUrl: input.mapsUrl ?? null,
      isDefault: false,
    });
  }

  return { deliveryDetail: detail, deliveryOrder: order, created: true };
}

export async function getInvoiceDelivery(salesInvoiceId: number) {
  const detail = await db.query.deliveryDetailsTable.findFirst({
    where: eq(deliveryDetailsTable.salesInvoiceId, salesInvoiceId),
  });
  if (!detail) return null;
  const order = await db.query.deliveryOrdersTable.findFirst({
    where: eq(deliveryOrdersTable.deliveryDetailsId, detail.id),
  });
  return { detail, order: order ?? null };
}

export function formatDeliveryDetail(detail: DeliveryDetail, order: DeliveryOrder | null) {
  return {
    id: detail.id,
    method: detail.method,
    methodLabel: DELIVERY_METHOD_LABELS[detail.method] ?? detail.method,
    provinceId: detail.provinceId,
    provinceName: detail.provinceName,
    city: detail.city,
    district: detail.district,
    area: detail.area,
    landmark: detail.landmark,
    fullAddress: detail.fullAddress,
    mapsUrl: detail.mapsUrl,
    receiverName: detail.receiverName,
    receiverPhone: detail.receiverPhone,
    receiverAltPhone: detail.receiverAltPhone,
    deliveryCompany: detail.deliveryCompany,
    deliveryType: detail.deliveryType,
    deliveryTypeLabel: DELIVERY_TYPE_LABELS[detail.deliveryType] ?? detail.deliveryType,
    deliveryFee: money(detail.deliveryFee),
    codEnabled: detail.codEnabled,
    codFee: money(detail.codFee),
    codAmount: money(detail.codAmount),
    isFragile: detail.isFragile,
    needsRefrigeration: detail.needsRefrigeration,
    expectedShipDate: detail.expectedShipDate,
    expectedArrivalDate: detail.expectedArrivalDate,
    order: order
      ? {
          id: order.id,
          deliveryNo: order.deliveryNo,
          status: order.status,
          statusLabel: DELIVERY_STATUS_LABELS[order.status] ?? order.status,
          labelPrintCount: order.labelPrintCount,
        }
      : null,
  };
}

// ─── Delivery orders (listing + status) ──────────────────────────────────────

export async function listDeliveryOrders(filters: {
  status?: string;
  provinceId?: number;
  q?: string;
  limit?: number;
}) {
  const conds: any[] = [];
  if (filters.status) conds.push(eq(deliveryOrdersTable.status, filters.status));
  if (filters.provinceId) conds.push(eq(deliveryOrdersTable.provinceId, filters.provinceId));
  const orders = await db.query.deliveryOrdersTable.findMany({
    where: conds.length ? and(...conds) : undefined,
    orderBy: [desc(deliveryOrdersTable.createdAt)],
    limit: Math.min(Math.max(filters.limit ?? 100, 1), 500),
  });
  const details = new Map<number, DeliveryDetail>();
  for (const order of orders) {
    if (order.deliveryDetailsId && !details.has(order.deliveryDetailsId)) {
      const d = await db.query.deliveryDetailsTable.findFirst({
        where: eq(deliveryDetailsTable.id, order.deliveryDetailsId),
      });
      if (d) details.set(order.deliveryDetailsId, d);
    }
  }
  const q = filters.q?.trim().toLowerCase();
  return orders
    .map((order) => {
      const detail = order.deliveryDetailsId ? details.get(order.deliveryDetailsId) ?? null : null;
      return {
        id: order.id,
        deliveryNo: order.deliveryNo,
        salesInvoiceId: order.salesInvoiceId,
        customerId: order.customerId,
        status: order.status,
        statusLabel: DELIVERY_STATUS_LABELS[order.status] ?? order.status,
        provinceName: detail?.provinceName ?? "",
        city: detail?.city ?? "",
        receiverName: detail?.receiverName ?? "",
        receiverPhone: detail?.receiverPhone ?? "",
        deliveryCompany: detail?.deliveryCompany ?? "",
        deliveryType: detail?.deliveryType ?? "",
        deliveryTypeLabel: detail ? DELIVERY_TYPE_LABELS[detail.deliveryType] ?? detail.deliveryType : "",
        deliveryFee: money(detail?.deliveryFee),
        codEnabled: detail?.codEnabled ?? false,
        codAmount: money(detail?.codAmount),
        expectedArrivalDate: detail?.expectedArrivalDate ?? null,
        createdAt: order.createdAt,
      };
    })
    .filter((row) => {
      if (!q) return true;
      return [row.deliveryNo, row.receiverName, row.receiverPhone, row.provinceName, row.city]
        .some((v) => String(v).toLowerCase().includes(q));
    });
}

export async function updateDeliveryOrderStatus(
  id: number,
  status: DeliveryStatus,
  actor: { id: number | null; name: string },
  reason?: string | null,
): Promise<DeliveryOrder | null> {
  const now = new Date();
  const patch: Record<string, unknown> = { status, statusUpdatedAt: now, updatedAt: now };
  if (status === "delivered") patch.deliveredAt = now;
  if (status === "returned") patch.returnedAt = now;
  const [updated] = await db
    .update(deliveryOrdersTable)
    .set(patch as any)
    .where(eq(deliveryOrdersTable.id, id))
    .returning();
  if (!updated) return null;
  await db.insert(deliveryOrderStatusHistoryTable).values({
    deliveryOrderId: id,
    status,
    reason: reason ?? null,
    createdBy: actor.id,
    createdByName: actor.name,
  });
  return updated;
}

export async function markLabelPrinted(id: number): Promise<void> {
  await db
    .update(deliveryOrdersTable)
    .set({ labelPrintedAt: new Date(), labelPrintCount: sql`${deliveryOrdersTable.labelPrintCount} + 1` })
    .where(eq(deliveryOrdersTable.id, id));
}

// ─── Delivery accounting mode (global setting) ───────────────────────────────

export async function getDeliveryAccountingMode(): Promise<DeliveryAccountingMode> {
  const row = await db.query.settingsTable.findFirst({
    where: eq(settingsTable.key, DELIVERY_ACCOUNTING_SETTING_KEY),
  });
  const value = (row?.value as any)?.mode;
  return DELIVERY_ACCOUNTING_MODES.includes(value) ? value : "revenue";
}

export async function setDeliveryAccountingMode(mode: DeliveryAccountingMode): Promise<void> {
  await db
    .insert(settingsTable)
    .values({ key: DELIVERY_ACCOUNTING_SETTING_KEY, value: { mode } })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: { mode }, updatedAt: new Date() } });
}

// ─── COD settlement ──────────────────────────────────────────────────────────

export const codSettlementSchema = z.object({
  deliveryOrderId: z.coerce.number().int().positive(),
  receivedAmount: z.coerce.number().min(0).max(999_999_999),
  settlementDate: z.string().regex(DATE).optional(),
  referenceNo: z.string().trim().max(120).optional().nullable(),
  account: z.enum(["cash", "bank", "transfer", "pos"]).default("cash"),
  deliveryCompany: z.string().trim().max(160).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  attachmentUrl: z.string().trim().max(4000).optional().nullable(),
});

export const returnDeliverySchema = z.object({
  reason: z.string().trim().min(3, "سبب الإرجاع مطلوب").max(2000),
  restoreStock: z.boolean().optional().default(true),
  returnedItems: z.array(z.object({
    productId: z.coerce.number().int().optional().nullable(),
    productName: z.string().trim().max(300).optional(),
    quantity: z.coerce.number().min(0).optional(),
  })).optional().default([]),
});

export const cancelDeliverySchema = z.object({
  reason: z.string().trim().min(3, "سبب الإلغاء مطلوب").max(2000),
});

const rawRows = <T = any>(result: any): T[] => (result?.rows ?? result ?? []) as T[];

export async function getCodSettlement(deliveryOrderId: number) {
  const rows = rawRows(
    await db.execute(
      sql`select * from delivery_cod_settlements where delivery_order_id = ${deliveryOrderId} limit 1`,
    ),
  );
  return rows[0] ?? null;
}

export type InsertCodSettlement = {
  deliveryOrderId: number;
  salesInvoiceId: number | null;
  customerId: number | null;
  deliveryCompany: string | null;
  expectedAmount: number;
  receivedAmount: number;
  settlementDate: string;
  referenceNo: string | null;
  account: string;
  accountingMode: string;
  notes: string | null;
  attachmentUrl: string | null;
  receiptVoucherId: number | null;
  financialTransactionId: number | null;
  /** "completed" once the money is executed; "pending_approval" until a manager confirms. */
  status?: "completed" | "pending_approval";
  createdBy: number | null;
  createdByName: string;
};

/** Inserts the settlement row. The unique index on delivery_order_id is the
 *  hard guard against a duplicate settlement. */
export async function insertCodSettlement(s: InsertCodSettlement): Promise<number> {
  const rows = rawRows(
    await db.execute(sql`
      insert into delivery_cod_settlements (
        delivery_order_id, sales_invoice_id, customer_id, delivery_company,
        expected_amount, received_amount, settlement_date, reference_no, account,
        accounting_mode, notes, attachment_url, receipt_voucher_id,
        financial_transaction_id, status, created_by, created_by_name
      ) values (
        ${s.deliveryOrderId}, ${s.salesInvoiceId}, ${s.customerId}, ${s.deliveryCompany},
        ${String(s.expectedAmount)}, ${String(s.receivedAmount)}, ${s.settlementDate},
        ${s.referenceNo}, ${s.account}, ${s.accountingMode}, ${s.notes}, ${s.attachmentUrl},
        ${s.receiptVoucherId}, ${s.financialTransactionId}, ${s.status ?? "completed"},
        ${s.createdBy}, ${s.createdByName}
      ) returning id
    `),
  );
  return Number(rows[0]?.id);
}

/** Marks a pending settlement as completed once a manager has confirmed it. */
export async function completeCodSettlement(
  deliveryOrderId: number,
  financialTransactionId: number | null,
): Promise<void> {
  await db.execute(sql`
    update delivery_cod_settlements
    set status = 'completed',
        financial_transaction_id = coalesce(${financialTransactionId}, financial_transaction_id)
    where delivery_order_id = ${deliveryOrderId}
  `);
}

export async function markCodSettled(deliveryOrderId: number): Promise<void> {
  // cod_settled_at is a runtime-provisioned column (not in the Drizzle schema).
  await db.execute(sql`
    update delivery_orders set cod_settled_at = NOW(), updated_at = NOW() where id = ${deliveryOrderId}
  `);
}

/** Records the return reason + returned items on the order (runtime columns). */
export async function saveReturnMetadata(
  deliveryOrderId: number,
  reason: string,
  returnedItems: unknown[],
): Promise<void> {
  await db.execute(sql`
    update delivery_orders
    set return_reason = ${reason}, returned_items = ${JSON.stringify(returnedItems)}::jsonb, updated_at = NOW()
    where id = ${deliveryOrderId}
  `);
}

export async function saveCancelReason(deliveryOrderId: number, reason: string): Promise<void> {
  await db.execute(sql`
    update delivery_orders set cancel_reason = ${reason}, updated_at = NOW() where id = ${deliveryOrderId}
  `);
}

export async function getDeliveryOrderById(id: number): Promise<DeliveryOrder | null> {
  const order = await db.query.deliveryOrdersTable.findFirst({
    where: eq(deliveryOrdersTable.id, id),
  });
  return order ?? null;
}

/** Full details for the delivery-order details page: order + detail + invoice +
 *  tracking history + settlement. Audit/timeline are attached by the caller. */
export async function getDeliveryOrderDetails(id: number) {
  const order = await getDeliveryOrderById(id);
  if (!order) return null;
  const detail = order.deliveryDetailsId
    ? await db.query.deliveryDetailsTable.findFirst({ where: eq(deliveryDetailsTable.id, order.deliveryDetailsId) })
    : null;
  const invoice = order.salesInvoiceId
    ? await db.query.salesInvoicesTable.findFirst({ where: eq(salesInvoicesTable.id, order.salesInvoiceId) })
    : null;
  const history = await db.query.deliveryOrderStatusHistoryTable.findMany({
    where: eq(deliveryOrderStatusHistoryTable.deliveryOrderId, id),
    orderBy: [desc(deliveryOrderStatusHistoryTable.createdAt)],
  });
  const settlement = await getCodSettlement(id);
  return { order, detail: detail ?? null, invoice: invoice ?? null, history, settlement };
}

export function formatDeliveryOrderFull(data: NonNullable<Awaited<ReturnType<typeof getDeliveryOrderDetails>>>) {
  const { order, detail, invoice, history, settlement } = data;
  return {
    id: order.id,
    deliveryNo: order.deliveryNo,
    status: order.status,
    statusLabel: DELIVERY_STATUS_LABELS[order.status] ?? order.status,
    salesInvoiceId: order.salesInvoiceId,
    invoiceNo: invoice?.invoiceNo ?? null,
    customerId: order.customerId,
    invoice: invoice
      ? {
          invoiceNo: invoice.invoiceNo,
          total: Number(invoice.total),
          paidAmount: Number(invoice.paidAmount),
          remainingAmount: Number(invoice.remainingAmount),
          paymentStatus: invoice.paymentStatus,
          customerName: invoice.customerName,
          customerPhone: invoice.customerPhone,
        }
      : null,
    detail: detail ? formatDeliveryDetail(detail, order) : null,
    returnReason: (order as any).returnReason ?? null,
    cancelReason: (order as any).cancelReason ?? null,
    labelPrintCount: order.labelPrintCount,
    history: history.map((h) => ({
      status: h.status,
      statusLabel: DELIVERY_STATUS_LABELS[h.status] ?? h.status,
      reason: h.reason,
      notes: h.notes,
      createdByName: h.createdByName,
      createdAt: h.createdAt,
    })),
    settlement: settlement
      ? {
          id: Number(settlement.id),
          receivedAmount: Number(settlement.received_amount),
          expectedAmount: Number(settlement.expected_amount),
          settlementDate: settlement.settlement_date,
          referenceNo: settlement.reference_no,
          account: settlement.account,
          accountingMode: settlement.accounting_mode,
          deliveryCompany: settlement.delivery_company,
          notes: settlement.notes,
          attachmentUrl: settlement.attachment_url,
          status: settlement.status,
          createdByName: settlement.created_by_name,
          createdAt: settlement.created_at,
        }
      : null,
  };
}

export { DELIVERY_STATUSES, DELIVERY_TYPES, DELIVERY_METHODS };
