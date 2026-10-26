import {createHash} from "node:crypto";
import {sql} from "drizzle-orm";
import {z} from "zod/v4";
import {canonicalPartnershipJson} from "../../lib/vehicle-partnership/canonical";
import {formatMoney,parseMoney} from "../../lib/vehicle-partnership/money";
import {PartnershipValidationError} from "../../lib/vehicle-partnership/types";
import {reconcilePaymentState} from "../payment-state";
import {activityRange} from "./activity";
import {authorizePartnership,partnershipId,readOriginalVehicle,type PartnershipActor,type PartnershipDatabase} from "./agreements";
import {appendPartnershipAudit,lockPartnership,partnershipRows,PartnershipRepositoryError,type PartnershipExecutor} from "./repository";
import type {PartnershipFinancialRequestReference,PartnershipFinancialRequestWriter,TrustedPartnershipRequest} from "./accounting";
type Row=Record<string,unknown>;
function conflict(message:string):never{throw new PartnershipRepositoryError(message,409,"CONFLICT");}
const capitalSchema=z.object({memberId:z.number().int().positive(),amount:z.string(),entryDate:z.string(),expectedVersion:z.number().int().nonnegative(),idempotencyKey:z.string().trim().min(8).max(180),reason:z.string().trim().min(3).max(2000)}).strict();
const digest=(value:unknown)=>createHash("sha256").update(canonicalPartnershipJson(value)).digest("hex");
async function capitalMember(tx:PartnershipExecutor,partnershipIdValue:number,memberId:number,date:string){
 const members=partnershipRows(await tx.execute(sql`/* vp_capital_member */ SELECT m.id,m.agreement_id,g.partnership_id,g.status,g.effective_from::text FROM vehicle_partnership_members m JOIN vehicle_partnership_agreements g ON g.id=m.agreement_id WHERE m.id=${partnershipId(memberId)} AND g.partnership_id=${partnershipIdValue} AND g.status='approved' AND g.effective_from<=${date}::date AND NOT EXISTS (SELECT 1 FROM vehicle_partnership_agreements later WHERE later.partnership_id=g.partnership_id AND later.status='approved' AND later.effective_from<=${date}::date AND later.effective_from>g.effective_from) FOR KEY SHARE OF m,g`));
 if(members.length!==1||Number(members[0].id)!==memberId||Number(members[0].partnership_id)!==partnershipIdValue||members[0].status!=="approved"||String(members[0].effective_from)>date)conflict("مساهمة رأس المال تتطلب شريكاً ضمن الاتفاق المعتمد النافذ بتاريخها");
 return members[0];
}
export function capitalSourceMetadata(row:Row,vehicleId:number){
 const raw=row.source_snapshot;if(!raw||typeof raw!=="object"||Array.isArray(raw))conflict("إثبات مساهمة رأس المال غير صالح");const snapshot=raw as Row;
 activityRange({vehicleId,from:snapshot.entryDate,to:snapshot.entryDate});
 if(typeof snapshot.requestKey!=="string"||snapshot.requestKey.length<8||String(row.event_key)!==`vp:capital:${snapshot.requestKey}`||parseMoney(String(row.amount))<=0n)conflict("هوية مساهمة رأس المال أو مبلغها غير صالح");
 const command={memberId:partnershipId(Number(row.member_id)),amount:formatMoney(parseMoney(String(row.amount))),entryDate:String(snapshot.entryDate),reason:String(row.reason)};
 if(snapshot.commandDigest!==digest(command))conflict("تغير إثبات مساهمة رأس المال؛ راجع الطلب قبل الاعتماد");
 return {...command,sourceDigest:String(snapshot.commandDigest)};
}
export async function lockPartnershipCapitalContext(tx:PartnershipExecutor,actor:PartnershipActor,rightId:number){
 authorizePartnership(actor);partnershipId(rightId);
 const read=async(lock=false)=>partnershipRows(await tx.execute(sql`/* vp_capital_source */ SELECT r.*,p.vehicle_id FROM vehicle_partnership_rights r JOIN vehicle_partnerships p ON p.id=r.partnership_id WHERE r.id=${rightId} AND r.category='capital' AND r.cost_funding_id IS NULL AND r.closing_line_id IS NULL AND r.activity_id IS NULL ${lock?sql`FOR UPDATE OF r`:sql``}`));
 const initial=await read();if(!initial.length)throw new PartnershipRepositoryError("مصدر مساهمة رأس المال غير موجود",404,"NOT_FOUND");if(initial.length!==1)throw new Error("Ambiguous capital source");
 const root=await lockPartnership(tx,partnershipId(Number(initial[0].vehicle_id)));await readOriginalVehicle(tx,actor,root.vehicleId,true);
 const proof=capitalSourceMetadata(initial[0],root.vehicleId);const member=await capitalMember(tx,root.id,proof.memberId,proof.entryDate);
 const rows=await read(true);if(rows.length!==1||Number(rows[0].partnership_id)!==root.id||Number(rows[0].agreement_id)!==Number(member.agreement_id)||rows[0].direction!=="credit"||rows[0].category!=="capital"||capitalSourceMetadata(rows[0],root.vehicleId).sourceDigest!==proof.sourceDigest)conflict("هوية مساهمة رأس المال تغيرت أثناء المراجعة");
 return {root,row:rows[0],proof};
}
export async function preparePartnershipCapitalRequest(tx:PartnershipExecutor,reference:PartnershipFinancialRequestReference,actor:PartnershipActor):Promise<TrustedPartnershipRequest>{
 authorizePartnership(actor);if(reference.sourceType!=="vehicle_partnership_right")conflict("نوع مصدر مساهمة رأس المال غير مطابق");
 const {root,row,proof}=await lockPartnershipCapitalContext(tx,actor,reference.sourceId);
 if(root.ownershipType!=="partnership"||row.status!=="pending")conflict("مساهمة رأس المال ليست طلباً معلقاً صالحاً");
 return {sourceType:"vehicle_partnership_right",sourceId:reference.sourceId,sourceEvent:"capital_entry",transactionType:"vp_capital_record",direction:"revenue",amount:proof.amount,transactionDate:proof.entryDate,department:"transportation",description:`تسجيل مساهمة رأس مال شراكة المركبة — ${proof.reason}`,referenceNo:`VP-CAP-${reference.sourceId}`,idempotencyKey:`vp:capital-request:${reference.sourceId}`,partnershipId:root.id,vehicleId:root.vehicleId,sourceDigest:proof.sourceDigest,linkedFinancialTransactionId:row.financial_transaction_id==null?null:partnershipId(Number(row.financial_transaction_id)),memberId:proof.memberId,agreementId:partnershipId(Number(row.agreement_id))};
}
const dto=(row:Row)=>({rightId:partnershipId(Number(row.id)),status:String(row.status),amount:formatMoney(parseMoney(String(row.amount))),financialTransactionId:partnershipId(Number(row.financial_transaction_id))});
/** Explicit declaration is not receipt of money. The existing central source
 * request remains pending, and an eventual approved cash receipt is separate. */
