/**
 * Booking-finance normalization tool. DRY-RUN BY DEFAULT — writes NOTHING unless
 * explicitly and doubly authorized. Corrects ONLY the clean, high-confidence
 * UNDERCOUNTED signature surfaced by the read-only diagnostic (stored total =
 * service base only, with live تجهيزات provably missing and NO discount and a
 * trustworthy `baseBookingAmount`). It never touches "correct", "discounted",
 * "double-counted", "manual-review", or "ambiguous" bookings — those require a
 * human decision and are left exactly as they are.
 *
 * WHAT IT CHANGES ON APPLY (and ONLY this):
 *   total_amount → base + تجهيزات (the true receivable)
 *   remaining_amount → max(0, newTotal − approvedPaid)
 *   payment_status → derived
 * It DOES NOT touch cashbox, financial_transactions, receipts, ledgers, products,
 * schema, or the Booking Center A4 design. Actual cash received is unchanged — the
 * OBLIGATION is corrected upward, exactly as the accounting should read it.
 *
 * SAFETY: apply requires BOTH `--apply` AND env `AJN_NORMALIZE_APPLY=1`; it writes
 * a timestamped JSON backup of every affected row FIRST, and `--revert <file>`
 * restores any backup. Nothing here runs on deploy or import; it is a manual tool.
 *
 *   Dry-run (default, read-only):
 *     node ./scripts/run-tsx.mjs --tsconfig ./tsconfig.json ./scripts/normalize-booking-finance.ts
 *   Apply (explicit, backed-up):
 *     AJN_NORMALIZE_APPLY=1 node ./scripts/run-tsx.mjs --tsconfig ./tsconfig.json ./scripts/normalize-booking-finance.ts --apply [--ids 15,78]
 *   Revert:
 *     node ./scripts/run-tsx.mjs --tsconfig ./tsconfig.json ./scripts/normalize-booking-finance.ts --revert scripts/normalize-backups/<file>.json
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { round2 } from "../src/server/booking-finance";
import { collectDiagnostics, type BookingDiag } from "./diagnose-booking-finance";

const BACKUP_DIR = resolve(process.cwd(), "scripts", "normalize-backups");

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}
function deriveStatus(total: number, paid: number): "paid" | "partial" | "unpaid" {
  const remaining = round2(Math.max(0, total - paid));
  return remaining <= 0 ? "paid" : paid > 0 ? "partial" : "unpaid";
}

type Plan = {
  source: "service" | "kosha";
  id: number;
  code: string;
  customer: string;
  oldTotal: number;
  newTotal: number;
  paid: number;
  newRemaining: number;
  newStatus: string;
  delta: number;
};

function planFrom(records: BookingDiag[], onlyIds: number[] | null): Plan[] {
  return records
    .filter((r) => r.autoFixable && r.potentialCorrect != null && (!onlyIds || onlyIds.includes(r.id)))
    .map((r) => {
      const newTotal = round2(r.potentialCorrect as number);
      return {
        source: r.source,
        id: r.id,
        code: r.code,
        customer: r.customer,
        oldTotal: r.stored,
        newTotal,
        paid: r.paid,
        newRemaining: round2(Math.max(0, newTotal - r.paid)),
        newStatus: deriveStatus(newTotal, r.paid),
        delta: round2(newTotal - r.stored),
      };
    });
}

async function snapshot(plans: Plan[]): Promise<string> {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const rows: any[] = [];
  for (const p of plans) {
    const table = p.source === "kosha" ? "kosha_bookings" : "service_orders";
    const cur = (
      await db.execute(sql`SELECT total_amount::text AS total_amount, remaining_amount::text AS remaining_amount, payment_status FROM ${sql.raw(table)} WHERE id = ${p.id}`)
    ).rows[0] as any;
    rows.push({ source: p.source, id: p.id, table, before: cur });
  }
  const file = resolve(BACKUP_DIR, `normalize-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify({ createdAt: new Date().toISOString(), rows }, null, 2), "utf8");
  return file;
}

async function apply(plans: Plan[]) {
  const backup = await snapshot(plans);
  console.log(`backup written: ${backup}`);
  for (const p of plans) {
    if (p.source === "kosha") {
      await db.execute(sql`
        UPDATE kosha_bookings
        SET total_amount = ${String(p.newTotal)}, remaining_amount = ${String(p.newRemaining)},
            payment_status = ${p.newStatus}, updated_at = now()
        WHERE id = ${p.id}
      `);
    } else {
      await db.execute(sql`
        UPDATE service_orders
        SET total_amount = ${String(p.newTotal)}, remaining_amount = ${String(p.newRemaining)},
            payment_status = ${p.newStatus}
        WHERE id = ${p.id}
      `);
    }
    console.log(`applied #${p.id} ${p.code}: ${fmt(p.oldTotal)} → ${fmt(p.newTotal)} (remaining ${fmt(p.newRemaining)}, ${p.newStatus})`);
  }
  console.log(`\nAPPLIED ${plans.length} correction(s). Cashbox/accounting/payments untouched. Revert with --revert ${backup}`);
}

async function revert(file: string) {
  const data = JSON.parse(readFileSync(resolve(file), "utf8"));
  for (const row of data.rows as any[]) {
    const b = row.before;
    await db.execute(sql`
      UPDATE ${sql.raw(row.table)}
      SET total_amount = ${b.total_amount}, remaining_amount = ${b.remaining_amount}, payment_status = ${b.payment_status}
      WHERE id = ${row.id}
    `);
    console.log(`reverted #${row.id} → total ${b.total_amount}, remaining ${b.remaining_amount}, ${b.payment_status}`);
  }
  console.log(`\nREVERTED ${data.rows.length} row(s) from ${file}.`);
  process.exit(0);
}

async function main() {
  const argv = process.argv.slice(2);
  const revertIdx = argv.indexOf("--revert");
  if (revertIdx >= 0) return revert(argv[revertIdx + 1]);

  const wantsApply = argv.includes("--apply");
  const envApply = process.env.AJN_NORMALIZE_APPLY === "1";
  const idsArg = argv.includes("--ids") ? argv[argv.indexOf("--ids") + 1] : null;
  const onlyIds = idsArg ? idsArg.split(",").map((s) => Number(s.trim())).filter(Number.isFinite) : null;

  const { records } = await collectDiagnostics();
  const plans = planFrom(records, onlyIds);

  console.log("Booking-finance normalization — CLEAN auto-fixable UNDERCOUNTED bookings only\n");
  if (!plans.length) {
    console.log("Nothing to normalize (no clean auto-fixable bookings match).");
    process.exit(0);
  }
  for (const p of plans) {
    console.log(
      `#${p.id} ${p.code} [${p.source}] — ${p.customer}: total ${fmt(p.oldTotal)} → ${fmt(p.newTotal)} (+${fmt(p.delta)})  |  paid ${fmt(p.paid)}  |  remaining → ${fmt(p.newRemaining)}  |  status → ${p.newStatus}`,
    );
  }
  const totalDelta = round2(plans.reduce((s, p) => s + p.delta, 0));
  console.log(`\n${plans.length} booking(s), corrected receivable +${fmt(totalDelta)} د.ع.`);

  if (wantsApply && envApply) {
    console.log("\n>>> APPLY authorized (--apply + AJN_NORMALIZE_APPLY=1). Writing...\n");
    await apply(plans);
    process.exit(0);
  }
  console.log("\nDRY-RUN — no rows modified. To apply: AJN_NORMALIZE_APPLY=1 ... --apply  (writes a backup first; reversible via --revert).");
  if (wantsApply && !envApply) console.log("(--apply was passed but AJN_NORMALIZE_APPLY=1 is NOT set, so nothing was written — this is the safety interlock.)");
  process.exit(0);
}

main().catch((error) => {
  console.error("normalize failed:", error);
  process.exit(1);
});
