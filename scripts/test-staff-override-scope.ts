import assert from "node:assert/strict";
import * as availability from "../src/server/booking-resource-availability";
const groups=(availability as any).staffConflictGroups;
assert.equal(typeof groups,"function","staff overrides need one narrow, tested partition policy shared by booking and photography guards");
assert.deepEqual(groups([4,2,3],"قرار مدير",[2]),{checked:[3,4],overridden:[2]});
assert.deepEqual(groups([4,2,3],"",[2,3,4]),{checked:[2,3,4],overridden:[]});
assert.deepEqual(groups([4,2,3],"قرار مدير",[0,-1,NaN,99]),{checked:[2,3,4],overridden:[]});
assert.deepEqual(groups([4,2,3,2],"قرار مدير",[2,2]),{checked:[3,4],overridden:[2]});
assert.deepEqual(groups([4,2,3],"قرار مدير"),{checked:[2,3,4],overridden:[]},"reason alone never waives any employee");
for(let selected=1;selected<=8;selected++){const all=[1,2,3,4,5,6,7,8],value=groups(all,"قرار مدير",[selected]);assert.deepEqual(value.overridden,[selected]);assert.deepEqual(value.checked,all.filter(id=>id!==selected));}
console.log("PASS staff override partition: only explicitly selected IDs, reason required, other staff protected, invalid/unrelated IDs fail closed");
