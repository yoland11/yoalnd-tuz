import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error("TEST_DATABASE_URL is required");
if (process.env.AJN_ENV !== "test" || process.env.ALLOW_TEST_WRITES !== "true")
  throw new Error(
    "Database writes require AJN_ENV=test and ALLOW_TEST_WRITES=true",
  );
const databaseName = new URL(testUrl).pathname.replace(/^\//, "");
if (!/(^|[_-])test($|[_-])/i.test(databaseName))
  throw new Error(`Refusing non-test database: ${databaseName}`);
process.env.DATABASE_URL = testUrl;

const { pool } = await import("@workspace/db");
for (const migration of [
  "0082_installment_management.sql",
  "0095_production_safety.sql",
  "0096_phase2_production_hardening.sql",
])
  await pool.query(
    await readFile(
      new URL(`../lib/db/migrations/${migration}`, import.meta.url),
      "utf8",
    ),
  );

const api = await import("../src/server/api");
const { adminSessionTokenHash } =
  await import("../src/server/admin-session-security");
const { loadPublicSettings } = await import("../src/server/public-settings");
const {
  postInstallmentPayment,
  reconcileInstallmentPayments,
  handleInstallments,
} = await import("../src/server/installments");

const pass = (name: string) => console.log(`PASS  ${name}`);
const one = async (text: string, values: unknown[] = []) =>
  (await pool.query(text, values)).rows[0];
const prefix = `s${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;

try {
  // Bootstrap is explicit, one-time, and never repairs an existing account.
  process.env.ADMIN_BOOTSTRAP_ENABLED = "true";
  process.env.ADMIN_USERNAME = `${prefix}_admin`;
  process.env.ADMIN_PASSWORD = "Integration-only-password-42!";
  process.env.ADMIN_FULL_NAME = "Safety Test Admin";
  await api.seedAdminUser();
  let bootstrap = await one("select * from staff where username=$1", [
    process.env.ADMIN_USERNAME,
  ]);
  assert.equal(bootstrap.role, "admin");
  assert.equal(bootstrap.is_active, true);
  pass(
    "bootstrap creates the first administrator only when explicitly enabled",
  );

  await pool.query(
    "update staff set is_active=false, permissions='[]'::jsonb where id=$1",
    [bootstrap.id],
  );
  await api.seedAdminUser();
  bootstrap = await one("select * from staff where id=$1", [bootstrap.id]);
  assert.equal(bootstrap.is_active, false);
  assert.deepEqual(bootstrap.permissions, []);
  pass("disabled administrator remains disabled during initialization");

  await pool.query("update staff set role='employee' where id=$1", [
    bootstrap.id,
  ]);
  await api.seedAdminUser();
  bootstrap = await one("select * from staff where id=$1", [bootstrap.id]);
  assert.equal(bootstrap.role, "employee");
  assert.equal(bootstrap.is_active, false);
  pass("demoted administrator is not promoted again");

  // Administrator bearer secrets are hash-only and revocation remains effective.
  await pool.query("update staff set is_active=true where id=$1", [
    bootstrap.id,
  ]);
  const createdSession = await api.createSession(Number(bootstrap.id));
  const storedSession = await one(
    "select * from admin_sessions where session_id=$1",
    [createdSession.sessionId],
  );
  assert.equal(storedSession.token, null);
  assert.equal(
    storedSession.token_hash,
    adminSessionTokenHash(createdSession.token),
  );
  assert.notEqual(storedSession.token_hash, createdSession.token);
  pass("raw administrator token is never stored");

  const authenticated = await api.resolveAdminSession(
    new NextRequest("http://localhost/api/admin/me", {
      headers: { authorization: `Bearer ${createdSession.token}` },
    }),
  );
  assert.equal(authenticated?.user.id, Number(bootstrap.id));
  pass("correct administrator token authenticates through its hash");
  await api.destroySession(createdSession.token);
  const revoked = await api.resolveAdminSession(
    new NextRequest("http://localhost/api/admin/me", {
      headers: { authorization: `Bearer ${createdSession.token}` },
    }),
  );
  assert.equal(revoked, null);
  pass("revoked administrator token is rejected");

  await assert.rejects(
    () =>
      loadPublicSettings(async () => {
        throw new Error("simulated database outage");
      }),
    /simulated database outage/,
  );
  pass(
    "public settings database failure propagates instead of returning defaults",
  );

  process.env.ADMIN_BOOTSTRAP_ENABLED = "false";
  const malformed = await api.handleApi(
    new NextRequest("http://localhost/api/admin/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "json-test-request",
      },
      body: "{broken",
    }),
    ["admin", "auth", "login"],
  );
  assert.equal(malformed.status, 400);
  const malformedPayload = await malformed.json();
  assert.equal(malformedPayload.code, "VALIDATION_ERROR");
  assert.equal(malformedPayload.requestId, "json-test-request");
  pass("malformed JSON returns structured HTTP 400");

  const actor = {
    id: Number(bootstrap.id),
    username: bootstrap.username,
    fullName: bootstrap.full_name,
    role: "admin",
    permissions: ["installments", "accounting"],
    isActive: true,
  };

  await pool.query(`
    create table if not exists ajn_test_controls (id integer primary key, fail_accounting boolean not null default false);
    insert into ajn_test_controls(id, fail_accounting) values (1, false) on conflict(id) do update set fail_accounting=false;
    create or replace function ajn_test_reject_accounting() returns trigger language plpgsql as $$
    begin
      if (select fail_accounting from ajn_test_controls where id=1) then
        raise exception 'simulated accounting failure';
      end if;
      return new;
    end $$;
    drop trigger if exists ajn_test_reject_accounting_trigger on financial_transactions;
    create trigger ajn_test_reject_accounting_trigger before insert on financial_transactions
      for each row execute function ajn_test_reject_accounting();
  `);

  async function fixture(label: string) {
    const invoice = await one(
      `insert into sales_invoices
      (invoice_no,date,customer_name,total,paid_amount,remaining_amount,payment_status,status,created_by_name)
      values ($1,current_date,'Safety Customer',100,0,100,'unpaid','active','Safety Test') returning *`,
      [`${prefix}-${label}-INV`],
    );
    const contract = await one(
      `insert into installment_contracts
      (contract_no,public_token,source_type,source_id,sales_invoice_id,customer_name,department,original_total,balance_at_conversion,financed_amount,remaining_amount,installment_count,first_due_date,last_due_date,created_by,created_by_name)
      values ($1,$2,'sales_invoice',$3,$3,'Safety Customer','sales',100,100,100,100,1,current_date,current_date,$4,'Safety Test') returning *`,
      [`${prefix}-${label}-CON`, randomUUID(), invoice.id, bootstrap.id],
    );
    const schedule = await one(
      `insert into installment_schedule
      (contract_id,installment_no,due_date,original_amount,remaining_amount)
      values ($1,1,current_date,100,100) returning *`,
      [contract.id],
    );
    return { invoice, contract, schedule };
  }

  const success = await fixture("success");
  const paymentData = {
    amount: 40,
    paymentMethod: "cash",
    receiptNumber: "R-1",
    receiptImage: "",
    notes: "",
    idempotencyKey: `${prefix}-payment-key`,
    allocations: [],
  };
  const posted = await postInstallmentPayment(
    Number(success.contract.id),
    paymentData,
    actor,
  );
  assert.ok(!(posted instanceof NextResponse));
  const savedPayment = await one(
    "select * from installment_payments where idempotency_key=$1",
    [paymentData.idempotencyKey],
  );
  const savedInvoice = await one("select * from sales_invoices where id=$1", [
    success.invoice.id,
  ]);
  const savedContract = await one(
    "select * from installment_contracts where id=$1",
    [success.contract.id],
  );
  const movement = await one(
    "select * from financial_transactions where id=$1",
    [savedPayment.financial_transaction_id],
  );
  const ledger = await one(
    "select count(*)::int count from financial_ledger_entries where transaction_id=$1",
    [movement.id],
  );
  assert.equal(Number(savedPayment.amount), 40);
  assert.equal(Number(savedInvoice.paid_amount), 40);
  assert.equal(Number(savedInvoice.remaining_amount), 60);
  assert.equal(Number(savedContract.collected_amount), 40);
  assert.equal(Number(savedContract.scheduled_paid_amount), 40);
  assert.equal(Number(savedContract.remaining_amount), 60);
  assert.equal(movement.approval_status, "executed");
  assert.equal(ledger.count, 2);
  pass(
    "installment payment, invoice, contract, cash movement, and ledger save atomically",
  );

  const retried = await postInstallmentPayment(
    Number(success.contract.id),
    paymentData,
    actor,
  );
  assert.ok(!(retried instanceof NextResponse));
  assert.equal(retried.duplicate, true);
  const retryCounts = await one(
    `select
    (select count(*)::int from installment_payments where idempotency_key=$1) payments,
    (select count(*)::int from financial_transactions where source_type='installment_payment' and source_id=$2) movements,
    (select count(*)::int from financial_ledger_entries where transaction_id=$3) ledger`,
    [paymentData.idempotencyKey, String(savedPayment.id), movement.id],
  );
  assert.deepEqual(retryCounts, { payments: 1, movements: 1, ledger: 2 });
  pass(
    "duplicate installment retry creates neither duplicate payment nor accounting",
  );

  const failed = await fixture("rollback");
  await pool.query(
    "update ajn_test_controls set fail_accounting=true where id=1",
  );
  await assert.rejects(
    () =>
      postInstallmentPayment(
        Number(failed.contract.id),
        {
          ...paymentData,
          idempotencyKey: `${prefix}-failed-payment-key`,
          amount: 30,
        },
        actor,
      ),
    (error: any) =>
      String(error?.cause?.message ?? error?.message).includes(
        "simulated accounting failure",
      ),
  );
  await pool.query(
    "update ajn_test_controls set fail_accounting=false where id=1",
  );
  const rollback = await one(
    `select
    (select count(*)::int from installment_payments where idempotency_key=$1) payments,
    (select paid_amount::numeric from sales_invoices where id=$2) invoice_paid,
    (select collected_amount::numeric from installment_contracts where id=$3) contract_collected,
    (select remaining_amount::numeric from installment_contracts where id=$3) contract_remaining`,
    [`${prefix}-failed-payment-key`, failed.invoice.id, failed.contract.id],
  );
  assert.equal(rollback.payments, 0);
  assert.equal(Number(rollback.invoice_paid), 0);
  assert.equal(Number(rollback.contract_collected), 0);
  assert.equal(Number(rollback.contract_remaining), 100);
  pass("accounting failure rolls back payment, invoice, and contract changes");

  const legacy = await fixture("legacy");
  const legacyPayment = await one(
    `insert into installment_payments
    (payment_no,idempotency_key,contract_id,amount,payment_method,received_by,received_by_name)
    values ($1,$2,$3,25,'cash',$4,'Safety Test') returning *`,
    [
      `${prefix}-LEG-PAY`,
      `${prefix}-legacy-key`,
      legacy.contract.id,
      bootstrap.id,
    ],
  );
  await pool.query(
    "update installment_schedule set paid_amount=25,remaining_amount=75,status='partial' where id=$1",
    [legacy.schedule.id],
  );
  await pool.query(
    "update installment_contracts set collected_amount=25,scheduled_paid_amount=25,remaining_amount=75 where id=$1",
    [legacy.contract.id],
  );
  await pool.query(
    "update sales_invoices set paid_amount=25,remaining_amount=75,payment_status='partial' where id=$1",
    [legacy.invoice.id],
  );
  const firstReport = await reconcileInstallmentPayments(
    Number(legacy.contract.id),
    actor,
  );
  const secondReport = await reconcileInstallmentPayments(
    Number(legacy.contract.id),
    actor,
  );
  assert.ok(firstReport.createdTransactionId);
  assert.equal(secondReport.createdTransactionId, null);
  const reconciled = await one(
    `select
    (select financial_transaction_id from installment_payments where id=$1) linked_id,
    (select count(*)::int from financial_transactions where source_type='installment_contract' and source_id=$2 and source_event='reconciliation') movements,
    (select count(*)::int from installment_history where contract_id=$3 and action='financial_reconciled') reports`,
    [legacyPayment.id, String(legacy.contract.id), legacy.contract.id],
  );
  assert.equal(
    Number(reconciled.linked_id),
    Number(firstReport.createdTransactionId),
  );
  assert.equal(reconciled.movements, 1);
  assert.equal(reconciled.reports, 1);
  pass(
    "legacy reconciliation creates and reports exactly one missing movement",
  );

  const cancellable = await fixture("cancel");
  const cancelResponse = await handleInstallments(
    new NextRequest(
      `http://localhost/api/admin/installments/contracts/${cancellable.contract.id}/cancel`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "Safety test cancellation" }),
      },
    ),
    ["contracts", String(cancellable.contract.id), "cancel"],
    actor,
  );
  assert.equal(cancelResponse.status, 200);
  const cancelled = await one(
    `select
    (select status from installment_contracts where id=$1) contract_status,
    (select status from installment_schedule where contract_id=$1) schedule_status,
    (select count(*)::int from installment_history where contract_id=$1 and action='contract_cancelled') history`,
    [cancellable.contract.id],
  );
  assert.deepEqual(cancelled, {
    contract_status: "cancelled",
    schedule_status: "cancelled",
    history: 1,
  });
  pass(
    "contract cancellation updates contract, schedule, and history together",
  );
} finally {
  await pool
    .query("update ajn_test_controls set fail_accounting=false where id=1")
    .catch(() => undefined);
  await pool.end();
}
