import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  bookingLinksTable,
  bookingServicesTable,
  bookingTimelineTable,
  bookingsTable,
  customersTable,
  db,
  receiptVouchersTable,
} from "@workspace/db";
import {
  createSourceFinancialRequest,
  ensureMasterCashBoxTables,
  type FinancialActor,
} from "@/server/master-cash-box";
import { recalcBookingFinancialsWith } from "@/server/booking-financials";

/**
 * Booking Center — unified booking engine.
 *
 * Financial rule of the module: a booking never invents money. `paid_amount`
 * and `refunded_amount` are recomputed from vouchers that the master cash box
 * has actually executed, so the booking, the cashbox and the ledger cannot
 * disagree. Everything here funnels through the existing
 * createSourceFinancialRequest → approve → execute path.
 */

// ---------------------------------------------------------------------------
// Service catalogue
// ---------------------------------------------------------------------------

/**
 * `department` maps each service onto the revenue account codes already wired
 * into counterAccountCode() in master-cash-box.ts, so booking revenue lands in
 * the correct account with no chart-of-accounts changes.
 */
export const BOOKING_SERVICES = [
  { key: "kosha", label: "الكوش", icon: "👑", department: "koshas" },
  { key: "photography", label: "التصوير", icon: "📸", department: "photography" },
  { key: "sound", label: "الصوتيات", icon: "🔊", department: "audio" },
  { key: "flowers", label: "الورود", icon: "🌹", department: "general" },
  { key: "gifts", label: "الهدايا والتوزيعات", icon: "🎁", department: "gifts" },
  { key: "graduation", label: "التخرج", icon: "🎓", department: "graduation" },
  { key: "led", label: "شاشات LED", icon: "🎥", department: "general" },
  { key: "transport", label: "النقل", icon: "🚗", department: "general" },
  { key: "decor", label: "الديكورات", icon: "🎈", department: "general" },
  { key: "other", label: "خدمات أخرى", icon: "➕", department: "general" },
] as const;

export type BookingServiceKey = (typeof BOOKING_SERVICES)[number]["key"];

const SERVICE_KEYS = BOOKING_SERVICES.map((s) => s.key) as [string, ...string[]];

export function serviceMeta(key: string) {
  return BOOKING_SERVICES.find((s) => s.key === key) ?? BOOKING_SERVICES[BOOKING_SERVICES.length - 1];
}

/** Per-service lifecycle. Ordered — index doubles as progress weight. */
export const SERVICE_STATUSES = [
  "waiting",
  "preparing",
  "ready",
  "dispatched",
  "installed",
  "running",
  "finished",
  "returned",
  "cancelled",
] as const;

export const BOOKING_STATUSES = [
  "draft",
  "confirmed",
  "in_progress",
  "completed",
  "cancelled",
] as const;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "صيغة التاريخ غير صحيحة");
const optionalText = z.string().trim().max(2000).optional().nullable();

export const bookingServiceInputSchema = z.object({
  serviceKey: z.enum(SERVICE_KEYS),
  amount: z.coerce.number().min(0).max(999_999_999).default(0),
  status: z.enum(SERVICE_STATUSES).optional().default("waiting"),
  notes: optionalText,
  details: z.record(z.string(), z.unknown()).optional().default({}),
});

export const bookingInputSchema = z.object({
  customerId: z.coerce.number().int().positive().optional().nullable(),
  customerName: z.string().trim().min(1, "اسم الزبون مطلوب").max(200),
  customerPhone: z.string().trim().max(30).optional().default(""),
  eventDate: dateSchema.optional().nullable(),
  eventTime: z.string().trim().max(20).optional().nullable(),
  eventType: z.string().trim().max(40).optional().nullable(),
  hallName: optionalText,
  hallAddress: optionalText,
  mapUrl: z.string().trim().max(2000).optional().nullable(),
  status: z.enum(BOOKING_STATUSES).optional().default("draft"),
  productsTotal: z.coerce.number().min(0).max(999_999_999).optional().default(0),
  additionalCharges: z.coerce.number().min(0).max(999_999_999).optional().default(0),
  discount: z.coerce.number().min(0).max(999_999_999).optional().default(0),
  notes: optionalText,
  internalNotes: optionalText,
  services: z.array(bookingServiceInputSchema).max(20).optional().default([]),
});

export const bookingPatchSchema = bookingInputSchema.partial().omit({ services: true });

