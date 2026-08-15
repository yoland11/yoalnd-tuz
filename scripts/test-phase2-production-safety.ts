import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl)
  throw new Error(
    "TEST_DATABASE_URL is required for Phase 2 integration tests",
  );
if (process.env.AJN_ENV !== "test" || process.env.ALLOW_TEST_WRITES !== "true")
  throw new Error(
    "Phase 2 database tests require AJN_ENV=test and ALLOW_TEST_WRITES=true",
  );
const parsedUrl = new URL(testUrl);
const databaseName = parsedUrl.pathname.replace(/^\//, "");
if (!/(^|[_-])test($|[_-])/i.test(databaseName))
  throw new Error(`Refusing non-test database: ${databaseName}`);

const schema = `ajn_phase2_${Date.now().toString(36)}_${randomUUID().slice(0, 6).replace(/-/g, "")}`;
const adminPool = new pg.Pool({ connectionString: testUrl, max: 1 });
const pass = (name: string) => console.log(`PASS  ${name}`);

try {
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  await adminPool.query(`SET search_path TO "${schema}", public`);
  const migrationFiles = (
    await readdir(new URL("../lib/db/migrations/", import.meta.url))
  )
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort((a, b) => a.localeCompare(b, "en"));
  const phase2Name = "0096_phase2_production_hardening.sql";
  for (const name of migrationFiles.filter((name) => name !== phase2Name)) {
    try {
      await adminPool.query(
        await readFile(
          new URL(`../lib/db/migrations/${name}`, import.meta.url),
          "utf8",
        ),
      );
    } catch (error) {
      throw new Error(`Migration ${name} failed`, { cause: error });
    }
  }
  pass("migration from the pre-Phase-2 schema succeeds through 0095");
  const phase2Sql = await readFile(
    new URL(`../lib/db/migrations/${phase2Name}`, import.meta.url),
    "utf8",
  );
  await adminPool.query(phase2Sql);
  pass("clean Phase 2 migration succeeds");
  await adminPool.query(phase2Sql);
  pass("Phase 2 migration is safe to rerun");
  const schemaFingerprint = async () =>
    JSON.stringify(
      (
        await adminPool.query(
          `
    SELECT 'column' kind, table_name object_name, column_name detail
      FROM information_schema.columns WHERE table_schema=$1
    UNION ALL
    SELECT 'index', tablename, indexname FROM pg_indexes WHERE schemaname=$1
    ORDER BY 1,2,3
  `,
          [schema],
        )
      ).rows,
    );
  const schemaBeforeRequests = await schemaFingerprint();

  parsedUrl.searchParams.set("options", `-c search_path=${schema},public`);
  process.env.DATABASE_URL = parsedUrl.toString();
  process.env.RATE_LIMIT_BACKEND = "postgres";
  process.env.ADMIN_BOOTSTRAP_ENABLED = "false";

  const { consumeRateLimit } = await import("../src/server/rate-limit");
  const first = await consumeRateLimit({
    action: "phase2-test",
    keyParts: ["instance-a", "shared-account"],
    limit: 2,
    windowMs: 60_000,
  });
  const second = await consumeRateLimit({
    action: "phase2-test",
    keyParts: ["instance-a", "shared-account"],
    limit: 2,
    windowMs: 60_000,
  });
  const blocked = await consumeRateLimit({
    action: "phase2-test",
    keyParts: ["instance-a", "shared-account"],
    limit: 2,
    windowMs: 60_000,
  });
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);
  pass("distributed rate limiter allows requests then enforces the threshold");
  const persisted = await adminPool.query(
    "select hit_count from rate_limit_buckets where action='phase2-test'",
  );
  assert.equal(Number(persisted.rows[0]?.hit_count), 3);
  pass("stateless limiter consumers share the PostgreSQL counter");

  const api = await import("../src/server/api");
  let limitedResponse: Response | null = null;
  for (let index = 0; index < 9; index += 1) {
    limitedResponse = await api.handleApi(
      new NextRequest("http://localhost/api/admin/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": "phase2-rate-limit",
        },
        body: JSON.stringify({
          username: "missing-phase2-user",
          password: "invalid",
        }),
      }),
      ["admin", "auth", "login"],
    );
  }
  assert.equal(limitedResponse?.status, 429);
  assert.ok(Number(limitedResponse?.headers.get("retry-after")) > 0);
  assert.equal((await limitedResponse!.json()).code, "RATE_LIMITED");
  pass("rate-limited API response is structured HTTP 429 with Retry-After");

  const one = async (query: string, values: unknown[] = []) =>
    (await adminPool.query(query, values)).rows[0];
  const suffix = randomUUID().slice(0, 8);
  const customerPhone = `077${Date.now().toString().slice(-8)}`;
  const customer = await one(
    "insert into customers(phone,name,full_name) values($1,'عميل اختبار','عميل اختبار') returning id",
    [customerPhone],
  );
  await adminPool.query(
    "insert into customer_accounts(customer_id,customer_code,username,phone_normalized,password_hash,recovery_code_hash,recovery_acknowledged_at) values($1,$2,$3,$4,$5,$6,now())",
    [
      customer.id,
      `C-${suffix}`,
      `customer_${suffix}`,
      customerPhone,
      bcrypt.hashSync("Customer-pass-42", 4),
      bcrypt.hashSync("RECOVERY", 4),
    ],
  );
  const customerLogin = await api.handleApi(
    new NextRequest("http://localhost/api/auth/customer/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identifier: `customer_${suffix}`,
        password: "Customer-pass-42",
      }),
    }),
    ["auth", "customer", "login"],
  );
  assert.equal(customerLogin.status, 200);
  pass("customer login remains functional with the distributed limiter");
  const staff = await one(
    "insert into staff(username,password_hash,full_name,role,permissions) values($1,'x','Representative','admin','[]'::jsonb) returning id",
    [`rep_${suffix}`],
  );
  const group = await one(
    "insert into graduation_groups(group_no,join_token,title) values($1,$2,'Phase 2 Group') returning id",
    [`G-${suffix}`, randomUUID()],
  );
  const order = await one(
    "insert into graduation_orders(order_no,student_code,qr_token,group_id,customer_name,phone,total_amount,paid_amount,remaining_amount,payment_status) values($1,$2,$3,$4,'طالب اختبار','07700000000',100,25,75,'partial') returning id",
    [`O-${suffix}`, `S-${suffix}`, randomUUID(), group.id],
  );
  const payment = await one(
    "insert into graduation_student_payments(payment_batch_id,idempotency_key,graduation_order_id,group_id,amount,received_by,received_by_name) values($1,$2,$3,$4,25,$5,'Representative') returning id",
    [randomUUID(), randomUUID(), order.id, group.id, staff.id],
  );
  const receipt = await one(
    "insert into graduation_receipts(receipt_no,receipt_type,graduation_order_id,group_id,payment_id,snapshot,issued_by,issued_by_name) values($1,'payment',$2,$3,$4,$5::jsonb,$6,'Representative') returning id",
    [
      `R-${suffix}`,
      order.id,
      group.id,
      payment.id,
      JSON.stringify({
        studentName: "طالب اختبار",
        studentCode: `S-${suffix}`,
        paymentAmount: 25,
        paymentMethod: "cash",
      }),
      staff.id,
    ],
  );
  const request = await one(
    "insert into representative_payment_requests(group_id,graduation_order_id,amount,payment_method,status,representative_id,representative_name,posted_payment_id,approved_by,approved_at) values($1,$2,25,'cash','approved',$3,'Representative',$4,$3,now()) returning id",
    [group.id, order.id, staff.id, payment.id],
  );
  const { handleRepresentativePortal } =
    await import("../src/server/representative");
  const representativeUser = {
    id: Number(staff.id),
    username: `rep_${suffix}`,
    fullName: "Representative",
    role: "admin",
    permissions: [],
    isActive: true,
  };
  const beforeReceipts = Number(
    (await one("select count(*)::int count from graduation_receipts")).count,
  );
  const printable = await handleRepresentativePortal(
    new NextRequest(
      `http://localhost/api/admin/representative/payments/${request.id}/receipt`,
    ),
    ["payments", String(request.id), "receipt"],
    representativeUser,
  );
  assert.equal(printable?.status, 200);
  assert.equal((await printable!.json()).receipt.receiptNo, `R-${suffix}`);
  const afterReceipts = Number(
    (await one("select count(*)::int count from graduation_receipts")).count,
  );
  assert.equal(afterReceipts, beforeReceipts);
  assert.ok(receipt.id);
  pass(
    "authorized representative obtains the existing printable receipt without duplicate mutation",
  );
  const unauthorized = await handleRepresentativePortal(
    new NextRequest(
      `http://localhost/api/admin/representative/payments/${request.id}/receipt`,
    ),
    ["payments", String(request.id), "receipt"],
    { ...representativeUser, role: "employee", permissions: [] },
  );
  assert.equal(unauthorized?.status, 403);
  pass("unauthorized representative cannot obtain a receipt");
  assert.equal(await schemaFingerprint(), schemaBeforeRequests);
  pass("application requests perform no schema DDL");
} finally {
  await adminPool
    .query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    .catch(() => undefined);
  await adminPool.end();
}
