/** Operational evidence over ORIGINAL checkout records, never an inventory ledger. */
export class LoadingError extends Error {
  constructor(message:string, public readonly status=409) { super(message); this.name="LoadingError"; }
}
export type LoadingActor={id:number;name:string;manager?:boolean;viewAll?:boolean};
export type LoadingLineFact={
  key:string;kind:"asset"|"consumable";productId:number;variantId:number|null;tracking:"individual"|"quantity";
  required:number;issued:number;prepared:number;origin:string;name:string;unit:string;codes:string[];
  returnedGood:number;damaged:number;missing:number;maintenance:number;
};
export type LoadingFacts={
  source:"kosha"|"service";id:number;status:string;vehicle:{id:number;name:string;active:boolean}|null;
  staff:{id:number;name:string}[];lines:LoadingLineFact[];blockers:string[];
};
export type LoadingSelection={id:string;responsibleId:number;senderId:number;receiverId:number};
type Line=Pick<LoadingLineFact,"key"|"kind"|"productId"|"variantId"|"tracking"|"required"|"origin"|"name"|"unit">&{loaded:number};
type Handover={id:string;senderId:number;receiverId:number;from:string;to:string;condition:"good"|"damaged"|"missing"|"maintenance";note:string;at:string;receivedAt:string|null;receivedBy:number|null;
  lines:{key:string;quantity:number;origin:string}[];cancelledAt:string|null;cancelledBy:number|null;cancellationReason:string|null};