export const receiveBookingPaymentSchema = z.object({
  amount: z.coerce.number().positive("المبلغ يجب أن يكون أكبر من صفر").max(999_999_999),
  method: z.enum(["cash", "transfer", "card", "pos", "other"]).default("cash"),
  date: dateSchema.optional(),
  reference: z.string().trim().max(200).optional().nullable(),
  notes: optionalText,
  attachments: z.array(z.string().max(2000)).max(20).optional().default([]),
  serviceKey: z.enum(SERVICE_KEYS).optional().nullable(),
});

// ---------------------------------------------------------------------------
// Table provisioning (runtime-provisioned, consistent with master-cash-box)
// ---------------------------------------------------------------------------

let bookingTablesReady: Promise<unknown> | null = null;

export async function ensureBookingCenterTables() {
  if (!bookingTablesReady) {
    bookingTablesReady = db
      .execute(
        sql`
      CREATE TABLE IF NOT EXISTS "bookings" (
        "id" serial PRIMARY KEY,
        "booking_no" varchar(40) NOT NULL,
        "customer_id" integer REFERENCES "customers"("id") ON DELETE RESTRICT,
        "customer_name" text NOT NULL DEFAULT '',
        "customer_phone" varchar(30) NOT NULL DEFAULT '',
        "event_date" date,
        "event_time" varchar(20),
        "event_type" varchar(40),
        "hall_name" text,
        "hall_address" text,
        "map_url" text,
        "status" varchar(30) NOT NULL DEFAULT 'draft',
        "services_total" numeric(16,2) NOT NULL DEFAULT 0,
        "products_total" numeric(16,2) NOT NULL DEFAULT 0,
        "additional_charges" numeric(16,2) NOT NULL DEFAULT 0,
        "discount" numeric(16,2) NOT NULL DEFAULT 0,
        "grand_total" numeric(16,2) NOT NULL DEFAULT 0,
        "paid_amount" numeric(16,2) NOT NULL DEFAULT 0,
        "pending_receipt_amount" numeric(16,2) NOT NULL DEFAULT 0,
        "refunded_amount" numeric(16,2) NOT NULL DEFAULT 0,
        "remaining_amount" numeric(16,2) NOT NULL DEFAULT 0,
        "payment_status" varchar(20) NOT NULL DEFAULT 'unpaid',
        "contract_signed_at" timestamp,
        "notes" text,
        "internal_notes" text,
        "cancelled_at" timestamp,
        "cancel_reason" text,
        "cancelled_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
        "created_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
        "created_by_name" text NOT NULL DEFAULT '',
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "bookings_booking_no_idx" ON "bookings" ("booking_no");
      CREATE INDEX IF NOT EXISTS "bookings_customer_idx" ON "bookings" ("customer_id");
      CREATE INDEX IF NOT EXISTS "bookings_event_date_idx" ON "bookings" ("event_date");
      CREATE INDEX IF NOT EXISTS "bookings_status_idx" ON "bookings" ("status");
      CREATE INDEX IF NOT EXISTS "bookings_payment_status_idx" ON "bookings" ("payment_status");

      CREATE TABLE IF NOT EXISTS "booking_services" (
        "id" serial PRIMARY KEY,
        "booking_id" integer NOT NULL REFERENCES "bookings"("id") ON DELETE CASCADE,
        "service_key" varchar(40) NOT NULL,
        "status" varchar(30) NOT NULL DEFAULT 'waiting',
        "amount" numeric(16,2) NOT NULL DEFAULT 0,
        "notes" text,
        "details" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "sort_order" integer NOT NULL DEFAULT 0,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "booking_services_booking_service_idx" ON "booking_services" ("booking_id", "service_key");
      CREATE INDEX IF NOT EXISTS "booking_services_booking_idx" ON "booking_services" ("booking_id");
      CREATE INDEX IF NOT EXISTS "booking_services_status_idx" ON "booking_services" ("status");

      CREATE TABLE IF NOT EXISTS "booking_links" (
        "id" serial PRIMARY KEY,
        "booking_id" integer NOT NULL REFERENCES "bookings"("id") ON DELETE CASCADE,
        "source_type" varchar(40) NOT NULL,
        "source_id" integer NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "booking_links_unique_idx" ON "booking_links" ("source_type", "source_id");
      CREATE INDEX IF NOT EXISTS "booking_links_booking_idx" ON "booking_links" ("booking_id");

      CREATE TABLE IF NOT EXISTS "booking_timeline" (
        "id" serial PRIMARY KEY,
        "booking_id" integer NOT NULL REFERENCES "bookings"("id") ON DELETE CASCADE,
        "event_key" varchar(60) NOT NULL,
        "service_key" varchar(40),
        "title" text NOT NULL,
        "description" text,
        "meta" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "actor_id" integer REFERENCES "staff"("id") ON DELETE SET NULL,
        "actor_name" text NOT NULL DEFAULT '',
        "created_at" timestamp NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS "booking_timeline_booking_idx" ON "booking_timeline" ("booking_id");
      CREATE INDEX IF NOT EXISTS "booking_timeline_created_idx" ON "booking_timeline" ("created_at");

      -- Link vouchers to unified bookings. NOTE: receipt_vouchers.booking_id
      -- already means service_orders.id in the legacy schema, so unified
      -- bookings need their own column rather than reusing it.
      ALTER TABLE IF EXISTS "receipt_vouchers" ADD COLUMN IF NOT EXISTS "booking_ref_id" integer;
      ALTER TABLE IF EXISTS "receipt_vouchers" ADD COLUMN IF NOT EXISTS "booking_service_key" varchar(40);
      CREATE INDEX IF NOT EXISTS "receipt_vouchers_booking_ref_idx" ON "receipt_vouchers" ("booking_ref_id");
      ALTER TABLE IF EXISTS "payment_vouchers" ADD COLUMN IF NOT EXISTS "booking_ref_id" integer;
      CREATE INDEX IF NOT EXISTS "payment_vouchers_booking_ref_idx" ON "payment_vouchers" ("booking_ref_id");
    `,
      )
      .catch((err) => {
        bookingTablesReady = null;
        throw err;
      });
  }
  return bookingTablesReady;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function money(value: unknown): number {
  const parsed = Number.parseFloat(String(value ?? 0));
  return Number.isFinite(parsed) ? Math.round((parsed + Number.EPSILON) * 100) / 100 : 0;
}

function todayBaghdad(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Baghdad",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function bookingNumber(id: number, date = new Date()) {
  const y = String(date.getFullYear()).slice(-2);
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `BK-${y}${m}-${String(id).padStart(5, "0")}`;
}

export function paymentStatusFor(grandTotal: number, paid: number, refunded: number) {
  const net = money(paid - refunded);
  if (net <= 0.004) return "unpaid";
  if (net + 0.004 >= grandTotal) return refunded > 0.004 ? "refunded_partial" : "paid";
  return "partial";
}

export async function addBookingTimeline(
  bookingId: number,
  entry: {
    eventKey: string;
    title: string;
    description?: string | null;
    serviceKey?: string | null;
    meta?: Record<string, unknown>;
    actor?: FinancialActor;
  },
) {
  await db.insert(bookingTimelineTable).values({
    bookingId,
    eventKey: entry.eventKey,
    title: entry.title,
    description: entry.description ?? null,
    serviceKey: entry.serviceKey ?? null,
    meta: entry.meta ?? {},
    actorId: entry.actor?.id ?? null,
    actorName: entry.actor?.name ?? "",
  });
}

// ---------------------------------------------------------------------------
// Financial recomputation — the single money authority for bookings
// ---------------------------------------------------------------------------

/**
 * Recompute a booking's derived financials. The formula itself lives in
 * `booking-financials.ts` so the cashbox approval path runs the identical SQL.
 *
 * Returns the drizzle-mapped (camelCase) row rather than the raw snake_case
 * result of the UPDATE, so every endpoint in this module emits one shape.
 */
export async function recalcBookingFinancials(bookingId: number) {
  await recalcBookingFinancialsWith(db, bookingId);
  return (
    (await db.query.bookingsTable.findFirst({
      where: eq(bookingsTable.id, bookingId),
    })) ?? null
  );
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createBooking(input: unknown, actor: FinancialActor) {
  await ensureBookingCenterTables();
  const data = bookingInputSchema.parse(input);

  let customerId = data.customerId ?? null;
  if (customerId) {
    const customer = await db.query.customersTable.findFirst({
      where: eq(customersTable.id, customerId),
    });
    if (!customer) throw new Error("العميل المختار غير موجود");
  }

  const now = new Date();
  const [row] = await db
    .insert(bookingsTable)
    .values({
      bookingNo: `BK-TMP-${now.getTime()}-${Math.floor(Math.random() * 1e6)}`,
      customerId,
      customerName: data.customerName,
      customerPhone: data.customerPhone ?? "",
      eventDate: data.eventDate ?? null,
      eventTime: data.eventTime ?? null,
      eventType: data.eventType ?? null,
      hallName: data.hallName ?? null,
      hallAddress: data.hallAddress ?? null,
      mapUrl: data.mapUrl ?? null,
      status: data.status,
      productsTotal: String(money(data.productsTotal)),
      additionalCharges: String(money(data.additionalCharges)),
      discount: String(money(data.discount)),
      notes: data.notes ?? null,
      internalNotes: data.internalNotes ?? null,
      createdBy: actor.id,
      createdByName: actor.name,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  const [saved] = await db
    .update(bookingsTable)
    .set({ bookingNo: bookingNumber(row.id, now) })
    .where(eq(bookingsTable.id, row.id))
    .returning();

  if (data.services.length) {
    await db.insert(bookingServicesTable).values(
      data.services.map((service, index) => ({
        bookingId: saved.id,
        serviceKey: service.serviceKey,
        status: service.status,
        amount: String(money(service.amount)),
        notes: service.notes ?? null,
        details: service.details ?? {},
        sortOrder: index,
      })),
    );
  }

  await addBookingTimeline(saved.id, {
    eventKey: "booking_created",
    title: "تم إنشاء الحجز",
    description: `رقم الحجز ${saved.bookingNo}`,
    actor,
  });

  return recalcBookingFinancials(saved.id);
}

export async function updateBooking(id: number, input: unknown, actor: FinancialActor) {
  await ensureBookingCenterTables();
  const data = bookingPatchSchema.parse(input);
  const existing = await db.query.bookingsTable.findFirst({
    where: eq(bookingsTable.id, id),
  });
  if (!existing) throw new Error("الحجز غير موجود");
  if (existing.status === "cancelled") throw new Error("لا يمكن تعديل حجز ملغى");

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  const assign = <K extends string>(key: K, value: unknown) => {
    if (value !== undefined) patch[key] = value;
  };
  assign("customerName", data.customerName);
  assign("customerPhone", data.customerPhone);
  assign("eventDate", data.eventDate);
  assign("eventTime", data.eventTime);
  assign("eventType", data.eventType);
  assign("hallName", data.hallName);
  assign("hallAddress", data.hallAddress);
  assign("mapUrl", data.mapUrl);
  assign("status", data.status);
  assign("notes", data.notes);
  assign("internalNotes", data.internalNotes);
  if (data.productsTotal !== undefined) patch.productsTotal = String(money(data.productsTotal));
  if (data.additionalCharges !== undefined)
    patch.additionalCharges = String(money(data.additionalCharges));
  if (data.discount !== undefined) patch.discount = String(money(data.discount));

  await db.update(bookingsTable).set(patch).where(eq(bookingsTable.id, id));

  if (data.status && data.status !== existing.status) {
    await addBookingTimeline(id, {
      eventKey: `booking_${data.status}`,
      title: `حالة الحجز: ${data.status}`,
      actor,
    });
  }

  return recalcBookingFinancials(id);
}

export async function setBookingService(
  bookingId: number,
  input: unknown,
  actor: FinancialActor,
) {
  await ensureBookingCenterTables();
  const data = bookingServiceInputSchema.parse(input);
  const booking = await db.query.bookingsTable.findFirst({
    where: eq(bookingsTable.id, bookingId),
  });
  if (!booking) throw new Error("الحجز غير موجود");
  if (booking.status === "cancelled") throw new Error("لا يمكن تعديل حجز ملغى");

  await db
    .insert(bookingServicesTable)
    .values({
      bookingId,
      serviceKey: data.serviceKey,
      status: data.status,
      amount: String(money(data.amount)),
      notes: data.notes ?? null,
      details: data.details ?? {},
    })
    .onConflictDoUpdate({
      target: [bookingServicesTable.bookingId, bookingServicesTable.serviceKey],
      set: {
        status: data.status,
        amount: String(money(data.amount)),
        notes: data.notes ?? null,
        details: data.details ?? {},
        updatedAt: new Date(),
      },
    });

  await addBookingTimeline(bookingId, {
    eventKey: "service_updated",
    serviceKey: data.serviceKey,
    title: `${serviceMeta(data.serviceKey).label}: ${data.status}`,
    actor,
  });

  return recalcBookingFinancials(bookingId);
}

export async function removeBookingService(
  bookingId: number,
  serviceKey: string,
  actor: FinancialActor,
) {
  await ensureBookingCenterTables();
  await db
    .delete(bookingServicesTable)
    .where(
      and(
        eq(bookingServicesTable.bookingId, bookingId),
        eq(bookingServicesTable.serviceKey, serviceKey),
      ),
    );
  await addBookingTimeline(bookingId, {
    eventKey: "service_removed",
    serviceKey,
    title: `تم إلغاء تفعيل ${serviceMeta(serviceKey).label}`,
    actor,
  });
  return recalcBookingFinancials(bookingId);
}

export async function getBooking(id: number) {
  await ensureBookingCenterTables();
  const booking = await db.query.bookingsTable.findFirst({
    where: eq(bookingsTable.id, id),
  });
  if (!booking) return null;

  const [services, links, timeline, payments] = await Promise.all([
    db
      .select()
      .from(bookingServicesTable)
      .where(eq(bookingServicesTable.bookingId, id))
      .orderBy(bookingServicesTable.sortOrder),
    db.select().from(bookingLinksTable).where(eq(bookingLinksTable.bookingId, id)),
    db
      .select()
      .from(bookingTimelineTable)
      .where(eq(bookingTimelineTable.bookingId, id))
      .orderBy(desc(bookingTimelineTable.createdAt))
      .limit(200),
    // booking_ref_id is provisioned via ALTER TABLE and is not part of the
    // drizzle receipt_vouchers model, so this one is raw SQL by necessity.
    db.execute(sql`
      SELECT id,
             voucher_no        AS "voucherNo",
             date,
             amount,
             method,
             approval_status   AS "approvalStatus",
             created_by_name   AS "createdByName",
             booking_service_key AS "serviceKey",
             financial_transaction_id AS "financialTransactionId"
      FROM receipt_vouchers
      WHERE booking_ref_id = ${id}
      ORDER BY id DESC
    `),
  ]);

  return {
    ...booking,
    services,
    links,
    timeline,
    payments: (payments.rows ?? []) as Record<string, unknown>[],
    progress: bookingProgress(booking, services),
    recommendations: bookingRecommendations(booking, services),
  };
}

export const bookingListSchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(BOOKING_STATUSES).optional(),
  paymentStatus: z.enum(["unpaid", "partial", "paid", "refunded_partial"]).optional(),
  serviceKey: z.enum(SERVICE_KEYS).optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});

export async function listBookings(input: unknown) {
  await ensureBookingCenterTables();
  const q = bookingListSchema.parse(input ?? {});
  const offset = (q.page - 1) * q.pageSize;

  const filters = [
    q.status ? sql`b.status = ${q.status}` : null,
    q.paymentStatus ? sql`b.payment_status = ${q.paymentStatus}` : null,
    q.from ? sql`b.event_date >= ${q.from}` : null,
    q.to ? sql`b.event_date <= ${q.to}` : null,
    q.search
      ? sql`(b.booking_no ILIKE ${`%${q.search}%`} OR b.customer_name ILIKE ${`%${q.search}%`} OR b.customer_phone ILIKE ${`%${q.search}%`})`
      : null,
    q.serviceKey
      ? sql`EXISTS (SELECT 1 FROM booking_services s WHERE s.booking_id = b.id AND s.service_key = ${q.serviceKey})`
      : null,
  ].filter(Boolean) as ReturnType<typeof sql>[];

  const where = filters.length
    ? sql.join([sql` WHERE `, sql.join(filters, sql` AND `)], sql``)
    : sql``;

  const rowsResult = await db.execute(sql`
    SELECT b.*,
      COALESCE(
        (SELECT json_agg(json_build_object('serviceKey', s.service_key, 'status', s.status, 'amount', s.amount)
                ORDER BY s.sort_order)
         FROM booking_services s WHERE s.booking_id = b.id),
        '[]'::json
      ) AS services
    FROM bookings b${where}
    ORDER BY b.event_date DESC NULLS LAST, b.id DESC
    LIMIT ${q.pageSize} OFFSET ${offset}
  `);

  const countResult = await db.execute(
    sql`SELECT COUNT(*)::int AS total FROM bookings b${where}`,
  );

  return {
    rows: (rowsResult.rows ?? []) as Record<string, unknown>[],
    total: Number((countResult.rows ?? [])[0]?.total ?? 0),
    page: q.page,
    pageSize: q.pageSize,
  };
}

/**
 * Booking Center dashboard: the six top cards plus a per-service card summary.
 * Computed in SQL in one round trip per block rather than per service card.
 */
export async function getBookingCenterDashboard() {
  await ensureBookingCenterTables();
  const today = todayBaghdad();

  const [totals, perService, latestBookings, latestPayments] = await Promise.all([
    db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE event_date = ${today})::int AS today_bookings,
        COUNT(*) FILTER (WHERE event_date > ${today} AND status <> 'cancelled')::int AS upcoming_events,
        COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
        COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
        COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
        COALESCE(SUM(grand_total::numeric) FILTER (WHERE status <> 'cancelled'), 0) AS total_amount,
        COALESCE(SUM(paid_amount::numeric) FILTER (WHERE status <> 'cancelled'), 0) AS paid_amount,
        COUNT(*) FILTER (WHERE remaining_amount::numeric > 0.004 AND status <> 'cancelled')::int AS pending_payments,
        COALESCE(SUM(remaining_amount::numeric) FILTER (WHERE status <> 'cancelled'), 0) AS outstanding_amount,
        COUNT(*)::int AS total_bookings,
        -- Revenue is cash actually collected this month, taken from executed
        -- vouchers by their voucher date. Summing bookings.paid_amount here
        -- would misreport it: paid_amount is a lifetime running total, so a
        -- booking created in January but paid in March would book March's cash
        -- into January.
        (SELECT COALESCE(SUM(rv.amount::numeric), 0)
           FROM receipt_vouchers rv
          WHERE rv.booking_ref_id IS NOT NULL
            AND rv.approval_status = 'executed'
            AND date_trunc('month', rv.date) = date_trunc('month', now())
        ) AS monthly_revenue
      FROM bookings
    `),
    db.execute(sql`
      SELECT s.service_key,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE b.event_date = ${today})::int AS today,
        COUNT(*) FILTER (WHERE s.status IN ('waiting', 'preparing'))::int AS pending,
        COUNT(*) FILTER (WHERE s.status IN ('ready', 'dispatched', 'installed', 'running'))::int AS in_progress,
        COUNT(*) FILTER (WHERE s.status IN ('finished', 'returned'))::int AS completed,
        -- Booked value, NOT collected cash: payments carry a service key only
        -- when the user supplies one, so per-service revenue is not reliably
        -- derivable. Labelled as "قيمة الحجوزات" in the UI to stay honest.
        COALESCE(SUM(s.amount::numeric) FILTER (
          WHERE date_trunc('month', b.created_at) = date_trunc('month', now())
            AND b.status <> 'cancelled'
        ), 0) AS monthly_booked
      FROM booking_services s
      JOIN bookings b ON b.id = s.booking_id
      GROUP BY s.service_key
    `),
    db.execute(sql`
      SELECT id, booking_no AS "bookingNo", customer_name AS "customerName",
             customer_phone AS "customerPhone", event_date AS "eventDate",
             status, grand_total AS "grandTotal", paid_amount AS "paidAmount",
             remaining_amount AS "remainingAmount", payment_status AS "paymentStatus"
      FROM bookings
      ORDER BY id DESC
      LIMIT 5
    `),
    // Latest payments across all bookings — executed vouchers only, so the
    // Overview never shows money that has not cleared the cash box.
    db.execute(sql`
      SELECT rv.id, rv.voucher_no AS "voucherNo", rv.date, rv.amount, rv.method,
             rv.approval_status AS "approvalStatus",
             b.id AS "bookingId", b.booking_no AS "bookingNo",
             b.customer_name AS "customerName"
      FROM receipt_vouchers rv
      JOIN bookings b ON b.id = rv.booking_ref_id
      WHERE rv.booking_ref_id IS NOT NULL
      ORDER BY rv.id DESC
      LIMIT 5
    `),
  ]);

  const statsByKey = new Map(
    ((perService.rows ?? []) as Record<string, unknown>[]).map((row) => [
      String(row.service_key),
      row,
    ]),
  );

  return {
    cards: (totals.rows ?? [])[0] ?? {},
    latestBookings: (latestBookings.rows ?? []) as Record<string, unknown>[],
    latestPayments: (latestPayments.rows ?? []) as Record<string, unknown>[],
    services: BOOKING_SERVICES.map((service) => {
      const stat = statsByKey.get(service.key);
      return {
        ...service,
        total: Number(stat?.total ?? 0),
        today: Number(stat?.today ?? 0),
        pending: Number(stat?.pending ?? 0),
        inProgress: Number(stat?.in_progress ?? 0),
        completed: Number(stat?.completed ?? 0),
        monthlyBooked: money(stat?.monthly_booked ?? 0),
      };
    }),
  };
}

/**
 * Cancels a booking without destroying financial history: vouchers, journal
 * entries and their links all survive. Money already collected is reported as
 * refundable so a manager can raise a refund explicitly — cancellation never
 * moves cash on its own.
 */
export async function cancelBooking(
  bookingId: number,
  reason: string,
  actor: FinancialActor,
) {
  await ensureBookingCenterTables();
  const clean = reason?.trim();
  if (!clean || clean.length < 3) throw new Error("سبب الإلغاء مطلوب");

  const booking = await db.query.bookingsTable.findFirst({
    where: eq(bookingsTable.id, bookingId),
  });
  if (!booking) throw new Error("الحجز غير موجود");
  if (booking.status === "cancelled") return booking;

  await db
    .update(bookingsTable)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      cancelReason: clean,
      cancelledBy: actor.id,
      updatedAt: new Date(),
    })
    .where(eq(bookingsTable.id, bookingId));

  await db
    .update(bookingServicesTable)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(bookingServicesTable.bookingId, bookingId));

  const refundable = money(money(booking.paidAmount) - money(booking.refundedAmount));
  await addBookingTimeline(bookingId, {
    eventKey: "booking_cancelled",
    title: "تم إلغاء الحجز",
    description: clean,
    meta: { refundableAmount: refundable },
    actor,
  });

  const updated = await recalcBookingFinancials(bookingId);
  return { ...(updated ?? booking), refundableAmount: refundable };
}

// ---------------------------------------------------------------------------
// Receive payment — routed through the existing cashbox approval engine
// ---------------------------------------------------------------------------

/**
 * Creates a receipt voucher for the booking and submits it to the master cash
 * box for manager approval. Nothing about the booking balance moves here: the
 * balance only changes once the transaction is executed, at which point
 * approveAndExecuteFinancialTransaction calls recalcBookingFinancials().
 */
export async function receiveBookingPayment(
  bookingId: number,
  input: unknown,
  actor: FinancialActor,
) {
  await Promise.all([ensureBookingCenterTables(), ensureMasterCashBoxTables()]);
  const data = receiveBookingPaymentSchema.parse(input);

  const booking = await db.query.bookingsTable.findFirst({
    where: eq(bookingsTable.id, bookingId),
  });
  if (!booking) throw new Error("الحجز غير موجود");
  if (booking.status === "cancelled") throw new Error("لا يمكن استلام دفعة على حجز ملغى");

  const customer = booking.customerId
    ? await db.query.customersTable.findFirst({
        where: eq(customersTable.id, booking.customerId),
      })
    : null;

  const date = data.date ?? todayBaghdad();
  const [row] = await db
    .insert(receiptVouchersTable)
    .values({
      voucherNo: `REC-TMP-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      date,
      amount: String(money(data.amount)),
      payerName: booking.customerName || customer?.name || "زبون",
      customerId: booking.customerId ?? null,
      reference: data.reference ?? booking.bookingNo,
      method: data.method === "card" ? "pos" : data.method,
      notes: data.notes ?? null,
      createdBy: actor.id,
      createdByName: actor.name,
      approvalStatus: "pending",
    })
    .returning();

  const y = String(new Date(row.createdAt).getFullYear()).slice(-2);
  const m = String(new Date(row.createdAt).getMonth() + 1).padStart(2, "0");
  const voucherNo = `REC-${y}${m}-${String(row.id).padStart(5, "0")}`;

  await db.execute(
    sql`UPDATE receipt_vouchers
        SET voucher_no = ${voucherNo},
            booking_ref_id = ${bookingId},
            booking_service_key = ${data.serviceKey ?? null}
        WHERE id = ${row.id}`,
  );

  const department = data.serviceKey ? serviceMeta(data.serviceKey).department : "general";

  const financialTransaction = await createSourceFinancialRequest(
    {
      transactionDate: date,
      direction: "revenue",
      amount: money(data.amount),
      department,
      transactionType: "receipt_voucher",
      description: `دفعة حجز ${booking.bookingNo} — ${booking.customerName}`,
      paymentMethod: data.method,
      sourceType: "receipt_voucher",
      sourceId: row.id,
      sourceEvent: "payment",
      // Voucher ids are unique, so one voucher can only ever produce one
      // cashbox movement.
      idempotencyKey: `receipt_voucher:${row.id}:payment`,
      customerId: booking.customerId,
      customerName: booking.customerName,
      customerPhone: booking.customerPhone || customer?.phone,
      notes: data.notes,
      attachments: data.attachments ?? [],
    },
    actor,
  );

  await db
    .update(receiptVouchersTable)
    .set({
      approvalStatus: financialTransaction.approvalStatus,
      financialTransactionId: financialTransaction.id,
    })
    .where(eq(receiptVouchersTable.id, row.id));

  await addBookingTimeline(bookingId, {
    eventKey: "payment_requested",
    serviceKey: data.serviceKey ?? null,
    title: `طلب قبض ${money(data.amount).toLocaleString("en-US")} — بانتظار الاعتماد`,
    description: voucherNo,
    meta: { voucherId: row.id, transactionId: financialTransaction.id },
    actor,
  });

  // Reflects the new pending amount; paid/remaining stay untouched by design.
  const updated = await recalcBookingFinancials(bookingId);

  return {
    booking: updated,
    voucherId: row.id,
    voucherNo,
    financialTransaction,
  };
}

