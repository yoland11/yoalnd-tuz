import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const workspace=readFileSync("src/views/admin/booking-operations-workspace.tsx","utf8");
const center=readFileSync("src/views/admin/booking-center.tsx","utf8");
for(const [name,source] of [["workspace",workspace],["center",center]]){
  assert.match(source,/<TransportReceiptDialog\s/,`${name} mounts reusable preview outside menu`);
  assert.match(source,/طباعة وصل نقل 80mm/);
  assert.match(source,/setTransportReceipt\(/);
}
assert.match(workspace,/<BookingTransportPlanEditor\s/);
assert.match(workspace,/transportation\.data\?\.transportPlan\?\.legacy/);
assert.match(workspace,/onSelect=\{\(\) => window\.print\(\)\}/,"A4 behavior preserved");
console.log("PASS transport receipt entry points: booking card and workspace share exact-source dialog; plan editor and original A4 retained");
