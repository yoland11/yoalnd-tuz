import assert from "node:assert/strict";
import {existsSync,readFileSync} from "node:fs";
import {createRequire} from "node:module";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import type {DriverCoverageSyncResult} from "../src/server/vehicle-partnership/driver-coverage";

(globalThis as typeof globalThis & {React:typeof React}).React=React;
assert.ok(existsSync("src/views/admin/vehicle-driver-coverage.tsx"),"approved-month driver coverage needs a usable confirmation and result UI");
const ui=await import("../src/views/admin/vehicle-driver-coverage");
const base="/admin/enterprise/vehicles/12/partnership";
const original={closingId:5,month:"2026-08",status:"approved",version:7,sourceDigest:"b".repeat(64)};
const selected={...original};
const attempt=ui.createDriverCoverageAttempt(base,selected,true,"driver-sync-ui-0001");
selected.closingId=6;selected.month="2026-09";selected.version=9;selected.sourceDigest="c".repeat(64);
const command=ui.buildDriverCoverageCommand(attempt,"  مراجعة دفعات السائقين الأصلية  ",true);
assert.deepEqual(command,{closingId:5,expectedVersion:7,expectedDigest:"b".repeat(64),idempotencyKey:"driver-sync-ui-0001",reason:"مراجعة دفعات السائقين الأصلية",includeReversalSummary:true},"a changing month selector must not retarget a confirmed attempt");
assert.ok(Object.isFrozen(attempt)&&Object.isFrozen(attempt.closing)&&Object.isFrozen(command),"the target and retry body must stay immutable");
assert.equal(ui.canSyncDriverCoverage({...original,status:"distributed"},true),true);
for(const closing of [null,{...original,status:"draft"},{...original,status:"review"},{...original,status:"pending"},{...original,closingId:0},{...original,version:-1},{...original,version:0.5},{...original,month:"2026-13"},{...original,month:"2026-8"},{...original,month:"0000-08"},{...original,sourceDigest:null},{...original,sourceDigest:"B".repeat(64)}]){
  assert.equal(ui.canSyncDriverCoverage(closing,true),false);
  assert.throws(()=>ui.createDriverCoverageAttempt(base,closing,true,"driver-sync-ui-0001"));
  const html=renderToStaticMarkup(<ui.default base={base} closing={closing} canApprove refresh={async()=>{}}/>);
  assert.match(html,/<button[^>]*disabled=""[^>]*>/,"unapproved, absent or malformed month cannot start a financial classification");
}
assert.equal(ui.canSyncDriverCoverage(original,false),false);
assert.throws(()=>ui.createDriverCoverageAttempt(base,original,false,"driver-sync-ui-0001"));
assert.throws(()=>ui.buildDriverCoverageCommand(attempt,"سبب صحيح",false));
for(const reason of ["","  ","اب","أ".repeat(2001)])assert.throws(()=>ui.buildDriverCoverageCommand(attempt,reason,true));
for(const key of ["","short","a".repeat(181)])assert.throws(()=>ui.createDriverCoverageAttempt(base,original,true,key));
assert.equal(renderToStaticMarkup(<ui.default base={base} closing={original} canApprove={false} refresh={async()=>{}}/>),"","staff cannot see the principal-only action");
const ready=renderToStaticMarkup(<ui.default base={base} closing={original} canApprove refresh={async()=>{}}/>);
assert.match(ready,/ربط دفعات السائقين بالشهر/);assert.doesNotMatch(ready,/<button[^>]*disabled=/);
const advanceReady=renderToStaticMarkup(<ui.default base={base} closing={original} kind="advance" canApprove refresh={async()=>{}}/>);assert.match(advanceReady,/ربط دفعات السلف بالشهر/);assert.doesNotMatch(advanceReady,/ربط دفعات السائقين بالشهر/);

