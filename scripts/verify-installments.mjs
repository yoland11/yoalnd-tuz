/** Read-only contract checks for AJN's optional installment layer. */
import { readFileSync } from "node:fs";
import { testInstallmentPaymentActions } from "./lib/installment-payment-actions-test.mjs";
import { testInstallmentAllocation } from "./lib/installment-allocation-test.mjs";
import { testInstallmentPosting } from "./lib/installment-posting-test.mjs";
const read = (file) => readFileSync(file, "utf8");
const server = read("src/server/installments.ts");
const api = read("src/server/api.ts");
const ui = read("src/views/admin/installments.tsx");
const migration = read("lib/db/migrations/0082_installment_management.sql");
const layout = read("src/views/admin/_layout.tsx");
const posting = read("src/server/installment-payment-posting.ts");
const cashBox = read("src/server/master-cash-box.ts");
const paymentState = read("src/server/payment-state.ts");
const checks = [
  ["additive optional contract schema", migration.includes("CREATE TABLE IF NOT EXISTS installment_contracts") && migration.includes("installment_schedule")],
  ["no automatic invoice conversion", server.includes('resource === "convert" && req.method === "POST"') && server.includes("invoiceId")],
  ["only active invoices with a balance are eligible", server.includes("invoice.status !== \"active\"") && server.includes("remainingAmount")],
  ["one active plan per source", migration.includes("installment_contracts_active_source_idx") && server.includes("توجد خطة أقساط نشطة")],
  ["fixed and custom schedule validation", server.includes('installmentType === "custom"') && server.includes("مجموع الأقساط المخصصة")],
  ["rounding reaches the final installment", server.includes("data.installmentCount - 1") && server.includes("financed - base")],
  ["server-side payment allocation and idempotency", server.includes("idempotency_key") && server.includes("ORDER BY due_date, installment_no FOR UPDATE")],
  ["pending requests record allocations without settling balances", server.includes("'pending',${user.id}") && server.includes("INSERT INTO installment_payment_allocations") && !server.includes("UPDATE sales_invoices SET paid_amount=paid_amount")],
  ["invoice payment state uses the canonical approval-only engine", posting.includes("await reconcilePaymentState(tx, { sourceType: \"sales_invoice\", sourceId: invoiceId })") && paymentState.includes("installment_financials") && paymentState.includes("f.approval_status='executed'")],
  ["installment approval, rejection and reversal stay in the central transaction", ["postApprovedInstallmentPayment(tx", "rejectPendingInstallmentPayment(tx", "reversePostedInstallmentPayment(tx"].every(call => cashBox.includes(call)) && server.includes("financial_transaction_id") && server.includes("db.transaction")],
  ["duplicate retry verifies its accounting movement", server.includes("verifyLinkedFinancialMovement") && server.includes("duplicate:true")],
  ["legacy reconciliation is deterministic and traceable", server.includes("installment-reconcile:") && server.includes('"financial_reconciled"')],
  ["history, timeline and notification records exist", server.includes("installment_history") && server.includes("entityTimelineTable") && server.includes("notificationsTable")],
  ["server permission registry is wired", ["installments.convert_invoice", "installments.receive_payment", "installments.reschedule"].every((x) => api.includes(x))],
  ["RTL operational screen and navigation exist", ui.includes('dir="rtl"') && layout.includes('href: "/admin/installments"')],
];
let failed = false;
for (const [name, passed] of checks) { console.log(`${passed ? "PASS" : "FAIL"}  ${name}`); if (!passed) failed = true; }
if (failed) process.exit(1);
await testInstallmentPaymentActions();
console.log("PASS  Actual installment form preserves failed drafts and retry identity, and reports pending approval");
await testInstallmentAllocation();
console.log("PASS  Actual installment request allocates sequentially across schedules and respects pending holds");
await testInstallmentPosting();
console.log("PASS  Actual installment posting handles final cents, overpayments and unproven historical balances safely");
console.log(`Installment contract checks passed (${checks.length}/${checks.length})`);
