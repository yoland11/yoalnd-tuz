import assert from "node:assert/strict";
import * as daily from "../src/lib/booking-daily-operations";

const now = new Date("2026-10-18T12:00:00Z");
const base: daily.DailyBookingFact = { source:"kosha",id:12,number:"K-12",customerName:"أحمد",eventDate:"2026-10-18",eventTime:"16:00",location:"بغداد",status:"confirmed",category:"kosha",details:{},assignedStaffId:8,vehicleId:2,vehicleName:"سيارة ٢",transportationMode:"ajn",crewName:null,overdueTasks:0,openTasks:0,products:[] };

// Break caught: the room currently discards explicit original member acceptance.
const accepted = daily.projectDailyBooking({ ...base, staffConfirmation:{trackedIds:[8],acceptedIds:[8]} } as any, now);
assert.equal(accepted.readiness.checks.find(c=>c.id==="staff-confirmation")?.state,"pass");
const pending = daily.projectDailyBooking({ ...base, staffConfirmation:{trackedIds:[8],acceptedIds:[]} } as any, now);
assert.equal(pending.readiness.checks.find(c=>c.id==="staff-confirmation")?.state,"fail");
assert.ok(pending.issues.some(i=>i.kind==="staff-confirmation"));
const partial = daily.projectDailyBooking({ ...base, details:{assignedStaffIds:[8,9]}, staffConfirmation:{trackedIds:[8],acceptedIds:[8]} } as any, now);
assert.equal(partial.readiness.checks.find(c=>c.id==="staff-confirmation")?.state,"unknown","untracked assigned colleague is not silently confirmed");

// Break caught: a maintenance vehicle currently looks assigned without a blocker.
const badVehicle = daily.projectDailyBooking({...base,vehicleState:{active:true,status:"maintenance"}} as any,now);
assert.equal(badVehicle.readiness.checks.find(c=>c.id==="vehicle-condition")?.state,"fail");
const customer = daily.projectDailyBooking({...base,transportationMode:"customer",vehicleState:{active:false,status:"maintenance"}} as any,now);
assert.ok(!customer.issues.some(i=>i.kind==="vehicle-condition"),"customer transport doesn't inherit an irrelevant vehicle blocker");

// Break caught: the room must surface actual missed arrival and previous-event assets.
const late = daily.projectDailyBooking({...base,execution:{stage:"INSTALLING",requiredArrivalAt:"2026-10-18T10:00:00Z",arrivedAt:null}, details:{bookingOperations:{assets:[{productId:3,quantity:1,stage:"out"}]}}} as any,now);
assert.ok(late.issues.some(i=>i.kind==="late-arrival"));
assert.equal(late.stage,"installing");
const returned = daily.projectDailyBooking({...base,eventDate:"2026-10-17",details:{bookingOperations:{assets:[{productId:3,quantity:1,stage:"out"}]}}},now);
assert.ok(returned.issues.some(i=>i.kind==="previous-event-return"));

// Break caught: a completed historic booking is not an unprepared operation.
const filters = daily.parseDailyOperationsFilters(new URLSearchParams());
const completed = daily.buildDailyOperations([{...base,status:"completed"}],filters,false,now);
assert.equal(completed.summary.needsPreparation,0);
const targeted = daily.buildDailyOperations([base,{...base,id:13,overdueTasks:2}],{...filters,attention:"tasks"} as any,false,now);
assert.equal(targeted.rows.length,1);
assert.equal(targeted.rows[0].id,13);
assert.equal(targeted.summary.bookings,2,"attention drilldown does not erase the cohort overview");
assert.deepEqual(daily.dailyOperationsRange("recent" as any,now),{from:"2026-09-18",to:"2026-10-19"});
assert.throws(()=>daily.parseDailyOperationsFilters(new URLSearchParams("attention=financial")),/متابعة/);

// Break caught: going back from a booking loses operator filters or destroys other tabs' parameters.
assert.equal(typeof (daily as any).dailyFiltersFromUrl,"function");
assert.equal(typeof (daily as any).dailyFiltersToUrl,"function");
const restored=(daily as any).dailyFiltersFromUrl(new URLSearchParams("tab=daily-operations&opsPeriod=week&opsEmployee=8&opsAttention=tasks"));
assert.equal(restored.period,"week"); assert.equal(restored.employee,8); assert.equal(restored.attention,"tasks");
const written=(daily as any).dailyFiltersToUrl(new URLSearchParams("tab=daily-operations&asset=42&vehicle=6"),restored);
assert.equal(written.get("asset"),"42"); assert.equal(written.get("vehicle"),"6"); assert.equal(written.get("opsEmployee"),"8");
console.log("PASS room completion: team acceptance, vehicle condition, live alerts, attention, historical stages and URL isolation");
