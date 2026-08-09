import assert from "node:assert/strict";
import { resolvePayrollPeriod } from "../src/server/payroll-periods";

const monthly = resolvePayrollPeriod({ period: "2026-08", periodType: "monthly" });
assert.deepEqual(monthly, {
  period: "2026-08", periodType: "monthly", periodKey: "monthly:2026-08-01:2026-08-31",
  start: "2026-08-01", end: "2026-08-31", paymentDate: "2026-08-31", calendarDays: 31,
});

const weekly = resolvePayrollPeriod({ period: "2026-08", periodType: "weekly", periodStartDate: "2026-08-09" });
assert.equal(weekly.end, "2026-08-15");
assert.equal(weekly.periodKey, "weekly:2026-08-09:2026-08-15");

const biweekly = resolvePayrollPeriod({ period: "2026-08", periodType: "biweekly", periodStartDate: "2026-08-09" });
assert.equal(biweekly.end, "2026-08-22");
assert.equal(biweekly.calendarDays, 14);

const daily = resolvePayrollPeriod({ period: "2026-08", periodType: "daily", periodStartDate: "2026-08-09" });
assert.equal(daily.end, "2026-08-09");
assert.equal(daily.calendarDays, 1);

const custom = resolvePayrollPeriod({ periodType: "custom", periodStartDate: "2026-08-21", periodEndDate: "2026-09-03", paymentDate: "2026-09-05" });
assert.equal(custom.period, "2026-08");
assert.equal(custom.periodKey, "custom:2026-08-21:2026-09-03");
assert.equal(custom.calendarDays, 14);

assert.notEqual(monthly.periodKey, weekly.periodKey);
assert.throws(() => resolvePayrollPeriod({ period: "2026-08", periodType: "custom", periodStartDate: "2026-08-01" }), /يتطلب الراتب المخصص/);
assert.throws(() => resolvePayrollPeriod({ period: "2026-08", periodType: "weekly", periodStartDate: "2026-08-16", periodEndDate: "2026-08-09" }), /بداية فترة الرواتب/);

console.log("Payroll period logic: 13 assertions passed (monthly, weekly, biweekly, daily, custom, unique keys and validation).");
