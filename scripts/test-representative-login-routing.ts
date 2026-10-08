import assert from "node:assert/strict";
import {
  adminLoginDestination,
  canEnterRepresentativePortal,
} from "../src/lib/representative-login-routing";

const representative = { role: "employee", isActive: true,
  permissions: ["representative.portal.access"] };
assert.equal(adminLoginDestination(representative, undefined), "/representative",
  "representative-only staff logging in from admin must not be sent to an inaccessible dashboard");
assert.equal(adminLoginDestination({ role: "admin", isActive: true, permissions: [] }, "/admin/workspace"),
  "/admin/workspace", "the ordinary admin start page stays unchanged");
assert.equal(adminLoginDestination({ role: "employee", isActive: true, permissions: ["dashboard"] }, "/admin/dashboard"),
  "/admin/dashboard", "ordinary staff with admin navigation keep their existing destination");
assert.equal(canEnterRepresentativePortal(representative), true);
assert.equal(canEnterRepresentativePortal({ ...representative, permissions: [] }), false);
assert.equal(canEnterRepresentativePortal({ ...representative, isActive: false }), false);
assert.equal(canEnterRepresentativePortal({ role: "admin", isActive: true, permissions: [] }), true);

console.log("Representative login routing tests passed");