export async function submitPartnershipCapital(db:PartnershipDatabase,actor:PartnershipActor,vehicleId:number,input:unknown,createRequest:PartnershipFinancialRequestWriter){
 authorizePartnership(actor);partnershipId(vehicleId);const parsed=capitalSchema.safeParse(input);if(!parsed.success)throw new PartnershipValidationError(parsed.error.issues.map(issue=>issue.message).join("؛ "));
 const command={...parsed.data,amount:formatMoney(parseMoney(parsed.data.amount))};if(parseMoney(command.amount)<=0n)throw new PartnershipValidationError("مساهمة رأس المال يجب أن تكون موجبة");
 activityRange({vehicleId,from:command.entryDate,to:command.entryDate});
 const commandDigest=digest({memberId:command.memberId,amount:command.amount,entryDate:command.entryDate,reason:command.reason});
 return db.transaction(async tx=>{
  const root=await lockPartnership(tx,vehicleId);await readOriginalVehicle(tx,actor,vehicleId,true);if(root.ownershipType!=="partnership")conflict("المركبة ليست ضمن شراكة فعالة");
  const member=await capitalMember(tx,root.id,command.memberId,command.entryDate);
  const replay=partnershipRows(await tx.execute(sql`/* vp_capital_replay */ SELECT * FROM vehicle_partnership_rights WHERE event_key=${`vp:capital:${command.idempotencyKey}`}`));
  if(replay.length){if(replay.length!==1||Number(replay[0].partnership_id)!==root.id||capitalSourceMetadata(replay[0],vehicleId).sourceDigest!==commandDigest)conflict("مرجع مساهمة رأس المال مستخدم لبيانات أخرى");return dto(replay[0]);}
  if(root.version!==command.expectedVersion)conflict("تغير اتفاق الشراكة؛ حدّث البيانات قبل تسجيل المساهمة");
  const snapshot={entryDate:command.entryDate,requestKey:command.idempotencyKey,commandDigest};
  const rows=partnershipRows(await tx.execute(sql`INSERT INTO vehicle_partnership_rights (partnership_id,agreement_id,member_id,amount,event_key,created_by,reason,source_snapshot,category,direction,status) VALUES (${root.id},${Number(member.agreement_id)},${command.memberId},${command.amount},${`vp:capital:${command.idempotencyKey}`},${actor.id},${command.reason},${JSON.stringify(snapshot)}::jsonb,'capital','credit','pending') RETURNING *`));
  if(rows.length!==1)throw new Error("Capital source insert was not confirmed");const rightId=partnershipId(Number(rows[0].id));
  const financial=await createRequest(tx,{sourceType:"vehicle_partnership_right",sourceId:rightId},actor);if(!Number.isSafeInteger(financial.id)||financial.id<=0||financial.approvalStatus!=="pending")throw new Error("Capital declaration requires central pending approval");
  const linked=partnershipRows(await tx.execute(sql`UPDATE vehicle_partnership_rights SET financial_transaction_id=${financial.id} WHERE id=${rightId} AND financial_transaction_id IS NULL AND status='pending' RETURNING id`));if(linked.length!==1||Number(linked[0].id)!==rightId)throw new Error("Capital financial request link was not confirmed");
  const payment=await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_right",sourceId:rightId});if(parseMoney(payment.approvedPaidAmount)!==0n||parseMoney(payment.reservedAmount)!==0n)conflict("تسجيل المساهمة لا يمثل قبضاً نقدياً");
  await appendPartnershipAudit(tx,{vehicleId,partnershipId:root.id,actor,action:"capital_submitted",reason:command.reason,financialTransactionId:financial.id,newValues:{rightId,memberId:command.memberId,amount:command.amount,entryDate:command.entryDate,cashImpact:"none",status:"pending"}});
  return dto({...rows[0],financial_transaction_id:financial.id});
 });
}
