import assert from "node:assert/strict";
import {
  canAccessRepresentativeGroup,
  classifyRepresentativeScope,
} from "../src/lib/representative-group-access";

const representative = {
  role: "employee",
  isActive: true,
  permissions: ["representative.portal.access"],
};

assert.deepEqual(
  classifyRepresentativeScope({ ...representative, role: "admin", permissions: [] }, []),
  { kind: "admin" },
  "the existing admin role keeps all-group access",
);
assert.deepEqual(
  classifyRepresentativeScope({ ...representative, isActive: false }, [11]),
  { kind: "denied", reason: "inactive" },
  "an inactive representative cannot access an assigned group",
);
assert.deepEqual(
  classifyRepresentativeScope({ ...representative, permissions: [] }, [11]),
  { kind: "denied", reason: "permission" },
  "a group assignment cannot grant portal permission by itself",
);
assert.deepEqual(
  classifyRepresentativeScope(representative, []),
  { kind: "denied", reason: "missing" },
  "zero assignments must not expand to all groups",
);
assert.deepEqual(
  classifyRepresentativeScope(representative, [11, 12]),
  { kind: "denied", reason: "ambiguous" },
  "two legacy active assignments must fail closed",
);

const single = classifyRepresentativeScope(representative, [11]);
assert.deepEqual(single, { kind: "group", groupId: 11 });
assert.equal(canAccessRepresentativeGroup(single, 11), true);
assert.equal(canAccessRepresentativeGroup(single, 12), false);
assert.equal(canAccessRepresentativeGroup({ kind: "denied", reason: "ambiguous" }, 11), false);
assert.equal(canAccessRepresentativeGroup({ kind: "admin" }, 12), true);

console.log("Representative group access policy tests passed");