// Exercise the actual reports mount with the server's permission DTO.
const {QueryClient,QueryClientProvider}=createRequire(import.meta.url)("@tanstack/react-query") as typeof import("@tanstack/react-query");
const {default:Reports}=await import("../src/views/admin/vehicle-partnership-reports");
const reportClient=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
reportClient.setQueryData(["vehicle-partnership","print-branding"],{site_name:"AJN"});
const reportWorkspace={rights:[],driverEntries:[],requests:[],closings:[{...original,revision:1,financialTransactionId:81}]};
for(const permission of [true,false,undefined]){
  const mounted=renderToStaticMarkup(<QueryClientProvider client={reportClient}><Reports vehicleId={12} vehicleName="المركبة المشتركة" plateNumber="بغداد 123" workspace={{...reportWorkspace,canApprove:permission}}/></QueryClientProvider>);
  assert.equal(mounted.includes("ربط دفعات السائقين بالشهر"),permission===true,"the original report must use the actual server approval permission");
}
const reversedReport=renderToStaticMarkup(<QueryClientProvider client={reportClient}><Reports vehicleId={12} vehicleName="المركبة" plateNumber="123" workspace={{...reportWorkspace,requests:[{id:71,sourceType:"vehicle_partnership_driver",sourceId:"61",sourceEvent:"driver_fee_settlement",status:"executed",amount:"40.00",date:"2026-08-20",description:"أجرة رحلة معكوسة",reversalTxnId:72,reversedAt:"2026-08-21T10:00:00Z"}]}}/></QueryClientProvider>);
assert.match(reversedReport,/سجل الصرف المعكوس/);assert.doesNotMatch(reversedReport,/معاينة وصل 80mm/);assert.match(reversedReport,/transaction=71/);
reportClient.clear();
const reportSource=readFileSync("src/views/admin/vehicle-partnership-reports.tsx","utf8");
const coverageName=reportSource.match(/import\s+(\w+)\s+from\s+["']\.\/vehicle-driver-coverage["']/)?.[1];
assert.ok(coverageName,"the driver coverage action is mounted in the existing reports");
const coverageMount=reportSource.match(new RegExp(`<${coverageName}\\b[\\s\\S]*?/>`))?.[0]??"";
assert.match(coverageMount,/\bkey\s*=\s*\{\s*vehicleId\s*\}/,"changing month/version must not remount the action and lose its retry nonce/result");
assert.match(coverageMount,/\bcanApprove\s*=\s*\{[^}]*\bworkspace\s*\.\s*canApprove\b[^}]*\}/,"mount permission must come from the server workspace");

const result:DriverCoverageSyncResult={closingId:5,revision:1,sourceDigest:"b".repeat(64),matchedPayments:2,amount:"99999999999999.99",coveredAmount:"99999999999989.98",uncoveredAmount:"10.01",results:[
  {financialTransactionId:71,transactionNo:"FIN-71 <script>",amount:"99999999999899.99",coveredAmount:"99999999999889.98",uncoveredAmount:"10.01",alreadyLinked:false},
  {financialTransactionId:72,transactionNo:"FIN-72",amount:"100.00",coveredAmount:"100.00",uncoveredAmount:"0.00",alreadyLinked:true},
]};
const table=renderToStaticMarkup(<ui.DriverCoverageResultTable result={result}/>);
for(const text of ["FIN-71 &lt;script&gt;","FIN-72","99,999,999,999,999.99 د.ع","99,999,999,999,899.99 د.ع","99,999,999,999,989.98 د.ع","10.01 د.ع","مدفوع خارج التحويل","مرتبط سابقاً"])assert.ok(table.includes(text),`missing exact source result ${text}`);
assert.doesNotMatch(table,/<script>/);
assert.match(table,/dir="rtl"/);assert.match(table,/dir="ltr"/);assert.match(table,/<th[^>]*scope="col"/);
const empty={...result,matchedPayments:0,amount:"0.00",coveredAmount:"0.00",uncoveredAmount:"0.00",results:[]};
assert.match(renderToStaticMarkup(<ui.DriverCoverageResultTable result={empty}/>),/لا توجد دفعات سائقين منفذة مطابقة/);
assert.match(renderToStaticMarkup(<ui.DriverCoverageResultTable result={{...empty,reversedPayments:1}}/>),/معكوسة بالكامل/);
assert.throws(()=>renderToStaticMarkup(<ui.DriverCoverageResultTable result={{...result,results:[{...result.results[0],amount:"1e6"}]}}/>),"invalid response money must never become zero or a no-data result");
assert.throws(()=>renderToStaticMarkup(<ui.DriverCoverageResultTable result={{...result,coveredAmount:"1.00"}}/>),"a mismatched result total cannot be displayed as a successful classification");

