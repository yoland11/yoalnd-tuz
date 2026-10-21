import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// A company loan follows its financial request: rejected requests never leave
// a loan stuck «بانتظار الموافقة», and only loans whose money entered the cash
// box can be repaid or counted as liabilities.
const api = readFileSync("src/server/api.ts", "utf8");
const cash = readFileSync("src/server/master-cash-box.ts", "utf8");
const ui = readFileSync("src/views/admin/loans.tsx", "utf8");
const between = (text, start, end) => {
  const from = text.indexOf(start);
  assert.ok(from >= 0, `missing: ${start}`);
  return text.slice(from, end ? text.indexOf(end, from) : from + 6000);
};

// 1. Rejecting or cancelling the request updates the loan / repayment.
const reject = between(cash, "export async function rejectFinancialTransaction(", "export async function reverseFinancialTransaction(");
assert.match(reject, /existing\.sourceType === "company_loan"\) \{[\s\S]*UPDATE company_loans SET status = 'rejected', updated_at = now\(\) WHERE id = \$\{sourceId\} AND status = 'pending'/);
assert.match(reject, /existing\.sourceType === "company_loan_repayment"\) \{[\s\S]*UPDATE company_loan_repayments SET status = 'rejected'/);
const cancel = between(cash, "export async function cancelFinancialTransactionRequest(", "/** Roles that may perform the final");
assert.match(cancel, /UPDATE company_loans SET status = 'cancelled', updated_at = now\(\) WHERE id = \$\{loanSourceId\} AND status = 'pending'/);
assert.match(cancel, /UPDATE company_loan_repayments SET status = 'rejected'/);

// 2. The list shows each older loan's real outcome (read-only, no write on GET).
const list = between(api, "async function handleCompanyLoans(", 'if (req.method === "POST"');
assert.match(list, /if \(request === "rejected"\) return "rejected";/);
assert.match(list, /if \(request === "executed"\) return "active";/);
assert.match(list, /status: effectiveLoanStatus\(loan\),/);
assert.doesNotMatch(list, /\.update\(companyLoansTable\)/, "listing loans never writes");

// 3. «مسح / إلغاء» closes a loan whose request was already rejected instead of refusing.
const del = between(api, "// \"Delete\" means cancel the still-pending request.", 'if (req.method === "POST" && id && parts[3] === "repayments"');
assert.match(del, /lockedTransaction\?\.approval_status === "rejected"[\s\S]*status: "rejected"[\s\S]*action: "company_loan_closed_after_rejection"/);
assert.match(del, /lockedTransaction\?\.approval_status === "executed"[\s\S]*لا يُلغى/);

// 4. Repayment requires money that actually entered the cash box.
const repay = between(api, 'if (req.method === "POST" && id && parts[3] === "repayments" && !parts[4]) {');
assert.match(repay, /if \(loan\.status === "pending"\) \{[\s\S]*request\?\.approval_status !== "executed"[\s\S]*لا يمكن تسديد قرض قبل اعتماد استلامه/);
assert.match(repay, /\["rejected", "cancelled"\]\.includes\(String\(loan\.status\)\)/);

// 5. Totals count only posted loans; rejected/cancelled rows say why.
assert.match(ui, /\.filter\(\(loan\) => \["active", "partially_repaid", "fully_repaid"\]\.includes\(loan\.status\)\)\.reduce\(/);
assert.match(ui, /لم يدخل الصندوق ولا يُحسب في الالتزامات/);

console.log("PASS  company loans: rejection/cancel update the loan, list shows real outcome, close rejected, repay only posted loans");
