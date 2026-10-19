import assert from "node:assert/strict";
import { existsSync } from "node:fs";
assert.ok(existsSync("src/lib/booking-operational-readiness.ts"),"missing shared operational readiness evaluator");
const {evaluateBookingReadiness}=await import("../src/lib/booking-operational-readiness");
const check={id:"equipment",category:"equipment",label:"المعدات",mandatory:true,applicable:true,state:"pass" as const,reason:"المعدات موثقة",href:"/admin/bookings/kosha/12?tab=assets"};
assert.equal(evaluateBookingReadiness([check]).status,"ready");
for(const state of ["fail","unknown"] as const) {
  const result=evaluateBookingReadiness([{...check,state}]);
  assert.equal(result.status,"not_ready",`${state} mandatory evidence cannot certify readiness`);
  assert.equal(result.blockers.length,1);
  assert.equal(result.percentage,0);
}
const optional=evaluateBookingReadiness([check,{...check,id:"task",category:"tasks",mandatory:false,state:"unknown"}]);
assert.equal(optional.status,"needs_followup");assert.equal(optional.blockers.length,0);assert.equal(optional.percentage,50);
assert.equal(evaluateBookingReadiness([{...check,applicable:false,state:"fail"}]).percentage,null);
assert.notEqual(evaluateBookingReadiness([]).status,"ready");
assert.deepEqual(evaluateBookingReadiness([{...check,paid:0,remaining:5000} as any]),evaluateBookingReadiness([{...check,paid:5000,remaining:0} as any]),"payment values cannot alter readiness");
assert.throws(()=>evaluateBookingReadiness([check,check]),/Duplicate/);
assert.throws(()=>evaluateBookingReadiness([{...check,state:"invented"} as any]),/Invalid/);
console.log("PASS mandatory/optional operational evidence, unknowns, category counts and financial independence");
