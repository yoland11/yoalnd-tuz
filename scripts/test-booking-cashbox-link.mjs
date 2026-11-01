import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

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

// 3. The booking's movement log and the ledger's booking filter share one definition of a
//    booking's movements, including receipt vouchers, penalties and group photos.
const finance = api.slice(api.indexOf('if (resource === "finance" && method === "GET") {'));
const link = readFileSync("src/server/booking-cash-link.ts", "utf8");
assert.match(finance.slice(0, 600), /where: await bookingTransactionCondition\(db as any, reference\.entityType, reference\.id\)/);
assert.match(link, /SELECT v\.id FROM receipt_vouchers v[\s\S]*v\.kosha_booking_id = \$\{id\}[\s\S]*receipt_voucher_allocations a/);
assert.match(link, /eq\(table\.sourceType, "receipt_voucher"\), inArray\(table\.sourceId, voucherIds\)/);
assert.match(link, /eq\(table\.sourceType, "booking_penalty"\), inArray\(table\.sourceId, penaltyIds\)/);
assert.match(link, /eq\(table\.sourceType, "group_photo"\)/);
const cashBox = readFileSync("src/server/master-cash-box.ts", "utf8");
assert.match(cashBox, /conditions\.push\(await bookingTransactionCondition\(db, bookingEntityType\(filters\.bookingSource\)!, filters\.bookingId\)\)/, "the ledger filters by the same definition");
// The tab states the stored total: products are already in it and damage is a separate due.
assert.match(finance.slice(0, 3000), /const finalAmount = total;/);
assert.doesNotMatch(finance.slice(0, 3000), /total \+ productCharges/, "product charges are not counted twice");
assert.match(finance.slice(0, 3000), /cash: await bookingCashSummary\(/);

// 4. The finance tab says when a payment is waiting for approval and which date the cash box uses.
assert.match(workspace, /دفعة بانتظار الاعتماد: \{money\(cash\.waiting\)\}/);
assert.match(workspace, /href="\/admin\/approvals"/);
assert.match(workspace, /readableDate\(row\.transactionDate \?\? row\.transactionTime\)/);
assert.match(workspace, /لم تُرحّل بعد/);

// 4b. Each side opens the other, and only for staff who can open it, in a real RTL layout.
assert.match(workspace, /<Tabs dir="rtl" value=\{tab\}/);
const masterCash = readFileSync("src/views/admin/master-cash.tsx", "utf8");
assert.match(workspace, /const canOpenCash = hasPerm\(me\.data \?\? null, "accounting"\)/);
assert.match(workspace, /\/admin\/finance\/master-cash\?bookingSource=\$\{booking\.source\}&bookingId=\$\{booking\.id\}/);
assert.match(workspace, /\/admin\/finance\/master-cash\?transaction=\$\{row\.id\}/);
assert.match(masterCash, /<Tabs dir="rtl" value=\{mcTab\}/);
assert.match(masterCash, /const canOpenBooking = hasPerm\(me, "orders"\)/);
assert.match(masterCash, /\/admin\/bookings\/\$\{booking\.source\}\/\$\{booking\.id\}\?tab=finance/);

// 5. A rejected or cancelled payment request never leaves its booking/order shown as paid:
//    both paths rebuild the document from approved money, like approval does.
const cash = readFileSync("src/server/master-cash-box.ts", "utf8");
// Exercise both supplied-transaction and default callers; do not pin the
// implementation to an inline db.transaction callback that forbids reuse.
execFileSync(process.execPath, ["scripts/test-source-financial-executor.mjs"], { stdio: "inherit" });
const reject = cash.slice(cash.indexOf("export async function rejectFinancialTransaction("), cash.indexOf("export async function reverseFinancialTransaction("));
assert.match(reject, /isPaymentStateSourceType\(existing\.sourceType\)\)\s*await reconcilePaymentState\(tx, \{ sourceType: existing\.sourceType, sourceId: existing\.sourceId \}\)/, "reject reconciles inside its transaction");

console.log("PASS  booking cash box link: payment date, receipt vouchers in the booking log, pending notice, Arabic text, reconcile on reject/cancel");
