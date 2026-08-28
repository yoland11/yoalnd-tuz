#!/usr/bin/env node

/** Creates an atomic, read-only logical backup of every public table. */
import { createHash } from "node:crypto";
import { createWriteStream, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createGzip } from "node:zlib";
import pg from "pg";

// Backups are an explicit administrative operation. They intentionally use a
// separate credential from the optional read-only production audit command.
const connectionString = process.env.AJN_BACKUP_DATABASE_URL;
if (!connectionString) throw new Error("AJN_BACKUP_DATABASE_URL is required");
const target = new URL(connectionString);
const databaseName = decodeURIComponent(target.pathname.slice(1));
if (!target.hostname || /(^|[_-])(test|dev|staging|preview)($|[_-])/i.test(databaseName))
  throw new Error("Refusing non-production-looking database target");

const repositoryRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const outputDirectory = resolve(repositoryRoot, "backups");
mkdirSync(outputDirectory, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const output = resolve(outputDirectory, `ajn-production-${stamp}.json.gz`);
const pool = new pg.Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 15_000,
  ssl: process.env.AJN_SCHEMA_TLS_NO_VERIFY === "true" ? { rejectUnauthorized: false } : undefined,
});

let client: pg.PoolClient | undefined;
const criticalTables = new Set([
  "ajn_schema_revisions", "customers", "staff", "products", "stock_movements",
  "sales_invoices", "sales_invoice_items", "product_bundles", "product_bundle_items",
  "sales_invoice_bundle_snapshots", "financial_transactions", "financial_ledger_entries",
  "payment_vouchers", "receipt_vouchers", "receipt_voucher_allocations",
  "delivery_details", "delivery_orders", "print_agents", "printers", "print_jobs",
  "kosha_bookings", "kosha_payment_requests", "kosha_booking_events",
  "kosha_staff_notifications", "notifications",
]);
try {
  client = await pool.connect();
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await client.query("SET LOCAL statement_timeout = '0'");
  const catalog = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
const snapshot: Record<string, unknown> = {
    format: "ajn-public-logical-backup/v1",
    createdAt: new Date().toISOString(),
    database: databaseName,
    schema: "public",
    scope: "critical-production-data",
    tables: {} as Record<string, unknown[]>,
  };
  const tables = snapshot.tables as Record<string, unknown[]>;
  for (const row of catalog.rows as Array<{ table_name: string }>) {
    if (!criticalTables.has(row.table_name)) continue;
    // Identifiers come only from PostgreSQL's catalog, not user input.
    const quoted = `"${row.table_name.replace(/"/g, '""')}"`;
    const rows = await client.query(`SELECT row_to_json(source_row) AS row FROM public.${quoted} AS source_row`);
    tables[row.table_name] = rows.rows.map((entry) => entry.row);
  }
  await client.query("COMMIT");
  const body = `${JSON.stringify(snapshot)}\n`;
  await pipeline(
    Readable.from([body]),
    createGzip({ level: 9 }),
    createWriteStream(output, { flags: "wx", mode: 0o600 }),
  );
  console.log(JSON.stringify({
    status: "BACKUP_CREATED",
    output,
    tables: Object.keys(tables).length,
    sha256: createHash("sha256").update(body).digest("hex"),
  }));
} finally {
  await client?.query("ROLLBACK").catch(() => undefined);
  client?.release();
  await pool.end().catch(() => undefined);
}
