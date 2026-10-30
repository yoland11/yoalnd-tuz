/** Read-only check before applying migration 0132: what warehouse data already exists. Writes nothing. */
import pg from "pg";

const url = process.env.AJN_SCHEMA_DATABASE_URL;
if (!url) {
  console.log("SKIPPED warehouse audit: AJN_SCHEMA_DATABASE_URL is not set (read-only credential; never falls back to another connection)");
  process.exit(0);
}
const client = new pg.Client({ connectionString: url, ssl: process.env.AJN_SCHEMA_TLS_NO_VERIFY === "true" ? { rejectUnauthorized: false } : undefined });
await client.connect();
try {
  await client.query("BEGIN READ ONLY");
  const one = async (text: string) => (await client.query(text)).rows;
  const warehouses = await one("SELECT id, name, is_active FROM warehouses ORDER BY id");
  const main = warehouses[0]?.id ?? null;
  console.log("warehouses:", JSON.stringify(warehouses));
  console.log("main (lowest id):", main);
  console.log("balance rows per warehouse:", JSON.stringify(await one("SELECT warehouse_id, count(*)::int AS rows, coalesce(sum(quantity::numeric), 0)::float AS quantity FROM warehouse_stock GROUP BY 1 ORDER BY 1")));
  console.log("assets outside main:", JSON.stringify(await one(`SELECT warehouse_id, count(*)::int AS assets FROM asset_passports WHERE warehouse_id IS NOT NULL AND warehouse_id <> ${Number(main)} GROUP BY 1 ORDER BY 1`)));
  const overdrawn = await one(`SELECT p.id, coalesce(p.name_ar, p.name) AS name, p.stock::float AS company, sum(ws.quantity::numeric)::float AS held
    FROM warehouse_stock ws JOIN products p ON p.id = ws.product_id WHERE ws.warehouse_id <> ${Number(main)}
    GROUP BY p.id HAVING sum(ws.quantity::numeric) > p.stock::numeric ORDER BY p.id LIMIT 50`);
  console.log(`items whose non-main balance exceeds the company figure: ${overdrawn.length}`, JSON.stringify(overdrawn));
  console.log("pending transfers:", JSON.stringify(await one("SELECT status, count(*)::int AS count FROM warehouse_transfers GROUP BY 1 ORDER BY 1")));
  console.log(overdrawn.length || warehouses.length > 1 ? "REVIEW: rows above stay as they are after 0132; non-main rows count as that warehouse's balance." : "CLEAN: every existing quantity belongs to the main warehouse after 0132.");
  await client.query("ROLLBACK");
} finally {
  await client.end();
}
