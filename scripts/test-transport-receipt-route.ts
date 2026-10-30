import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { sql,eq } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { readTransportReceipt } from "../src/server/booking-transport-receipt";
import { readTransportPlan } from "../src/lib/booking-transport-plan";
import { bookingResourceSpan } from "../src/lib/booking-resource-window";
import { normalizeTransportReceiptSettings,DEFAULT_TRANSPORT_RECEIPT_SETTINGS } from "../src/lib/transport-receipt";
const api=fs.readFileSync("src/server/api.ts","utf8"),start=api.indexOf('  if (resource === "transportation") {');
const block=api.slice(start,api.indexOf('  if (resource === "group-attendees") {',start));
const compiled=ts.transpileModule(block,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const dialect=new PgDialect();
let preferences:any=null;
async function run(variant:string,financial:boolean,options:{action?:string;method?:string;manager?:boolean;payload?:any;failAudit?:boolean;ordinary?:boolean}={}){
  let writes=0;
  const operations={transportation:{mode:"ajn",fee:50000,vehicleId:null,driverId:null,inTotal:true}};
  const db={execute:async(q:any)=>{
    const statement=dialect.sqlToQuery(q).sql.toLowerCase();
    if(statement.includes("from service_orders"))return {rows:[{id:7,customer_name:"عميل",phone:"07710000000",tracking_code:null,details:{bookingOperations:operations}}]};
    if(statement.includes("dispatch_assignments"))return {rows:[]};
    throw Error("Unexpected receipt route IO");
  },query:{settingsTable:{findFirst:async()=>preferences==null?undefined:{value:preferences}}},insert:()=>({values:(data:any)=>({onConflictDoUpdate:async()=>{preferences=data.value;writes++}})}),update:()=>{writes++;throw Error("receipt actions cannot post money")}};
  const env={sql,eq,resource:"transportation",method:options.method??"GET",reference:{source:"service",id:7,entityType:"service_order",row:{},operations},auth:{id:1,role:options.manager?"admin":"employee",fullName:"مدير"},
    req:{headers:new Map(),nextUrl:new URL(`https://example.test/api/admin/booking-operations/service/7/transportation?receipt=${options.ordinary?0:1}&tripId=legacy-1&variant=${variant}&canViewCustomerCharge=true${options.action?`&transportAction=${options.action}`:""}`)},
    db,can:()=>true,hasPermission:(_auth:any,permission:string)=>permission==="booking_finance_view"&&financial,canEditOrderFinancials:()=>financial,
    getCachedPublicSettings:async()=>({site_name:"شركة محددة",phone:"07720000000",logo_url:""}),readTransportReceipt,readTransportPlan,bookingResourceSpan,
    normalizeTransportReceiptSettings,DEFAULT_TRANSPORT_RECEIPT_SETTINGS,settingsTable:{key:"key"},TransportPlanError:class extends Error{constructor(message:string,public status:number){super(message)}},body:async()=>options.payload,
    addEntityTimeline:async()=>{if(options.failAudit)throw Error("print audit unavailable");writes++},erpActorFromAdmin:()=>({id:1,name:"مدير"}),makeRequestId:()=>"receipt-test",
    json:(data:any)=>({status:200,data,headers:new Map()}),error:(message:string,status:number)=>({status,message}),
  };
  try{const result=await new AsyncFunction(...Object.keys(env),compiled)(...Object.values(env));if((options.method??"GET")==="GET")assert.equal(writes,0);return {...result,writes}}catch(cause){if(typeof (cause as any)?.status==="number")return {status:(cause as any).status,writes};throw cause}
}
let response=await run("driver",false);
assert.equal(response.status,200);
assert.equal(response.data.variant,"driver","existing transport route must serve receipt selection, not ordinary aggregate payload");
assert.equal(response.data.amount,null,"forged query finance flag cannot grant access");
assert.equal(response.data.company.name,"شركة محددة");
assert.equal(response.headers.get("Cache-Control"),"private, no-store");
assert.equal((await run("customer",false)).status,403);
assert.equal((await run("customer",true)).data.amount.value,50000);
assert.equal((await run("unsupported",true)).status,422);
let settings=await run("driver",false,{action:"settings"});
assert.equal(settings.data.settings.showQr,true);
assert.equal(settings.data.canManage,false);
assert.equal((await run("driver",false,{action:"settings",method:"PUT",payload:{settings:{showQr:false}}})).status,403);
settings=await run("driver",true,{action:"settings",method:"PUT",manager:true,payload:{settings:{showQr:false,showNotes:false}}});
assert.equal(settings.status,200);assert.equal(preferences.showQr,false);assert.equal(preferences.showNotes,false);
assert.equal((await run("driver",true,{action:"settings",method:"PUT",manager:true,payload:{settings:{showQr:"false"}}})).status,422);
const printed=await run("driver",false,{action:"print-request",method:"POST",payload:{tripId:"legacy-1",variant:"driver",copies:2}});
assert.equal(printed.status,200);assert.equal(printed.data.physicalPrintConfirmed,false);assert.equal(printed.writes,1,"one audit only, no financial write");
assert.equal((await run("driver",false,{action:"print-request",method:"POST",payload:{tripId:"legacy-1",variant:"driver",copies:0}})).status,422);
assert.equal((await run("driver",false,{action:"print-request",method:"POST",payload:{tripId:"legacy-1",variant:"driver",copies:1,expectedRevision:9}})).status,409,"do not print a stale operation/price preview after another edit");
await assert.rejects(()=>run("driver",false,{action:"print-request",method:"POST",failAudit:true,payload:{tripId:"legacy-1",variant:"driver",copies:1}}),/print audit unavailable/);
const ordinary=await run("driver",false,{ordinary:true});
assert.equal(ordinary.data.capabilities?.canPrintFinancial,false);
assert.equal(ordinary.data.capabilities?.canEdit,false);
console.log("PASS actual receipt GET: original source, trusted financial scope, driver redaction, configured brand, private response and no writes");
