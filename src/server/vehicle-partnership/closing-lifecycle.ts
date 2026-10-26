import {createHash} from "node:crypto";
import {sql} from "drizzle-orm";
import {z} from "zod/v4";
import {canonicalPartnershipJson} from "../../lib/vehicle-partnership/canonical";
import {closingMonthBounds} from "../../lib/vehicle-partnership/closing";
import {formatMoney,parseMoney} from "../../lib/vehicle-partnership/money";
import {PartnershipValidationError} from "../../lib/vehicle-partnership/types";
import {authorizePartnership,partnershipId,readOriginalVehicle,type PartnershipActor,type PartnershipDatabase} from "./agreements";
import {previewClosing,closingPolicySchema,type ClosingSnapshot} from "./closing";
import {buildClosingJournal} from "./closing-journal";
import {lockClosingOriginalSources} from "./closing-locks";
import {appendPartnershipAudit,lockPartnership,partnershipRows,PartnershipRepositoryError,type PartnershipExecutor} from "./repository";
import type {PartnershipFinancialRequestWriter,TrustedPartnershipRequest} from "./accounting";
import {PARTNERSHIP_POSTING_TYPES} from "./financial-classification";
import {reserveClosingConversions,approveClosingRights} from "./closing-rights";
import {assertClosingUnused} from "./closing-unused";

