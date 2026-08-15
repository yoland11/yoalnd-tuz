#!/usr/bin/env node

/**
 * AJN production baseline collector.
 *
 * Safety contract:
 * - uses only AJN_PRODUCTION_READONLY_DATABASE_URL (never DATABASE_URL);
 * - refuses localhost/test/dev/staging/preview database targets;
 * - starts PostgreSQL with default_transaction_read_only=on;
 * - executes SELECT statements only;
 * - refuses to collect business aggregates when the connected role has any
 *   database/schema/table mutation privilege or elevated PostgreSQL role flag;
 * - writes aggregate metadata only; never writes credentials or row-level PII.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import pg from "pg";

const connectionString = process.env.AJN_PRODUCTION_READONLY_DATABASE_URL;
if (!connectionString) {
  throw new Error("AJN_PRODUCTION_READONLY_DATABASE_URL is required; DATABASE_URL is intentionally ignored");
}
if (process.env.TEST_DATABASE_URL === connectionString || process.env.DATABASE_URL === connectionString) {
  throw new Error("Refusing an audit URL that is also configured as TEST_DATABASE_URL or DATABASE_URL in this shell");
}

let target;
try {
  target = new URL(connectionString);
} catch {
  throw new Error("AJN_PRODUCTION_READONLY_DATABASE_URL is not a valid PostgreSQL URL");
}
if (!/^postgres(?:ql)?:$/.test(target.protocol)) throw new Error("Only PostgreSQL audit targets are supported");
const host = target.hostname.toLowerCase();
const databaseName = decodeURIComponent(target.pathname.replace(/^\//, ""));
const unsafeDatabaseMarker = /(^|[_-])(test|testing|dev|development|staging|preview|local)($|[_-])/i;
if (
  !host ||
  ["localhost", "127.0.0.1", "::1"].includes(host) ||
  host.endsWith(".local") ||
  unsafeDatabaseMarker.test(databaseName)
) {
  throw new Error("Refusing a local, test, development, staging, or preview database target");
}

const outputPath = new URL("../reports/ajn-production-baseline.json", import.meta.url);
if (existsSync(outputPath) && process.env.AJN_OVERWRITE_PRODUCTION_BASELINE !== "true") {
  throw new Error("Baseline already exists; set AJN_OVERWRITE_PRODUCTION_BASELINE=true only after archiving the earlier local artifact");
}

const provider = host.includes("supabase")
  ? "Supabase PostgreSQL"
  : host.includes("neon")
    ? "Neon PostgreSQL"
    : host.includes("vercel-storage")
      ? "Vercel Postgres"
      : "PostgreSQL provider (hostname redacted)";
const databaseNameMasked = databaseName.length < 5
  ? "*".repeat(databaseName.length)
  : `${databaseName.slice(0, 2)}***${databaseName.slice(-2)}`;
const targetFingerprint = createHash("sha256").update(`${host}/${databaseName}`).digest("hex").slice(0, 16);

const pool = new pg.Pool({
  connectionString,
  max: 1,
  idleTimeoutMillis: 5_000,
  connectionTimeoutMillis: 10_000,
  options: "-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=5000",
});

const capturedAt = new Date().toISOString();
const number = (value) => value === null || value === undefined ? null : Number(value);
const normalizeRow = (row) => Object.fromEntries(
  Object.entries(row).map(([key, value]) => [key, typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value) ? Number(value) : value]),
);

let client;
try {
  client = await pool.connect();
  const select = async (text, values = []) => {
    if (!/^\s*(select|with)\b/i.test(text)) throw new Error("Audit safety violation: only SELECT/WITH queries are permitted");
    return client.query(text, values);
  };

  const identity = (await select(`
    SELECT
      current_database() AS database_name,
      current_user AS role_name,
      current_setting('transaction_read_only') AS transaction_read_only,
      current_setting('server_version') AS server_version,
      has_database_privilege(current_user, current_database(), 'CREATE') AS database_create,
      has_database_privilege(current_user, current_database(), 'TEMP') AS database_temp,
      has_schema_privilege(current_user, 'public', 'CREATE') AS schema_create,
      r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls,
      COALESCE(s.ssl, false) AS ssl,
      s.version AS ssl_version
    FROM pg_roles r
    LEFT JOIN pg_stat_ssl s ON s.pid = pg_backend_pid()
    WHERE r.rolname = current_user
  `)).rows[0];

  if (identity.database_name !== databaseName) throw new Error("Connected database identity does not match the requested audit URL");

  const mutationPrivileges = (await select(`
    SELECT
      COALESCE(bool_or(has_table_privilege(current_user, format('%I.%I', table_schema, table_name), 'INSERT')), false) AS can_insert,
      COALESCE(bool_or(has_table_privilege(current_user, format('%I.%I', table_schema, table_name), 'UPDATE')), false) AS can_update,
      COALESCE(bool_or(has_table_privilege(current_user, format('%I.%I', table_schema, table_name), 'DELETE')), false) AS can_delete,
      COALESCE(bool_or(has_table_privilege(current_user, format('%I.%I', table_schema, table_name), 'TRUNCATE')), false) AS can_truncate,
      COALESCE(bool_or(has_table_privilege(current_user, format('%I.%I', table_schema, table_name), 'REFERENCES')), false) AS can_references,
      COALESCE(bool_or(has_table_privilege(current_user, format('%I.%I', table_schema, table_name), 'TRIGGER')), false) AS can_trigger
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `)).rows[0];

  const elevated = [
    identity.database_create,
    identity.database_temp,
    identity.schema_create,
    identity.rolsuper,
    identity.rolcreatedb,
    identity.rolcreaterole,
    identity.rolreplication,
    identity.rolbypassrls,
    ...Object.values(mutationPrivileges),
  ].some(Boolean);
  if (identity.transaction_read_only !== "on" || elevated) {
    throw new Error("Audit role is not demonstrably read-only; create/use a dedicated SELECT-only PostgreSQL role before collecting production aggregates");
  }

  const columns = (await select(`
    SELECT table_name, column_name, data_type, is_nullable, ordinal_position
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `)).rows;
  const indexes = (await select(`
    SELECT tablename, indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
    ORDER BY tablename, indexname
  `)).rows;
  const tableColumns = new Map();
  for (const row of columns) {
    const set = tableColumns.get(row.table_name) ?? new Set();
    set.add(row.column_name);
    tableColumns.set(row.table_name, set);
  }
  const hasTable = (name) => tableColumns.has(name);
  const hasColumns = (table, ...names) => hasTable(table) && names.every((name) => tableColumns.get(table).has(name));
  const scalar = async (sql, key = "value") => normalizeRow((await select(sql)).rows[0] ?? {})[key] ?? null;
  const row = async (sql) => normalizeRow((await select(sql)).rows[0] ?? {});
  const count = async (table) => hasTable(table) ? number(await scalar(`SELECT count(*)::bigint AS value FROM "${table}"`)) : null;

  const schemaRevision = hasTable("ajn_schema_revisions") && hasColumns("ajn_schema_revisions", "revision")
    ? number(await scalar("SELECT max(revision)::integer AS value FROM ajn_schema_revisions"))
    : null;
  const revisionApplied = async (revision) => hasTable("ajn_schema_revisions")
    ? Boolean(await scalar(`SELECT EXISTS(SELECT 1 FROM ajn_schema_revisions WHERE revision=${Number(revision)}) AS value`))
    : false;
  const schemaFingerprint = createHash("sha256")
    .update(JSON.stringify({ columns, indexes }))
    .digest("hex");

  const sales = hasColumns("sales_invoices", "status", "total", "paid_amount", "remaining_amount")
    ? await row(`SELECT count(*)::bigint AS invoice_count,
        count(*) FILTER (WHERE status='active')::bigint AS active_invoice_count,
        count(*) FILTER (WHERE status='cancelled')::bigint AS cancelled_invoice_count,
        COALESCE(sum(total),0) AS total_sales_value,
        COALESCE(sum(paid_amount),0) AS total_paid,
        COALESCE(sum(remaining_amount),0) AS total_outstanding
      FROM sales_invoices`)
    : null;
  const purchases = hasColumns("purchase_invoices", "total", "paid_amount", "remaining_amount")
    ? await row(`SELECT count(*)::bigint AS invoice_count, COALESCE(sum(total),0) AS purchase_total,
        COALESCE(sum(paid_amount),0) AS paid_amount, COALESCE(sum(remaining_amount),0) AS supplier_outstanding
      FROM purchase_invoices`)
    : null;
  const installments = hasColumns("installment_contracts", "status", "remaining_amount")
    ? {
        ...(await row(`SELECT count(*)::bigint AS contract_count,
          count(*) FILTER (WHERE status='active')::bigint AS active_contracts,
          count(*) FILTER (WHERE status='completed')::bigint AS completed_contracts,
          count(*) FILTER (WHERE status='cancelled')::bigint AS cancelled_contracts,
          COALESCE(sum(remaining_amount),0) AS outstanding_balance FROM installment_contracts`)),
        ...(hasColumns("installment_payments", "amount")
          ? await row(`SELECT count(*)::bigint AS payment_count, COALESCE(sum(amount),0) AS payment_total FROM installment_payments`)
          : { payment_count: null, payment_total: null }),
      }
    : null;
  const cash = hasColumns("master_cash_box", "current_balance")
    ? {
        current_main_cash_balance: await scalar("SELECT COALESCE(sum(current_balance),0) AS value FROM master_cash_box"),
        total_cash_inflows: hasColumns("financial_transactions", "direction", "amount", "approval_status")
          ? await scalar("SELECT COALESCE(sum(amount),0) AS value FROM financial_transactions WHERE approval_status='executed' AND direction IN ('revenue','income','inflow')")
          : null,
        total_cash_outflows: hasColumns("financial_transactions", "direction", "amount", "approval_status")
          ? await scalar("SELECT COALESCE(sum(amount),0) AS value FROM financial_transactions WHERE approval_status='executed' AND direction IN ('expense','outflow')")
          : null,
      }
    : null;
  const ledger = hasColumns("financial_ledger_entries", "entry_side", "amount")
    ? await row(`SELECT count(*)::bigint AS entry_count,
        COALESCE(sum(amount) FILTER (WHERE entry_side='debit'),0) AS total_debit,
        COALESCE(sum(amount) FILTER (WHERE entry_side='credit'),0) AS total_credit,
        COALESCE(sum(CASE WHEN entry_side='debit' THEN amount WHEN entry_side='credit' THEN -amount ELSE 0 END),0) AS debit_credit_difference
      FROM financial_ledger_entries`)
    : null;
  const expenses = hasColumns("expenses", "amount")
    ? await row(`SELECT count(*) FILTER (WHERE ${hasColumns("expenses", "deleted_at") ? "deleted_at IS NULL" : "true"})::bigint AS expense_count,
        COALESCE(sum(amount) FILTER (WHERE ${hasColumns("expenses", "deleted_at") ? "deleted_at IS NULL" : "true"}),0) AS expense_total FROM expenses`)
    : null;
  const customerDebt = hasColumns("customer_receivable_ledger", "customer_id", "remaining_amount")
    ? await row(`SELECT count(DISTINCT customer_id) FILTER (WHERE remaining_amount>0)::bigint AS customers_with_debt,
        COALESCE(sum(remaining_amount) FILTER (WHERE remaining_amount>0),0) AS total_customer_debt FROM customer_receivable_ledger`)
    : null;
  const supplierDebt = hasColumns("suppliers", "balance")
    ? await row(`SELECT count(*) FILTER (WHERE NULLIF(balance,'')::numeric>0)::bigint AS suppliers_with_debt,
        COALESCE(sum(NULLIF(balance,'')::numeric) FILTER (WHERE NULLIF(balance,'')::numeric>0),0) AS total_supplier_debt FROM suppliers`)
    : null;

  const businessTableNames = [
    "customers", "staff", "products", "product_variants", "stock_movements", "sales_invoices",
    "purchase_invoices", "installment_contracts", "installment_payments", "service_orders", "kosha_bookings",
    "orders", "research_orders", "photography_orders", "photography_events", "graduation_orders",
    "tailoring_orders", "research_files", "photography_uploads", "scanned_documents",
  ];
  const businessCounts = {};
  for (const table of businessTableNames) businessCounts[table] = await count(table);
  if (hasColumns("staff", "role", "is_active")) {
    businessCounts.staff_roles = await row(`SELECT
      count(*) FILTER (WHERE role IN ('admin','super_admin','main_manager') AND is_active=true)::bigint AS active_administrators,
      count(*) FILTER (WHERE role IN ('admin','super_admin','main_manager') AND is_active=false)::bigint AS disabled_administrators,
      count(*) FILTER (WHERE role NOT IN ('admin','super_admin','main_manager') AND is_active=true)::bigint AS active_employees,
      count(*) FILTER (WHERE role NOT IN ('admin','super_admin','main_manager') AND is_active=false)::bigint AS disabled_employees,
      count(*) FILTER (WHERE role='representative')::bigint AS representatives FROM staff`);
  }

  const inventory = hasColumns("products", "stock")
    ? await row(`SELECT count(*)::bigint AS sku_count, COALESCE(sum(stock),0) AS quantity_on_hand,
        count(*) FILTER (WHERE stock<0)::bigint AS negative_stock_rows,
        count(*) FILTER (WHERE stock=0)::bigint AS zero_stock_rows FROM products`)
    : null;

  const checks = [];
  const addCheck = async (name, severity, sql) => {
    const issueCount = number(await scalar(sql));
    checks.push({ name, classification: issueCount === 0 ? "OK" : severity, issueCount });
  };
  if (hasColumns("sales_invoice_items", "invoice_id") && hasColumns("sales_invoices", "id"))
    await addCheck("orphan_sales_items", "CRITICAL", "SELECT count(*)::bigint AS value FROM sales_invoice_items i LEFT JOIN sales_invoices h ON h.id=i.invoice_id WHERE h.id IS NULL");
  if (hasColumns("purchase_invoice_items", "invoice_id") && hasColumns("purchase_invoices", "id"))
    await addCheck("orphan_purchase_items", "CRITICAL", "SELECT count(*)::bigint AS value FROM purchase_invoice_items i LEFT JOIN purchase_invoices h ON h.id=i.invoice_id WHERE h.id IS NULL");
  if (hasColumns("installment_payments", "contract_id") && hasColumns("installment_contracts", "id"))
    await addCheck("orphan_installment_payments", "CRITICAL", "SELECT count(*)::bigint AS value FROM installment_payments p LEFT JOIN installment_contracts c ON c.id=p.contract_id WHERE c.id IS NULL");
  if (hasColumns("sales_invoices", "invoice_no"))
    await addCheck("duplicate_sales_invoice_numbers", "CRITICAL", "SELECT count(*)::bigint AS value FROM (SELECT invoice_no FROM sales_invoices GROUP BY invoice_no HAVING count(*)>1) d");
  if (hasColumns("purchase_invoices", "invoice_no"))
    await addCheck("duplicate_purchase_invoice_numbers", "CRITICAL", "SELECT count(*)::bigint AS value FROM (SELECT invoice_no FROM purchase_invoices GROUP BY invoice_no HAVING count(*)>1) d");
  for (const table of ["sales_invoices", "purchase_invoices", "installment_payments", "financial_transactions", "stock_movements"]) {
    if (hasColumns(table, "idempotency_key"))
      await addCheck(`duplicate_${table}_idempotency_keys`, "CRITICAL", `SELECT count(*)::bigint AS value FROM (SELECT idempotency_key FROM ${table} WHERE idempotency_key IS NOT NULL GROUP BY idempotency_key HAVING count(*)>1) d`);
  }
  if (hasColumns("installment_payments", "financial_transaction_id", "status"))
    await addCheck("posted_installment_payment_without_financial_link", "CRITICAL", "SELECT count(*)::bigint AS value FROM installment_payments WHERE status='posted' AND financial_transaction_id IS NULL");
  if (hasColumns("financial_transactions", "id", "approval_status") && hasColumns("financial_ledger_entries", "transaction_id"))
    await addCheck("executed_financial_movement_without_ledger", "CRITICAL", "SELECT count(*)::bigint AS value FROM financial_transactions f WHERE f.approval_status='executed' AND NOT EXISTS (SELECT 1 FROM financial_ledger_entries l WHERE l.transaction_id=f.id)");
  if (hasColumns("sales_invoices", "status", "total", "paid_amount", "remaining_amount"))
    await addCheck("active_sales_invoice_paid_remaining_mismatch", "WARNING", "SELECT count(*)::bigint AS value FROM sales_invoices WHERE status='active' AND abs(total-paid_amount-remaining_amount)>0.01");
  if (hasColumns("purchase_invoices", "status", "total", "paid_amount", "remaining_amount"))
    await addCheck("active_purchase_invoice_paid_remaining_mismatch", "WARNING", "SELECT count(*)::bigint AS value FROM purchase_invoices WHERE status='active' AND abs(total-paid_amount-remaining_amount)>0.01");
  if (hasColumns("products", "stock"))
    await addCheck("negative_product_stock", "WARNING", "SELECT count(*)::bigint AS value FROM products WHERE stock<0");
  if (hasColumns("stock_movements", "product_id") && hasColumns("products", "id"))
    await addCheck("orphan_stock_movements", "WARNING", "SELECT count(*)::bigint AS value FROM stock_movements m LEFT JOIN products p ON p.id=m.product_id WHERE m.product_id IS NOT NULL AND p.id IS NULL");
  if (hasColumns("orders", "customer_id") && hasColumns("customers", "id"))
    await addCheck("orphan_shop_order_customer_ownership", "CRITICAL", "SELECT count(*)::bigint AS value FROM orders o LEFT JOIN customers c ON c.id=o.customer_id WHERE o.customer_id IS NOT NULL AND c.id IS NULL");
  if (hasColumns("financial_ledger_entries", "transaction_id", "entry_side", "amount"))
    await addCheck("unbalanced_financial_transactions", "CRITICAL", "SELECT count(*)::bigint AS value FROM (SELECT transaction_id FROM financial_ledger_entries GROUP BY transaction_id HAVING abs(sum(CASE WHEN entry_side='debit' THEN amount WHEN entry_side='credit' THEN -amount ELSE 0 END))>0.01) d");

  const artifact = {
    artifactVersion: 1,
    capturedAt,
    productionTarget: {
      provider,
      databaseNameMasked,
      region: null,
      postgresqlVersion: String(identity.server_version),
      ssl: Boolean(identity.ssl),
      sslVersion: identity.ssl_version ?? null,
      pooling: host.includes("pooler") || target.port === "6543" ? "DETECTED_BY_ENDPOINT" : "UNKNOWN",
      fingerprint: targetFingerprint,
      definitelyDifferentFromTestAndDevelopment: true,
    },
    readOnlyAccess: {
      status: "VERIFIED",
      transactionReadOnly: identity.transaction_read_only,
      roleFingerprint: createHash("sha256").update(String(identity.role_name)).digest("hex").slice(0, 12),
      privileges: {
        databaseCreate: false,
        schemaCreate: false,
        ...Object.fromEntries(Object.keys(mutationPrivileges).map((key) => [key, false])),
      },
    },
    schema: {
      currentRevision: schemaRevision,
      revision0095: await revisionApplied(95) ? "APPLIED" : "PENDING",
      revision0096: await revisionApplied(96) ? "APPLIED" : "PENDING",
      revision0097: await revisionApplied(97) ? "APPLIED" : "PENDING",
      tableCount: tableColumns.size,
      fingerprintSha256: schemaFingerprint,
    },
    financialBaseline: { sales, purchases, installments, cash, ledger, expenses, customerDebt, supplierDebt },
    businessCounts,
    inventory,
    integrityChecks: checks,
    integrityOverall: checks.some((item) => item.classification === "CRITICAL")
      ? "CRITICAL"
      : checks.some((item) => item.classification === "WARNING") ? "WARNING" : "OK",
  };

  await mkdir(new URL("../reports/", import.meta.url), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({
    status: "PASS",
    output: "reports/ajn-production-baseline.json",
    targetFingerprint,
    currentRevision: schemaRevision,
    integrityOverall: artifact.integrityOverall,
  }));
} finally {
  client?.release();
  await pool.end().catch(() => undefined);
}
