import assert from "node:assert/strict";
import { hasStaffPermission, type StaffPermission } from "../src/lib/staff-permissions";

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

console.log("Staff permission compatibility checks passed.");
