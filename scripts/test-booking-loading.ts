import assert from "node:assert/strict";
import { existsSync } from "node:fs";

assert.ok(existsSync("src/lib/booking-loading.ts"), "booking-bound loading domain is missing");
const { createLoading, applyLoading, loadingReturnSummary, LoadingError } = await import("../src/lib/booking-loading");
const facts: any = {
  source:"kosha",id:12,status:"confirmed",vehicle:{id:8,name:"مركبة 8",active:true},staff:[{id:1,name:"علي"},{id:2,name:"أحمد"},{id:3,name:"حسن"}],blockers:[],
  lines:[
    {key:"asset:10",kind:"asset",productId:10,variantId:null,tracking:"individual",required:1,issued:1,prepared:1,origin:"custody:100",name:"عمود",unit:"قطعة",codes:["AJN-A000010"],returnedGood:0,damaged:0,missing:0,maintenance:0},
    {key:"asset:11",kind:"asset",productId:11,variantId:null,tracking:"quantity",required:3,issued:3,prepared:3,origin:"movements:200,201",name:"إضاءة",unit:"قطعة",codes:["LIGHT"],returnedGood:0,damaged:0,missing:0,maintenance:0},
    {key:"stock:20:0",kind:"consumable",productId:20,variantId:null,tracking:"quantity",required:1.5,issued:1.5,prepared:1.5,origin:"reservation:300",name:"قماش",unit:"وحدة",codes:["CLOTH"],returnedGood:0,damaged:0,missing:0,maintenance:0},
  ],
};
const input:any={id:"load-12",responsibleId:1,senderId:1,receiverId:2};
const at="2026-10-19T09:00:00.000Z";
const create=()=>createLoading(facts,input,{id:1,name:"علي"},at);
let seq=0;
const action=(record:any,command:any,actorId=1,live=facts)=>applyLoading(record,live,{id:actorId,name:`موظف ${actorId}`},{requestId:`request-${++seq}`,manifestId:record.id, ...command},at).record;
const rejects=(run:()=>unknown)=>assert.throws(run,LoadingError);

const original=create();
rejects(()=>action(original,{type:"scan",manifestId:"old-manifest",lineKey:"asset:10",code:"AJN-A000010",quantity:1}));
assert.equal(original.lines[0].origin,"custody:100");
assert.equal(original.lines[1].loaded,0);
assert.equal(original.source,"kosha");
rejects(()=>createLoading({...facts,source:"service"},{...input,senderId:1,receiverId:1},{id:1,name:"علي"},at));
rejects(()=>createLoading({...facts,vehicle:null},input,{id:1,name:"علي"},at));
rejects(()=>createLoading({...facts,lines:[{...facts.lines[0],issued:0}]},input,{id:1,name:"علي"},at));
rejects(()=>createLoading({...facts,lines:[{...facts.lines[0],required:2,issued:2,prepared:2}]},input,{id:1,name:"علي"},at));
rejects(()=>createLoading({...facts,blockers:["صرف غير مكتمل"]},input,{id:1,name:"علي"},at));

rejects(()=>action(original,{type:"scan",lineKey:"asset:10",code:"LIGHT",quantity:1}));
rejects(()=>action(original,{type:"scan",lineKey:"asset:10",code:"AJN-A000010",quantity:0.5}));
rejects(()=>action(original,{type:"scan",lineKey:"asset:10",code:"AJN-A000010",quantity:1},9));
let loaded=action(original,{type:"scan",lineKey:"asset:10",code:"https://example.test/assets/AJN-A000010",quantity:1});
assert.equal(loaded.lines[0].loaded,1);
assert.equal(original.lines[0].loaded,0,"domain must not mutate saved manifest input");
rejects(()=>action(loaded,{type:"scan",lineKey:"asset:10",code:"AJN-A000010",quantity:1}));
loaded=action(loaded,{type:"scan",lineKey:"asset:11",code:"LIGHT",quantity:2});
assert.equal(loaded.lines[1].loaded,2,"one quantity QR must not load the whole line");
rejects(()=>action(loaded,{type:"confirm"}));
loaded=action(loaded,{type:"scan",lineKey:"asset:11",code:"LIGHT",quantity:1});
loaded=action(loaded,{type:"scan",lineKey:"stock:20:0",code:"CLOTH",quantity:1.5});
rejects(()=>action(loaded,{type:"acknowledge",role:"receiver"},1));
loaded=action(loaded,{type:"acknowledge",role:"sender"},1);
loaded=action(loaded,{type:"acknowledge",role:"receiver"},2);
const command:any={type:"confirm",requestId:"confirm-original",manifestId:loaded.id};
const confirmed=applyLoading(loaded,facts,{id:1,name:"علي"},command,at).record;
assert.equal(confirmed.status,"confirmed");
assert.equal(applyLoading(confirmed,facts,{id:1,name:"علي"},command,at).duplicate,true);
rejects(()=>applyLoading(confirmed,facts,{id:2,name:"أحمد"},command,at));
rejects(()=>action(loaded,{type:"confirm"},1,{...facts,source:"service"}));
rejects(()=>action(loaded,{type:"confirm"},1,{...facts,lines:[{...facts.lines[0],origin:"custody:999"},...facts.lines.slice(1)]}));
rejects(()=>action(loaded,{type:"confirm"},1,{...facts,lines:[{...facts.lines[0],returnedGood:1},...facts.lines.slice(1)]}));

