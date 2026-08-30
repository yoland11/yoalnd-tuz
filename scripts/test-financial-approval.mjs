// AJN financial-approval contract suite.
// Read-only source contracts: they protect the server-side invariant without
// connecting to a database.  The existing save-smoke runner covers isolated
// test-database integration separately.
import { readFileSync } from "node:fs";

let failures = 0;
function check(name, ok) {
  if (ok) console.log(`✓ ${name}`);
  else {
    failures += 1;
    console.error(`✗ ${name}`);
  }
}

const cashbox = readFileSync("src/server/master-cash-box.ts", "utf8");
const api = readFileSync("src/server/api.ts", "utf8");
const sales = readFileSync("src/views/admin/master-cash.tsx", "utf8");
const dailyCash = readFileSync("src/server/daily-cash.ts", "utf8");
const eventBrain = readFileSync("src/server/event-brain.ts", "utf8");
const sourceGate = cashbox.slice(
  cashbox.indexOf("export async function createAndExecuteSourceFinancialTransaction"),
  cashbox.indexOf("export async function rejectFinancialTransaction"),
);
const executor = cashbox.slice(
  cashbox.indexOf("async function executePendingFinancialTransaction"),
  cashbox.indexOf("export async function approveAndExecuteFinancialTransaction"),
);

check("central source gate creates pending transactions", sourceGate.includes('approvalStatus: "pending"'));
check("central source gate never executes cash-box writes", !sourceGate.includes("executePendingFinancialTransaction("));
check("cash-box execution accepts pending requests only", executor.includes('transaction.approvalStatus !== "pending"'));
check("cash-box execution locks the master cash box", executor.includes("FOR UPDATE"));
check("cash-box execution posts journal and cash atomically", executor.includes("financialLedgerEntriesTable") && executor.includes("masterCashBoxTable"));
check("duplicate financial requests use idempotency keys", sourceGate.includes("idempotencyKey") && sourceGate.includes("تعارض مفتاح التكرار"));
check("financial approval is restricted to the principal admin role", cashbox.includes('String(actor.role ?? "").toLowerCase() === "admin"'));
check("financial approval cannot be delegated by permission", !cashbox.slice(cashbox.indexOf("export function canApproveFinancialTransactions"), cashbox.indexOf("/** Rebuild invoice")).includes("financial_approval:approve"));
check("principal admin may approve their own financial request", cashbox.includes("They may also\n  // approve their own request"));
check("Kosha field collections are also restricted to the principal admin", api.includes("function canApproveKoshaFieldCollection(user: AdminUser)") && api.includes("return user.role === \"admin\";"));
check("sales initial payment stays unofficial until approval", api.includes('paymentStatus: paidAmount > 0 ? "pending_approval" : paymentStatus'));
check("sales official payment is applied only in the cash-box executor", executor.includes('transaction.sourceType === "sales_invoice"'));
check("research payments stay pending until approval", executor.includes('transaction.sourceType === "research_order"'));
check("loan receipt is classified as a liability cash movement, not operating revenue", api.includes('transactionType: "company_loan_received"') && api.includes('sourceType: "company_loan"') && cashbox.includes('return "2300"') && cashbox.includes('isBalanceSheetTransfer(transaction)'));
check("loan movements present as cash flow liabilities instead of revenue or expense", cashbox.includes('accountingClassificationLabel: "استلام قرض / التزام"') && cashbox.includes('accountingClassificationLabel: "تسديد قرض / تخفيض التزام"') && sales.includes('movementDisplay(row)'));
check("daily revenue and expenses exclude loan principal", dailyCash.includes("company_loan_received','company_loan_repayment") && dailyCash.includes("company_loan','company_loan_repayment"));
check("event dashboard revenue excludes loan principal", eventBrain.includes("company_loan_received','company_loan_repayment"));
check("loan repayment is approval-first and durably idempotent", api.includes('idempotency_key = ${data.idempotencyKey}') && api.includes('FOR UPDATE') && api.includes('transactionType: "company_loan_repayment"'));
check("reversing a loan repayment restores the company liability", cashbox.includes('company_loan_repayment_reversed') && cashbox.includes('net_repaid'));
check("financial approvals UI uses the server-side approval API", sales.includes('/admin/master-cash/transactions/${id}/approve'));
check("financial approvals have a dedicated admin route", api.includes("if (section !== \"master-cash\")") && readFileSync("src/views/admin/index.tsx", "utf8").includes('path="/admin/financial-approvals"'));

if (failures) {
  console.error(`AJN FINANCIAL APPROVAL CONTRACT FAILED: ${failures} check(s).`);
  process.exit(1);
}
console.log("AJN FINANCIAL APPROVAL CONTRACT PASSED — cash-box posting remains approval-first.");
