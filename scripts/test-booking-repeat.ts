import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { and, eq, sql, getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { serviceOrdersTable, servicesTable, serviceOrderStatusHistoryTable, koshaBookingsTable, photographyEventsTable } from "@workspace/db";

// Execute the actual repeat branch; only external IO is controlled. No DB URL,
// original historical record, inventory movement or real task is modified.
const ast=ts.createSourceFile("api.ts",readFileSync("src/server/api.ts","utf8"),ts.ScriptTarget.Latest,true);
let branch:ts.IfStatement|undefined;
function visit(node:ts.Node){if(ts.isIfStatement(node)&&node.expression.getText(ast)==='section === "repeat-event" && method === "POST"')branch=node;ts.forEachChild(node,visit)}
visit(ast);assert.ok(branch);
const code=ts.transpileModule(`async function run(req,auth){const section='repeat-event',method=req.method;${branch!.getText(ast)}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const adapter=existsSync("src/lib/booking-repeat.ts")?await import("../src/lib/booking-repeat"):null;
const details={
  customerId:9,department:"kosha",departments:["kosha","photography"],assignedPortal:"photography",koshaId:3,
  bookingCenterServices:[{id:4,type:"kosha",status:"completed",amount:160000,quantity:1,price:160000}],themeColor:"ذهبي",customChoice:{label:"ورد"},
  bookingSource:"rental",sourceType:"rental",sourceId:42,externalReference:"rental:42",rentalOrderId:42,storeOrderId:43,salesInvoiceId:44,soundSyncState:{status:"completed"},
  soundItems:[{productId:20,name:"سماعة",quantity:2,unitPrice:1000,isAsset:true,isRental:true,rental:{startDate:"2026-10-22",endDate:"2026-10-23",days:2}}],
  pricing:{totalAmount:200000},storeProductsMeta:{"20:0":{unitPrice:1000,free:false,note:"ورد"}},
  assignedStaffId:2,assignedStaffIds:[2],primaryEmployeeId:2,primaryEmployeeName:"موظف",assistantEmployeeId:3,assistantEmployeeName:"مساعد",bookingStaffAssignments:[{id:2}],assignedEmployees:["موظف"],
  assignedPhotographerId:2,photographerId:2,photographyAssignments:[{employeeId:2}],photographers:[{staffId:2}],assignedPhotographers:[{id:2}],
  photographyPortal:{eventId:41,shootId:51},photographyWorkflowStatus:"completed",photographyCustomerStatus:"مكتمل",
  executionTeam:[{id:2}],vehicle:{id:4},vehicles:[{id:4}],transportationDriverId:2,transportationVehicleId:4,
  transportation:{mode:"ajn",fee:5000,note:"نقل",driverId:2,vehicleId:4},
  linkedAssets:[{productId:20,quantity:1,stage:"out",custodyId:91}],
  koshaPortalTimeline:[{id:"old"}],koshaPortalMedia:[{url:"old-proof.jpg"}],koshaPortalDelivery:{signatureUrl:"old-signature.jpg"},executionStage:"delivered",trackingStatus:"completed",
  bookingOperations:{
    baseBookingAmount:160000,productCharges:40000,productMeta:{"20:0":{unitPrice:1000,discount:50,note:"ورد",prep:{status:"completed",taskId:81,assigneeId:2}},"manual:a":{prep:{status:"completed",taskId:82}}},
    manualPrepItems:[{id:"a",name:"زينة",source:"custom",quantity:2,department:"flowers",infoOnly:false,note:"المدخل"}],
    assets:[{productId:20,quantity:1,stage:"out",custodyId:91}],custodyEmployeeIds:[2],team:[{id:2}],vehicles:[{id:4}],
    resourceWindow:{preparationStart:"2026-10-22T12:00:00+03:00",eventStart:"2026-10-22T20:00:00+03:00",eventEnd:"2026-10-23T01:00:00+03:00",returnEnd:"2026-10-23T12:00:00+03:00"},
    loading:{id:"old-manifest",receipts:[{id:"old-scan"}],handovers:[{id:"old-handover"}]},
    bookingStage:"completed",warehouseStage:"completed",warehouseHistory:[{id:"old"}],productsStage:"consumed",groupAttendees:[{id:"student",collected:true}],
    transportation:{mode:"ajn",fee:5000,note:"النقل",driverId:2,vehicleId:4,confirmedAt:"old"},
  },
};
const dialect=new PgDialect();
async function repeat(entityType:"service_order"|"kosha_booking"|"photography_event",inputDetails:any){
  const source:any={id:7,serviceId:4,koshaId:3,customerName:"زبون عربي",phone:"07700000000",eventDate:"2026-10-22",eventTime:"20:00",groomName:"زبون عربي",eventName:"مناسبة",location:"بغداد",assignedStaffId:2,assignedStaffName:"موظف",totalAmount:"200000",depositAmount:"50000",paidAmount:"50000",remainingAmount:"150000",status:"completed",customFields:structuredClone(inputDetails),bookingDetails:structuredClone(inputDetails)};
  const before=structuredClone(source),writes:any[]=[],tasks:any[]=[],audits:any[]=[],qrs:any[]=[];let duplicateReads=0;
  const create=(table:any,value:any)=>{writes.push({table:getTableName(table),value:structuredClone(value)});return {id:71,...value}};
  const db={query:{
    serviceOrdersTable:{findFirst:async()=>source},servicesTable:{findFirst:async()=>({id:4,type:"kosha"})},
    koshaBookingsTable:{findFirst:async()=>duplicateReads++?undefined:source},photographyEventsTable:{findFirst:async()=>duplicateReads++?undefined:source},
  },insert:(table:any)=>({values:(value:any)=>({returning:async()=>[create(table,value)],then:(resolve:any)=>resolve(create(table,value))})}),
  update:(table:any)=>({set:(value:any)=>({where:async(condition:any)=>{assert.equal(getTableName(table),"kosha_bookings");assert.deepEqual(dialect.sqlToQuery(sql`${condition}`).params,[71],"tracking updates target only the newly inserted booking");writes.push({table:"tracking",value})}})})};
  const context:any={db,serviceOrdersTable,servicesTable,serviceOrderStatusHistoryTable,koshaBookingsTable,photographyEventsTable,and,eq,sql,
    normalizeRepeatedBookingDetails:adapter?.normalizeRepeatedBookingDetails,
    body:async(req:any)=>req.payload,optionalPositiveId:(v:any)=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null,
    enterpriseNumber:Number,randomUUID:()=>"new-token",insertServiceOrderWithTracking:async(value:any)=>({...create(serviceOrdersTable,value),trackingCode:"NEW-71"}),
    ensureQrForEntity:async(...args:any[])=>qrs.push(args),createAutomaticTasksForEntity:async(value:any)=>tasks.push(value),recordEnterpriseMutation:async(...args:any[])=>audits.push(args),
    json:(value:any,status=200)=>({status,value}),error:(message:string,status:number)=>({status,message}),
  };
  vm.createContext(context);vm.runInContext(code,context);
  const response=await context.run({method:"POST",payload:{entityType,entityId:7,eventDate:"2026-11-12"}},{id:1,fullName:"مدير"});
  assert.deepEqual(source,before,"repeat must never mutate the source snapshot or its historical evidence");
  return {response,writes,tasks,audits,qrs};
}
for(const type of ["service_order","kosha_booking"] as const){
  const result=await repeat(type,details),destination=result.writes.find(w=>w.table===(type==="service_order"?"service_orders":"kosha_bookings"))!.value;
  assert.equal(result.response.status,201);assert.equal(destination.eventDate,"2026-11-12");
  const copied=type==="service_order"?destination.customFields:destination.bookingDetails;
  assert.equal(copied.bookingOperations.loading,undefined,"a new booking must not inherit another booking's QR/custody manifest");
  assert.equal(copied.bookingOperations.resourceWindow,undefined,"old resource dates cannot reserve the new event");
  assert.equal(copied.bookingOperations.assets,undefined);assert.equal(copied.linkedAssets,undefined,"even a linked physical asset is an active hold; do not copy it");
  assert.equal(copied.bookingOperations.productMeta["20:0"].prep,undefined);assert.equal(copied.bookingOperations.productMeta["manual:a"],undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(copied.bookingOperations.productMeta["20:0"])),{unitPrice:1000,discount:50,note:"ورد"});
  assert.equal(copied.bookingOperations.baseBookingAmount,160000);assert.equal(copied.bookingOperations.productCharges,40000);
  assert.equal(copied.bookingOperations.manualPrepItems[0].name,"زينة","requested checklist definitions survive without completion/ownership");
  for(const key of ["assignedStaffId","assignedStaffIds","primaryEmployeeId","assistantEmployeeId","primaryEmployeeName","assistantEmployeeName","bookingStaffAssignments","assignedEmployees","assignedPhotographerId","photographerId","photographyAssignments","photographers","assignedPhotographers","photographyPortal","photographyWorkflowStatus","photographyCustomerStatus","executionTeam","vehicle","vehicles","transportationDriverId","transportationVehicleId","koshaPortalTimeline","koshaPortalMedia","koshaPortalDelivery","executionStage","trackingStatus"])assert.equal(copied[key],undefined,`${key} belongs to the old execution only`);
  for(const key of ["custodyEmployeeIds","team","vehicles","bookingStage","warehouseStage","warehouseHistory","productsStage","groupAttendees"])assert.equal(copied.bookingOperations[key],undefined,`${key} must not inherit old operation state`);
  assert.deepEqual(JSON.parse(JSON.stringify(copied.bookingOperations.transportation)),{mode:"ajn",fee:5000,note:"النقل"});
  assert.deepEqual(JSON.parse(JSON.stringify(copied.transportation)),{mode:"ajn",fee:5000,note:"نقل"});
  assert.equal(copied.customerId,9);assert.equal(copied.koshaId,3);assert.equal(copied.themeColor,"ذهبي");assert.equal(copied.assignedPortal,"photography");assert.equal(copied.customChoice.label,"ورد");assert.equal(copied.bookingCenterServices[0].price,160000);assert.equal(copied.pricing.totalAmount,200000);
  assert.equal(copied.bookingCenterServices[0].status,"waiting","new service cannot inherit completed fulfillment");
  assert.equal(copied.bookingCenterServices[0].amount,160000);
  assert.deepEqual(JSON.parse(JSON.stringify(copied.soundItems[0])),{productId:20,name:"سماعة",quantity:2,unitPrice:1000,isAsset:true,isRental:true,rental:{days:2}},"requested sound items retain price/duration, not the old rental dates");
  for(const key of ["bookingSource","sourceType","sourceId","externalReference","rentalOrderId","storeOrderId","salesInvoiceId","soundSyncState"])assert.equal(copied[key],undefined,`${key} must not link a new booking to the old originating order`);
  assert.equal(destination.totalAmount,"200000");assert.equal(destination.remainingAmount,"200000");assert.equal(destination.paymentStatus,"unpaid");assert.equal(destination[type==="service_order"?"depositAmount":"paidAmount"],"0","original new-booking money contract unchanged");
  assert.equal(result.tasks.length,1);assert.equal(result.tasks[0].entityId,71);assert.ok(!result.tasks[0].assignedStaffIds?.length,"old staff cannot be silently scheduled on the new event");
  assert.equal(result.audits.length,1);assert.equal(result.audits[0][3],type);assert.equal(result.audits[0][4],71);assert.equal(result.audits[0][6].sourceId,7);
}
const photo=await repeat("photography_event",details);assert.equal(photo.writes[0].value.assignedStaffId,null,"standalone repeated photo event requires fresh assignment");assert.equal(photo.writes[0].value.assignedStaffName,"","unassigned photographer uses the existing non-null empty-name default");assert.equal(photo.tasks[0].assignedStaffIds.length,0);
for(const value of [null,undefined,{}, {bookingOperations:null}]){
  for(const type of ["service_order","kosha_booking"] as const){
    const legacy=await repeat(type,value);assert.equal(legacy.response.status,201);
  }
}
for(const value of [[],"invalid",{bookingOperations:[]},{bookingOperations:{productMeta:[]}},{bookingOperations:{productMeta:{a:null}}},{bookingOperations:{manualPrepItems:{}}},{bookingOperations:{manualPrepItems:[null]}},{transportation:"bad"},{bookingOperations:{transportation:[]}}, {bookingCenterServices:{}}, {bookingCenterServices:[null]}, {soundItems:{}}, {soundItems:[{rental:[]}]}]){
  for(const type of ["service_order","kosha_booking"] as const){
    const invalid=await repeat(type,value);assert.equal(invalid.response.status,422,"malformed operational data must fail explicitly before writes");
    assert.equal(invalid.writes.length,0);assert.equal(invalid.tasks.length,0);assert.equal(invalid.audits.length,0);assert.equal(invalid.qrs.length,0);
  }
}
console.log("PASS actual repeat-booking destination isolation: no inherited holds, custody, QR, preparation or staff; original choices, pricing, source history and new-booking amounts preserved (controlled IO)");