rejects(()=>action(confirmed,{type:"handover",receiverId:3,from:"المركبة",to:"القاعة",condition:"good",note:""},1));
let transferred=action(confirmed,{type:"handover",receiverId:3,from:"المركبة",to:"القاعة",condition:"good",note:""},2);
assert.equal(transferred.handovers.length,2);
rejects(()=>action(transferred,{type:"receive",handoverId:transferred.handovers[1].id},2));
transferred=action(transferred,{type:"receive",handoverId:transferred.handovers[1].id},3);
assert.equal(transferred.handovers[1].receivedBy,3);
assert.equal(confirmed.handovers.length,1,"handover history must be append-only");
const lateHandover=action(confirmed,{type:"handover",receiverId:3,from:"الموقع",to:"مستودع الفحص",condition:"maintenance",note:"تحتاج فحصاً عند العودة"},2,{...facts,status:"completed",vehicle:null});
assert.equal(lateHandover.handovers[1].receiverId,3,"closing a booking must not block the original return handover");
const view=loadingReturnSummary(confirmed,{...facts,lines:[{...facts.lines[0],returnedGood:1},{...facts.lines[1],returnedGood:1,damaged:1},facts.lines[2]]});
assert.equal(view.required,4,"consumables never require a normal return");
assert.equal(view.returned,3);
assert.equal(view.outstanding,1);
assert.equal(view.damaged,1);
assert.equal(view.status,"issues");
const returnedFacts={...facts,lines:[{...facts.lines[0],returnedGood:1},{...facts.lines[1],returnedGood:1,damaged:1},facts.lines[2]]};
const partialHandover=action(confirmed,{type:"handover",receiverId:3,from:"الموقع",to:"سيارة العودة",condition:"good",note:""},2,returnedFacts);
assert.deepEqual(partialHandover.handovers[1].lines,[{key:"asset:11",quantity:1,origin:"movements:200,201"}],"custody transfer must identify only remaining original units, not equipment already returned");
rejects(()=>action(partialHandover,{type:"receive",handoverId:partialHandover.handovers[1].id},3,{...returnedFacts,lines:[returnedFacts.lines[0],{...returnedFacts.lines[1],returnedGood:2},facts.lines[2]]}));
const cancelled=action(partialHandover,{type:"cancel_handover",handoverId:partialHandover.handovers[1].id,reason:"تغيرت الكميات بعد تسجيل الإرجاع"},2,returnedFacts);
assert.equal(cancelled.handovers[1].cancelledBy,2);
assert.equal(cancelled.handovers[1].receivedAt,null);
const replacement=action(cancelled,{type:"handover",receiverId:1,from:"الموقع",to:"المستودع",condition:"good",note:""},2,returnedFacts);
assert.equal(replacement.handovers.length,3,"cancelled custody attempts remain in append-only history");
rejects(()=>loadingReturnSummary(confirmed,{...facts,lines:[{...facts.lines[0],origin:"custody:999"},...facts.lines.slice(1)]}));
const domain=await import("../src/lib/booking-loading");
assert.equal(typeof domain.executeLoadingRequest,"function","durable creation/revision coordinator is missing");
const createCommand:any={type:"create",requestId:"create-request",responsibleId:1,senderId:1,receiverId:2};
const first=domain.executeLoadingRequest(null,facts,{id:1,name:"علي"},createCommand,at,"manifest-1");
assert.equal(domain.executeLoadingRequest(first.record,facts,{id:1,name:"علي"},createCommand,at,"manifest-2").duplicate,true);
rejects(()=>domain.executeLoadingRequest(first.record,facts,{id:1,name:"علي"},{...createCommand,receiverId:3},at,"manifest-3"));
const revisedCommand:any={type:"revise",requestId:"revision-request",manifestId:first.record.id,responsibleId:1,senderId:1,receiverId:3,reason:"تغيير المستلم قبل التحميل"};
const revised=domain.executeLoadingRequest(first.record,facts,{id:1,name:"علي"},revisedCommand,at,"manifest-2");
assert.equal(revised.record.receiverId,3);
assert.equal(revised.record.revisions[0].snapshot.id,"manifest-1");
assert.equal(revised.record.revisions[0].reason,"تغيير المستلم قبل التحميل");
assert.equal(domain.executeLoadingRequest(revised.record,facts,{id:1,name:"علي"},revisedCommand,at,"manifest-3").duplicate,true);
rejects(()=>domain.executeLoadingRequest(confirmed,facts,{id:1,name:"علي"},revisedCommand,at,"manifest-3"));
console.log("PASS loading domain: original checkout identities, source isolation, exact/decimal scans, replay, real signatures, custody history and original returns");
