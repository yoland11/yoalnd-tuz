import assert from "node:assert/strict";
import { canEditPayroll, canTransitionPayroll, payrollStatusLabel } from "../src/server/payroll-lifecycle";

assert.equal(canTransitionPayroll("draft", "under_review"), true);
assert.equal(canTransitionPayroll("under_review", "pending_manager_approval"), true);
assert.equal(canTransitionPayroll("approved", "ready_to_pay"), true);
assert.equal(canTransitionPayroll("ready_to_pay", "partially_paid"), true);
assert.equal(canTransitionPayroll("partially_paid", "paid"), true);
assert.equal(canTransitionPayroll("paid", "closed"), true);
assert.equal(canTransitionPayroll("closed", "draft"), false);
assert.equal(canTransitionPayroll("ready_to_pay", "under_review"), false);
assert.equal(canEditPayroll("reopened"), true);
assert.equal(canEditPayroll("approved"), false);
assert.equal(payrollStatusLabel("ready_to_pay"), "جاهزة للصرف");
console.log("Payroll lifecycle assertions passed: 11");
