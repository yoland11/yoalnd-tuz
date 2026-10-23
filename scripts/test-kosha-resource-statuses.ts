import assert from "node:assert/strict";
import {PgDialect} from "drizzle-orm/pg-core";
import {findBookingKoshaConflict} from "../src/server/booking-resource-availability";
const dialect=new PgDialect(),window={preparationStart:"2026-10-25T12:00:00+03:00",eventStart:"2026-10-25T20:00:00+03:00",eventEnd:"2026-10-26T01:00:00+03:00",returnEnd:"2026-10-26T12:00:00+03:00"};
for(const status of ["confirmed","active","processing","in_progress"]){
 const connection={execute:async(q:any)=>{const built=dialect.sqlToQuery(q),native=built.sql.split("UNION ALL")[0];const included=native.includes(`'${status}'`)||built.params.includes(status);assert.ok(included,`native Kosha reader must reserve the same ${status} status accepted by the allocation guard`);return{rows:[{source:"kosha",id:1,event_date:"2026-10-25",details:{bookingOperations:{resourceWindow:window,bookingStage:"booked"}}}]};}};
 assert.equal((await findBookingKoshaConflict({source:"kosha",id:2,eventDate:"2026-10-25",operations:{resourceWindow:window}},8,connection))?.id,1,"second booking must see the existing processing/booked Kosha allocation");
}
console.log("PASS native Kosha occupancy matches confirmed/active/processing/in-progress allocations and the actual booked workflow status (controlled query contract)");
