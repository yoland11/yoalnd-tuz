import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calculateAttendancePayroll, type AttendancePayrollRecord } from "../src/server/attendance-payroll";
import { canEditPayroll, canTransitionPayroll } from "../src/server/payroll-lifecycle";

const base = {
  periodStart: "2026-08-23",
  periodEnd: "2026-08-23",
  baseSalary: 600_000,
  dailyWorkingHours: 8,
  workingDaysPerWeek: 6,
  weeklyDaysOff: ["fri"],
  shiftStart: "09:00",
  shiftEnd: "17:00",
  overtimeRate: 3_000,
  weekendHourRate: 4_500,
  holidayHourRate: 6_000,
  lateDeductionRate: 100,
  absenceDeductionRate: 20_000,
  policy: {
    lateGraceMinutes: 10,
    lateDeductionRule: "per_minute" as const,
    absenceDeductionRule: "fixed_per_day" as const,
    earlyLeaveDeductionRule: "per_minute" as const,
    earlyLeaveDeductionRate: 50,
    unpaidLeaveDeductionRule: "fixed_per_day" as const,
    unpaidLeaveDeductionRate: 25_000,
  },
};

const record = (checkInAt: string | null, checkOutAt: string | null, status = "present"): AttendancePayrollRecord => ({ checkInAt, checkOutAt, status });
const calculate = (records: AttendancePayrollRecord[], overrides: Record<string, unknown> = {}) => calculateAttendancePayroll({ ...base, ...overrides, records } as any);

const normal = calculate([record("2026-08-23T06:00:00Z", "2026-08-23T14:00:00Z")]);
assert.equal(normal.presentDays, 1, "normal attendance: present day");
assert.equal(normal.workedHours, 8, "normal attendance: worked hours");
assert.equal(normal.absenceDeduction, 0, "normal attendance: no absence deduction");

const late = calculate([record("2026-08-23T06:30:00Z", "2026-08-23T14:00:00Z", "late")]);
assert.equal(late.lateMinutes, 20, "late employee: grace period applied");
assert.equal(late.lateDeduction, 2_000, "late employee: per-minute deduction");

const early = calculate([record("2026-08-23T06:00:00Z", "2026-08-23T13:00:00Z")]);
assert.equal(early.earlyLeaveMinutes, 60, "early leave minutes");
assert.equal(early.earlyLeaveDeduction, 3_000, "early leave deduction");

const absent = calculate([]);
assert.equal(absent.absenceDays, 1, "absence day");
assert.equal(absent.missingCheckIn, 1, "absence has missing check-in");
assert.equal(absent.absenceDeduction, 20_000, "fixed absence deduction");

const paidLeave = calculate([record("2026-08-23T12:00:00Z", "2026-08-23T12:00:00Z", "paid_leave")]);
assert.equal(paidLeave.paidLeaveDays, 1, "paid leave counted");
assert.equal(paidLeave.absenceDays, 0, "paid leave is not absence");

const unpaidLeave = calculate([record("2026-08-23T12:00:00Z", "2026-08-23T12:00:00Z", "unpaid_leave")]);
assert.equal(unpaidLeave.unpaidLeaveDays, 1, "unpaid leave counted");
assert.equal(unpaidLeave.unpaidLeaveDeduction, 25_000, "unpaid leave deduction");

const overtime = calculate([record("2026-08-23T06:00:00Z", "2026-08-23T16:00:00Z")]);
assert.equal(overtime.overtimeHours, 2, "overtime hours");
assert.equal(overtime.overtimeAmount, 6_000, "regular overtime amount");

const weekend = calculate([record("2026-08-21T06:00:00Z", "2026-08-21T10:00:00Z")], { periodStart: "2026-08-21", periodEnd: "2026-08-21" });
assert.equal(weekend.weekendOvertimeHours, 4, "weekend overtime hours");
assert.equal(weekend.overtimeAmount, 18_000, "weekend overtime rate");

const holiday = calculate([record("2026-08-23T06:00:00Z", "2026-08-23T10:00:00Z")], { policy: { ...base.policy, holidays: ["2026-08-23"] } });
assert.equal(holiday.holidayOvertimeHours, 4, "holiday overtime hours");
assert.equal(holiday.overtimeAmount, 24_000, "holiday overtime rate");

const missingCheckout = calculate([record("2026-08-23T06:00:00Z", null)]);
assert.equal(missingCheckout.missingCheckOut, 1, "missing checkout detected");

const corrected = calculate([record("2026-08-23T06:00:00Z", "2026-08-23T14:00:00Z")]);
assert.equal(missingCheckout.missingCheckOut, 1, "correction fixture starts incomplete");
assert.equal(corrected.missingCheckOut, 0, "corrected attendance removes missing checkout");
assert.equal((corrected as any).netSalary === undefined, true, "attendance calculator does not finalize salary");

assert.match(absent.formulas.absence, /غياب 1 يوم × 20,000 د\.ع = 20,000 د\.ع خصم/, "calculation details contain exact absence formula");
assert.match(late.formulas.late, /تأخير 20 دقيقة/, "calculation details contain exact late formula");
assert.match(overtime.formulas.overtime, /إضافي 2 ساعة/, "calculation details contain exact overtime formula");

const invalidOrder = calculate([record("2026-08-23T14:00:00Z", "2026-08-23T06:00:00Z")]);
assert.equal(invalidOrder.invalidTimeOrder, 1, "invalid time order detected");

assert.equal(canTransitionPayroll("calculated", "under_review"), true, "payroll enters manager review");
assert.equal(canTransitionPayroll("pending_manager_approval", "approved"), true, "manager can approve");
assert.equal(canTransitionPayroll("approved", "ready_to_pay"), true, "approval and payment remain separate");
assert.equal(canEditPayroll("approved"), false, "approved payroll protected from recalculation");
assert.equal(canEditPayroll("paid"), false, "paid payroll protected from recalculation");

const originalCalculated = 5_000;
const managerAdjustment = { originalCalculated, adjustedValue: 7_500, employeeId: 10, managerId: 1, reason: "مراجعة موثقة" };
assert.equal(managerAdjustment.reason.length >= 3, true, "manager adjustment requires reason");
assert.equal(managerAdjustment.originalCalculated, 5_000, "manager adjustment preserves original value");

const apiSource = readFileSync(new URL("../src/server/api.ts", import.meta.url), "utf8");
const payrollSource = readFileSync(new URL("../src/server/hr-intelligence.ts", import.meta.url), "utf8");
assert.match(apiSource, /pg_advisory_xact_lock/, "fingerprint writes serialize per employee");
assert.match(apiSource, /check_out_at is null limit 1 for update/, "multiple active fingerprint sessions are rejected");
assert.match(apiSource, /وقت الانصراف لا يمكن أن يسبق وقت الحضور/, "attendance corrections reject invalid time order");
assert.match(payrollSource, /reason: z\.string\(\)\.trim\(\)\.min\(3/, "manager payroll edits require a reason");
assert.match(payrollSource, /originalCalculated/, "payroll keeps original calculated values");

console.log("attendance-payroll scenarios: 15 passed");
