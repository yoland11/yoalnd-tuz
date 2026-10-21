import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// A booking payment reaches the Main Cash Box on the day it is taken and is
// visible from the booking itself.
const api = readFileSync("src/server/api.ts", "utf8");
const workspace = readFileSync("src/views/admin/booking-operations-workspace.tsx", "utf8");

// 1. Payment syncs (store order, service booking, kosha booking, rental) date new
//    movements today; the cash box lists and totals by transaction_date.
for (const name of ["syncOrderFinancialPayment", "syncServiceOrderFinancialPayment", "syncKoshaFinancialPayment", "syncRentalFinancialPayment"]) {
  const start = api.indexOf(`async function ${name}(`);
  assert.ok(start > 0, `${name} exists`);
  const body = api.slice(start, api.indexOf("\n}\n", start));
  assert.match(body, /transactionDate: baghdadToday\(\),/, `${name} dates the movement today`);
  assert.doesNotMatch(body, /transactionDate: order\.createdAt/, `${name} no longer back-dates to the booking's creation day`);
}

// 2. No double-encoded Arabic in server messages (approval notes, errors).
assert.doesNotMatch(api, /Ø[ª§ -ÿ]/, "no mojibake strings");
assert.match(api, /"تحصيل مباشر من الإدارة"/);

// 3. The booking's movement log includes receipt-voucher collections (kosha payments).
const finance = api.slice(api.indexOf('if (resource === "finance" && method === "GET") {'));
assert.match(finance.slice(0, 2500), /SELECT v\.id FROM receipt_vouchers v[\s\S]*v\.kosha_booking_id = \$\{reference\.id\}[\s\S]*receipt_voucher_allocations a/);
assert.match(finance.slice(0, 2500), /eq\(financialTransactionsTable\.sourceType, "receipt_voucher"\),\s*inArray\(financialTransactionsTable\.sourceId, voucherIds\)/);

// 4. The finance tab says when a payment is waiting for approval and which date the cash box uses.
assert.match(workspace, /دفعة بانتظار الاعتماد: \{money\(amount\)\}/);
assert.match(workspace, /href="\/admin\/approvals"/);
assert.match(workspace, /readableDate\(row\.transactionDate \?\? row\.transactionTime\)/);
assert.match(workspace, /"لم تُرحّل بعد"/);

console.log("PASS  booking cash box link: payment date, receipt vouchers in the booking log, pending notice, Arabic text");
