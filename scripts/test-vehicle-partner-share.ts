/** Simple vehicle profit split (company + one partner): pure arithmetic only. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PartnerShareError, assertPayoutFits, basisPointsLabel, buildPartnerMonths, lastDayOfMonth, monthOf, monthRange,
  nextMonth, partnerBalance, percentToBasisPoints, termForMonth, type PartnerTerm,
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

// Wiring: the API reads paid from executed cash rows only and locks the vehicle.
const api = readFileSync(new URL("../src/server/api.ts", import.meta.url), "utf8");
const route = api.slice(api.indexOf('parts[2] === "partner"'), api.indexOf('parts[2] === "expenses" && method === "POST"'));
assert.match(route, /requirePermission\(req, "accounting"\)/, "setting a partner or a payout needs accounting permission");
assert.match(route, /for update/, "payouts lock the vehicle row");
assert.match(route, /vehiclePartnerPayouts\(tx, vehicleId\)/, "paid and pending are re-read inside the transaction");
assert.match(route, /createAndExecuteSourceFinancialTransaction\(tx/, "a payout is a main-cash request waiting for approval");
assert.match(route, /sourceType: "vehicle_partner_share"/);
const payouts = api.slice(api.indexOf("async function vehiclePartnerPayouts"), api.indexOf("async function vehiclePartnerState"));
assert.match(payouts, /approval_status = 'executed'/, "only executed reversals reduce what was paid");
assert.match(payouts, /row\.approval_status === "executed"\) paid/, "only executed payouts count as paid");
const migration = readFileSync(new URL("../lib/db/migrations/0136_vehicle_partners.sql", import.meta.url), "utf8");
assert.doesNotMatch(migration.replace(/--.*$/gm, ""), /\b(drop|truncate|delete\s+from|update\s|alter\s+column)\b/i, "the migration is additive only");
assert.match(migration, /unique index[\s\S]*\("vehicle_id", "starts_month"\)/i);

console.log("PASS vehicle partner share: months, exact percentages, profit and loss split, changed and stopped terms, balance, payout ceiling, cash-only paid, locked payouts, additive migration");
