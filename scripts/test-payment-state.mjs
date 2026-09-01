import { readFileSync } from "node:fs";

let failures = 0;
function check(label, condition) {
  if (condition) console.log(`✓ ${label}`);
  else {
    failures += 1;
    console.error(`✗ ${label}`);
  }
}

const engine = readFileSync("src/server/payment-state.ts", "utf8");
const cashBox = readFileSync("src/server/master-cash-box.ts", "utf8");
const critical = readFileSync("scripts/run-critical-verification.mjs", "utf8");
const audit = readFileSync("scripts/audit-payment-status.mjs", "utf8");

for (const source of [
  "sales_invoice", "purchase_invoice", "kosha_booking", "order",
  "service_order", "graduation_order", "photography_order", "rental_order", "research_order",
]) check(`${source} has a canonical reconciliation adapter`, engine.includes(`${source}: {`));

check("only executed financial approvals count as official money", engine.includes("approval_status = 'executed'"));
check("pending and rejected requests are excluded by the executed-only source", engine.includes("approval_status = 'executed'"));
check("reversal directions net against original approved payments", engine.includes("ELSE -amount::numeric"));
check("receipt allocation reversals reduce officially paid money", engine.includes("a.reversed_amount"));
check("canonical state keeps zero paid documents unpaid", engine.includes("approved_paid <= 0 THEN 'unpaid'"));
check("canonical state maps partial approved money to partial", engine.includes("ELSE 'partial'"));
check("canonical state maps full approved money to paid", engine.includes("approved_paid >= computed.total_amount THEN 'paid'"));
check("reconciliation locks the source row inside the caller transaction", engine.includes("FOR UPDATE"));
check("legacy service orders reconcile without writing a missing updated_at column", engine.includes("service_order: { table: \"service_orders\"") && engine.includes("touchesUpdatedAt: false") && engine.includes("config.touchesUpdatedAt !== false"));
check("approval execution invokes the canonical engine", cashBox.includes("await reconcilePaymentState(tx, { sourceType: transaction.sourceType, sourceId })"));
check("receipt posting invokes the canonical engine", cashBox.includes("for (const source of sourcesToReconcile.values())\n    await reconcilePaymentState(tx, source);"));
check("receipt reversal invokes the canonical engine", cashBox.includes("async function reverseReceiptVoucherAllocations") && cashBox.includes("sourcesToReconcile"));
check("payment-state regression test is part of the critical gate", critical.includes("Payment-state reconciliation invariant") && critical.includes("test:payment-state"));
check("payment-status audit is read-only and never falls back to an application URL", audit.includes("BEGIN READ ONLY") && audit.includes("AJN_SCHEMA_DATABASE_URL") && !audit.includes("process.env.DATABASE_URL") && !audit.includes("process.env.TEST_DATABASE_URL"));
check("pending approval is not reported as an official unpaid mismatch", audit.includes("pending_approval") && audit.includes("approved_paid <= 0"));

if (failures) {
  console.error(`AJN PAYMENT STATE REGRESSION: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log("AJN PAYMENT STATE CONTRACT PASSED — approved payment snapshots reconcile centrally.");