export type LoadingRecord={
  version:1;id:string;source:"kosha"|"service";bookingId:number;status:"loading"|"confirmed";
  vehicleId:number;vehicleName:string;staffIds:number[];responsibleId:number;senderId:number;receiverId:number;
  createdBy:number;createdAt:string;confirmedAt:string|null;signature:string;lines:Line[];
  acknowledgements:Partial<Record<"sender"|"receiver",{by:number;at:string}>>;
  handovers:Handover[];receipts:{id:string;actorId:number;fingerprint:string}[];
  revisions:{snapshot:Omit<LoadingRecord,"revisions">;by:number;at:string;reason:string}[];
};
export type LoadingCommand={requestId:string;manifestId:string}&(
  |{type:"scan";lineKey:string;code:string;quantity:number}
  |{type:"acknowledge";role:"sender"|"receiver"}
  |{type:"confirm"}
  |{type:"handover";receiverId:number;from:string;to:string;condition:Handover["condition"];note:string}
  |{type:"receive";handoverId:string}
  |{type:"cancel_handover";handoverId:string;reason:string}
);
function fail(message:string,status=409):never { throw new LoadingError(message,status); }
const id=(value:unknown):value is number=>typeof value==="number"&&Number.isSafeInteger(value)&&value>0;
const quantity=(value:unknown):value is number=>typeof value==="number"&&Number.isFinite(value)&&value>=0&&Number.isSafeInteger(Math.round(value*1000))&&Math.abs(value*1000-Math.round(value*1000))<1e-6;
const text=(value:unknown,max=180):value is string=>typeof value==="string"&&value.trim().length>0&&value.length<=max;
const round=(value:number)=>Math.round(value*1000)/1000;
const instant=(value:unknown)=>typeof value==="string"&&Number.isFinite(Date.parse(value));
const inactive=new Set(["cancelled","canceled","deleted","archived","completed","closed","delivered"]);
function signature(source:string,bookingId:number,vehicleId:number,staffIds:number[],lines:readonly Pick<Line,"key"|"kind"|"productId"|"variantId"|"tracking"|"required"|"origin">[]) {
  return JSON.stringify([source,bookingId,vehicleId,[...staffIds].sort((a,b)=>a-b),[...lines].sort((a,b)=>a.key.localeCompare(b.key)).map(l=>[l.key,l.kind,l.productId,l.variantId,l.tracking,l.required,l.origin])]);
}
function assertFacts(facts:LoadingFacts) {
  if(!facts||!["kosha","service"].includes(facts.source)||!id(facts.id)||!Array.isArray(facts.staff)||!Array.isArray(facts.lines)||!Array.isArray(facts.blockers))fail("بيانات التحميل لا تطابق الحجز",422);
  if(facts.lines.length>500||facts.staff.some(s=>!id(s.id))||new Set(facts.staff.map(s=>s.id)).size!==facts.staff.length)fail("بيانات فريق أو معدات الحجز غير صالحة",422);
  const keys=new Set<string>();
  for(const l of facts.lines){
    if(!text(l.key)||keys.has(l.key)||!id(l.productId)||(l.variantId!==null&&!id(l.variantId))||!["asset","consumable"].includes(l.kind)||!["individual","quantity"].includes(l.tracking)
      ||!quantity(l.required)||l.required<=0||![l.issued,l.prepared,l.returnedGood,l.damaged,l.missing,l.maintenance].every(quantity)||!text(l.origin,2000)||!Array.isArray(l.codes)||l.codes.some(c=>typeof c!=="string"))fail("مرجع أو كمية معدات الحجز غير صالحة",422);
    if(l.kind==="asset"&&(!Number.isSafeInteger(l.required)||(l.tracking==="individual"&&l.required!==1)))fail("رمز الأصل الفردي يمثل قطعة واحدة؛ راجع تعريف تتبع المعدة",422);
    if(round(l.returnedGood+l.damaged+l.missing+l.maintenance)>l.issued)fail("إرجاع المعدة يتجاوز صرفها الأصلي");
    keys.add(l.key);
  }
}
function assertOperational(facts:LoadingFacts) {
  assertFacts(facts);
  if(inactive.has(String(facts.status).toLowerCase()))fail("الحجز ملغى أو مغلق؛ لا يمكن تأكيد التحميل");
  if(facts.blockers.length)fail(facts.blockers.join("؛ "));
  if(!facts.vehicle?.active||!id(facts.vehicle.id))fail("حدد مركبة فعالة للحجز قبل تأكيد التحميل");
}
function allowed(facts:LoadingFacts,actor:LoadingActor) {
  if(!id(actor.id)||(!actor.manager&&!facts.staff.some(s=>s.id===actor.id)))fail("هذه العملية متاحة لفريق الحجز المخول فقط",403);
}
function availableForLoading(facts:LoadingFacts) {
  if(!facts.lines.length)fail("لا توجد معدات أو مواد أصلية في قائمة التحميل");
  for(const line of facts.lines){
    if(line.issued!==line.required)fail(`أكمل الصرف الأصلي من تبويب المعدات أو المنتجات: ${line.name}`);
    if(line.prepared<line.required)fail(`أكمل تجهيز العنصر أولاً: ${line.name}`);
    if(line.returnedGood+line.damaged+line.missing+line.maintenance>0)fail(`بدأ إرجاع العنصر؛ لا يمكن تأكيد تحميله مجدداً: ${line.name}`);
  }
}
export function createLoading(facts:LoadingFacts,input:LoadingSelection,actor:LoadingActor,at:string):LoadingRecord {
  assertOperational(facts);allowed(facts,actor);availableForLoading(facts);
  const staffIds=facts.staff.map(s=>s.id);
  if(!text(input.id)||!instant(at)||![input.responsibleId,input.senderId,input.receiverId].every(i=>id(i)&&staffIds.includes(i))||input.senderId===input.receiverId)fail("حدد مسؤول التحميل وموظفين مختلفين للتسليم والاستلام من فريق الحجز",422);
  const lines:Line[]=facts.lines.map(l=>({key:l.key,kind:l.kind,productId:l.productId,variantId:l.variantId,tracking:l.tracking,required:l.required,origin:l.origin,name:l.name,unit:l.unit,loaded:0}));
  return {version:1,id:input.id,source:facts.source,bookingId:facts.id,status:"loading",vehicleId:facts.vehicle!.id,vehicleName:facts.vehicle!.name,staffIds,
    responsibleId:input.responsibleId,senderId:input.senderId,receiverId:input.receiverId,createdBy:actor.id,createdAt:at,confirmedAt:null,
    signature:signature(facts.source,facts.id,facts.vehicle!.id,staffIds,lines),lines,acknowledgements:{},handovers:[],receipts:[],revisions:[]};
}
/** Validate stored evidence, not just incoming request payloads. Never silently reset corruption. */
export function readLoading(value:unknown,ref:{source:string;id:number}):LoadingRecord|null {
  if(value==null)return null;
  const r=value as LoadingRecord;
  if(r.version!==1||!text(r.id)||r.source!==ref.source||r.bookingId!==ref.id||!["loading","confirmed"].includes(r.status)||!id(r.vehicleId)||!id(r.createdBy)||!instant(r.createdAt)
    ||!Array.isArray(r.staffIds)||r.staffIds.some(s=>!id(s))||![r.responsibleId,r.senderId,r.receiverId].every(s=>r.staffIds.includes(s))||r.senderId===r.receiverId
    ||!Array.isArray(r.lines)||!r.lines.length||r.lines.length>500||!r.acknowledgements||!Array.isArray(r.handovers)||!Array.isArray(r.receipts)||r.receipts.length>2000||!Array.isArray(r.revisions)||r.revisions.length>20)fail("سجل التحميل المحفوظ غير مكتمل؛ راجع المسؤول");
  const revisionIds=new Set([r.id]);
  for(const revision of r.revisions){
    if(!revision?.snapshot||"revisions" in revision.snapshot||revision.snapshot.status!=="loading"||!id(revision.by)||!instant(revision.at)||!text(revision.reason,1000)||revision.reason.trim().length<5||revisionIds.has(revision.snapshot.id))fail("تسلسل مراجعات التحميل غير صالح");
    readLoading({...revision.snapshot,revisions:[]},ref);revisionIds.add(revision.snapshot.id);
  }
  assertFacts({source:r.source,id:r.bookingId,status:"confirmed",vehicle:null,staff:r.staffIds.map(i=>({id:i,name:""})),blockers:[],lines:r.lines.map(l=>({...l,issued:l.required,prepared:l.required,codes:[],returnedGood:0,damaged:0,missing:0,maintenance:0}))});
  if(r.lines.some(l=>!quantity(l.loaded)||l.loaded>l.required)||r.signature!==signature(r.source,r.bookingId,r.vehicleId,r.staffIds,r.lines))fail("هوية قائمة التحميل المحفوظة لا تطابق مراجعها الأصلية");
  const receipts=new Set<string>();
  for(const receipt of r.receipts){if(!text(receipt?.id)||receipts.has(receipt.id)||!id(receipt.actorId)||!text(receipt.fingerprint,5000))fail("سجل محاولات التحميل يحتاج مراجعة");receipts.add(receipt.id)}
  for(const role of ["sender","receiver"] as const){const ack=r.acknowledgements[role];if(ack&&(!instant(ack.at)||ack.by!==(role==="sender"?r.senderId:r.receiverId)))fail("إقرار العهدة لا يطابق الموظف الأصلي")}
  let holder=r.receiverId;
  for(let i=0;i<r.handovers.length;i++){
    const h=r.handovers[i];
    if(!text(h?.id)||!id(h.senderId)||!id(h.receiverId)||h.senderId===h.receiverId||!text(h.from,200)||!text(h.to,200)||!instant(h.at)||!["good","damaged","missing","maintenance"].includes(h.condition)
      ||typeof h.note!=="string"||h.note.length>1000||(h.condition!=="good"&&!h.note.trim())
      ||(h.receivedAt===null?h.receivedBy!==null:!instant(h.receivedAt)||h.receivedBy!==h.receiverId)
      ||(i===0?(h.senderId!==r.senderId||h.receiverId!==r.receiverId||!h.receivedAt||h.cancelledAt!==null):h.senderId!==holder)
      ||(h.cancelledAt===null?h.cancelledBy!==null||h.cancellationReason!==null:!instant(h.cancelledAt)||!id(h.cancelledBy)||!text(h.cancellationReason,1000)||h.cancellationReason.trim().length<5||h.receivedAt!==null)
      ||(!h.receivedAt&&!h.cancelledAt&&i!==r.handovers.length-1)
      ||!Array.isArray(h.lines)||!h.lines.length||new Set(h.lines.map(l=>l.key)).size!==h.lines.length
      ||h.lines.some(l=>{const original=r.lines.find(o=>o.key===l.key);return !original||l.origin!==original.origin||!quantity(l.quantity)||l.quantity<=0||l.quantity>original.required||(i>0&&original.kind!=="asset")})
      ||r.handovers.slice(0,i).some(p=>p.id===h.id))fail("سجل تسليم واستلام العهدة يحتاج مراجعة");
    if(h.receivedAt)holder=h.receiverId;
  }
  if(r.status==="loading"&&(r.handovers.length||r.confirmedAt!==null)||r.status==="confirmed"&&(!instant(r.confirmedAt)||!r.acknowledgements.sender||!r.acknowledgements.receiver||!r.handovers.length||r.lines.some(l=>l.loaded!==l.required)))fail("تأكيد التحميل المحفوظ لا يطابق الأدلة الأصلية");
  return r;
}
export function normalizeLoadingCode(value:string) {
  let code=String(value??"").trim();try{code=decodeURIComponent(code)}catch{/* Preserve plain scanner bytes. */}
  if(code.includes("/")){const parts=code.split(/[?#]/)[0].split("/").filter(Boolean);code=parts.at(-1)??code}
  return code.trim();
}
function commandFingerprint(command:LoadingCommand) {
  switch(command.type){
    case "scan":return JSON.stringify([command.type,command.lineKey,command.code,command.quantity]);
    case "acknowledge":return JSON.stringify([command.type,command.role]);
    case "confirm":return JSON.stringify([command.type]);
    case "handover":return JSON.stringify([command.type,command.receiverId,command.from,command.to,command.condition,command.note]);
    case "receive":return JSON.stringify([command.type,command.handoverId]);
    case "cancel_handover":return JSON.stringify([command.type,command.handoverId,command.reason]);
    default:return fail("إجراء تحميل غير مدعوم",422);
  }
}
export function applyLoading(value:LoadingRecord,facts:LoadingFacts,actor:LoadingActor,command:LoadingCommand,at:string):{record:LoadingRecord;duplicate:boolean} {
  const current=readLoading(value,{source:facts.source,id:facts.id})!;
  assertFacts(facts);allowed(facts,actor);
  if(!text(command.requestId)||!instant(at))fail("رمز المحاولة أو تاريخ العملية غير صحيح",422);
  const fingerprint=JSON.stringify([command.manifestId,commandFingerprint(command)]);
  if(fingerprint.length>5000)fail("بيانات العملية طويلة جداً",422);
  const receipt=current.receipts.find(r=>r.id===command.requestId);
  if(receipt){if(receipt.actorId!==actor.id||receipt.fingerprint!==fingerprint)fail("رمز المحاولة مستخدم لبيانات أو موظف مختلف");return {record:current,duplicate:true}}
  if(command.manifestId!==current.id)fail("تغير إصدار قائمة التحميل؛ حدّث الصفحة قبل متابعة المسح أو الإقرار");
  if(current.receipts.length>=2000)fail("بلغ سجل التحميل حد العمليات؛ راجع المسؤول دون حذف التاريخ");
  const r=structuredClone(current);
  if(command.type==="scan"||command.type==="acknowledge"||command.type==="confirm"){
    assertOperational(facts);
    if(current.signature!==signature(facts.source,facts.id,facts.vehicle!.id,facts.staff.map(s=>s.id),facts.lines))fail("تغيرت معدات الحجز أو مراجع صرفها أو المركبة أو الفريق؛ راجع قائمة التحميل");
    if(r.status!=="loading")fail("التحميل مؤكد؛ لا يمكن مسح المعدات أو صرفها مرة أخرى");
    availableForLoading(facts);
  }else{
    if(r.status!=="confirmed")fail("أكد التحميل قبل نقل العهدة");
    // Returning an ORIGINAL manifest remains possible after closure or a vehicle
    // breakdown. Later extra equipment does not rewrite this manifest's custody.
    for(const line of r.lines){const live=facts.lines.find(l=>l.key===line.key);if(!live||live.origin!==line.origin||live.issued!==line.required)fail("مراجع العهدة لا تطابق الصرف الأصلي")}
  }
  if(command.type==="scan"){
    const line=r.lines.find(l=>l.key===command.lineKey);const live=facts.lines.find(l=>l.key===command.lineKey);
    if(!line||!live||!text(command.code,500)||!live.codes.some(c=>normalizeLoadingCode(c).toLowerCase()===normalizeLoadingCode(command.code).toLowerCase()))fail("الرمز لا يطابق العنصر المحدد في هذا الحجز");
    if(!quantity(command.quantity)||command.quantity<=0||(line.kind==="asset"&&!Number.isSafeInteger(command.quantity)))fail("أدخل كمية تحميل صالحة للعنصر المحدد",422);
    if(round(line.loaded+command.quantity)>line.required)fail(line.tracking==="individual"?"تم مسح هذه القطعة سابقاً":"كمية المسح تتجاوز المطلوب");
    line.loaded=round(line.loaded+command.quantity);
  }else if(command.type==="acknowledge"){
    if(!["sender","receiver"].includes(command.role))fail("نوع الإقرار غير صحيح",422);
    if(actor.id!==(command.role==="sender"?r.senderId:r.receiverId))fail("يجب أن يؤكد الموظف المحدد بنفسه؛ لا يمكن التوقيع نيابة عنه",403);
    if(r.lines.some(l=>l.loaded!==l.required))fail("أكمل مسح كل المعدات والكميات قبل الإقرار");
    if(r.acknowledgements[command.role])fail("إقرار الموظف مسجل مسبقاً");
    r.acknowledgements[command.role]={by:actor.id,at};
  }else if(command.type==="confirm"){
    if(actor.id!==r.responsibleId&&!actor.manager)fail("تأكيد التحميل لمسؤوله المحدد",403);
    if(r.lines.some(l=>l.loaded!==l.required)||!r.acknowledgements.sender||!r.acknowledgements.receiver)fail("التحميل أو إقرارات التسليم والاستلام غير مكتملة");
    r.status="confirmed";r.confirmedAt=at;
    r.handovers.push({id:command.requestId,senderId:r.senderId,receiverId:r.receiverId,from:"المستودع / التجهيز",to:`المركبة: ${r.vehicleName}`,condition:"good",note:"تأكيد قائمة الصرف الأصلية دون حركة مخزون إضافية",at,receivedAt:r.acknowledgements.receiver.at,receivedBy:r.receiverId,
      lines:r.lines.map(l=>({key:l.key,quantity:l.required,origin:l.origin})),cancelledAt:null,cancelledBy:null,cancellationReason:null});
  }else if(command.type==="handover"){
    if(r.handovers.some(h=>!h.receivedAt&&!h.cancelledAt))fail("يوجد تسليم بانتظار تأكيد المستلم");
    const previous=r.handovers.filter(h=>h.receivedAt).at(-1)!;
    if(actor.id!==previous.receiverId)fail("تسليم العهدة متاح لحاملها الحالي فقط",403);
    if(!id(command.receiverId)||!facts.staff.some(s=>s.id===command.receiverId)||command.receiverId===actor.id||!text(command.from,200)||!text(command.to,200)
      ||!["good","damaged","missing","maintenance"].includes(command.condition)||typeof command.note!=="string"||command.note.length>1000||(command.condition!=="good"&&!command.note.trim()))fail("حدد المستلم والموقعين واكتب ملاحظة لأي مشكلة",422);
    const remaining=loadingReturnSummary(r,facts).lines.filter(l=>l.outstanding>0).map(l=>({key:l.key,quantity:l.outstanding,origin:r.lines.find(o=>o.key===l.key)!.origin}));
    if(!remaining.length)fail("لا توجد معدات متبقية خارج المستودع لتسليمها");
    r.handovers.push({id:command.requestId,senderId:actor.id,receiverId:command.receiverId,from:command.from.trim(),to:command.to.trim(),condition:command.condition,note:command.note.trim(),at,receivedAt:null,receivedBy:null,lines:remaining,cancelledAt:null,cancelledBy:null,cancellationReason:null});
  }else if(command.type==="receive"){
    const h=r.handovers.at(-1)!;
    if(h.id!==command.handoverId||h.receivedAt||h.cancelledAt)fail("التسليم غير متاح للاستلام أو تم تأكيده سابقاً");
    if(actor.id!==h.receiverId)fail("تأكيد الاستلام للموظف المستلم المحدد فقط",403);
    const returns=loadingReturnSummary(r,facts);
    if(h.lines.some(l=>(returns.lines.find(o=>o.key===l.key)?.outstanding??0)<l.quantity))fail("تغيرت الكميات بعد تسجيل الإرجاع؛ ألغِ التسليم المعلق وراجع الكميات الأصلية");
    h.receivedAt=at;h.receivedBy=actor.id;
  }else if(command.type==="cancel_handover"){
    const h=r.handovers.at(-1)!;
    if(h.id!==command.handoverId||h.receivedAt||h.cancelledAt)fail("يمكن إلغاء محاولة تسليم معلقة فقط دون حذف تاريخها");
    if(actor.id!==h.senderId&&!actor.manager)fail("إلغاء التسليم للمسلّم أو الإدارة فقط",403);
    if(!text(command.reason,1000)||command.reason.trim().length<5)fail("اكتب سبب إلغاء التسليم المعلق",422);
    h.cancelledAt=at;h.cancelledBy=actor.id;h.cancellationReason=command.reason.trim();
  }
  r.receipts.push({id:command.requestId,actorId:actor.id,fingerprint});
  return {record:r,duplicate:false};
}
export function loadingReturnSummary(record:LoadingRecord,facts:LoadingFacts) {
  readLoading(record,{source:facts.source,id:facts.id});assertFacts(facts);
  let required=0,returned=0,damaged=0,missing=0,maintenance=0;
  const lines=record.lines.filter(l=>l.kind==="asset").map(line=>{
    const live=facts.lines.find(l=>l.key===line.key);
    if(!live||live.origin!==line.origin||live.issued!==line.required)fail("إرجاع المعدة لا يطابق مرجع صرف قائمة التحميل الأصلية");
    const done=round(live.returnedGood+live.damaged+live.missing+live.maintenance);
    required+=line.required;returned+=done;damaged+=live.damaged;missing+=live.missing;maintenance+=live.maintenance;
    return {key:line.key,required:line.required,returned:done,outstanding:round(line.required-done),damaged:live.damaged,missing:live.missing,maintenance:live.maintenance};
  });
  const outstanding=round(required-returned);
  return {required:round(required),returned:round(returned),outstanding,damaged,missing,maintenance,lines,status:!required?"not_required":damaged||missing||maintenance?"issues":outstanding===0?"returned":returned>0?"partial":"pending"};
}

export type LoadingRequest=LoadingCommand|({requestId:string;responsibleId:number;senderId:number;receiverId:number}&({type:"create";manifestId?:never;reason?:never}|{type:"revise";manifestId:string;reason:string}));
/** The caller holds the original booking lock and persists the returned record atomically with its audit. */
export function executeLoadingRequest(value:LoadingRecord|null,facts:LoadingFacts,actor:LoadingActor,command:LoadingRequest,at:string,nextId:string):{record:LoadingRecord;duplicate:boolean} {
  if(command.type!=="create"&&command.type!=="revise"){
    if(!value)fail("أنشئ قائمة التحميل من الصرف الأصلي أولاً");
    return applyLoading(value!,facts,actor,command as LoadingCommand,at);
  }
  assertFacts(facts);allowed(facts,actor);
  if(!text(command.requestId)||!instant(at))fail("رمز محاولة التحميل غير صحيح",422);
  const fingerprint=JSON.stringify([command.type,command.responsibleId,command.senderId,command.receiverId,command.type==="revise"?[command.manifestId,command.reason]:null]);
  const current=readLoading(value,{source:facts.source,id:facts.id});
  const previous=current?.receipts.find(r=>r.id===command.requestId);
  if(previous){if(previous.actorId!==actor.id||previous.fingerprint!==fingerprint)fail("رمز المحاولة مستخدم لبيانات أو موظف مختلف");return {record:current!,duplicate:true}}
  if(current&&command.type==="create")fail("توجد قائمة أصلية؛ استخدم مراجعة القائمة قبل تأكيدها");
  if(command.type==="revise"&&(!current||current.status!=="loading"))fail("لا يمكن استبدال قائمة تحميل مؤكدة أو غير موجودة");
  if(command.type==="revise"&&current!.id!==command.manifestId)fail("تغير إصدار قائمة التحميل؛ حدّث الصفحة قبل المراجعة");
  if(current&&(actor.id!==current.responsibleId&&!actor.manager))fail("مراجعة التحميل لمسؤوله أو الإدارة فقط",403);
  if(current&&(current.revisions.length>=20||current.receipts.length>=2000))fail("بلغ سجل المراجعات الحد المتاح؛ راجع المسؤول دون حذف التاريخ");
  if(command.type==="revise"&&(!text(command.reason,1000)||command.reason.trim().length<5))fail("اكتب سبب مراجعة القائمة من 5 إلى 1000 حرف",422);
  const record=createLoading(facts,{id:nextId,responsibleId:command.responsibleId,senderId:command.senderId,receiverId:command.receiverId},actor,at);
  record.receipts=[...(current?.receipts??[]),{id:command.requestId,actorId:actor.id,fingerprint}];
  if(current){
    if(current.id===nextId||current.revisions.some(r=>r.snapshot.id===nextId))fail("معرف مراجعة التحميل مستخدم مسبقاً");
    const {revisions,...snapshot}=structuredClone(current);
    record.revisions=[...revisions,{snapshot,by:actor.id,at,reason:command.reason!.trim()}];
  }
  return {record,duplicate:false};
}
