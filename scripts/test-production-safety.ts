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
  "0097_release_readiness.sql",
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
const { approveAndExecuteFinancialTransaction, rejectFinancialTransaction, reverseFinancialTransaction, createSourceFinancialRequest } = await import("../src/server/master-cash-box");

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
    drop trigger if exists ajn_test_reject_installment_posting on installment_history;
    create trigger ajn_test_reject_installment_posting before insert on installment_history
      for each row when (new.action in ('payment_approved','payment_rejected')) execute function ajn_test_reject_accounting();
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
  let savedInvoice = await one("select * from sales_invoices where id=$1", [
    success.invoice.id,
  ]);
  let savedContract = await one(
    "select * from installment_contracts where id=$1",
    [success.contract.id],
  );
  let movement = await one(
    "select * from financial_transactions where id=$1",
    [savedPayment.financial_transaction_id],
  );
  let ledger = await one(
    "select count(*)::int count from financial_ledger_entries where transaction_id=$1",
    [movement.id],
  );
  assert.equal(Number(savedPayment.amount), 40);
  assert.equal(savedPayment.status, "pending");
  assert.equal(Number(savedInvoice.paid_amount), 0, "A pending installment must not settle the invoice");
  assert.equal(Number(savedInvoice.remaining_amount), 100);
  assert.equal(Number(savedContract.collected_amount), 0);
  assert.equal(Number(savedContract.scheduled_paid_amount), 0);
  assert.equal(Number(savedContract.remaining_amount), 100);
  assert.equal(movement.approval_status, "pending");
  assert.equal(ledger.count, 0);
  assert.equal(Number((await one("select paid_amount from installment_schedule where id=$1", [success.schedule.id])).paid_amount), 0);
  const pendingRetry = await postInstallmentPayment(Number(success.contract.id), paymentData, actor);
  assert.ok(!(pendingRetry instanceof NextResponse));
  assert.equal(pendingRetry.duplicate, true);
  const excessivePending = await postInstallmentPayment(Number(success.contract.id), { ...paymentData, amount: 70, idempotencyKey: `${prefix}-over-request` }, actor);
  assert.ok(excessivePending instanceof NextResponse);
  assert.equal(excessivePending.status, 422);
  pass("pending installment retries are stable and reserve only the remaining balance without settling it");
  const reviewer = { id: actor.id, name: actor.fullName, role: actor.role, permissions: actor.permissions };
  await assert.rejects(approveAndExecuteFinancialTransaction(Number(movement.id), { ...reviewer, role: "employee" }), /للمدير الرئيسي/);
  const cashBeforeApproval = Number((await one("select current_balance from master_cash_box where code='MASTER'")).current_balance);
  await Promise.all([
    approveAndExecuteFinancialTransaction(Number(movement.id), reviewer),
    approveAndExecuteFinancialTransaction(Number(movement.id), reviewer),
  ]);
  savedInvoice = await one("select * from sales_invoices where id=$1", [success.invoice.id]);
  savedContract = await one("select * from installment_contracts where id=$1", [success.contract.id]);
  movement = await one("select * from financial_transactions where id=$1", [movement.id]);
  ledger = await one("select count(*)::int count from financial_ledger_entries where transaction_id=$1", [movement.id]);
  assert.equal(Number(savedInvoice.paid_amount), 40);
  assert.equal(Number(savedInvoice.remaining_amount), 60);
  assert.equal(Number(savedContract.collected_amount), 40);
  assert.equal(Number(savedContract.scheduled_paid_amount), 40);
  assert.equal(Number(savedContract.remaining_amount), 60);
  assert.equal(movement.approval_status, "executed");
  assert.equal(ledger.count, 2);
  assert.equal(Number((await one("select current_balance from master_cash_box where code='MASTER'")).current_balance), cashBeforeApproval + 40);
  assert.equal(Number((await one("select paid_amount from installment_schedule where id=$1", [success.schedule.id])).paid_amount), 40);
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

  const rejectedFixture = await fixture("rejected");
  const rejected = await postInstallmentPayment(Number(rejectedFixture.contract.id), { ...paymentData, idempotencyKey: `${prefix}-rejected` }, actor);
  assert.ok(!(rejected instanceof NextResponse));
  await pool.query("update ajn_test_controls set fail_accounting=true where id=1");
  await assert.rejects(rejectFinancialTransaction(Number(rejected.payment.financial_transaction_id), reviewer, "رفض تجريبي للقسط"), (error: any) => String(error?.cause?.message ?? error?.message).includes("simulated accounting failure"));
  await pool.query("update ajn_test_controls set fail_accounting=false where id=1");
  assert.equal((await one("select approval_status from financial_transactions where id=$1", [rejected.payment.financial_transaction_id])).approval_status, "pending");
  assert.equal((await one("select status from installment_payments where id=$1", [rejected.payment.id])).status, "pending");
  await rejectFinancialTransaction(Number(rejected.payment.financial_transaction_id), reviewer, "رفض تجريبي للقسط");
  const rejectedState = await one("select status from installment_payments where id=$1", [rejected.payment.id]);
  assert.equal(rejectedState.status, "rejected");
  assert.equal(Number((await one("select paid_amount from sales_invoices where id=$1", [rejectedFixture.invoice.id])).paid_amount), 0);
  const afterRejected = await postInstallmentPayment(Number(rejectedFixture.contract.id), { ...paymentData, amount: 100, idempotencyKey: `${prefix}-after-rejected` }, actor);
  assert.ok(!(afterRejected instanceof NextResponse), "Rejected requests must release the pending balance hold");
  pass("rejected installment does not settle money and releases its pending reservation");

  await assert.rejects(reverseFinancialTransaction(Number(movement.id), reviewer, "عكس جزئي تجريبي", undefined, undefined, { amount: 10, idempotencyKey: `${prefix}-partial-reversal` }), /العكس الجزئي/);
  assert.equal(Number((await one("select paid_amount from sales_invoices where id=$1", [success.invoice.id])).paid_amount), 40);
  const [fullReversal, repeatReversal] = await Promise.all([1, 2].map(() => reverseFinancialTransaction(Number(movement.id), reviewer, "عكس كامل تجريبي", undefined, undefined, { idempotencyKey: `${prefix}-full-reversal` })));
  assert.equal(repeatReversal.reverse.id, fullReversal.reverse.id);
  assert.equal(Number((await one("select paid_amount from sales_invoices where id=$1", [success.invoice.id])).paid_amount), 0);
  assert.equal(Number((await one("select collected_amount from installment_contracts where id=$1", [success.contract.id])).collected_amount), 0);
  assert.equal(Number((await one("select paid_amount from installment_schedule where id=$1", [success.schedule.id])).paid_amount), 0);
  assert.equal(Number((await one("select current_balance from master_cash_box where code='MASTER'")).current_balance), cashBeforeApproval);
  pass("full installment reversal restores all balances once; unsupported partial reversal never posts");

  const approvalFailure = await fixture("approval-rollback");
  const waiting = await postInstallmentPayment(Number(approvalFailure.contract.id), { ...paymentData, idempotencyKey: `${prefix}-approval-rollback` }, actor);
  assert.ok(!(waiting instanceof NextResponse));
  await pool.query("update ajn_test_controls set fail_accounting=true where id=1");
  await assert.rejects(approveAndExecuteFinancialTransaction(Number(waiting.payment.financial_transaction_id), reviewer), (error: any) => String(error?.cause?.message ?? error?.message).includes("simulated accounting failure"));
  await pool.query("update ajn_test_controls set fail_accounting=false where id=1");
  assert.equal(Number((await one("select collected_amount from installment_contracts where id=$1", [approvalFailure.contract.id])).collected_amount), 0);
  assert.equal(Number((await one("select paid_amount from installment_schedule where id=$1", [approvalFailure.schedule.id])).paid_amount), 0);
  assert.equal(Number((await one("select paid_amount from sales_invoices where id=$1", [approvalFailure.invoice.id])).paid_amount), 0);
  assert.equal((await one("select approval_status from financial_transactions where id=$1", [waiting.payment.financial_transaction_id])).approval_status, "pending");
  assert.equal((await one("select count(*)::int count from financial_ledger_entries where transaction_id=$1", [waiting.payment.financial_transaction_id])).count, 0);
  assert.equal(Number((await one("select current_balance from master_cash_box where code='MASTER'")).current_balance), cashBeforeApproval);
  pass("approval and rejection source-audit failures roll back cash, ledger, source status, and all installment balances");

  const down = await fixture("down-payment");
  await pool.query("update installment_contracts set down_payment_amount=20,financed_amount=80,remaining_amount=80 where id=$1", [down.contract.id]);
  await pool.query("update installment_schedule set original_amount=80,remaining_amount=80 where id=$1", [down.schedule.id]);
  const downRequest = await postInstallmentPayment(Number(down.contract.id), { ...paymentData, amount: 20, idempotencyKey: `${prefix}-down` }, actor, true);
  assert.ok(!(downRequest instanceof NextResponse));
  const duplicateDown = await postInstallmentPayment(Number(down.contract.id), { ...paymentData, amount: 20, idempotencyKey: `${prefix}-second-down` }, actor, true);
  assert.ok(duplicateDown instanceof NextResponse, "A second key must not reserve the same down-payment allowance twice");
  assert.equal(duplicateDown.status, 422);
  const scheduledRequest = await postInstallmentPayment(Number(down.contract.id), { ...paymentData, amount: 80, idempotencyKey: `${prefix}-scheduled` }, actor);
  assert.ok(!(scheduledRequest instanceof NextResponse));
  await approveAndExecuteFinancialTransaction(Number(scheduledRequest.payment.financial_transaction_id), reviewer);
  assert.equal((await one("select status from installment_contracts where id=$1", [down.contract.id])).status, "active", "Contract cannot complete while its down payment is pending");
  await approveAndExecuteFinancialTransaction(Number(downRequest.payment.financial_transaction_id), reviewer);
  const paidDown = await one("select * from installment_contracts where id=$1", [down.contract.id]);
  assert.equal(Number(paidDown.collected_amount), 100);
  assert.equal(Number(paidDown.scheduled_paid_amount), 80);
  assert.equal(paidDown.status, "completed");
  assert.equal(Number((await one("select paid_amount from sales_invoices where id=$1", [down.invoice.id])).paid_amount), 100);
  pass("down-payment and scheduled approvals remain distinct and completion waits for both");

  const allocationFixture = await fixture("allocation-retry");
  const explicit = { ...paymentData, idempotencyKey: `${prefix}-explicit`, allocations: [{ installmentId: Number(allocationFixture.schedule.id), amount: 40 }] };
  const explicitRequest = await postInstallmentPayment(Number(allocationFixture.contract.id), explicit, actor);
  assert.ok(!(explicitRequest instanceof NextResponse));
  const changedAllocation = await postInstallmentPayment(Number(allocationFixture.contract.id), { ...explicit, allocations: [{ installmentId: Number(allocationFixture.schedule.id), amount: 20 }] }, actor);
  assert.ok(changedAllocation instanceof NextResponse, "Idempotency must not accept a changed explicit allocation payload");
  assert.equal(changedAllocation.status, 409);
  const repeatedAllocation = await postInstallmentPayment(Number(allocationFixture.contract.id), { ...explicit, idempotencyKey: `${prefix}-repeated-allocation`, allocations: [{ installmentId: Number(allocationFixture.schedule.id), amount: 20 }, { installmentId: Number(allocationFixture.schedule.id), amount: 20 }] }, actor);
  assert.ok(repeatedAllocation instanceof NextResponse);
  assert.equal(repeatedAllocation.status, 422);

  const concurrentFixture = await fixture("concurrent-request");
  const concurrentRequests = await Promise.all(["a", "b"].map(key => postInstallmentPayment(Number(concurrentFixture.contract.id), { ...paymentData, amount: 60, idempotencyKey: `${prefix}-concurrent-${key}` }, actor)));
  assert.equal(concurrentRequests.filter(result => !(result instanceof NextResponse)).length, 1);
  assert.equal(concurrentRequests.filter(result => result instanceof NextResponse && result.status === 422).length, 1);
  pass("concurrent requests cannot oversubscribe the balance and changed or duplicate allocations are rejected");

  async function directPayment(invoiceId: number, amount: number, label: string) {
    const request = await createSourceFinancialRequest({ direction: "revenue", amount, department: "sales", transactionType: "invoice_collection", description: "دفعة اختبار معتمدة", paymentMethod: "cash", sourceType: "sales_invoice", sourceId: String(invoiceId), sourceEvent: "payment", idempotencyKey: `${prefix}-${label}` }, reviewer);
    await approveAndExecuteFinancialTransaction(Number(request.id), reviewer);
  }
  const previous = await fixture("previous-payment");
  await directPayment(Number(previous.invoice.id), 25, "previous-direct");
  await pool.query("update installment_contracts set paid_before_conversion=25,balance_at_conversion=75,financed_amount=75,remaining_amount=75 where id=$1", [previous.contract.id]);
  await pool.query("update installment_schedule set original_amount=75,remaining_amount=75 where id=$1", [previous.schedule.id]);
  const laterRequest = await postInstallmentPayment(Number(previous.contract.id), { ...paymentData, idempotencyKey: `${prefix}-later-payment` }, actor);
  assert.ok(!(laterRequest instanceof NextResponse));
  await approveAndExecuteFinancialTransaction(Number(laterRequest.payment.financial_transaction_id), reviewer);
  assert.equal(Number((await one("select paid_amount from sales_invoices where id=$1", [previous.invoice.id])).paid_amount), 65);
  assert.equal(Number((await one("select remaining_amount from installment_contracts where id=$1", [previous.contract.id])).remaining_amount), 35);
  pass("approved payments before conversion and installment collections are counted once each");

  const settled = await fixture("settled-while-pending");
  const settledRequest = await postInstallmentPayment(Number(settled.contract.id), { ...paymentData, idempotencyKey: `${prefix}-settled-pending` }, actor);
  assert.ok(!(settledRequest instanceof NextResponse));
  await directPayment(Number(settled.invoice.id), 100, "settled-direct");
  const cashBeforeBlocked = Number((await one("select current_balance from master_cash_box where code='MASTER'")).current_balance);
  await assert.rejects(approveAndExecuteFinancialTransaction(Number(settledRequest.payment.financial_transaction_id), reviewer), /رصيد الفاتورة/);
  assert.equal((await one("select approval_status from financial_transactions where id=$1", [settledRequest.payment.financial_transaction_id])).approval_status, "pending");
  assert.equal(Number((await one("select collected_amount from installment_contracts where id=$1", [settled.contract.id])).collected_amount), 0);
  assert.equal(Number((await one("select current_balance from master_cash_box where code='MASTER'")).current_balance), cashBeforeBlocked);
  pass("installment approval rechecks the invoice balance and rolls back when another payment settled it");

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
  const unrelatedPending = await createSourceFinancialRequest({ direction: "revenue", amount: 1, department: "sales", transactionType: "installment_collection", description: "حركة معلقة مختلفة للمراجعة", paymentMethod: "cash", sourceType: "installment_contract", sourceId: String(legacy.contract.id), sourceEvent: "payment", idempotencyKey: `${prefix}-legacy-unrelated` }, reviewer);
  await assert.rejects(reconcileInstallmentPayments(Number(legacy.contract.id), actor), /حركات مالية غير منفذة/);
  await rejectFinancialTransaction(Number(unrelatedPending.id), reviewer, "رفض حركة اختبار مختلفة");
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
  assert.equal((await one("select approval_status from financial_transactions where id=$1", [firstReport.createdTransactionId])).approval_status, "pending");
  assert.equal(Number((await one("select paid_amount from sales_invoices where id=$1", [legacy.invoice.id])).paid_amount), 25, "Manual legacy reconciliation must not silently rewrite historical snapshots");
  await approveAndExecuteFinancialTransaction(Number(firstReport.createdTransactionId), reviewer);
  assert.equal(Number((await one("select paid_amount from sales_invoices where id=$1", [legacy.invoice.id])).paid_amount), 25);
  assert.equal(Number((await one("select collected_amount from installment_contracts where id=$1", [legacy.contract.id])).collected_amount), 25, "Legacy approval must not apply the historical payment twice");
  pass(
    "legacy reconciliation creates and reports exactly one missing movement",
  );

  const oldPosted = await fixture("old-posted");
  const oldRequest = await postInstallmentPayment(Number(oldPosted.contract.id), { ...paymentData, amount: 25, idempotencyKey: `${prefix}-old-posted` }, actor);
  assert.ok(!(oldRequest instanceof NextResponse));
  await pool.query("update installment_payments set status='posted' where id=$1", [oldRequest.payment.id]);
  await pool.query("update installment_schedule set paid_amount=25,remaining_amount=75,status='partial' where id=$1", [oldPosted.schedule.id]);
  await pool.query("update installment_contracts set collected_amount=25,scheduled_paid_amount=25,remaining_amount=75 where id=$1", [oldPosted.contract.id]);
  await pool.query("update sales_invoices set paid_amount=25,remaining_amount=75,payment_status='partial' where id=$1", [oldPosted.invoice.id]);
  await approveAndExecuteFinancialTransaction(Number(oldRequest.payment.financial_transaction_id), reviewer);
  assert.equal(Number((await one("select collected_amount from installment_contracts where id=$1", [oldPosted.contract.id])).collected_amount), 25);
  assert.equal(Number((await one("select paid_amount from installment_schedule where id=$1", [oldPosted.schedule.id])).paid_amount), 25);
  assert.equal(Number((await one("select paid_amount from sales_invoices where id=$1", [oldPosted.invoice.id])).paid_amount), 25);
  pass("approving a legacy already-posted installment does not apply its allocations twice");

  const oldContract = await fixture("old-contract-source");
  await pool.query("update installment_schedule set paid_amount=25,remaining_amount=75,status='partial' where id=$1", [oldContract.schedule.id]);
  await pool.query("update installment_contracts set collected_amount=25,scheduled_paid_amount=25,remaining_amount=75 where id=$1", [oldContract.contract.id]);
  const oldContractRequest = await createSourceFinancialRequest({ direction: "revenue", amount: 25, department: "sales", transactionType: "installment_collection", description: "دفعة عقد قديمة", paymentMethod: "cash", sourceType: "installment_contract", sourceId: String(oldContract.contract.id), sourceEvent: "payment", idempotencyKey: `${prefix}-old-contract-payment` }, reviewer);
  await approveAndExecuteFinancialTransaction(Number(oldContractRequest.id), reviewer);
  assert.equal(Number((await one("select paid_amount from sales_invoices where id=$1", [oldContract.invoice.id])).paid_amount), 25, "Legacy contract-source payments must remain part of canonical invoice settlement");
  assert.equal(Number((await one("select collected_amount from installment_contracts where id=$1", [oldContract.contract.id])).collected_amount), 25);
  pass("legacy contract payment source is reconciled without duplicating historical allocation snapshots");

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