// ---------------------------------------------------------------------------
// Readiness + recommendations
// ---------------------------------------------------------------------------

type ServiceRow = { serviceKey: string; status: string; amount: string | number };

/**
 * Booking readiness as a 0–100 figure. Payment and contract are always
 * measured; every enabled service contributes its own lifecycle progress.
 */
export function bookingProgress(
  booking: { grandTotal: string | number; paidAmount: string | number; contractSignedAt: Date | null },
  services: ServiceRow[],
) {
  const dimensions: { key: string; label: string; ratio: number }[] = [];

  const grand = money(booking.grandTotal);
  const paid = money(booking.paidAmount);
  dimensions.push({
    key: "payment",
    label: "الدفع",
    ratio: grand <= 0 ? 0 : Math.min(1, paid / grand),
  });
  dimensions.push({
    key: "contract",
    label: "العقد",
    ratio: booking.contractSignedAt ? 1 : 0,
  });

  const readyIndex = SERVICE_STATUSES.indexOf("finished");
  for (const service of services) {
    if (service.status === "cancelled") continue;
    const index = SERVICE_STATUSES.indexOf(service.status as (typeof SERVICE_STATUSES)[number]);
    dimensions.push({
      key: service.serviceKey,
      label: serviceMeta(service.serviceKey).label,
      ratio: index < 0 ? 0 : Math.min(1, index / readyIndex),
    });
  }

  const percent = dimensions.length
    ? Math.round((dimensions.reduce((sum, d) => sum + d.ratio, 0) / dimensions.length) * 100)
    : 0;

  return { percent, dimensions };
}

