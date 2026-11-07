/** Simple vehicle profit split (company + one partner): pure arithmetic only. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PartnerShareError, assertPayoutFits, basisPointsLabel, buildPartnerMonths, lastDayOfMonth, monthOf, monthRange,
  nextMonth, partnerBalance, percentToBasisPoints, settleMonths, termForMonth, type PartnerTerm,
} from "../src/lib/vehicle-partner-share";

// Months and dates.
assert.equal(nextMonth("2026-11"), "2026-12");
assert.equal(nextMonth("2026-12"), "2027-01");
assert.deepEqual(monthRange("2026-11", "2027-02"), ["2026-11", "2026-12", "2027-01", "2027-02"]);
assert.deepEqual(monthRange("2026-03", "2026-02"), [], "an empty range when the start is later");
assert.throws(() => monthRange("2000-01", "2099-12"), PartnerShareError, "a typo cannot ask for a century of months");
assert.equal(lastDayOfMonth("2028-02"), "2028-02-29");
assert.equal(lastDayOfMonth("2026-11"), "2026-11-30");
assert.equal(monthOf("2026-11-06T12:00:00.000Z"), "2026-11");
assert.equal(monthOf(null), null);

// Percentages are exact basis points.
assert.equal(percentToBasisPoints("50"), 5000);
assert.equal(percentToBasisPoints("33.33"), 3333);
assert.equal(percentToBasisPoints(12.5), 1250);
assert.equal(percentToBasisPoints("0"), 0);
for (const bad of ["", "-5", "101", "50.555", "abc", "1e2"]) assert.throws(() => percentToBasisPoints(bad), PartnerShareError, bad);
assert.equal(basisPointsLabel(5000), "50%");
assert.equal(basisPointsLabel(3350), "33.5%");

const terms: PartnerTerm[] = [
  { startsMonth: "2026-09", partnerName: "أبو حسين", partnerPhone: null, shareBasisPoints: 5000 },
  { startsMonth: "2026-11", partnerName: "أبو حسين", partnerPhone: null, shareBasisPoints: 4000 },
];
assert.equal(termForMonth(terms, "2026-08"), null, "before the partnership the company owns everything");
assert.equal(termForMonth(terms, "2026-10")?.shareBasisPoints, 5000);
assert.equal(termForMonth(terms, "2027-01")?.shareBasisPoints, 4000, "the latest term lasts until a newer one");

const months = buildPartnerMonths({
  terms,
  throughMonth: "2026-11",
  trips: [
    { eventDate: "2026-08-20", fee: 999_000 }, // before the partnership: not counted
    { eventDate: "2026-09-02", fee: 100_000 },
    { eventDate: "2026-09-15", fee: 50_000, count: 2 },
    { eventDate: "2026-10-10", fee: 20_000 },
    { eventDate: "2026-11-01", fee: 100_000.01 },
    { eventDate: "2026-11-03", fee: null }, // shared overall fee: unknown, not zero
    { eventDate: null, fee: 70_000 },
  ],
  expenses: [
    { date: "2026-09-05T12:00:00.000Z", amount: 30_000, status: "executed" },
    { date: "2026-09-06T12:00:00.000Z", amount: 0, status: "pending" }, // waiting: not a cost yet
    { date: "2026-10-12T12:00:00.000Z", amount: 50_000, status: "executed" }, // a losing month
    { date: "2026-11-02T12:00:00.000Z", amount: 0, status: "rejected" },
  ],
});
assert.deepEqual(months.map((month) => month.month), ["2026-09", "2026-10", "2026-11"]);
const [sep, oct, nov] = months;
assert.deepEqual({ trips: sep.tripCount, income: sep.income, expenses: sep.expenses, net: sep.net, partner: sep.partnerShare, company: sep.companyShare, pending: sep.pendingExpenses },
  { trips: 3, income: 150_000, expenses: 30_000, net: 120_000, partner: 60_000, company: 60_000, pending: 1 });
assert.deepEqual({ net: oct.net, partner: oct.partnerShare, company: oct.companyShare }, { net: -30_000, partner: -15_000, company: -15_000 }, "a loss is shared like a profit");
assert.equal(nov.shareBasisPoints, 4000, "a changed percentage applies from its month only");
assert.equal(nov.unallocatedTrips, 1);
assert.equal(nov.income, 100_000.01);
assert.equal(nov.partnerShare, 40_000, "fils round half away from zero");
assert.equal(Math.round((nov.partnerShare + nov.companyShare) * 100), Math.round(nov.net * 100), "the two shares always add up to the net");

const stopped = buildPartnerMonths({ terms: [...terms, { startsMonth: "2026-12", partnerName: "أبو حسين", partnerPhone: null, shareBasisPoints: 0 }], throughMonth: "2026-12", trips: [{ eventDate: "2026-12-01", fee: 10_000 }], expenses: [] });
assert.equal(stopped.at(-1)!.partnerShare, 0, "a 0% term ends the partnership");
assert.equal(stopped.at(-1)!.partnerName, null);
assert.deepEqual(buildPartnerMonths({ terms: [], trips: [], expenses: [], throughMonth: "2026-11" }), []);
assert.deepEqual(buildPartnerMonths({ terms: [{ ...terms[0], startsMonth: "2027-01" }], trips: [], expenses: [], throughMonth: "2026-11" }), [], "a future partner has no months yet");

// Balance: earned (losses included) minus paid minus waiting requests.
const balance = partnerBalance(months, 30_000, 10_000);
assert.deepEqual(balance, { earned: 85_000, paid: 30_000, pending: 10_000, remaining: 45_000, available: 45_000 });
assert.equal(assertPayoutFits(45_000, balance), 45_000);
assert.throws(() => assertPayoutFits(45_000.01, balance), (error: unknown) => error instanceof PartnerShareError && error.status === 409, "no payout above the remaining share");
assert.throws(() => assertPayoutFits(0, balance), PartnerShareError);
assert.throws(() => assertPayoutFits(10.005, balance), PartnerShareError, "two decimals at most");
const over = partnerBalance(months, 90_000, 0);
assert.equal(over.remaining, -5_000, "an overpaid partner shows a negative remaining");
assert.equal(over.available, 0);

// Month by month: a payout names its month; older payouts without one fill the oldest months first.
{
  const paidBalance = partnerBalance(months, 70_000, 0);
  const settled = settleMonths(months, [{ month: "2026-09", paid: 20_000, pending: 0 }, { month: null, paid: 50_000, pending: 0 }], paidBalance);
  const by = Object.fromEntries(settled.map((row) => [row.month, row]));
  assert.deepEqual([by["2026-09"].paid, by["2026-09"].remaining, by["2026-09"].payable], [60_000, 0, 0], "September is settled by its own payout plus the oldest loose money");
  assert.deepEqual([by["2026-10"].paid, by["2026-10"].payable], [0, 0], "a losing month owes nothing and takes no loose money");
  assert.deepEqual([by["2026-11"].paid, by["2026-11"].remaining, by["2026-11"].payable], [10_000, 30_000, 15_000], "a month never pays more than the overall balance left after a loss");
  assert.deepEqual(settled.map((row) => row.month), months.map((row) => row.month), "months keep their order");
  const waiting = settleMonths(months, [{ month: "2026-11", paid: 0, pending: 5_000 }], partnerBalance(months, 0, 5_000));
  const nov = waiting.find((row) => row.month === "2026-11")!;
  assert.deepEqual([nov.pending, nov.remaining, nov.payable], [5_000, 35_000, 35_000], "a waiting request holds its month's amount");
  const over = settleMonths(months, [{ month: null, paid: 200_000, pending: 0 }], partnerBalance(months, 200_000, 0));
  assert.ok(over.every((row) => row.payable === 0), "nothing is payable once the partner received more than his share");
  assert.equal(over.find((row) => row.month === "2026-11")!.paid, 140_000, "money above every share stays visible on the latest month");
}

// Wiring: the API reads paid from executed cash rows only and locks the vehicle.
const api = readFileSync(new URL("../src/server/api.ts", import.meta.url), "utf8");
const route = api.slice(api.indexOf('parts[2] === "partner"'), api.indexOf('parts[2] === "expenses" && method === "POST"'));
assert.match(route, /requirePermission\(req, "accounting"\)/, "setting a partner or a payout needs accounting permission");
assert.match(route, /for update/, "payouts lock the vehicle row");
assert.match(route, /vehiclePartnerPayouts\(tx, vehicleId, true\)/, "paid and pending are re-read inside the transaction");
assert.match(route, /createAndExecuteSourceFinancialTransaction\(tx/, "a payout is a main-cash request waiting for approval");
assert.match(route, /sourceType: "vehicle_partner_share"/);
const payouts = api.slice(api.indexOf("async function vehiclePartnerPayouts"), api.indexOf("async function vehiclePartnerState"));
assert.match(payouts, /approval_status = 'executed'/, "only executed reversals reduce what was paid");
assert.match(payouts, /row\.approval_status === "executed"\) \{ paid \+=/, "only executed payouts count as paid");
assert.match(route, /month: d\.month|d\.month/, "a payout names the month it pays");
assert.match(route, /settleMonths\(\[\.\.\.state\.months\], cash\.slices, balance\)/, "the month cap is re-read inside the transaction");
assert.match(route, /insert into vehicle_partner_payout_months/, "the payout's month is stored with it");
const trips = api.slice(api.indexOf('parts[2] === "trips" && method === "POST"'), api.indexOf('parts[2] === "maintenance" && method === "POST"'));
assert.match(trips, /requirePermission\(req, "accounting"\)/, "adding transport or collecting its fee needs accounting permission");
assert.match(trips, /sourceType: "vehicle_trip"/, "a transport fee is a main-cash request waiting for approval");
assert.match(trips, /for update/, "collection and cancellation lock the trip");
assert.match(trips, /cash\.collected > 0 \|\| cash\.pending > 0/, "a trip with money collected or waiting cannot be cancelled");
assert.match(trips, /if \(cash\.pending > 0\) throw/, "a second collection waits for the first");
assert.match(api, /where t\.vehicle_id = \$\{vehicleId\} and t\.status = 'active'/, "only active standalone trips count as the vehicle's income");
const tripsMigration = readFileSync(new URL("../lib/db/migrations/0137_vehicle_trips_and_payout_months.sql", import.meta.url), "utf8");
assert.doesNotMatch(tripsMigration.replace(/--.*$/gm, ""), /(drop|truncate|delete\s+from|update\s|alter\s+column|alter\s+table)/i, "the 0137 migration is additive only");
assert.match(tripsMigration, /CHECK \("fee" > 0\)/);
assert.match(tripsMigration, /"financial_transaction_id" integer PRIMARY KEY REFERENCES "financial_transactions"/, "one month per payout");
const migration = readFileSync(new URL("../lib/db/migrations/0136_vehicle_partners.sql", import.meta.url), "utf8");
assert.doesNotMatch(migration.replace(/--.*$/gm, ""), /\b(drop|truncate|delete\s+from|update\s|alter\s+column)\b/i, "the migration is additive only");
assert.match(migration, /unique index[\s\S]*\("vehicle_id", "starts_month"\)/i);

// Printed receipt and monthly report: only an executed payout reads as money paid.
const { buildPartnerPayoutReceiptHtml, buildVehicleMonthReportHtml } = await import("../src/components/vehicle-print");
const receipt = { id: 9, transactionNo: "FIN-2611-000010", date: "2026-11-06", month: "2026-10", amount: 50_000, status: "executed", paymentMethod: "cash", note: "<دفعة>", partnerName: "أبو حسين", partnerPhone: "07701234567", vehicleName: "كيا", plateNumber: "P-1", monthShare: 60_000, monthRemaining: 10_000 };
for (const size of ["a5", "80mm"] as const) {
  const paid = buildPartnerPayoutReceiptHtml(receipt, size);
  assert.match(paid, /وصل صرف حصة شريك/);
  assert.match(paid, /50,000/);
  assert.match(paid, /2026 \/ 10/, "the receipt names the month it pays");
  assert.match(paid, /&lt;دفعة&gt;/, "notes are escaped");
  assert.doesNotMatch(paid, /<script/i, "the shared print dialog adds the print script");
  const waiting = buildPartnerPayoutReceiptHtml({ ...receipt, status: "pending" }, size);
  assert.match(waiting, /بانتظار الموافقة/);
  assert.doesNotMatch(waiting, /وصل صرف حصة شريك/, "a waiting request never prints as a payment receipt");
}
const report = buildVehicleMonthReportHtml({
  vehicleName: "كيا", plateNumber: "P-1", month: "2026-10",
  summary: { tripCount: 3, income: 150_000, expenses: 30_000, net: 120_000, unallocatedBookings: 1 },
  trips: [{ date: "2026-10-02", number: "B-7", customer: "زبون", driver: null, fee: 100_000, standalone: false }, { date: "2026-10-05", number: "T-3", customer: "نقل خارجي", driver: "سائق", fee: 50_000, standalone: true }],
  expenses: [{ date: "2026-10-05", type: "وقود", description: null, amount: 30_000, counted: true, status: "executed" }, { date: "2026-10-06", type: "تصليح", description: "قيد", amount: 5_000, counted: false, status: "pending" }],
  partner: { name: "أبو حسين", shareBasisPoints: 5000, partnerShare: 60_000, companyShare: 60_000, paid: 50_000, pending: 0, remaining: 10_000 },
  payouts: [{ date: "2026-11-06", number: "FIN-2611-000010", amount: 50_000, status: "executed" }],
});
for (const text of ["تقرير السيارة الشهري", "2026 / 10", "150,000", "120,000", "حصة الشريك أبو حسين (50%)", "حصة الشركة", "الباقي للشريك من هذا الشهر", "نقل مستقل", "بانتظار الموافقة — غير محسوب", "أجرة كلية لعدة سيارات"]) assert.ok(report.includes(text), text);
assert.match(buildVehicleMonthReportHtml({ vehicleName: "كيا", plateNumber: null, month: "2026-10", summary: { tripCount: 0, income: 0, expenses: 0, net: 0, unallocatedBookings: 0 }, trips: [], expenses: [], partner: null, payouts: [] }), /لا يوجد شريك بهذا الشهر/);

console.log("PASS vehicle partner share: months, exact percentages, profit and loss split, changed and stopped terms, balance, month-by-month settlement and caps, payout ceiling, cash-only paid, locked payouts and trips, additive migrations, printed receipt and monthly report");
