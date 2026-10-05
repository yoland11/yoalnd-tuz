import assert from "node:assert/strict";
import * as access from "../src/lib/graduation-group-pricing-access";

assert.equal(typeof access.canManageGraduationGroupPricing, "function", "pricing must have a scoped authorization decision");
const user = (permissions: string[], role = "employee") => ({ role, permissions, isActive: true });
assert.equal(access.canManageGraduationGroupPricing(user([], "admin")), true);
assert.equal(access.canManageGraduationGroupPricing(user(["graduation.price.edit"])), true);
assert.equal(access.canManageGraduationGroupPricing(user(["graduation"])), true);
for (const permission of ["accounting", "products", "graduation.view", "graduation.group.edit", "representative.portal.access"]) {
  assert.equal(access.canManageGraduationGroupPricing(user([permission])), false, permission);
}
assert.equal(access.canManageGraduationGroupPricing({ ...user([], "admin"), isActive: false }), false);
assert.equal(access.canManageAssignedGroupPricing(user(["representative.portal.access"]), true), true);
assert.equal(access.canManageAssignedGroupPricing(user(["representative.portal.access"]), false), false);
assert.equal(access.canManageAssignedGroupPricing(user(["representative.group.view"]), true), false);
console.log("Graduation group pricing authorization: PASS");
