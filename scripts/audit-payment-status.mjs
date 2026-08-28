import pg from "pg";

// This command is intentionally audit-only. It never falls back to an
// application, production, or test write URL. The supplied audit role must be
// read-only; the transaction is also explicitly opened READ ONLY.
const connectionString = process.env.AJN_SCHEMA_DATABASE_URL;
if (!connectionString) {
  console.warn("Payment-status audit: SKIPPED — AJN_SCHEMA_DATABASE_URL unavailable.");
  process.exit(0);
}

const sources = [
  ["sales_invoice", "sales_invoices", "total", "paid_amount", "remaining_amount", "payment_status", "revenue", true],
  ["purchase_invoice", "purchase_invoices", "total", "paid_amount", "remaining_amount", "payment_status", "expense", false],
  ["kosha_booking", "kosha_bookings", "total_amount", "paid_amount", "remaining_amount", "payment_status", "revenue", true],
  ["order", "orders", "total", "deposit_amount", "remaining_amount", "payment_status", "revenue", true],
  ["service_order", "service_orders", "total_amount", "deposit_amount", "remaining_amount", "payment_status", "revenue", true],
  ["graduation_order", "graduation_orders", "total_amount", "paid_amount", "remaining_amount", "payment_status", "revenue", true],
  ["photography_order", "photography_orders", "total_amount", "paid_amount", "remaining_amount", "payment_status", "revenue", true],
  ["rental_order", "rental_orders", "total_amount", "paid_amount", "remaining_amount", "payment_status", "revenue", true],
  ["research_order", "research_orders", "total_amount", "paid_amount", "remaining_amount", "payment_status", "revenue", true],
];

const client = new pg.Client({ connectionString, statement_timeout: 15_000 });
const verbose = process.argv.includes("--verbose");
try {
  await client.connect();
  await client.query("BEGIN READ ONLY");
  const report = [];
  for (const [sourceType, table, total, paid, remaining, status, direction, allocations] of sources) {
    const exists = await client.query("SELECT to_regclass($1) AS relation", [table]);
    if (!exists.rows[0]?.relation) {
      report.push({ module: sourceType, status: "SKIPPED", reason: "table unavailable" });
      continue;
    }
    const rows = await client.query(`
      WITH direct_financials AS (
        SELECT source_id, coalesce(sum(CASE WHEN direction = $1 THEN amount::numeric ELSE -amount::numeric END), 0)::numeric AS value
        FROM financial_transactions
        WHERE source_type = $2 AND approval_status = 'executed'
        GROUP BY source_id
      ), allocations AS (
        ${allocations ? `SELECT a.source_id::text AS source_id, coalesce(sum(greatest(a.amount::numeric - coalesce(a.reversed_amount::numeric, 0), 0)), 0)::numeric AS value
          FROM receipt_voucher_allocations a JOIN receipt_vouchers v ON v.id = a.receipt_voucher_id
          WHERE a.source_type = $2 AND a.posted_at IS NOT NULL AND coalesce(v.approval_status, 'executed') = 'executed'
          GROUP BY a.source_id` : "SELECT NULL::text AS source_id, 0::numeric AS value WHERE false"}
      ), calculated AS (
        SELECT d.id, d.${total}::numeric AS total_amount,
          greatest(coalesce(f.value, 0) + coalesce(a.value, 0), 0)::numeric AS approved_paid
        FROM ${table} d
        LEFT JOIN direct_financials f ON f.source_id = d.id::text
        LEFT JOIN allocations a ON a.source_id = d.id::text
      )
      SELECT d.id, d.${status} AS current_status, d.${paid}::text AS current_paid,
        d.${remaining}::text AS current_remaining, c.total_amount::text AS total_amount,
        least(c.total_amount, c.approved_paid)::text AS calculated_paid,
        greatest(c.total_amount - c.approved_paid, 0)::text AS calculated_remaining,
        CASE WHEN c.total_amount <= 0 OR c.approved_paid <= 0 THEN 'unpaid'
          WHEN c.approved_paid >= c.total_amount THEN 'paid' ELSE 'partial' END AS calculated_status
      FROM ${table} d JOIN calculated c ON c.id = d.id
      WHERE abs(d.${paid}::numeric - least(c.total_amount, c.approved_paid)) > 0.01
         OR abs(d.${remaining}::numeric - greatest(c.total_amount - c.approved_paid, 0)) > 0.01
         OR (
           d.${status} <> CASE WHEN c.total_amount <= 0 OR c.approved_paid <= 0 THEN 'unpaid'
             WHEN c.approved_paid >= c.total_amount THEN 'paid' ELSE 'partial' END
           AND NOT (d.${status} = 'pending_approval' AND c.approved_paid <= 0)
         )
      ORDER BY d.id DESC LIMIT 100
    `, [direction, sourceType]);
    report.push({
      module: sourceType,
      status: "AUDITED",
      mismatches: rows.rowCount,
      ...(verbose ? { rows: rows.rows } : {}),
    });
  }
  console.log(JSON.stringify({ mode: "READ_ONLY_DRY_RUN", report }, null, 2));
} finally {
  try { await client.query("ROLLBACK"); } catch { /* no open transaction */ }
  await client.end().catch(() => undefined);
}
