import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createRequire} from 'node:module';
const {QueryClient,QueryClientProvider}=createRequire(import.meta.url)('@tanstack/react-query') as typeof import('@tanstack/react-query');
(globalThis as any).React=React;
const page=await import('../src/views/admin/vehicle-partnership');
// Missing persisted-header controls are the regression. Continue into behavioral
// rendering and real command execution once the control exists.
assert.equal(typeof (page as any).VehiclePartnershipZeroClosing,'function','monthly UI must expose pending cancellation and admin zero-period reopening');
const ui=await import('../src/views/admin/vehicle-partnership-zero-closing');
const base='/admin/enterprise/vehicles/12/partnership';
const original={closingId:23,month:'2026-08',status:'pending',version:7,revision:3,sourceDigest:'a'.repeat(64),financialTransactionId:null};
const render=(closings:any[],canApprove=false)=>renderToStaticMarkup(<ui.default base={base} closings={closings} canApprove={canApprove} visible refresh={async()=>{}}/>);
const pending=render([original]);assert.match(pending,/إلغاء الإغلاق المعلق/);assert.match(pending,/2026-08/);assert.match(pending,/3/);
assert.match(render([{...original,status:'approved'}],true),/إعادة فتح الإغلاق/);
assert.doesNotMatch(render([{...original,status:'approved'}]),/إعادة فتح الإغلاق/);
for(const header of [{...original,financialTransactionId:99},{...original,financialTransactionId:undefined},{...original,sourceDigest:null},{...original,sourceDigest:'wrong'},{...original,version:-1},{...original,revision:0},{...original,status:'draft'}])assert.equal(render([header],true),'','unknown, invalid, monetary and nonrecoverable headers have no recovery action');
const attempt=ui.makeZeroClosingAttempt(base,original,false,'  إعادة الإغلاق للمراجعة  ','zero-recovery-001');
assert.ok(Object.isFrozen(attempt));assert.ok(Object.isFrozen(attempt.command));
assert.deepEqual(attempt.command,{closingId:23,action:'cancel_zero',expectedVersion:7,expectedDigest:'a'.repeat(64),reason:'إعادة الإغلاق للمراجعة',idempotencyKey:'zero-recovery-001'});
assert.equal(attempt.route,base+'/closings/transition');assert.equal(attempt.month,'2026-08');assert.equal(attempt.revision,3);
original.version=100;original.sourceDigest='b'.repeat(64);original.month='2026-10';assert.equal(attempt.command.expectedVersion,7);assert.equal(attempt.month,'2026-08');
assert.equal(ui.makeZeroClosingAttempt(base,{...original,status:'approved'},true,'سبب موثق','zero-recovery-002').command.action,'reopen_zero');
for(const [header,admin,reason,key] of [[{...original,status:'approved'},false,'سبب موثق','zero-recovery-003'],[{...original,financialTransactionId:99},true,'سبب موثق','zero-recovery-003'],[original,false,'ab','zero-recovery-003'],[original,false,'a'.repeat(2001),'zero-recovery-003'],[original,false,'سبب موثق','short']] as const)assert.throws(()=>ui.makeZeroClosingAttempt(base,header,admin,reason,key));
assert.throws(()=>ui.makeZeroClosingAttempt('/wrong',original,false,'سبب موثق','zero-recovery-003'));
const nativeFetch=globalThis.fetch,bodies:string[]=[],events:string[]=[];let first=true;
const callbacks={onSaved:()=>{events.push('saved');},refresh:async()=>{throw Error('refresh unavailable');},onRefreshError:(error:unknown)=>{assert.equal((error as Error).message,'refresh unavailable');events.push('refresh-error');}};
globalThis.fetch=(async(url,init)=>{assert.equal(String(url),'/api/admin/enterprise/vehicles/12/partnership/closings/transition');assert.equal(init?.method,'POST');bodies.push(String(init?.body));if(first){first=false;throw new Error('response lost');}return Response.json({closingId:23,month:'2026-08',status:'draft',version:8,revision:4,sourceDigest:'a'.repeat(64),financialTransactionId:null});}) as typeof fetch;
try{
 await assert.rejects(()=>ui.submitZeroClosingAttempt(attempt,callbacks));assert.equal(events.length,0);
 await ui.submitZeroClosingAttempt(attempt,callbacks);assert.equal(bodies[0],bodies[1]);assert.equal(bodies[1],JSON.stringify({closingId:23,action:'cancel_zero',expectedVersion:7,expectedDigest:'a'.repeat(64),reason:'إعادة الإغلاق للمراجعة',idempotencyKey:'zero-recovery-001'}));assert.deepEqual(events,['saved','refresh-error']);
 globalThis.fetch=(async()=>Response.json({message:'المصدر مستخدم',code:'CONFLICT',requestId:'zero-request-001',retryable:false},{status:409})) as typeof fetch;
 await assert.rejects(()=>ui.submitZeroClosingAttempt(attempt,callbacks),(error:any)=>error.requestId==='zero-request-001'&&/المصدر مستخدم/.test(error.message));assert.equal(events.length,2);
 for(const result of [{closingId:24,month:'2026-08',status:'draft',version:8,revision:4,sourceDigest:'a'.repeat(64),financialTransactionId:null},{closingId:23,month:'2026-09',status:'draft',version:8,revision:4,sourceDigest:'a'.repeat(64),financialTransactionId:null},{closingId:23,month:'2026-08',status:'draft',version:8,revision:4,sourceDigest:'a'.repeat(64),financialTransactionId:88}]){
 globalThis.fetch=(async()=>Response.json(result)) as typeof fetch;await assert.rejects(()=>ui.submitZeroClosingAttempt(attempt,callbacks));assert.equal(events.length,2);
 }
}finally{globalThis.fetch=nativeFetch;}
// A background setup failure retains its last valid scoped configuration. The
// parent must keep the recovery controller mounted and show the error rather
// than replacing the entire page (which drops a lost-response retry).
const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
const setupKey=['vehicle-partnership',12,'setup'];
client.setQueryData(setupKey,{vehicle:{name:'المركبة الأصلية',plate_number:'فحص 123'},partnership:{id:1,ownershipType:'partnership',registrationOwner:'الشركة',version:7,agreements:[]},configuredElsewhere:false,canApprove:true});
client.getQueryCache().find({queryKey:setupKey})!.setState({status:'error',error:new Error('تعذر تحديث الإعداد الأصلي')});
const staleSetup=renderToStaticMarkup(<QueryClientProvider client={client}><page.default vehicleId={12}/></QueryClientProvider>);
assert.match(staleSetup,/الشراكة والأرباح/,'the same scoped page/controller survives a background setup failure');
assert.match(staleSetup,/تعذر تحديث الإعداد الأصلي/);assert.match(staleSetup,/role="alert"/);
assert.doesNotMatch(staleSetup,/حفظ وإرسال للموافقة|اتفاق جديد \/ تعديل مؤرخ/,'failed setup reads cannot expose new stale-configuration actions');
client.clear();
console.log('PASS zero closing recovery UI: persisted eligibility, original frozen header/month/route/body/nonce, visible source error, saved-before-refresh failure and strict response identity.');