type Row=Record<string,unknown>;
const hash=(value:unknown)=>createHash("sha256").update(canonicalPartnershipJson(value)).digest("hex");
function conflict(message:string):never{throw new PartnershipRepositoryError(message,409,"CONFLICT");}
function object(value:unknown):Row{if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Invalid monthly closing source object");return value as Row;}
const common={expectedVersion:z.number().int().nonnegative(),expectedDigest:z.string().regex(/^[a-f0-9]{64}$/),idempotencyKey:z.string().trim().min(8).max(180),reason:z.string().trim().min(3).max(2000)};
const draftSchema=z.object({...common,month:z.string(),policy:closingPolicySchema}).strict();
const transitionSchema=z.object({...common,closingId:z.number().int().positive(),action:z.enum(["review","submit","return_to_draft","approve_zero","cancel_zero","reopen_zero"])}).strict();
function parse<T>(schema:z.ZodType<T>,input:unknown):T{const parsed=schema.safeParse(input);if(!parsed.success)throw new PartnershipValidationError(parsed.error.issues.map(issue=>issue.message).join("؛ "));return parsed.data;}
export function closingDto(row:Row){return {closingId:partnershipId(Number(row.id)),month:String(row.period).slice(0,7),status:String(row.status),version:Number(row.version),revision:Number(row.revision),sourceDigest:String(row.source_digest),financialTransactionId:row.financial_transaction_id==null?null:partnershipId(Number(row.financial_transaction_id))};}
async function header(tx:PartnershipExecutor,rootId:number,ref:{id:number}|{period:string},lock=true):Promise<Row|null>{
 const result=partnershipRows(await tx.execute(sql`/* vp_month_header */ SELECT h.*,h.period::text AS period FROM vehicle_partnership_closings h WHERE h.partnership_id=${rootId} AND ${"id" in ref?sql`h.id=${ref.id}`:sql`h.period=${ref.period}::date`} ${lock?sql`FOR UPDATE`:sql``}`));
 if(result.length>1)throw new Error("Duplicate monthly closing identity");
 if(!result.length)return null;const row=result[0];
 if(Number(row.partnership_id)!==rootId||!Number.isInteger(Number(row.version))||Number(row.version)<0||!["draft","review","pending","approved","distributed"].includes(String(row.status)))conflict("هوية الإغلاق أو حالته غير صالحة");
 partnershipId(Number(row.id));partnershipId(Number(row.revision));closingMonthBounds(String(row.period).slice(0,7));return row;
}
async function line(tx:PartnershipExecutor,row:Row,actor:PartnershipActor,input:{key:string;kind:string;amount:string;snapshot:unknown;agreementId?:number;memberId?:number},reason:string){
 const result=partnershipRows(await tx.execute(sql`/* vp_month_line */ INSERT INTO vehicle_partnership_closing_lines (closing_id,revision,source_key,line_kind,agreement_id,member_id,amount,snapshot,created_by,reason) VALUES (${Number(row.id)},${Number(row.revision)},${input.key},${input.kind},${input.agreementId??null},${input.memberId??null},${input.amount},${JSON.stringify(input.snapshot)}::jsonb,${actor.id},${reason}) RETURNING id`));
 if(result.length!==1)throw new Error("Monthly immutable line insert was not confirmed");return partnershipId(Number(result[0].id));
}
async function replay(tx:PartnershipExecutor,row:Row,key:string,fingerprint:string){
 const previous=partnershipRows(await tx.execute(sql`/* vp_month_operation */ SELECT snapshot FROM vehicle_partnership_closing_lines WHERE closing_id=${Number(row.id)} AND source_key=${`operation:${key}`} ORDER BY revision LIMIT 2`));
 if(!previous.length)return null;if(previous.length!==1)conflict("مرجع عملية الإغلاق مكرر");const proof=object(previous[0].snapshot);
 if(proof.fingerprint!==fingerprint)conflict("مرجع العملية مستخدم لطلب مختلف");return object(proof.result);
}
async function writeOperation(tx:PartnershipExecutor,row:Row,actor:PartnershipActor,command:{idempotencyKey:string;reason:string},fingerprint:string){
 const result=closingDto(row);await line(tx,row,actor,{key:`operation:${command.idempotencyKey}`,kind:"summary",amount:"0.00",snapshot:{fingerprint,result}},command.reason);return result;
}
async function update(tx:PartnershipExecutor,row:Row,status:string,digest:string,container:Row,actor?:PartnershipActor):Promise<Row>{
 const result=partnershipRows(await tx.execute(sql`/* vp_month_update */ UPDATE vehicle_partnership_closings SET status=${status},version=${Number(row.version)+1},source_digest=${digest},policy_snapshot=${JSON.stringify(container)}::jsonb${actor?sql`,approved_by=${actor.id},approved_at=now()`:sql``} WHERE id=${Number(row.id)} AND version=${Number(row.version)} RETURNING *,period::text AS period`));
 if(result.length!==1)conflict("نسخة الإغلاق تغيرت أثناء العملية");return result[0];
}
function expected(row:Row,version:number,digest:string){if(Number(row.version)!==version||row.source_digest!==digest)conflict("نسخة الإغلاق أو بصمته تغيرت؛ حدّث المعاينة قبل المتابعة");}
async function checkedPreview(tx:PartnershipExecutor,actor:PartnershipActor,vehicleId:number,row:Row){
 const result=await previewClosing(tx,actor,vehicleId,String(row.period).slice(0,7));
 if(result.stored||result.sourceDigest!==row.source_digest)conflict("مصادر الشهر تغيرت بعد المراجعة؛ احفظ مسودة جديدة قبل الاعتماد");
 if(result.approvalBlockers.length)conflict(result.approvalBlockers.join("؛ "));
 if(result.snapshot.lossClaims.some(claim=>claim.key.startsWith("opening:")&&parseMoney(claim.remaining)>0n))conflict("الخسارة الافتتاحية تحتاج مصدر تسوية معتمداً قبل إغلاق الشهر");
 return result;
}
/** One existing feature monthly identity. Drafts never post money or consume
 * original sources; each operation is durably replayable from immutable lines. */
export async function saveClosingDraft(db:PartnershipDatabase,actor:PartnershipActor,vehicleId:number,input:unknown){
 authorizePartnership(actor);partnershipId(vehicleId);const command=parse(draftSchema,input),range=closingMonthBounds(command.month),fingerprint=hash({command,vehicleId,actorId:actor.id});
 return db.transaction(async tx=>{
  const root=await lockPartnership(tx,vehicleId);await readOriginalVehicle(tx,actor,vehicleId);
  if(root.ownershipType!=="partnership")conflict("المركبة لا تستخدم شراكة فعالة");
  let current=await header(tx,root.id,{period:range.from});
  if(current){const prior=await replay(tx,current,command.idempotencyKey,fingerprint);if(prior)return prior;if(!["draft","review"].includes(String(current.status)))conflict("لا يمكن تعديل إغلاق معلق أو معتمد");if(Number(current.version)!==command.expectedVersion)conflict("نسخة المسودة تغيرت");}
  else if(command.expectedVersion!==0)conflict("الإغلاق المطلوب لم يعد موجوداً");
  const preview=await previewClosing(tx,actor,vehicleId,command.month,command.policy);
  if(preview.stored||preview.sourceDigest!==command.expectedDigest)conflict("المعاينة تغيرت؛ أعد مراجعة مصادر الشهر");
  const container={policy:command.policy,snapshot:preview.snapshot};
  if(current)current=await update(tx,current,"draft",preview.sourceDigest,container);
  else{
   const result=partnershipRows(await tx.execute(sql`/* vp_month_insert */ INSERT INTO vehicle_partnership_closings (partnership_id,period,source_digest,policy_snapshot,idempotency_key,created_by,reason,status,revision,version) VALUES (${root.id},${range.from}::date,${preview.sourceDigest},${JSON.stringify(container)}::jsonb,${command.idempotencyKey},${actor.id},${command.reason},'draft',1,1) RETURNING *,period::text AS period`));
   if(result.length!==1)throw new Error("Monthly draft insert was not confirmed");current=result[0];
  }
  const result=await writeOperation(tx,current,actor,command,fingerprint);
  await appendPartnershipAudit(tx,{vehicleId,partnershipId:root.id,actor,action:"closing_draft_saved",reason:command.reason,newValues:{...result,month:command.month}});return result;
 });
}
/** Review/submit use original data under locks. Only the source-derived
 * request writer may create a pending FI; it cannot approve or move cash. */
export async function transitionClosing(db:PartnershipDatabase,actor:PartnershipActor,vehicleId:number,input:unknown,createRequest:PartnershipFinancialRequestWriter){
 authorizePartnership(actor);partnershipId(vehicleId);const command=parse(transitionSchema,input);if(["approve_zero","reopen_zero"].includes(command.action))authorizePartnership(actor,true);
 const fingerprint=hash({command,vehicleId,actorId:actor.id});
 return db.transaction(async tx=>{
  const root=await lockPartnership(tx,vehicleId);await readOriginalVehicle(tx,actor,vehicleId);
  const initial=await header(tx,root.id,{id:command.closingId},false);if(!initial)throw new PartnershipRepositoryError("الإغلاق غير موجود",404,"NOT_FOUND");
  const completed=await replay(tx,initial,command.idempotencyKey,fingerprint);if(completed)return completed;
  if(!["return_to_draft","cancel_zero"].includes(command.action))await lockClosingOriginalSources(tx,actor,vehicleId,String(initial.period).slice(0,7));
  const current=await header(tx,root.id,{id:command.closingId});if(!current||current.period!==initial.period)conflict("هوية الإغلاق تغيرت أثناء المراجعة");
  const prior=await replay(tx,current,command.idempotencyKey,fingerprint);if(prior)return prior;expected(current,command.expectedVersion,command.expectedDigest);
  const allowed=command.action==="review"?"draft":command.action==="submit"||command.action==="return_to_draft"?"review":command.action==="reopen_zero"?"approved":"pending";
  if(current.status!==allowed)conflict("العملية غير متاحة في مرحلة الإغلاق الحالية");
  const container=object(current.policy_snapshot);let next:Row;
  if(command.action==="return_to_draft")next=await update(tx,current,"draft",String(current.source_digest),container);
  else if(command.action==="reopen_zero"){
   if(current.financial_transaction_id!=null||current.approved_by==null||current.approved_at==null)conflict("أعد فتح الإغلاق المالي من مسار العكس الأصلي؛ هذا المسار للشهر المعتمد الخالي من القيود فقط");
   const proof=await verifySubmittedClosing(tx,actor,{root,row:current},false);
   if(proof.journal.legs.length||parseMoney(proof.journal.amount)!==0n)conflict("الإغلاق المعتمد ليس خالياً من القيود");
   const audit=partnershipRows(await tx.execute(sql`/* vp_month_zero_approval */ SELECT EXISTS(SELECT 1 FROM financial_audit_logs a WHERE a.action='vehicle_partnership_closing_approved_zero' AND a.actor_id=${Number(current.approved_by)} AND a.transaction_id IS NULL AND a.new_values->>'closingId'=${String(current.id)} AND a.new_values->>'partnershipId'=${String(root.id)} AND a.new_values->>'vehicleId'=${String(vehicleId)} AND a.new_values->>'sourceDigest'=${String(current.source_digest)} AND a.new_values->>'revision'=${String(current.revision)} AND a.new_values->>'version'=${String(current.version)} AND a.new_values->>'status'='approved') AS proven`));
   if(audit.length!==1||audit[0].proven!==true)conflict("الموافقة الإدارية على النسخة الصفرية غير مثبتة");
   await assertClosingUnused(tx,actor,{root,row:current,snapshot:proof.snapshot,financialId:null});
   const changed=partnershipRows(await tx.execute(sql`/* vp_month_reopen_zero */ UPDATE vehicle_partnership_closings SET status='draft',revision=revision+1,version=version+1,approved_by=NULL,approved_at=NULL WHERE id=${Number(current.id)} AND version=${Number(current.version)} AND status='approved' AND financial_transaction_id IS NULL RETURNING *,period::text AS period`));
   if(changed.length!==1)conflict("نسخة الإغلاق تغيرت أثناء إعادة الفتح");next=changed[0];
  }
  else if(command.action==="cancel_zero"){
   if(current.financial_transaction_id!=null)conflict("ألغِ طلب الإغلاق المالي من مسار الموافقة الأصلي");
   const proof=await verifySubmittedClosing(tx,actor,{root,row:current},false);if(proof.journal.legs.length||parseMoney(proof.journal.amount)!==0n)conflict("مصدر الإغلاق المعلق غير مطابق لمسار الإلغاء الصفري");
   const changed=partnershipRows(await tx.execute(sql`/* vp_month_cancel_zero */ UPDATE vehicle_partnership_closings SET status='draft',revision=revision+1,version=version+1,approved_by=NULL,approved_at=NULL WHERE id=${Number(current.id)} AND version=${Number(current.version)} AND status='pending' AND financial_transaction_id IS NULL RETURNING *,period::text AS period`));
   if(changed.length!==1)conflict("نسخة الإغلاق تغيرت أثناء الإلغاء");next=changed[0];
  }
  else{
   const preview=await checkedPreview(tx,actor,vehicleId,current);
   const journal=buildClosingJournal(preview.snapshot);
   if(command.action==="approve_zero"){
    if(current.financial_transaction_id!=null||journal.legs.length||parseMoney(journal.amount)!==0n)conflict("هذا الإغلاق يتطلب الموافقة المالية على قيده الفعلي");
    await verifySubmittedClosing(tx,actor,{root,row:current},false);
    next=await update(tx,current,"approved",preview.sourceDigest,container,actor);
    await approveClosingRights(tx,actor,{root,row:next,snapshot:preview.snapshot,financialId:null});
   }else if(command.action==="review")next=await update(tx,current,"review",preview.sourceDigest,{...container,snapshot:preview.snapshot});
   else{
    for(const source of closingSubmissionLines(preview.snapshot,Number(current.revision)))await line(tx,current,actor,source,command.reason);
    next=await update(tx,current,"pending",preview.sourceDigest,{...container,snapshot:preview.snapshot,journal});
    if(parseMoney(journal.amount)>0n){
     const financial=await createRequest(tx,{sourceType:"vehicle_partnership_closing",sourceId:Number(current.id)},actor);
     if(!Number.isSafeInteger(financial.id)||financial.id<=0||financial.approvalStatus!=="pending")throw new Error("Monthly adapter must return a pending financial request");
     const linked=partnershipRows(await tx.execute(sql`/* vp_month_link */ UPDATE vehicle_partnership_closings SET financial_transaction_id=${financial.id} WHERE id=${Number(current.id)} AND financial_transaction_id IS NULL AND status='pending' RETURNING id`));
     if(linked.length!==1)throw new Error("Monthly financial request link was not confirmed");next={...next,financial_transaction_id:financial.id};
     await reserveClosingConversions(tx,actor,{root,row:next,snapshot:preview.snapshot,financialId:financial.id});
    }
   }
  }
  const result=await writeOperation(tx,next,actor,command,fingerprint);
  await appendPartnershipAudit(tx,{vehicleId,partnershipId:root.id,actor,action:command.action==="approve_zero"?"closing_approved_zero":`closing_${command.action}`,reason:command.reason,financialTransactionId:next.financial_transaction_id==null?null:Number(next.financial_transaction_id),oldValues:closingDto(current),newValues:result});return result;
 });
}

/** The exact persisted revision is proved independently of a recalculation.
 * Operation/audit rows never masquerade as source or allocation evidence. */
export function closingSubmissionLines(snapshot:ClosingSnapshot,revision:number){
 partnershipId(revision);const result:Array<{key:string;kind:string;amount:string;snapshot:unknown;agreementId?:number;memberId?:number}>=[];
 for(const source of snapshot.sourceSnapshots){
  const proof=object(source.snapshot),amount=object(proof.financial).amount;if(typeof amount!=="string")conflict("مبلغ مصدر الإغلاق غير موثق");
  if(!/^financial:[1-9]\d*$/.test(source.key))conflict("مرجع مصدر الإغلاق غير صالح");
  result.push({key:source.key,kind:proof.activityId!=null?"income":"cost",amount:formatMoney(parseMoney(amount)),snapshot:proof});
 }
 for(const [kind,items] of [["profit_allocation",snapshot.calculation.profitAllocations],["loss_allocation",snapshot.calculation.lossAllocations],["loss_recovery",snapshot.calculation.lossRecoveries]] as const){
  for(const [index,item] of items.entries())if(parseMoney(item.amount)>0n)result.push({key:`${kind}:${index}:${item.agreementId}:${item.memberId}`,kind,amount:item.amount,agreementId:item.agreementId,memberId:item.memberId,snapshot:item});
 }
 const journal=buildClosingJournal(snapshot);result.push({key:`summary:${revision}`,kind:"summary",amount:journal.amount,snapshot:{snapshot,journal}});
 if(new Set(result.map(item=>item.key)).size!==result.length)conflict("مصدر أو توزيع شهري مكرر");return result;
}
export async function lockClosingContext(tx:PartnershipExecutor,actor:PartnershipActor,closingId:number){
 authorizePartnership(actor);partnershipId(closingId);
 const found=partnershipRows(await tx.execute(sql`/* vp_month_scope */ SELECT h.id,h.period::text,p.vehicle_id,h.partnership_id FROM vehicle_partnership_closings h JOIN vehicle_partnerships p ON p.id=h.partnership_id WHERE h.id=${closingId}`));
 if(!found.length)throw new PartnershipRepositoryError("مصدر الإغلاق غير موجود",404,"NOT_FOUND");if(found.length!==1)throw new Error("Ambiguous monthly source identity");
 const vehicleId=partnershipId(Number(found[0].vehicle_id)),root=await lockPartnership(tx,vehicleId);await readOriginalVehicle(tx,actor,vehicleId);
 await lockClosingOriginalSources(tx,actor,vehicleId,String(found[0].period).slice(0,7));
 const row=await header(tx,root.id,{id:closingId});if(!row||row.period!==found[0].period||Number(found[0].partnership_id)!==root.id)conflict("هوية مصدر الإغلاق تغيرت");
 return {root,row};
}
export async function verifySubmittedClosing(tx:PartnershipExecutor,actor:PartnershipActor,context:Awaited<ReturnType<typeof lockClosingContext>>,revalidate=true){
 const {root,row}=context,container=object(row.policy_snapshot),snapshot=object(container.snapshot) as unknown as ClosingSnapshot;
 if(snapshot.vehicleId!==root.vehicleId||snapshot.partnershipId!==root.id||snapshot.from!==row.period||hash(snapshot)!==row.source_digest)conflict("بصمة الإغلاق المحفوظة غير مطابقة");
 const journal=buildClosingJournal(snapshot);
 if(canonicalPartnershipJson(container.journal)!==canonicalPartnershipJson(journal))conflict("القيد المقترح لا يطابق النسخة المحفوظة");
 const expectedLines=new Map(closingSubmissionLines(snapshot,Number(row.revision)).map(item=>[item.key,item]));
 const persisted=partnershipRows(await tx.execute(sql`/* vp_month_submission */ SELECT source_key,line_kind,agreement_id,member_id,amount::text,snapshot FROM vehicle_partnership_closing_lines WHERE closing_id=${Number(row.id)} AND revision=${Number(row.revision)} AND left(source_key,10)<>'operation:' ORDER BY source_key LIMIT 6001`));
 if(persisted.length!==expectedLines.size||persisted.length>6000)conflict("سطور الإغلاق المحفوظة ناقصة أو مكررة");
 for(const item of persisted){const key=String(item.source_key),expected=expectedLines.get(key);if(!expected||item.line_kind!==expected.kind||Number(item.agreement_id??0)!==Number(expected.agreementId??0)||Number(item.member_id??0)!==Number(expected.memberId??0)||parseMoney(String(item.amount))!==parseMoney(expected.amount)||canonicalPartnershipJson(item.snapshot)!==canonicalPartnershipJson(expected.snapshot))conflict("مبلغ أو هوية سطر الإغلاق لا يطابق النسخة المحفوظة");expectedLines.delete(key);}
 if(revalidate)await checkedPreview(tx,actor,root.vehicleId,row);
 return {snapshot,journal};
}
export async function prepareClosingFinancialRequest(tx:PartnershipExecutor,reference:{sourceType:"vehicle_partnership_closing";sourceId:number},actor:PartnershipActor):Promise<TrustedPartnershipRequest>{
 const context=await lockClosingContext(tx,actor,reference.sourceId),{root,row}=context;
 if(row.status!=="pending")conflict("طلب الإغلاق ليس معلقاً للموافقة المالية");
 const {journal}=await verifySubmittedClosing(tx,actor,context);
 if(parseMoney(journal.amount)===0n)conflict("الإغلاق الخالي من القيود يحتاج اعتماداً إدارياً موثقاً دون حركة مالية");
 const rule=PARTNERSHIP_POSTING_TYPES[journal.transactionType];
 return {sourceType:"vehicle_partnership_closing",sourceId:reference.sourceId,sourceEvent:"monthly_result",transactionType:journal.transactionType,direction:rule.direction,amount:journal.amount,transactionDate:closingMonthBounds(String(row.period).slice(0,7)).to,department:"transportation",description:`إغلاق حساب شراكة المركبة — ${String(row.period).slice(0,7)}`,referenceNo:`VP-MONTH-${reference.sourceId}-R${Number(row.revision)}`,idempotencyKey:`vp:closing:${reference.sourceId}:r${Number(row.revision)}`,partnershipId:root.id,vehicleId:root.vehicleId,sourceDigest:String(row.source_digest),linkedFinancialTransactionId:row.financial_transaction_id==null?null:partnershipId(Number(row.financial_transaction_id))};
}
