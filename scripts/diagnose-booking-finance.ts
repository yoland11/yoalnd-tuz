/**
 * PHASE 5A — Production Booking Financial Diagnostic. STRICTLY READ-ONLY.
 *
 * Lists every potentially affected booking whose stored `total_amount` may not
 * correctly represent the whole unified/multi-service booking, and CLASSIFIES
 * each from the real data model.
 *
 * TRUST MODEL (validated against production):
 *   - The ONLY trustworthy service base is `bookingOperations.baseBookingAmount`
 *     (opsBase), written by the products flow as (total − productCharges).
 *   - `pricing.totalAmount` / `pricing.koshaPrice` are display snapshots that go
 *     STALE after re-pricing, so they are shown for context but NEVER used to
 *     decide a correction.
 *   - When opsBase is missing/zero the booking is AMBIGUOUS — it cannot be
 *     decomposed safely and is never auto-classified as an error.
 *   - تجهيزات/preparations = Σ live non-released stock_reservations (opsBase was
 *     computed net of these, so whole = opsBase + preparations − discount).
 *
 * It runs SELECT queries ONLY. It writes NOTHING: no UPDATE/INSERT/DELETE, no
 * migration, no cashbox, no accounting, no payments, no schema. Any historical
 * correction is a separate, explicitly-approved step this script never performs.
 *
 * Run (DATABASE_URL must be exported first):
 *   node ./scripts/run-tsx.mjs --tsconfig ./tsconfig.json ./scripts/diagnose-booking-finance.ts
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { bookingApprovedPaid, bookingProductCharges, round2 } from "../src/server/booking-finance";

const EPS = 1; // IQD rounding tolerance

function money(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}
function fmt(n: number | null): string {
  return n == null ? "—" : n.toLocaleString("en-US");
}

export type Classification =
  | "POSSIBLY CORRECT"
  | "POSSIBLY UNDERCOUNTED"
  | "POSSIBLY DISCOUNTED"
  | "POSSIBLY DOUBLE-COUNTED"
  | "HISTORICAL / AMBIGUOUS"
  | "REQUIRES MANUAL REVIEW";

export type BookingDiag = {
  source: "service" | "kosha";
  id: number;
  code: string;
  customer: string;
  date: string | null;
  services: string;
  numProducts: number;
  stored: number;
  opsBase: number | null; // the ONLY trusted base
  pricingTotal: number | null; // display snapshot (may be stale) — context only
  prepared: number;
  koshaProductsCol: number;
  discount: number;
  paid: number; // approved money (executed txns + posted allocations)
  storedRemaining: number;
  wholeExpected: number | null; // opsBase + prepared − discount
  potentialCorrect: number | null;
  autoFixable: boolean; // safe to auto-correct (only the clean UNDERCOUNTED signature)
  classification: Classification;
  reason: string;
};

export function classifyBooking(input: {
  stored: number;
  opsBase: number | null;
  prepared: number;
  discount: number;
  koshaProductsCol: number;
}): { classification: Classification; potentialCorrect: number | null; wholeExpected: number | null; autoFixable: boolean; reason: string } {
  const { stored, opsBase, prepared, discount, koshaProductsCol } = input;
  // No trustworthy base → cannot decompose. Never auto-classify as an error.
  if (opsBase == null || opsBase <= 0) {
    return {
      classification: "HISTORICAL / AMBIGUOUS",
      potentialCorrect: null,
      wholeExpected: null,
      autoFixable: false,
      reason: "لا يوجد أساس موثوق (baseBookingAmount = 0/غير مسجّل) — لا يمكن تفكيك الإجمالي بأمان؛ مراجعة يدوية.",
    };
  }
  // A separate kosha line-items store (products_total) that we don't fold here → manual.
  if (koshaProductsCol > EPS) {
    return {
      classification: "REQUIRES MANUAL REVIEW",
      potentialCorrect: null,
      wholeExpected: round2(opsBase + prepared - discount),
      autoFixable: false,
      reason: `يوجد بند خدمات إضافية (products_total=${fmt(koshaProductsCol)}) خارج نموذج التجهيزات — يحتاج مراجعة يدوية.`,
    };
  }
  const whole = round2(opsBase + prepared - discount);
  const baseNet = round2(opsBase - discount);
  if (Math.abs(stored - whole) <= EPS) {
    if (discount > EPS)
      return {
        classification: "POSSIBLY DISCOUNTED",
        potentialCorrect: stored,
        wholeExpected: whole,
        autoFixable: false,
        reason: `الإجمالي المخزّن = الأساس ${fmt(opsBase)} + تجهيزات ${fmt(prepared)} − خصم ${fmt(discount)} = ${fmt(whole)} — صحيح، الانخفاض مبرَّر بخصم.`,
      };
    return {
      classification: "POSSIBLY CORRECT",
      potentialCorrect: stored,
      wholeExpected: whole,
      autoFixable: false,
      reason: `الإجمالي المخزّن = الأساس ${fmt(opsBase)} + تجهيزات ${fmt(prepared)} = ${fmt(whole)} — يمثّل الحجز كاملًا.`,
    };
  }
  if (prepared > EPS && Math.abs(stored - baseNet) <= EPS) {
    return {
      classification: "POSSIBLY UNDERCOUNTED",
      potentialCorrect: whole,
      wholeExpected: whole,
      autoFixable: discount <= EPS, // clean signature: base-only, products missing, no discount
      reason: `الإجمالي المخزّن = الأساس فقط (${fmt(baseNet)}) والتجهيزات ${fmt(prepared)} غير مضافة — الصحيح ${fmt(whole)} (نقص ${fmt(round2(whole - stored))}).`,
    };
  }
  if (stored - whole > EPS) {
    return {
      classification: "POSSIBLY DOUBLE-COUNTED",
      potentialCorrect: null,
      wholeExpected: whole,
      autoFixable: false,
      reason: `الإجمالي المخزّن ${fmt(stored)} يتجاوز الحجز الكامل المعروف ${fmt(whole)} بمقدار ${fmt(round2(stored - whole))} — يحتاج مراجعة يدوية.`,
    };
  }
  return {
    classification: "REQUIRES MANUAL REVIEW",
    potentialCorrect: null,
    wholeExpected: whole,
    autoFixable: false,
    reason: `المكوّنات لا تتصالح مع الإجمالي المخزّن (مخزّن ${fmt(stored)} · أساس ${fmt(opsBase)} · تجهيزات ${fmt(prepared)} · خصم ${fmt(discount)} · متوقع ${fmt(whole)}) — غالبًا أُعيد تسعيره يدويًا.`,
  };
}

async function buildRecord(
  source: "service" | "kosha",
  row: any,
): Promise<BookingDiag | null> {
  const id = Number(row.id);
  const numProducts = Number(row.product_count ?? 0);
  const details = ((source === "service" ? row.custom_fields : row.booking_details) ?? {}) as Record<string, any>;
  const ops = (details.bookingOperations ?? {}) as Record<string, any>;
  const pricing = (details.pricing ?? {}) as Record<string, any>;
  const discount = money(pricing.discountAmount ?? 0);
  const koshaProductsCol = source === "kosha" ? money(row.products_total) : 0;
  if (numProducts === 0 && discount === 0 && koshaProductsCol === 0) return null; // plain single-service — cannot diverge
  const opsBase = ops.baseBookingAmount != null ? money(ops.baseBookingAmount) : null;
  const stored = money(row.total_amount);
  const entity = source === "service" ? "service_order" : "kosha_booking";
  const prepared = numProducts > 0 ? await bookingProductCharges(entity, id, (ops.productMeta ?? {}) as Record<string, any>) : 0;
  const paid = await bookingApprovedPaid(entity, id);
  const c = classifyBooking({ stored, opsBase, prepared, discount, koshaProductsCol });
  return {
    source,
    id,
    code: String(row.code),
    customer: String(row.customer_name ?? ""),
    date: row.event_date ? String(row.event_date) : row.created_at ? new Date(row.created_at).toISOString().slice(0, 10) : null,
    services: source === "kosha" ? "كوشة" : String(row.service_name ?? "خدمة"),
    numProducts,
    stored,
    opsBase,
    pricingTotal: pricing.totalAmount != null ? money(pricing.totalAmount) : null,
    prepared,
    koshaProductsCol,
    discount,
    paid,
    storedRemaining: money(row.remaining_amount),
    wholeExpected: c.wholeExpected,
    potentialCorrect: c.potentialCorrect,
    autoFixable: c.autoFixable,
    classification: c.classification,
    reason: c.reason,
  };
}

export async function collectDiagnostics(executor = db): Promise<{ scanned: number; serviceScanned: number; koshaScanned: number; records: BookingDiag[] }> {
  const svc = (
    await executor.execute(sql`
      SELECT o.id, coalesce(o.tracking_code, 'SRV-' || o.id) AS code, o.customer_name, o.event_date, o.created_at,
             o.total_amount::text AS total_amount, o.remaining_amount::text AS remaining_amount,
             coalesce(s.name_ar, s.name) AS service_name, o.custom_fields,
             (SELECT count(*) FROM stock_reservations r WHERE r.source_type = 'service_order' AND r.source_id = o.id AND r.status <> 'released') AS product_count
      FROM service_orders o LEFT JOIN services s ON s.id = o.service_id
      WHERE o.archived_at IS NULL AND o.status <> 'cancelled' ORDER BY o.id DESC
    `)
  ).rows as any[];
  const ksh = (
    await executor.execute(sql`
      SELECT o.id, coalesce(o.tracking_code, 'KOSHA-' || o.id) AS code, o.customer_name, o.event_date, o.created_at,
             o.total_amount::text AS total_amount, coalesce(o.products_total, '0')::text AS products_total,
             o.remaining_amount::text AS remaining_amount, o.booking_details,
             (SELECT count(*) FROM stock_reservations r WHERE r.source_type = 'kosha_booking' AND r.source_id = o.id AND r.status <> 'released') AS product_count
      FROM kosha_bookings o WHERE o.archived_at IS NULL AND o.status <> 'cancelled' ORDER BY o.id DESC
    `)
  ).rows as any[];
  const records: BookingDiag[] = [];
  for (const row of svc) {
    const r = await buildRecord("service", row);
    if (r) records.push(r);
  }
  for (const row of ksh) {
    const r = await buildRecord("kosha", row);
    if (r) records.push(r);
  }
  return { scanned: svc.length + ksh.length, serviceScanned: svc.length, koshaScanned: ksh.length, records };
}

async function main() {
  console.log("PHASE 5A — Production Booking Financial Diagnostic (READ-ONLY). No rows are modified.\n");
  const { scanned, serviceScanned, koshaScanned, records } = await collectDiagnostics();

  const order: Classification[] = [
    "POSSIBLY UNDERCOUNTED",
    "POSSIBLY DOUBLE-COUNTED",
    "REQUIRES MANUAL REVIEW",
    "HISTORICAL / AMBIGUOUS",
    "POSSIBLY DISCOUNTED",
    "POSSIBLY CORRECT",
  ];
  records.sort((a, b) => order.indexOf(a.classification) - order.indexOf(b.classification) || a.id - b.id);

  for (const r of records) {
    console.log(
      [
        `#${r.id} ${r.code} [${r.source}]`,
        `العميل=${r.customer}`,
        `التاريخ=${r.date ?? "—"}`,
        `تجهيزات_عدد=${r.numProducts}`,
        `مخزّن=${fmt(r.stored)}`,
        `أساس=${fmt(r.opsBase)}`,
        r.pricingTotal != null && r.pricingTotal !== r.opsBase ? `تسعير_مخزّن=${fmt(r.pricingTotal)}` : null,
        `تجهيزات=${fmt(r.prepared)}`,
        r.koshaProductsCol > 0 ? `خدمات_إضافية=${fmt(r.koshaProductsCol)}` : null,
        `خصم=${fmt(r.discount)}`,
        `مدفوع=${fmt(r.paid)}`,
        `متبقٍ=${fmt(r.storedRemaining)}`,
        `صحيح_محتمل=${fmt(r.potentialCorrect)}`,
        r.autoFixable ? "⟳AUTO-FIXABLE" : null,
        `>> ${r.classification}`,
        `— ${r.reason}`,
      ]
        .filter(Boolean)
        .join("  |  "),
    );
  }

  const by = (k: Classification) => records.filter((r) => r.classification === k).length;
  const autoFixable = records.filter((r) => r.autoFixable);
  console.log("\n==================== SUMMARY ====================");
  console.log(`BOOKINGS SCANNED (non-cancelled): ${scanned}  (service ${serviceScanned} + kosha ${koshaScanned})`);
  console.log(`EXAMINED IN DETAIL (تجهيزات/discount present): ${records.length}`);
  console.log(`POTENTIALLY UNDERCOUNTED: ${by("POSSIBLY UNDERCOUNTED")}   (auto-fixable: ${autoFixable.length})`);
  console.log(`POTENTIALLY OVERCOUNTED (double-counted): ${by("POSSIBLY DOUBLE-COUNTED")}`);
  console.log(`DISCOUNTED / VALID VARIATIONS: ${by("POSSIBLY DISCOUNTED")}`);
  console.log(`POSSIBLY CORRECT (reconciles): ${by("POSSIBLY CORRECT")}`);
  console.log(`HISTORICAL / AMBIGUOUS (no trusted base): ${by("HISTORICAL / AMBIGUOUS")}`);
  console.log(`REQUIRES MANUAL REVIEW: ${by("REQUIRES MANUAL REVIEW")}`);
  if (autoFixable.length) {
    const totalDelta = round2(autoFixable.reduce((s, r) => s + ((r.potentialCorrect ?? r.stored) - r.stored), 0));
    console.log(`\nAUTO-FIXABLE (clean UNDERCOUNTED signature) — hidden receivable ${fmt(totalDelta)} د.ع:`);
    for (const r of autoFixable) console.log(`   #${r.id} ${r.code}: ${fmt(r.stored)} → ${fmt(r.potentialCorrect)} (+${fmt(round2((r.potentialCorrect ?? 0) - r.stored))})`);
  }
  console.log("\nDATABASE MODIFIED: NO  |  ROWS MODIFIED/INSERTED/DELETED: 0  |  MIGRATION: NO");
  console.log("ACCOUNTING/CASHBOX/PAYMENTS CHANGED: NO  |  BOOKING CENTER A4 CHANGED: NO");
  console.log("SELECT-only. Correction, if wanted, is a separate approved step (see scripts/normalize-booking-finance.ts, dry-run).");
  process.exit(0);
}

// Only run when invoked directly (the normalizer imports collectDiagnostics/classifyBooking).
if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("scripts/diagnose-booking-finance.ts")) {
  main().catch((error) => {
    console.error("diagnostic failed:", error);
    process.exit(1);
  });
}
