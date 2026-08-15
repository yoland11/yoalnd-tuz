import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import pg from "pg";

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error("TEST_DATABASE_URL is required for Phase 3 integration tests");
if (process.env.AJN_ENV !== "test" || process.env.ALLOW_TEST_WRITES !== "true")
  throw new Error("Phase 3 database tests require AJN_ENV=test and ALLOW_TEST_WRITES=true");
const parsedTestUrl = new URL(testUrl);
const databaseName = parsedTestUrl.pathname.replace(/^\//, "");
if (!/(^|[_-])test($|[_-])/i.test(databaseName))
  throw new Error(`Refusing non-test database: ${databaseName}`);
if (process.env.DATABASE_URL && process.env.DATABASE_URL !== testUrl)
  throw new Error("DATABASE_URL must be unset or equal TEST_DATABASE_URL during Phase 3 tests");

const suffix = `${Date.now().toString(36)}_${randomUUID().slice(0, 6).replace(/-/g, "")}`;
const cleanDatabase = `ajn_phase3_clean_test_${suffix}`;
const upgradeDatabase = `ajn_phase3_upgrade_test_${suffix}`;
const adminPool = new pg.Pool({ connectionString: testUrl, max: 2 });
let cleanPool: pg.Pool | undefined;
let upgradePool: pg.Pool | undefined;
const migrationNames = (await readdir(new URL("../lib/db/migrations/", import.meta.url)))
  .filter((name) => /^\d+.*\.sql$/.test(name))
  .sort((a, b) => a.localeCompare(b, "en"));
const pass = (name: string) => console.log(`PASS  ${name}`);

function databaseUrl(name: string) {
  const url = new URL(testUrl!);
  url.pathname = `/${name}`;
  url.searchParams.delete("options");
  return url.toString();
}

async function applyMigrations(pool: pg.Pool, database: string, names: string[]) {
  for (const name of names) {
    try {
      await pool.query(await readFile(new URL(`../lib/db/migrations/${name}`, import.meta.url), "utf8"));
    } catch (error) {
      throw new Error(`Migration ${name} failed in ${database}`, { cause: error });
    }
  }
}

async function one(text: string, values: unknown[] = []) {
  if (!cleanPool) throw new Error("Clean test database is not connected");
  return (await cleanPool.query(text, values)).rows[0];
}

async function oneUpgrade(text: string, values: unknown[] = []) {
  if (!upgradePool) throw new Error("Upgrade test database is not connected");
  return (await upgradePool.query(text, values)).rows[0];
}

async function dropDisposableDatabase(name: string) {
  if (!/^ajn_phase3_(clean|upgrade)_test_[a-z0-9_]+$/.test(name))
    throw new Error(`Refusing to drop unexpected database: ${name}`);
  await adminPool.query(
    "select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()",
    [name],
  );
  await adminPool.query(`DROP DATABASE IF EXISTS "${name}"`);
}

try {
  await adminPool.query(`CREATE DATABASE "${cleanDatabase}" TEMPLATE template0`);
  await adminPool.query(`CREATE DATABASE "${upgradeDatabase}" TEMPLATE template0`);
  cleanPool = new pg.Pool({ connectionString: databaseUrl(cleanDatabase), max: 2 });
  upgradePool = new pg.Pool({ connectionString: databaseUrl(upgradeDatabase), max: 2 });

  // Scenario A: full clean migration chain.
  await applyMigrations(cleanPool, cleanDatabase, migrationNames);
  pass(`clean database applies all ${migrationNames.length} migrations in order`);
  const requiredTables = [
    "admin_sessions", "ajn_schema_revisions", "customer_sessions", "financial_ledger_entries",
    "financial_transactions", "graduation_receipts", "installment_contracts", "installment_payments",
    "rate_limit_buckets", "representative_payment_requests", "research_files", "sales_invoices",
  ];
  const existingTables = (await cleanPool.query(
    "select table_name from information_schema.tables where table_schema=$1 and table_name=any($2::text[])",
    ["public", requiredTables],
  )).rows.map((row) => row.table_name).sort();
  assert.deepEqual(existingTables, [...requiredTables].sort());
  const requiredColumns = [
    ["admin_sessions", "token_hash"], ["admin_sessions", "revoked_at"],
    ["installment_payments", "financial_transaction_id"], ["installment_payments", "idempotency_key"],
    ["rate_limit_buckets", "reset_at"], ["financial_transactions", "idempotency_key"],
  ];
  for (const [table, column] of requiredColumns) {
    const row = await one(
      "select exists(select 1 from information_schema.columns where table_schema=$1 and table_name=$2 and column_name=$3) present",
      ["public", table, column],
    );
    assert.equal(row.present, true, `${table}.${column} missing`);
  }
  const requiredIndexes = [
    "admin_sessions_token_hash_idx", "financial_ledger_entries_unique_idx",
    "financial_transactions_idempotency_idx", "installment_payments_financial_transaction_idx",
    "rate_limit_buckets_reset_at_idx", "sales_invoices_idempotency_key_idx",
  ];
  const existingIndexes = (await cleanPool.query(
    "select indexname from pg_indexes where schemaname=$1 and indexname=any($2::text[])",
    ["public", requiredIndexes],
  )).rows.map((row) => row.indexname).sort();
  assert.deepEqual(existingIndexes, [...requiredIndexes].sort());
  assert.equal((await one("select exists(select 1 from ajn_schema_revisions where revision=97) present")).present, true);
  pass("required Phase 1/2 tables, columns, indexes, constraints, and revision marker exist");

  process.env.DATABASE_URL = databaseUrl(cleanDatabase);
  const databaseSchema = await import("@workspace/db");
  const { getTableColumns, getTableName, is } = await import("drizzle-orm");
  const { PgTable } = await import("drizzle-orm/pg-core");
  const expectedTables = new Map<string, string[]>();
  for (const candidate of Object.values(databaseSchema)) {
    if (!is(candidate, PgTable)) continue;
    expectedTables.set(
      getTableName(candidate),
      Object.values(getTableColumns(candidate)).map((column) => column.name).sort(),
    );
  }
  const schemaRows = (await cleanPool.query(
    "select table_name,column_name from information_schema.columns where table_schema='public' order by table_name,column_name",
  )).rows as Array<{ table_name: string; column_name: string }>;
  const actualColumns = new Map<string, Set<string>>();
  for (const row of schemaRows) {
    const columns = actualColumns.get(row.table_name) ?? new Set<string>();
    columns.add(row.column_name);
    actualColumns.set(row.table_name, columns);
  }
  const drift: string[] = [];
  for (const [table, columns] of expectedTables) {
    if (!actualColumns.has(table)) {
      drift.push(`missing table ${table}`);
      continue;
    }
    for (const column of columns) {
      if (!actualColumns.get(table)!.has(column)) drift.push(`missing column ${table}.${column}`);
    }
  }
  assert.deepEqual(drift, [], `Drizzle/migration schema drift:\n${drift.join("\n")}`);
  pass(`all ${expectedTables.size} Drizzle tables and their columns exist after a clean migration`);

  // Scenario B: representative records immediately before Phase 1/2 survive 0095/0096.
  const preHardening = migrationNames.filter((name) => name < "0095_");
  await applyMigrations(upgradePool, upgradeDatabase, preHardening);
  const marker = `phase3_${suffix}`;
  const legacyStaff = await oneUpgrade(
    "insert into staff(username,password_hash,full_name,role,permissions,is_active) values($1,'legacy-hash','Legacy Disabled','employee','[]'::jsonb,false) returning id",
    [`${marker}_staff`],
  );
  const legacyCustomer = await oneUpgrade(
    "insert into customers(phone,name,full_name) values($1,'Legacy Customer','Legacy Customer') returning id",
    [`077${Date.now().toString().slice(-8)}`],
  );
  const legacyInvoice = await oneUpgrade(
    "insert into sales_invoices(invoice_no,date,customer_name,customer_id,total,paid_amount,remaining_amount,payment_status,status,created_by_name) values($1,current_date,'Legacy Customer',$2,125,25,100,'partial','active','Legacy') returning id",
    [`${marker}_invoice`, legacyCustomer.id],
  );
  await applyMigrations(upgradePool, upgradeDatabase, migrationNames.filter((name) => name >= "0095_"));
  const survived = await oneUpgrade(
    "select s.role,s.is_active,c.full_name,i.total,i.paid_amount,i.remaining_amount from staff s cross join customers c cross join sales_invoices i where s.id=$1 and c.id=$2 and i.id=$3",
    [legacyStaff.id, legacyCustomer.id, legacyInvoice.id],
  );
  assert.equal(survived.role, "employee");
  assert.equal(survived.is_active, false);
  assert.equal(survived.full_name, "Legacy Customer");
  assert.equal(Number(survived.total), 125);
  assert.equal(Number(survived.paid_amount), 25);
  assert.equal(Number(survived.remaining_amount), 100);
  pass("upgrade through 0095/0096 preserves disabled/demoted staff, customer, and invoice financial data");
  const phase2Sql = await readFile(new URL("../lib/db/migrations/0096_phase2_production_hardening.sql", import.meta.url), "utf8");
  await upgradePool.query(phase2Sql);
  assert.equal((await oneUpgrade("select count(*)::int count from ajn_schema_revisions where revision=96")).count, 1);
  assert.equal((await oneUpgrade("select count(*)::int count from ajn_schema_revisions where revision=97")).count, 1);
  pass("0096 is idempotent when deployment retries it and 0097 is recorded exactly once");

  // Run application-level verification against the disposable clean schema.
  process.env.DATABASE_URL = databaseUrl(cleanDatabase);
  process.env.RATE_LIMIT_BACKEND = "postgres";
  process.env.AUTH_SECRET = "phase3-test-auth-secret-with-at-least-32-chars";
  process.env.ADMIN_BOOTSTRAP_ENABLED = "false";
  process.env.SUPABASE_URL = "https://phase3-test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "phase3-test-service-role-key-with-32-chars";
  process.env.SUPABASE_STORAGE_BUCKET = "ajn-assets";
  process.env.AJN_RESEARCH_PRIVATE_BUCKET = "ajn-private";
  process.env.AJN_DOCUMENT_PRIVATE_BUCKET = "ajn-private";
  // pnpm --filter executes this suite from lib/db; make the real application
  // assets explicit so invoice PDF generation is exercised, not skipped.
  process.env.AJN_PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));

  const { productionEnvironmentIssues } = await import("../src/server/production-env");
  const validProduction = {
    NODE_ENV: "production", AJN_ENV: "production", DATABASE_URL: "postgresql://ajn:strong-secret@db.ajn.example:5432/ajn",
    AUTH_SECRET: "a".repeat(48), APP_BASE_URL: "https://ajn.example", CRON_SECRET: "c".repeat(48),
    SUPABASE_URL: "https://storage.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "s".repeat(48),
    SUPABASE_STORAGE_BUCKET: "ajn-assets",
    AJN_CUSTOMER_PRIVATE_BUCKET: "ajn-private", RATE_LIMIT_BACKEND: "postgres", ADMIN_BOOTSTRAP_ENABLED: "false",
    ULTRAMSG_INSTANCE_ID: "instance-123", ULTRAMSG_TOKEN: "u".repeat(48),
  };
  assert.deepEqual(productionEnvironmentIssues(validProduction), []);
  const unsafeIssues = productionEnvironmentIssues({
    ...validProduction, DATABASE_URL: "postgresql://postgres:password@localhost:5432/ajn_test",
    TEST_DATABASE_URL: "postgresql://postgres:password@localhost:5432/ajn_test", RATE_LIMIT_BACKEND: "memory",
    AUTH_SECRET: "replace-with-secret", APP_BASE_URL: "http://localhost:3000", ADMIN_BOOTSTRAP_ENABLED: "true",
  });
  assert.ok(unsafeIssues.some((issue) => issue.includes("test database")));
  assert.ok(unsafeIssues.some((issue) => issue.includes("localhost")));
  assert.ok(unsafeIssues.some((issue) => issue.includes("RATE_LIMIT_BACKEND")));
  assert.ok(unsafeIssues.some((issue) => issue.includes("placeholder")));
  assert.ok(unsafeIssues.some((issue) => issue.includes("ADMIN_USERNAME")));
  assert.ok(unsafeIssues.some((issue) => issue.includes("ADMIN_PASSWORD")));
  assert.deepEqual(productionEnvironmentIssues({
    ...validProduction,
    ADMIN_BOOTSTRAP_ENABLED: "true",
    ADMIN_USERNAME: "initial-admin",
    ADMIN_PASSWORD: "B".repeat(40),
  }), []);
  pass("production environment rejects test/local databases, memory limits, placeholders, HTTP origins, and incomplete bootstrap credentials");

  const { safeServerError } = await import("../src/server/safe-server-log");
  const redactedLog = safeServerError(new Error("failed postgresql://admin:db-secret@db.example/ajn token=raw-token\nparams: customer-secret"));
  assert.doesNotMatch(redactedLog.message, /db-secret|raw-token|customer-secret/);
  assert.match(redactedLog.message, /REDACTED/);
  pass("server error logging strips connection credentials, tokens, and SQL parameter payloads");

  const { cleanupExpiredRateLimits } = await import("../src/server/rate-limit");
  await cleanPool.query(
    `insert into rate_limit_buckets(key_hash,action,hit_count,window_started_at,reset_at,updated_at) values
      ('${"a".repeat(64)}','active',1,now(),now()+interval '1 hour',now()),
      ('${"b".repeat(64)}','recent-expired',1,now()-interval '2 hours',now()-interval '30 minutes',now()),
      ('${"c".repeat(64)}','stale-expired',1,now()-interval '3 days',now()-interval '2 days',now())`,
  );
  const cleanup = await cleanupExpiredRateLimits({ limit: 10, retentionMs: 24 * 60 * 60 * 1_000 });
  assert.equal(cleanup.deleted, 1);
  const remainingBuckets = (await cleanPool.query("select action from rate_limit_buckets order by action")).rows.map((row) => row.action);
  assert.deepEqual(remainingBuckets, ["active", "recent-expired"]);
  assert.equal((await cleanupExpiredRateLimits({ limit: 10, retentionMs: 24 * 60 * 60 * 1_000 })).deleted, 0);
  pass("bounded rate-limit cleanup is rerunnable and never deletes active or recently expired buckets");

  const { validateResearchFileData, handleAdminResearch } = await import("../src/server/research-center");
  const pdfData = `data:application/pdf;base64,${Buffer.from("%PDF-1.7\nphase3").toString("base64")}`;
  assert.equal(validateResearchFileData(pdfData, "report.pdf", "application/pdf").mime, "application/pdf");
  assert.throws(() => validateResearchFileData(`data:text/html;base64,${Buffer.from("<script>alert(1)</script>").toString("base64")}`, "report.html", "text/html"), /نوع الملف غير مدعوم/);
  assert.throws(() => validateResearchFileData(pdfData, "report.svg", "application/pdf"), /امتداد الملف/);
  assert.throws(() => validateResearchFileData(pdfData, "report.pdf", "image/png"), /لا يطابق/);
  pass("research uploads enforce size/type/extension/signature and reject executable content");

  const researchStaff = await one(
    "insert into staff(username,password_hash,full_name,role,permissions,is_active) values($1,'phase3-hash','Phase 3','admin','[\"research\",\"accounting\"]'::jsonb,true) returning id,username",
    [`research_${suffix}`],
  );
  const researchUser = { id: Number(researchStaff.id), username: String(researchStaff.username), fullName: "Phase 3", role: "admin", permissions: ["research", "accounting"], isActive: true };
  const researchPayload = {
    customerName: "عميل المرحلة الثالثة", phone: `078${Date.now().toString().slice(-8)}`, title: `بحث أمان ${suffix}`,
    researchType: "graduation", universityName: "جامعة اختبار", language: "ar", researchField: "اختبار",
    requiredPages: 20, citationStyle: "APA7", urgency: "normal", estimatedPrice: 100, deposit: 25, files: [],
  };
  const originalFetch = globalThis.fetch;
  const storageCalls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    storageCalls.push(url);
    if (url.includes("/storage/v1/object/sign/"))
      return Response.json({ signedURL: "/storage/v1/object/sign/ajn-private/research/test.pdf?token=phase3" });
    if (url.includes("/storage/v1/object/ajn-private/"))
      return new Response("{}", { status: 201, headers: { "content-type": "application/json" } });
    throw new Error(`Unexpected Phase 3 storage request: ${url}`);
  }) as typeof fetch;
  try {
    const privateFileOrder = await handleAdminResearch(
      new NextRequest("http://localhost/api/admin/research/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        ...researchPayload,
        phone: `077${Date.now().toString().slice(-8)}`,
        title: `بحث ملف خاص ${suffix}`,
        deposit: 0,
        files: [{ title: "private.pdf", fileName: "private.pdf", fileUrl: pdfData, mimeType: "application/pdf", fileType: "customer_upload" }],
      }) }),
      ["admin", "research", "orders"], researchUser,
    );
    assert.equal(privateFileOrder?.status, 201);
    const privateOrderId = (await privateFileOrder!.json()).order.id;
    const storedPrivate = await one("select file_url from research_files where research_order_id=$1", [privateOrderId]);
    assert.match(storedPrivate.file_url, /^private:research\//);
    const privateDetail = await handleAdminResearch(
      new NextRequest(`http://localhost/api/admin/research/orders/${privateOrderId}`),
      ["admin", "research", "orders", String(privateOrderId)], researchUser,
    );
    const privateDetailBody = await privateDetail!.json();
    assert.match(privateDetailBody.files[0].fileUrl, /token=phase3/);
    assert.ok(storageCalls.some((url) => url.includes("/object/ajn-private/research/")));
    assert.ok(storageCalls.some((url) => url.includes("/object/sign/ajn-private/research/")));
    pass("new research documents use private storage and are exposed only through short-lived signed URLs");
    const { uploadDocumentAsset } = await import("../src/server/document-scanner");
    const onePixelPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const privateDocument = await uploadDocumentAsset(onePixelPng, 42);
    assert.match(String(privateDocument.storagePath), /^secure-documents-v2\//);
    assert.ok(storageCalls.some((url) => url.includes("/object/ajn-private/secure-documents-v2/")));
    pass("new scanned documents use private storage while legacy paths remain separately readable");
  } finally {
    globalThis.fetch = originalFetch;
  }
  const createdResearch = await handleAdminResearch(
    new NextRequest("http://localhost/api/admin/research/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(researchPayload) }),
    ["admin", "research", "orders"], researchUser,
  );
  assert.equal(createdResearch?.status, 201);
  const createdResearchBody = await createdResearch!.json();
  const researchFinancial = await one(
    `select r.paid_amount research_paid,i.paid_amount invoice_paid,f.approval_status,
      (select count(*)::int from financial_ledger_entries l where l.transaction_id=f.id) ledger_count
     from research_orders r join sales_invoices i on i.id=r.invoice_id
     join financial_transactions f on f.source_type='research_order' and f.source_id=r.id::text
     where r.id=$1`, [createdResearchBody.order.id],
  );
  assert.equal(Number(researchFinancial.research_paid), 25);
  assert.equal(Number(researchFinancial.invoice_paid), 25);
  assert.equal(researchFinancial.approval_status, "executed");
  assert.equal(researchFinancial.ledger_count, 2);
  pass("research deposit saves order, invoice, cash movement, and ledger atomically");

  const researchPaymentKey = `phase3-research-${randomUUID()}`;
  const researchPaymentBody = JSON.stringify({ amount: 10, paymentMethod: "cash", idempotencyKey: researchPaymentKey });
  const firstResearchPayment = await handleAdminResearch(
    new NextRequest(`http://localhost/api/admin/research/orders/${createdResearchBody.order.id}/payment`, { method: "POST", headers: { "content-type": "application/json" }, body: researchPaymentBody }),
    ["admin", "research", "orders", String(createdResearchBody.order.id), "payment"], researchUser,
  );
  const retriedResearchPayment = await handleAdminResearch(
    new NextRequest(`http://localhost/api/admin/research/orders/${createdResearchBody.order.id}/payment`, { method: "POST", headers: { "content-type": "application/json" }, body: researchPaymentBody }),
    ["admin", "research", "orders", String(createdResearchBody.order.id), "payment"], researchUser,
  );
  assert.equal(firstResearchPayment?.status, 200);
  assert.equal(retriedResearchPayment?.status, 200);
  assert.equal((await retriedResearchPayment!.json()).duplicate, true);
  const retryState = await one(
    `select r.paid_amount,
      (select count(*)::int from financial_transactions where idempotency_key=$2) transaction_count,
      (select count(*)::int from financial_ledger_entries l join financial_transactions f on f.id=l.transaction_id where f.idempotency_key=$2) ledger_count
     from research_orders r where r.id=$1`,
    [createdResearchBody.order.id, `research-payment:${createdResearchBody.order.id}:${researchPaymentKey}`],
  );
  assert.equal(Number(retryState.paid_amount), 35);
  assert.equal(retryState.transaction_count, 1);
  assert.equal(retryState.ledger_count, 2);
  pass("research payment retry preserves one payment movement and one balanced ledger entry pair");

  await cleanPool.query(`create or replace function phase3_reject_research_finance() returns trigger language plpgsql as $$ begin if new.source_type='research_order' then raise exception 'phase3 accounting failure'; end if; return new; end $$`);
  await cleanPool.query("create trigger phase3_reject_research_finance before insert on financial_transactions for each row execute function phase3_reject_research_finance() ");
  const failedTitle = `بحث فشل ${suffix}`;
  const failedResearch = await handleAdminResearch(
    new NextRequest("http://localhost/api/admin/research/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...researchPayload, phone: `079${Date.now().toString().slice(-8)}`, title: failedTitle }) }),
    ["admin", "research", "orders"], researchUser,
  );
  assert.equal(failedResearch?.status, 500);
  assert.equal((await one("select count(*)::int count from research_orders where title=$1", [failedTitle])).count, 0);
  await cleanPool.query("drop trigger phase3_reject_research_finance on financial_transactions");
  await cleanPool.query("drop function phase3_reject_research_finance()");
  pass("research accounting failure rolls back the order and invoice instead of leaving a partial financial state");

  const { generateInvoicePdf } = await import("../src/server/telegram");
  const invoicePdf = await generateInvoicePdf({
    id: 1,
    invoiceNo: `PHASE3-${suffix}`,
    date: new Date(),
    total: 100,
    discountAmount: 0,
    paidAmount: 100,
    remainingAmount: 0,
    paymentMethod: "cash",
    items: [],
  });
  assert.equal(invoicePdf.subarray(0, 4).toString("ascii"), "%PDF");
  pass("invoice PDF generation uses the bundled Arabic fonts from the filtered test workspace");

  const api = await import("../src/server/api");
  const adminPassword = "Phase3-admin-pass-42";
  await cleanPool.query("update staff set password_hash=$2 where id=$1", [researchStaff.id, bcrypt.hashSync(adminPassword, 4)]);
  const adminSession = await api.createSession(Number(researchStaff.id));
  const saleProduct = await one(
    "insert into products(name,name_ar,price,cost_price,stock,min_stock,is_active) values($1,$1,100,50,10,0,true) returning id,stock",
    [`Phase 3 product ${suffix}`],
  );
  const saleIdempotencyKey = `phase3-sale-${randomUUID()}`;
  const salePayload = JSON.stringify({
    customerName: "Phase 3 cash customer",
    useCashCustomer: true,
    paymentMethod: "cash",
    paidAmount: 0,
    discountAmount: 0,
    taxAmount: 0,
    items: [{ productId: saleProduct.id, productName: `Phase 3 product ${suffix}`, quantity: 2, unitPrice: 100, costPrice: 50, discount: 0, discountPct: 0 }],
  });
  const saleRequest = () => new NextRequest("http://localhost/api/admin/sales-invoices", {
    method: "POST",
    headers: { authorization: `Bearer ${adminSession.token}`, "content-type": "application/json", "x-idempotency-key": saleIdempotencyKey },
    body: salePayload,
  });
  const createdSale = await api.handleApi(saleRequest(), ["admin", "sales-invoices"]);
  assert.equal(createdSale.status, 201);
  const createdSaleBody = await createdSale.json();
  const retriedSale = await api.handleApi(saleRequest(), ["admin", "sales-invoices"]);
  assert.equal(retriedSale.status, 201);
  assert.equal((await retriedSale.json()).id, createdSaleBody.id);
  assert.equal(Number((await one("select stock from products where id=$1", [saleProduct.id])).stock), 8);
  assert.equal((await one("select count(*)::int count from sales_invoices where idempotency_key=$1", [saleIdempotencyKey])).count, 1);
  const printableSale = await api.handleApi(
    new NextRequest(`http://localhost/api/admin/sales-invoices/${createdSaleBody.id}`, { headers: { authorization: `Bearer ${adminSession.token}` } }),
    ["admin", "sales-invoices", String(createdSaleBody.id)],
  );
  assert.equal(printableSale.status, 200);
  const printableSaleBody = await printableSale.json();
  assert.equal(printableSaleBody.items.length, 1);
  assert.ok(printableSaleBody.qr);
  const cancelledSale = await api.handleApi(
    new NextRequest(`http://localhost/api/admin/sales-invoices/${createdSaleBody.id}/cancel`, {
      method: "POST",
      headers: { authorization: `Bearer ${adminSession.token}`, "content-type": "application/json" },
      body: JSON.stringify({ reason: "Phase 3 cancellation verification", password: adminPassword, confirmed: true }),
    }),
    ["admin", "sales-invoices", String(createdSaleBody.id), "cancel"],
  );
  assert.equal(cancelledSale.status, 200);
  assert.equal(Number((await one("select stock from products where id=$1", [saleProduct.id])).stock), 10);
  assert.equal((await one("select status from sales_invoices where id=$1", [createdSaleBody.id])).status, "cancelled");
  pass("sale creation, retry, stock deduction, printable invoice view, and cancellation restoration work end to end");

  const publicResearch = await api.handleApi(
    new NextRequest(`http://localhost/api/research/track/${createdResearchBody.order.qrToken}`),
    ["research", "track", createdResearchBody.order.qrToken],
  );
  assert.equal(publicResearch.status, 200);
  const publicResearchBody = await publicResearch.json();
  for (const sensitiveField of ["customerId", "invoiceId", "createdBy", "assignedWriterId", "notes"])
    assert.equal(sensitiveField in publicResearchBody.order, false, `public research tracking leaked ${sensitiveField}`);
  assert.equal("uploadedBy" in (publicResearchBody.files[0] ?? {}), false);
  const invalidResearch = await api.handleApi(
    new NextRequest("http://localhost/api/research/track/not-a-valid-research-token"),
    ["research", "track", "not-a-valid-research-token"],
  );
  assert.equal(invalidResearch.status, 404);
  let throttledStatus = 0;
  for (let attempt = 0; attempt < 61 && throttledStatus !== 429; attempt += 1) {
    throttledStatus = (await api.handleApi(
      new NextRequest("http://localhost/api/research/track/not-a-valid-research-token"),
      ["research", "track", "not-a-valid-research-token"],
    )).status;
  }
  assert.equal(throttledStatus, 429);
  pass("public research tracking exposes only its intended projection and enforces distributed enumeration limits");

  const noAuth = await api.handleApi(new NextRequest("http://localhost/api/admin/installments/dashboard"), ["admin", "installments", "dashboard"]);
  assert.equal(noAuth.status, 401);
  const employee = await one(
    "insert into staff(username,password_hash,full_name,role,permissions,is_active) values($1,$2,'No Finance','employee','[]'::jsonb,true) returning id",
    [`employee_${suffix}`, bcrypt.hashSync("Phase3-pass-42", 4)],
  );
  const employeeSession = await api.createSession(Number(employee.id));
  const denied = await api.handleApi(
    new NextRequest("http://localhost/api/admin/installments/dashboard", { headers: { authorization: `Bearer ${employeeSession.token}` } }),
    ["admin", "installments", "dashboard"],
  );
  assert.equal(denied.status, 403);
  await cleanPool.query("update staff set permissions='[\"installments.view\"]'::jsonb where id=$1", [employee.id]);
  const allowed = await api.handleApi(
    new NextRequest("http://localhost/api/admin/installments/dashboard", { headers: { authorization: `Bearer ${employeeSession.token}` } }),
    ["admin", "installments", "dashboard"],
  );
  assert.equal(allowed.status, 200);
  pass("sensitive installment route distinguishes authentication from granular authorization");

  const restrictedRoutes = [
    ["master cash", ["admin", "master-cash", "dashboard"]],
    ["expenses", ["admin", "expenses"]],
    ["sales invoices", ["admin", "sales-invoices"]],
    ["purchase invoices", ["admin", "purchase-invoices"]],
    ["staff administration", ["admin", "staff"]],
    ["admin settings", ["admin", "settings"]],
    ["research documents", ["admin", "research", "dashboard"]],
    ["representative portal", ["admin", "representative", "dashboard"]],
  ] as const;
  for (const [label, parts] of restrictedRoutes) {
    const path = parts.slice(1).join("/");
    const unauthenticated = await api.handleApi(new NextRequest(`http://localhost/api/admin/${path}`), [...parts]);
    assert.equal(unauthenticated.status, 401, `${label} must reject unauthenticated access`);
    const unauthorized = await api.handleApi(
      new NextRequest(`http://localhost/api/admin/${path}`, { headers: { authorization: `Bearer ${employeeSession.token}` } }),
      [...parts],
    );
    assert.equal(unauthorized.status, 403, `${label} must reject an authenticated employee without permission`);
  }
  pass("finance, expenses, invoices, staff, settings, research, and representative routes enforce authorization after authentication");

  const customerPassword = "Customer-pass-42";
  const customers: Array<{ id: number; accountId: number; username: string; phone: string; token?: string }> = [];
  for (const label of ["a", "b"]) {
    const phone = `075${randomUUID().replace(/\D/g, "").slice(0, 8).padEnd(8, label === "a" ? "1" : "2")}`;
    const customer = await one("insert into customers(phone,name,full_name) values($1,$2,$2) returning id", [phone, `Customer ${label}`]);
    const username = `customer_${label}_${suffix}`;
    const account = await one(
      "insert into customer_accounts(customer_id,customer_code,username,phone_normalized,password_hash,link_status,recovery_code_hash,recovery_acknowledged_at) values($1,$2,$3,$4,$5,'linked',$6,now()) returning id",
      [customer.id, `C-${label}-${suffix}`, username, phone, bcrypt.hashSync(customerPassword, 4), bcrypt.hashSync("RECOVERY", 4)],
    );
    customers.push({ id: customer.id, accountId: account.id, username, phone });
  }
  for (const customer of customers) {
    const login = await api.handleApi(
      new NextRequest("http://localhost/api/auth/customer/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier: customer.username, password: customerPassword }) }),
      ["auth", "customer", "login"],
    );
    assert.equal(login.status, 200);
    const sessionCookie = login.headers.get("set-cookie")?.match(/ajn_customer_session=([^;]+)/)?.[1];
    assert.ok(sessionCookie, "customer login must issue an HttpOnly session cookie");
    customer.token = decodeURIComponent(sessionCookie);
  }
  const orderIds: number[] = [];
  for (const [index, customer] of customers.entries()) {
    const saved = await one(
      "insert into orders(tracking_code,customer_id,customer_name,customer_phone,total,deposit_amount,remaining_amount,status) values($1,$2,$3,$4,10,0,10,'pending') returning id",
      [`AJN-${randomUUID().replace(/-/g, "").toUpperCase()}`, customer.id, `Customer ${index}`, customer.phone],
    );
    orderIds.push(saved.id);
  }
  const mine = await api.handleApi(
    new NextRequest("http://localhost/api/orders/my", { headers: { cookie: `ajn_customer_session=${customers[0].token}` } }),
    ["orders", "my"],
  );
  assert.equal(mine.status, 200);
  const mineIds = (await mine.json()).filter((row: any) => row.kind === "order").map((row: any) => row.id);
  assert.ok(mineIds.includes(orderIds[0]));
  assert.ok(!mineIds.includes(orderIds[1]));
  pass("customer order listing resists horizontal ID/customer manipulation");

  const adminLogin = await api.handleApi(
    new NextRequest("http://localhost/api/admin/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: researchUser.username, password: adminPassword, forceReplace: true }),
    }),
    ["admin", "auth", "login"],
  );
  assert.equal(adminLogin.status, 200);
  const adminCookie = adminLogin.headers.get("set-cookie")?.match(/ajn_admin_session=([^;]+)/)?.[1];
  assert.ok(adminCookie, "admin login must issue its HttpOnly session cookie");
  const authenticatedMe = await api.handleApi(
    new NextRequest("http://localhost/api/admin/auth/me", { headers: { cookie: `ajn_admin_session=${adminCookie}` } }),
    ["admin", "auth", "me"],
  );
  assert.equal(authenticatedMe.status, 200);
  const adminLogout = await api.handleApi(
    new NextRequest("http://localhost/api/admin/auth/logout", { method: "POST", headers: { cookie: `ajn_admin_session=${adminCookie}` } }),
    ["admin", "auth", "logout"],
  );
  assert.equal(adminLogout.status, 200);
  const revokedMe = await api.handleApi(
    new NextRequest("http://localhost/api/admin/auth/me", { headers: { cookie: `ajn_admin_session=${adminCookie}` } }),
    ["admin", "auth", "me"],
  );
  assert.equal(revokedMe.status, 401);
  pass("administrator login, authorized session use, logout, and post-logout rejection work end to end");

  const { db, getPool } = await import("@workspace/db");
  const beforeRollback = Number((await one("select count(*)::int count from settings where key like 'phase3-rollback-%'")).count);
  await assert.rejects(() => db.transaction(async (tx) => {
    await tx.execute((await import("drizzle-orm")).sql`insert into settings(key,value) values(${`phase3-rollback-${suffix}`},'{}'::jsonb)`);
    throw new Error("forced rollback");
  }), /forced rollback/);
  const afterRollback = Number((await one("select count(*)::int count from settings where key like 'phase3-rollback-%'")).count);
  assert.equal(afterRollback, beforeRollback);
  assert.equal(getPool().options.max, 5);
  pass("database transaction releases on failure and singleton serverless pool remains bounded at max=5");
} finally {
  if (process.env.DATABASE_URL) {
    const workspaceDb = await import("@workspace/db").catch(() => undefined);
    await workspaceDb?.getPool?.().end().catch(() => undefined);
  }
  await cleanPool?.end().catch(() => undefined);
  await upgradePool?.end().catch(() => undefined);
  await dropDisposableDatabase(cleanDatabase).catch(() => undefined);
  await dropDisposableDatabase(upgradeDatabase).catch(() => undefined);
  await adminPool.end();
}
