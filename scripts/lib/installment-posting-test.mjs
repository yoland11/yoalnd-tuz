import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

// Exercise the real posting/locking code. Only database I/O and the canonical
// reconciliation boundary are doubled; no connection or database write occurs.
// Removing the final-cent rounding, overpayment guard, reconciliation call, or
// legacy posted-payment or unexplained historical-balance guards must fail
// these behavior checks. Historical snapshots are never invented as money.
export async function testInstallmentPosting(text = readFileSync("src/server/installment-payment-posting.ts", "utf8")) {
  const tree = ts.createSourceFile("installment-payment-posting.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const source = tree.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(tree)).join("\n");
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const reconciliations = [];
  const context = vm.createContext({ exports: {}, sql,
    reconcilePaymentState: async (tx, input) => {
      reconciliations.push({ tx, sourceType: input.sourceType, sourceId: input.sourceId });
      return tx.canonicalState;
    },
  });
  vm.runInContext(code, context);
  const approve = context.exports.postApprovedInstallmentPayment;
  const dialect = new PgDialect();
  const actor = { id: 2, name: "مدير تجريبي" };

  function fixture({ amount = "0.10", status = "pending", total = "0.30", paid = "0.20", remaining = "0.10",
    canonicalPaid = "0.30", canonicalRemaining = "0.00" } = {}) {
    const contract = { id: 7, sales_invoice_id: 11, status: "active",
      financed_amount: total, balance_at_conversion: total, collected_amount: paid,
      scheduled_paid_amount: paid, remaining_amount: remaining, down_payment_amount: "0.00" };
    const payment = { id: 9, contract_id: 7, financial_transaction_id: 15, amount, status,
      payment_method: "cash", receipt_number: null, receipt_image: null };
    const invoice = { id: 11, total, paid_amount: paid, status: "active" };
    const allocations = [{ payment_id: 9, installment_id: 13, amount }];
    const writes = [];
    const tx = { canonicalState: { sourceType: "sales_invoice", sourceId: 11, totalAmount: total,
      approvedPaidAmount: canonicalPaid, remainingAmount: canonicalRemaining,
      paymentStatus: canonicalPaid === total ? "paid" : canonicalPaid === "0.00" ? "unpaid" : "partial" },
      execute: async query => {
      const compiled = dialect.sqlToQuery(query);
      const statement = compiled.sql.replace(/\s+/g, " ").trim();
      const params = compiled.params;
      if (statement.startsWith("SELECT contract_id FROM installment_payments")) {
        assert.deepEqual(params, [9]);
        return { rows: [{ contract_id: 7 }] };
      }
      if (statement.startsWith("SELECT * FROM installment_contracts")) {
        assert.deepEqual(params, [7]);
        assert.match(statement, /FOR UPDATE$/);
        return { rows: [contract] };
      }
      if (statement.startsWith("SELECT * FROM installment_payments")) {
        assert.deepEqual(params, [9]);
        assert.match(statement, /FOR UPDATE$/);
        return { rows: [payment] };
      }
      if (statement.startsWith("SELECT total,paid_amount,status FROM sales_invoices")) {
        assert.deepEqual(params, [11]);
        assert.match(statement, /FOR UPDATE$/);
        return { rows: [invoice] };
      }
      if (statement.startsWith("SELECT * FROM installment_payment_allocations")) {
        assert.deepEqual(params, [9]);
        return { rows: allocations };
      }
      if (statement.startsWith("UPDATE installment_schedule")) {
        writes.push({ statement, params });
        return { rows: [{ id: 13 }] };
      }
      if (statement.startsWith("UPDATE installment_contracts")) {
        writes.push({ statement, params });
        return { rows: [{ id: 7 }] };
      }
      if (statement.startsWith("UPDATE installment_payments") || statement.startsWith("INSERT INTO installment_history")) {
        writes.push({ statement, params });
        return { rows: [] };
      }
      throw new Error(`Unexpected posting database operation: ${statement}`);
    } };
    return { tx, writes };
  }

  const finalCent = fixture();
  await assert.doesNotReject(() => approve(finalCent.tx, 15, 9, 0.10, actor),
    "A valid final 0.10 payment against total 0.30 and paid 0.20 must be approved");
  const scheduleWrites = finalCent.writes.filter(write => write.statement.startsWith("UPDATE installment_schedule"));
  const contractWrites = finalCent.writes.filter(write => write.statement.startsWith("UPDATE installment_contracts"));
  assert.equal(scheduleWrites.length, 1, "The approved final allocation must post exactly once");
  assert.equal(scheduleWrites[0].params[0], "0.1");
  assert.equal(contractWrites.length, 1, "Approval must update the installment contract");
  assert.equal(contractWrites[0].params[0], "0.1");
  assert(finalCent.writes.some(write => /UPDATE installment_payments SET status='posted'/.test(write.statement)),
    "Approval must mark the installment payment posted");
  assert.equal(reconciliations.length, 1, "Approval must reconcile the canonical invoice payment state");
  assert.equal(reconciliations[0].tx, finalCent.tx);
  assert.equal(reconciliations[0].sourceType, "sales_invoice");
  assert.equal(reconciliations[0].sourceId, 11);

  reconciliations.length = 0;
  const excessive = fixture({ amount: "0.11" });
  await assert.rejects(() => approve(excessive.tx, 15, 9, 0.11, actor), /رصيد الفاتورة/);
  assert.equal(excessive.writes.length, 0, "A true overpayment must fail before source writes");
  assert.equal(reconciliations.length, 0, "A refused payment must not reconcile a changed balance");

  const legacy = fixture({ status: "posted", canonicalPaid: "0.20", canonicalRemaining: "0.10" });
  await approve(legacy.tx, 15, 9, 0.10, actor);
  assert.equal(legacy.writes.length, 0, "A legacy posted payment must not apply its allocations again");
  assert.equal(reconciliations.length, 1, "Legacy approval must still reconcile the canonical invoice payment state");
  assert.equal(reconciliations[0].tx, legacy.tx);
  assert.equal(reconciliations[0].sourceType, "sales_invoice");
  assert.equal(reconciliations[0].sourceId, 11);

  const historical = { total: "100.00", paid: "25.00", remaining: "75.00", amount: "40.00" };
  const reviewError = /مراجعة مالية/;
  const unprovenReject = fixture({ ...historical, canonicalPaid: "0.00", canonicalRemaining: "100.00" });
  await assert.rejects(() => context.exports.rejectPendingInstallmentPayment(unprovenReject.tx, 15, 9, actor, "رفض الطلب"),
    reviewError, "Rejection must refuse to erase a historical paid 25 without executed financial evidence");
  const unprovenApproval = fixture({ ...historical, canonicalPaid: "40.00", canonicalRemaining: "60.00" });
  await assert.rejects(() => approve(unprovenApproval.tx, 15, 9, 40, actor),
    reviewError, "Approval must refuse to replace historical paid 25 with only the new 40");
  const anchoredApproval = fixture({ ...historical, canonicalPaid: "65.00", canonicalRemaining: "35.00" });
  await approve(anchoredApproval.tx, 15, 9, 40, actor);
  const anchoredReject = fixture({ ...historical, canonicalPaid: "25.00", canonicalRemaining: "75.00" });
  await context.exports.rejectPendingInstallmentPayment(anchoredReject.tx, 15, 9, actor, "رفض الطلب");

  const unprovenPosted = fixture({ ...historical, status: "posted", canonicalPaid: "0.00", canonicalRemaining: "100.00" });
  await assert.rejects(() => approve(unprovenPosted.tx, 15, 9, 40, actor),
    reviewError, "An already-posted legacy approval must preserve its preexisting invoice balance");
  assert.equal(unprovenPosted.writes.length, 0, "A legacy posted payment must never post source allocations again");

  const reversing = { ...historical, status: "posted", paid: "65.00", remaining: "35.00" };
  const unprovenReversal = fixture({ ...reversing, canonicalPaid: "0.00", canonicalRemaining: "100.00" });
  await assert.rejects(() => context.exports.reversePostedInstallmentPayment(unprovenReversal.tx, 15, 9, 40, actor, "عكس كامل"),
    reviewError, "A full reversal must refuse to erase unrelated historical invoice payments");
  const anchoredReversal = fixture({ ...reversing, canonicalPaid: "25.00", canonicalRemaining: "75.00" });
  await context.exports.reversePostedInstallmentPayment(anchoredReversal.tx, 15, 9, 40, actor, "عكس كامل");

  const legacyPayment = fixture({ ...historical, amount: "25.00", canonicalPaid: "25.00", canonicalRemaining: "75.00" });
  await assert.rejects(() => context.exports.reconcileLegacyInstallmentInvoice(legacyPayment.tx, 7, "payment", 25),
    reviewError, "Ordinary legacy contract payments must add their amount to the preexisting invoice balance");
  const anchoredLegacyPayment = fixture({ ...historical, amount: "25.00", canonicalPaid: "50.00", canonicalRemaining: "50.00" });
  await context.exports.reconcileLegacyInstallmentInvoice(anchoredLegacyPayment.tx, 7, "payment", 25);
  const initialLegacyPayment = fixture({ ...historical, paid: "0.00", remaining: "100.00", amount: "25.00",
    canonicalPaid: "25.00", canonicalRemaining: "75.00" });
  await context.exports.reconcileLegacyInstallmentInvoice(initialLegacyPayment.tx, 7, "payment", 25);
  const explicitReconciliation = fixture({ ...historical, amount: "25.00",
    canonicalPaid: "25.00", canonicalRemaining: "75.00" });
  await context.exports.reconcileLegacyInstallmentInvoice(explicitReconciliation.tx, 7, "reconciliation", 25);
  const initialReconciliation = fixture({ ...historical, paid: "0.00", remaining: "100.00", amount: "25.00",
    canonicalPaid: "25.00", canonicalRemaining: "75.00" });
  await context.exports.reconcileLegacyInstallmentInvoice(initialReconciliation.tx, 7, "reconciliation", 25);
}