const nativeFetch=globalThis.fetch;
const bodies:string[]=[];
const events:string[]=[];
let shouldFail=true;
globalThis.fetch=(async(input,init)=>{
  assert.equal(String(input),"/api/admin/enterprise/vehicles/12/partnership/closings/driver-coverage");
  assert.equal(init?.method,"POST");assert.equal(init?.credentials,"include");
  bodies.push(String(init?.body));
  if(shouldFail){shouldFail=false;throw new Error("response lost");}
  return Response.json(result);
}) as typeof fetch;
try{
  const callbacks={onSaved:()=>{events.push("saved");},refresh:async()=>{events.push("refresh");throw new Error("refresh unavailable");},onRefreshError:(error:unknown)=>{assert.match(String(error),/refresh unavailable/);events.push("refresh-error");}};
  await assert.rejects(()=>ui.submitDriverCoverageAttempt(attempt,command,callbacks),(error:unknown)=>Boolean(error&&typeof error==="object"&&"code" in error&&error.code==="NETWORK_ERROR"));
  assert.deepEqual(events,[],"an unknown network result cannot claim saved or run a view refresh");
  const saved=await ui.submitDriverCoverageAttempt(attempt,command,callbacks);
  assert.deepEqual(saved,result);assert.deepEqual(events,["saved","refresh","refresh-error"],"a failed view refresh must preserve the confirmed save result");
  assert.equal(bodies[0],bodies[1],"retry retains the exact nonce, target, version, digest and reason");
  assert.deepEqual(JSON.parse(bodies[1]),{closingId:5,expectedVersion:7,expectedDigest:"b".repeat(64),idempotencyKey:"driver-sync-ui-0001",reason:"مراجعة دفعات السائقين الأصلية",includeReversalSummary:true});
  globalThis.fetch=(async(input,init)=>{assert.equal(String(input),'/api/admin/enterprise/vehicles/12/partnership/closings/advance-coverage');assert.equal(String(init?.body),bodies[1]);return Response.json(result);}) as typeof fetch;
  await ui.submitDriverCoverageAttempt(attempt,command,{onSaved:()=>{},refresh:async()=>{},onRefreshError:()=>{}},'advance');
  globalThis.fetch=(async()=>Response.json({message:"تغيرت نسخة الشهر",code:"CONFLICT",requestId:"REQ-coverage-conflict",retryable:false},{status:409})) as typeof fetch;
  await assert.rejects(()=>ui.submitDriverCoverageAttempt(attempt,command,callbacks),(error:unknown)=>Boolean(error&&typeof error==="object"&&"status" in error&&error.status===409&&"requestId" in error&&error.requestId==="REQ-coverage-conflict"));
  assert.deepEqual(events,["saved","refresh","refresh-error"],"an API conflict is not an empty or successful result");
  globalThis.fetch=(async()=>Response.json({...result,closingId:6})) as typeof fetch;
  await assert.rejects(()=>ui.submitDriverCoverageAttempt(attempt,command,callbacks),/لا تطابق/);
}finally{globalThis.fetch=nativeFetch;}
console.log("PASS driver coverage UI: principal-only approved target, frozen exact retry, original FIN rows, exact amounts, explicit empty result, AJN errors and saved-but-refresh-failed handling (no database writes).");
