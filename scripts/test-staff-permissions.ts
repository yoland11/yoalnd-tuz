import assert from "node:assert/strict";
import {
  canAssignStaffRole,
  canAssignStaffRoleTo,
  canManageStaffPermissionSets,
  hasStaffPermission,
  isLimitedStaffRoleAssignable,
  type StaffPermission,
} from "../src/lib/staff-permissions";

const actions: StaffPermission[] = ["staff.view", "staff.create", "staff.edit", "staff.delete"];

for (const action of actions) {
  assert.equal(hasStaffPermission(["staff"], action), true, `legacy staff grant keeps ${action}`);
}

assert.equal(hasStaffPermission(["staff.view"], "staff.view"), true);
assert.equal(hasStaffPermission(["staff.view"], "staff.create"), false);
assert.equal(hasStaffPermission(["staff.create"], "staff.view"), false);
assert.equal(hasStaffPermission(["staff.edit"], "staff.create"), false);
assert.equal(hasStaffPermission(["staff.delete"], "staff.edit"), false);
assert.equal(hasStaffPermission([], "staff.delete"), false);

assert.equal(canAssignStaffRole("admin", []), true);
assert.equal(canAssignStaffRole("employee", ["staff"]), true);
assert.equal(canAssignStaffRole("employee", ["staff.role"]), true);
assert.equal(canAssignStaffRole("employee", ["staff.edit"]), false);
assert.equal(canAssignStaffRoleTo("employee", ["staff.role"], "photographer"), true);
assert.equal(canAssignStaffRoleTo("employee", ["staff.role"], "manager"), false);
assert.equal(canAssignStaffRoleTo("employee", ["staff.edit"], "employee"), false);
assert.equal(canAssignStaffRoleTo("admin", [], "accountant"), true);
assert.equal(canManageStaffPermissionSets("employee", ["staff.role"]), false);
assert.equal(canManageStaffPermissionSets("employee", ["staff"]), true);
assert.equal(isLimitedStaffRoleAssignable("photographer"), true);
assert.equal(isLimitedStaffRoleAssignable("booking_staff"), true);
assert.equal(isLimitedStaffRoleAssignable("manager"), false);
assert.equal(isLimitedStaffRoleAssignable("accountant"), false);
assert.equal(isLimitedStaffRoleAssignable("admin"), false);

console.log("Staff permission and role assignment checks passed.");
