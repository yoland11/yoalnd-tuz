/**
 * READ-ONLY diagnostic for the ajn-booking-finance model.
 *
 * Lists bookings whose persisted `total_amount` disagrees with the authoritative
 * whole-booking total (base service + products/تجهيزات) from
 * getBookingFinancialSummary. These are the historical multi-service bookings
 * that under- (or over-) report in any surface that reads total_amount directly.
 *
 * It SELECTs only. It writes nothing, posts no cash, and modifies no row. Any
 * migration of historical money is a separate, explicitly-approved step.
 *
 * Run: node ./scripts/run-tsx.mjs --tsconfig ./tsconfig.json ./scripts/diagnose-booking-finance.ts
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { getBookingFinancialSummary } from "../src/server/booking-finance";

function money(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

async function scan(
  source: "service" | "kosha",
  table: "service_orders" | "kosha_bookings",
  refExpr: string,
) {
  // Only bookings that actually carry products can diverge; scan those.
  const entity = source === "service" ? "service_order" : "kosha_booking";
  const rows = (
    await db.execute(sql`
      SELECT o.id, ${sql.raw(refExpr)} AS reference, o.total_amount::text AS total_amount
      FROM ${sql.raw(table)} o
      WHERE o.archived_at IS NULL AND o.status <> 'cancelled'
        AND EXISTS (
          SELECT 1 FROM stock_reservations r
          WHERE r.source_type = ${entity} AND r.source_id = o.id AND r.status <> 'released'
        )
      ORDER BY o.id DESC
      LIMIT 2000
    `)
  ).rows as any[];

  const mismatches: Array<{ id: number; reference: string; totalAmount: number; base: number; products: number; finalTotal: number; delta: number }> = [];
  let underReported = 0;
  for (const row of rows) {
    const id = Number(row.id);
    const summary = await getBookingFinancialSummary(source, id);
    if (!summary) continue;
    const totalAmount = money(row.total_amount);
    const delta = money(summary.finalTotal - totalAmount);
    if (Math.abs(delta) >= 0.01) {
      mismatches.push({ id, reference: String(row.reference ?? ""), totalAmount, base: summary.base, products: summary.products, finalTotal: summary.finalTotal, delta });
      if (delta > 0) underReported += delta;
    }
  }
  return { scanned: rows.length, mismatches, underReported: money(underReported) };
}

async function main() {
  console.log("ajn-booking-finance diagnostic (READ-ONLY) — persisted total_amount vs authoritative base+products\n");
  const service = await scan("service", "service_orders", "coalesce(o.tracking_code, 'SRV-' || o.id)");
  const kosha = await scan("kosha", "kosha_bookings", "coalesce(o.tracking_code, 'KOSHA-' || o.id)");

  for (const [label, result] of [["SERVICE ORDERS", service], ["KOSHA BOOKINGS", kosha]] as const) {
    console.log(`== ${label} ==`);
    console.log(`  bookings-with-products scanned: ${result.scanned}`);
    console.log(`  mismatched (total_amount ≠ base+products): ${result.mismatches.length}`);
    console.log(`  total under-reported obligation: ${result.underReported.toLocaleString("en-US")} د.ع`);
    for (const m of result.mismatches.slice(0, 25)) {
      console.log(
        `   #${m.id} ${m.reference}: total_amount=${m.totalAmount.toLocaleString("en-US")}  base=${m.base.toLocaleString("en-US")}  products=${m.products.toLocaleString("en-US")}  authoritative=${m.finalTotal.toLocaleString("en-US")}  Δ=${m.delta > 0 ? "+" : ""}${m.delta.toLocaleString("en-US")}`,
      );
    }
    if (result.mismatches.length > 25) console.log(`   … and ${result.mismatches.length - 25} more`);
    console.log("");
  }
  console.log("No rows were modified. Historical correction, if wanted, is a separate approved step.");
  process.exit(0);
}

main().catch((error) => {
  console.error("diagnostic failed:", error);
  process.exit(1);
});