export function bookingRecommendations(
  booking: {
    grandTotal: string | number;
    paidAmount: string | number;
    remainingAmount: string | number;
    eventDate: string | null;
    contractSignedAt: Date | null;
  },
  services: ServiceRow[],
) {
  const out: { level: "info" | "warn" | "danger"; message: string }[] = [];
  const remaining = money(booking.remainingAmount);

  if (remaining > 0.004) {
    out.push({
      level: money(booking.paidAmount) <= 0.004 ? "danger" : "warn",
      message: `الزبون لم يسدد كامل المبلغ — المتبقي ${remaining.toLocaleString("en-US")}`,
    });
  }
  if (!booking.contractSignedAt) {
    out.push({ level: "warn", message: "العقد غير موقّع حتى الآن" });
  }
  for (const service of services) {
    if (service.status === "cancelled") continue;
    if (service.status === "waiting") {
      out.push({
        level: "warn",
        message: `${serviceMeta(service.serviceKey).label} لم يتم تحضيرها بعد`,
      });
    }
  }
  if (booking.eventDate) {
    const days = Math.ceil(
      (new Date(booking.eventDate).getTime() - new Date(todayBaghdad()).getTime()) / 86_400_000,
    );
    if (days >= 0 && days <= 3 && remaining > 0.004) {
      out.push({
        level: "danger",
        message: `المناسبة بعد ${days} يوم وهناك مبلغ غير مسدد`,
      });
    }
  }
  return out;
}
