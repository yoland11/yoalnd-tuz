import assert from "node:assert/strict";
import {
  assignmentDecision,
  representativeStaffIsEligible,
} from "../src/lib/representative-assignment-policy";

const base = {
  currentActiveGroupIds: [] as number[],
  targetGroupId: 8,
  hasPaymentRequests: false,
  hasCustodyHandovers: false,
  resolveAmbiguous: false,
};

assert.equal(assignmentDecision(base), "assign", "a new account can get its first group");
assert.equal(assignmentDecision({ ...base, currentActiveGroupIds: [8] }), "same",
  "saving the same group is idempotent");
assert.equal(assignmentDecision({ ...base, currentActiveGroupIds: [9] }), "replace",
  "an account without financial activity may move to a different group");
assert.equal(assignmentDecision({ ...base, currentActiveGroupIds: [8, 9] }), "ambiguous",
  "two active legacy groups need an explicit admin correction");
assert.equal(assignmentDecision({ ...base, currentActiveGroupIds: [8, 9], resolveAmbiguous: true }), "replace",
  "explicit admin correction may resolve an ambiguity before financial activity");
for (const financial of [{ hasPaymentRequests: true }, { hasCustodyHandovers: true }]) {
  assert.equal(assignmentDecision({ ...base, currentActiveGroupIds: [9], ...financial }), "financiallyLocked",
    "a representative with financial history cannot move groups");
  assert.equal(assignmentDecision({ ...base, ...financial }), "financiallyLocked",
    "a missing active link cannot be silently rebound after financial activity");
  assert.equal(assignmentDecision({ ...base, currentActiveGroupIds: [8], ...financial }), "same",
    "re-saving the historical group remains idempotent");
  assert.equal(assignmentDecision({ ...base, currentActiveGroupIds: [8, 9], resolveAmbiguous: true, ...financial }), "financiallyLocked",
    "an ambiguous financial account requires manual review, not automatic rewriting");
}
assert.equal(assignmentDecision({ ...base, hasPaymentRequests: true,
  historicalGroupIds: [8], paymentGroupIds: [8] }), "assign",
  "a deactivated representative may restore only the sole group tied to historical payments");
assert.equal(assignmentDecision({ ...base, hasCustodyHandovers: true,
  historicalGroupIds: [8] }), "assign",
  "a custody account may restore its sole historical assignment");
assert.equal(assignmentDecision({ ...base, hasPaymentRequests: true,
  historicalGroupIds: [8, 9], paymentGroupIds: [8] }), "financiallyLocked",
  "multiple historical groups cannot be inferred from custody or payment activity");
assert.equal(assignmentDecision({ ...base, hasPaymentRequests: true,
  historicalGroupIds: [8], paymentGroupIds: [9] }), "financiallyLocked",
  "a payment for another group blocks automatic restoration");

assert.equal(representativeStaffIsEligible({ isActive: true, role: "employee",
  permissions: ["representative.portal.access"] }), true);
assert.equal(representativeStaffIsEligible({ isActive: false, role: "employee",
  permissions: ["representative.portal.access"] }), false);
assert.equal(representativeStaffIsEligible({ isActive: true, role: "employee", permissions: [] }), false);
assert.equal(representativeStaffIsEligible({ isActive: true, role: "admin", permissions: [] }), false,
  "admin accounts already have global access and cannot be linked as a representative");

console.log("Representative assignment policy tests passed");
