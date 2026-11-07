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
assert.match(workspace,/<TabsContent value="transport"><BookingTransportPlanEditor /,"one transport card for old and new bookings");
assert.doesNotMatch(workspace,/TransportationCard/,"no second transport card");
assert.match(workspace,/onSelect=\{\(\) => window\.print\(\)\}/,"A4 behavior preserved");
const dialog=readFileSync("src/components/transport-receipt-dialog.tsx","utf8");
assert.doesNotMatch(dialog,/tab=overview/,"the transport card lives in the «النقل» tab, not the overview");
assert.match(dialog,/\?tab=transport#ajn-transport-card/);
assert.match(workspace,/<TransportReceiptDialog reference=\{transportReceipt\} onClose=\{\(\) => setTransportReceipt\(null\)\} onOpenTransport=\{openTransportCard\} \/>/,"inside the booking the dialog switches to the transport tab itself");
assert.match(workspace,/const openTransportCard = \(\) => \{\s*changeTab\("transport"\);/);
assert.match(dialog,/ناقص بهذي الرحلة: \{missing\.join\(" و"\)\}/,"a trip without a car or driver says what is missing");
const {servicesWithTransport}=await import("../src/lib/booking-transport");
const lines=[{type:"kosha",status:"waiting",amount:0},{type:"transportation",status:"waiting",amount:15000}];
assert.equal(servicesWithTransport(lines,undefined),lines,"not loaded yet: the saved line stays");
assert.equal(servicesWithTransport(lines,{mode:"ajn",fee:20000})[1].amount,20000,"the «النقل» line follows the transport card");
assert.equal(servicesWithTransport(lines,{mode:"customer"})[1].amount,0);
assert.match(String(servicesWithTransport(lines,null)[1].notes),/ما محدد نقل بعد/);
assert.equal(servicesWithTransport(lines,null)[0],lines[0]);
console.log("PASS transport receipt entry points: booking card and workspace share exact-source dialog; plan editor and original A4 retained");
