import assert from "node:assert/strict";
import { bookingIdentity, filterManagerHeaders, managerStats, displayEventDate, type ManagerHeader } from "../src/lib/kosha-manager";

const base: ManagerHeader = {id:1,source:"kosha",customerName:"أحمد",phone:"07700000000",eventDate:"2026-09-05",status:"confirmed",paymentStatus:"partial",executionStage:"booked",koshaId:2,koshaName:"البيضاء",remainingAmount:75000,createdAt:"2026-08-01",searchText:"أحمد 07700000000 البيضاء"};
const records: ManagerHeader[] = [base,{...base,source:"service",koshaId:3,eventDate:"2026-09-06"},{...base,id:2,status:"cancelled",executionStage:"delivered"}];
assert.notEqual(bookingIdentity(records[0]),bookingIdentity(records[1]),"Same numeric IDs from different sources must remain distinct");
assert.deepEqual(filterManagerHeaders(records,new URLSearchParams({search:"أحمد",koshaId:"2",status:"confirmed",paymentStatus:"partial",quick:"today"}),"2026-09-05").map(bookingIdentity),["kosha:1"]);
assert.equal(filterManagerHeaders(records,new URLSearchParams({quick:"tomorrow"}),"2026-09-05").length,1);
assert.equal(filterManagerHeaders(records,new URLSearchParams({quick:"upcoming"}),"2026-09-05").length,2);
assert.equal(managerStats(records,"2026-09-05").completed,0,"Cancelled historical delivered bookings are not completed bookings");
assert.equal(filterManagerHeaders(records,new URLSearchParams({quick:"completed"}),"2026-09-05").length,0);
assert.match(displayEventDate("2026-09-05"),/2026/);
console.log("PASS: Kosha manager source identity, combined filters, event date and cancellation precedence");
