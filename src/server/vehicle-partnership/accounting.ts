import {createHash} from "node:crypto";
import {sql,type SQL} from "drizzle-orm";
import {z} from "zod/v4";
import {canonicalPartnershipJson} from "../../lib/vehicle-partnership/canonical";
import {validateAgreement} from "../../lib/vehicle-partnership/domain";
import {formatMoney,parseMoney} from "../../lib/vehicle-partnership/money";
import {PartnershipValidationError} from "../../lib/vehicle-partnership/types";
import {activityRange,resolveActivitySources,type TransportSource} from "./activity";
import {authorizePartnership,partnershipId,readOriginalVehicle,readVehiclePartnership,type PartnershipActor,type PartnershipDatabase} from "./agreements";
import {appendPartnershipAudit,lockPartnership,partnershipRows,PartnershipRepositoryError,type PartnershipExecutor} from "./repository";
import {PARTNERSHIP_POSTING_TYPES} from "./financial-classification";
import {preparePartnershipCostRequest} from "./costing";
import {preparePartnershipCapitalRequest} from "./capital";
import {prepareClosingFinancialRequest} from "./closing-lifecycle";
import {prepareDistributionFinancialRequest} from "./distributions";
import {prepareAdvancePaymentFinancialRequest} from "./advance-payments";
import {prepareDriverPaymentFinancialRequest} from "./driver-payments";
import {prepareOpeningLossRequest} from "./opening-loss";

export type PartnershipFinancialRequestReference={sourceType:"vehicle_partnership_activity"|"vehicle_partnership_cost"|"vehicle_partnership_right"|"vehicle_partnership_closing"|"vehicle_partnership_settlement"|"vehicle_partnership_driver"|"vehicle_partnership_opening";sourceId:number;distribution?:unknown;driverPayment?:unknown;advancePayment?:unknown};
export type PartnershipFinancialRequestWriter=(tx:PartnershipExecutor,reference:PartnershipFinancialRequestReference,actor:PartnershipActor)=>Promise<{id:number;approvalStatus:string}>;
export type TrustedPartnershipRequest={
 sourceType:PartnershipFinancialRequestReference["sourceType"];sourceId:number;
 sourceEvent:(typeof PARTNERSHIP_POSTING_TYPES)[keyof typeof PARTNERSHIP_POSTING_TYPES]["sourceEvent"];
 transactionType:keyof typeof PARTNERSHIP_POSTING_TYPES;direction:"revenue"|"expense";
 amount:string;transactionDate:string;department:string;description:string;referenceNo:string;idempotencyKey:string;
 partnershipId:number;vehicleId:number;sourceDigest:string;linkedFinancialTransactionId:number|null;
 agreementId?:number;memberId?:number;employeeFinanceEntryId?:number;
 sourceSnapshot?:Record<string,unknown>;paymentMethod?:"cash"|"transfer"|"pos";
};
const common=z.object({source:z.enum(["kosha","service","delivery"]),sourceId:z.number().int().positive(),recognitionDate:z.string(),expectedVersion:z.number().int().nonnegative(),idempotencyKey:z.string().trim().min(8).max(180),reason:z.string().trim().min(1).max(2000),driverNoCharge:z.boolean().default(false)});
const requestSchema=z.discriminatedUnion("incomeBasis",[
 common.extend({incomeBasis:z.literal("internal"),amount:z.string()}).strict(),
 common.extend({incomeBasis:z.literal("external")}).strict(),
]);
function conflict(message:string):never{throw new PartnershipRepositoryError(message,409,"CONFLICT");}
function sourcePredicate(source:TransportSource,id:number):SQL{
 return source==="kosha"?sql`kosha_booking_id=${id}`:source==="service"?sql`service_order_id=${id}`:sql`delivery_order_id=${id}`;
}
export async function lockOriginalPartnershipTransport(tx:PartnershipExecutor,reference:{source:TransportSource;sourceId:number}):Promise<void>{
 partnershipId(reference.sourceId);
 const statement=reference.source==="kosha"?sql`/* vp_transport_source_lock */ SELECT id FROM kosha_bookings WHERE id=${reference.sourceId} FOR UPDATE`:
  reference.source==="service"?sql`/* vp_transport_source_lock */ SELECT id FROM service_orders WHERE id=${reference.sourceId} FOR UPDATE`:
  reference.source==="delivery"?sql`/* vp_transport_source_lock */ SELECT id FROM delivery_orders WHERE id=${reference.sourceId} FOR UPDATE`:null;
 if(!statement)throw new PartnershipValidationError("مصدر النقل غير صالح");
 const rows=partnershipRows(await tx.execute(statement));
 if(rows.length!==1||Number(rows[0].id)!==reference.sourceId)throw new PartnershipRepositoryError("عملية النقل الأصلية غير موجودة",404,"NOT_FOUND");
}
function requestDto(row:Record<string,unknown>){
 const activityId=partnershipId(Number(row.id)),financialTransactionId=Number(row.financial_transaction_id);
 if(!Number.isSafeInteger(financialTransactionId)||financialTransactionId<=0)throw new Error("Partnership activity financial request link is missing");
 if(!["pending","approved","rejected","cancelled","reversed"].includes(String(row.status)))throw new Error("Invalid partnership activity request state");
 return {activityId,financialTransactionId,status:String(row.status),amount:formatMoney(parseMoney(String(row.amount))),incomeBasis:String(row.income_basis),recognitionDate:String(row.recognition_date)};
}
/** Shared ordering for request, approval and rejection: root -> original
 * operation -> source annotation -> financial request. */
export async function lockPartnershipActivityContext(tx:PartnershipExecutor,actor:PartnershipActor,activityId:number){
 authorizePartnership(actor);
 partnershipId(activityId);
 const read=async(lock=false)=>partnershipRows(await tx.execute(sql`/* vp_financial_activity_source */ SELECT a.*,a.recognition_date::text AS recognition_date,p.vehicle_id FROM vehicle_partnership_activity a JOIN vehicle_partnerships p ON p.id=a.partnership_id WHERE a.id=${activityId} ${lock?sql`FOR UPDATE OF a`:sql``}`));
 const initial=await read();if(initial.length===0)throw new PartnershipRepositoryError("مصدر طلب النقل غير موجود",404,"NOT_FOUND");
 if(initial.length!==1)throw new Error("Ambiguous partnership financial source");
 const root=await lockPartnership(tx,partnershipId(Number(initial[0].vehicle_id)));
 await readOriginalVehicle(tx,actor,root.vehicleId,true);
 const sourceRow=initial[0];
 const refs=([ ["kosha",sourceRow.kosha_booking_id],["service",sourceRow.service_order_id],["delivery",sourceRow.delivery_order_id] ] as const).filter(([,id])=>id!=null);
 if(refs.length!==1)conflict("مرجع عملية النقل المالية غير صالح");
 const [source,rawId]=refs[0],sourceId=partnershipId(Number(rawId));
 await lockOriginalPartnershipTransport(tx,{source,sourceId});
 const current=await read(true);if(current.length!==1)conflict("مصدر طلب النقل تغير أثناء المراجعة");
 const row=current[0];
 if(Number(row.id)!==activityId||Number(row.partnership_id)!==root.id||Number(row.vehicle_id)!==root.vehicleId||row.income_basis!=="internal"&&row.income_basis!=="external")conflict("مصدر النقل ليس ضمن اتفاق هذه المركبة");
 const currentRefs=[row.kosha_booking_id,row.service_order_id,row.delivery_order_id];
 if(currentRefs.filter(id=>id!=null).length!==1||Number(row[source==="kosha"?"kosha_booking_id":source==="service"?"service_order_id":"delivery_order_id"])!==sourceId)conflict("هوية مصدر النقل تغيرت أثناء المراجعة");
 return {root,row,original:{source,sourceId}};
}
/** The central request writer receives a source ID, never a client amount,
 * direction, account or cash-impact flag. Validate its original locked source
 * and immutable proof again before constructing the pending financial row. */
export async function preparePartnershipFinancialRequest(tx:PartnershipExecutor,reference:PartnershipFinancialRequestReference,actor:PartnershipActor):Promise<TrustedPartnershipRequest>{
 if(reference.sourceType==="vehicle_partnership_opening")return prepareOpeningLossRequest(tx,reference as {sourceType:"vehicle_partnership_opening";sourceId:number},actor);
 if(reference.sourceType==="vehicle_partnership_settlement"&&reference.advancePayment!==undefined){
  if(reference.distribution!==undefined||reference.driverPayment!==undefined)throw new PartnershipValidationError("طلب تسديد السلفة لا يجمع مصادر صرف أخرى");
  return prepareAdvancePaymentFinancialRequest(tx,{sourceType:"vehicle_partnership_settlement",sourceId:reference.sourceId,advancePayment:reference.advancePayment},actor);
 }
 if(reference.sourceType==="vehicle_partnership_driver")return prepareDriverPaymentFinancialRequest(tx,{sourceType:"vehicle_partnership_driver",sourceId:reference.sourceId,driverPayment:reference.driverPayment},actor);
 if(reference.sourceType==="vehicle_partnership_settlement")return prepareDistributionFinancialRequest(tx,{sourceType:"vehicle_partnership_settlement",sourceId:reference.sourceId,distribution:reference.distribution},actor);
 if(reference.sourceType==="vehicle_partnership_closing")return prepareClosingFinancialRequest(tx,{sourceType:"vehicle_partnership_closing",sourceId:reference.sourceId},actor);
 if(reference.sourceType==="vehicle_partnership_cost")return preparePartnershipCostRequest(tx,reference,actor);
 if(reference.sourceType==="vehicle_partnership_right")return preparePartnershipCapitalRequest(tx,reference,actor);
 authorizePartnership(actor);
 if(reference.sourceType!=="vehicle_partnership_activity")throw new PartnershipValidationError("مصدر طلب الشراكة غير مدعوم");
 const {root,row,original:{source,sourceId}}=await lockPartnershipActivityContext(tx,actor,reference.sourceId);
 if(row.status!=="pending")conflict("طلب النقل ليس معلقاً للمراجعة المالية");
 const {trip,digest}=await resolveActivitySources(tx,actor,{vehicleId:root.vehicleId,source,id:sourceId});
 const snapshot=row.source_snapshot;
 if(!snapshot||typeof snapshot!=="object"||Array.isArray(snapshot))conflict("بصمة مصدر النقل غير مكتملة");
 const proof=snapshot as Record<string,unknown>;
 if(proof.originalDigest!==digest||proof.source!==source||Number(proof.sourceId)!==sourceId||Number(proof.vehicleId)!==root.vehicleId||Number(proof.agreementId)!==Number(row.agreement_id))conflict("بيانات النقل تغيرت؛ أعد مراجعة الطلب من مصدره");
 const date=String(row.recognition_date);activityRange({vehicleId:root.vehicleId,from:date,to:date});activityRange({vehicleId:root.vehicleId,from:trip.date,to:trip.date});
 if(date<trip.date!||["cancelled","canceled","archived","deleted"].includes(trip.status))conflict("تاريخ النقل أو حالته لم يعد صالحاً للاعتراف بالمبلغ");
 const setup=await readVehiclePartnership(tx,actor,root.vehicleId);
 const agreement=setup.partnership?.agreements.filter(a=>a.status==="approved"&&a.effectiveFrom<=trip.date!).sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
 if(!agreement||agreement.id!==Number(row.agreement_id)||agreement.revision!==Number(proof.agreementRevision))conflict("اتفاق الرحلة تغير قبل المراجعة المالية");
 const amount=formatMoney(parseMoney(String(row.amount)));
 if(row.income_basis==="external"&&(trip.inTotal!==true||trip.billingSource==null||trip.billingId==null||trip.customerCharge==null||parseMoney(amount)!==parseMoney(trip.customerCharge)))conflict("أجرة النقل الخارجي لا تطابق المبلغ المفوتر الأصلي");
 if(typeof row.reason!=="string"||!row.reason.trim())conflict("سبب طلب النقل غير موثق");
 const expected=createHash("sha256").update(canonicalPartnershipJson({snapshot:proof,amount,incomeBasis:row.income_basis,recognitionDate:date,reason:row.reason})).digest("hex");
 if(row.source_digest!==expected)conflict("إثبات طلب النقل لا يطابق بياناته؛ لا يمكن اعتماد قيم معدلة");
 const type=row.income_basis==="internal"?"vp_internal_entitlement":"vp_external_attribution",rule=PARTNERSHIP_POSTING_TYPES[type];
 return {sourceType:"vehicle_partnership_activity",sourceId:reference.sourceId,sourceEvent:rule.sourceEvent,transactionType:type,direction:rule.direction,amount,transactionDate:date,department:"transportation",description:`${row.income_basis==="internal"?"استحقاق نقل داخلي":"اعتماد نسبة أجرة نقل خارجية"} — ${trip.reference}`,referenceNo:`VP-ACT-${reference.sourceId}`,idempotencyKey:`vp:activity:${reference.sourceId}:r${partnershipId(Number(row.revision))}`,partnershipId:root.id,vehicleId:root.vehicleId,sourceDigest:expected,linkedFinancialTransactionId:row.financial_transaction_id==null?null:partnershipId(Number(row.financial_transaction_id))};
}
/** Creates an annotation of the ORIGINAL operation and a pending request in
 * ONE transaction. The injected writer is the trusted central source adapter;
 * it must not execute cash or journals. No generic financial form is used. */
export async function submitPartnershipActivity(db:PartnershipDatabase,actor:PartnershipActor,vehicleId:number,input:unknown,createRequest:PartnershipFinancialRequestWriter){
 authorizePartnership(actor);partnershipId(vehicleId);
 const parsed=requestSchema.safeParse(input);
 if(!parsed.success)throw new PartnershipValidationError(parsed.error.issues.map(issue=>issue.message).join("؛ "));
 const command=parsed.data;
 activityRange({vehicleId,from:command.recognitionDate,to:command.recognitionDate});
 const internalAmount=command.incomeBasis==="internal"?formatMoney(parseMoney(command.amount)):null;
 return db.transaction(async tx=>{
  const root=await lockPartnership(tx,vehicleId);
  await readOriginalVehicle(tx,actor,vehicleId,true);
  if(root.ownershipType!=="partnership")conflict("هذه المركبة لا تستخدم اتفاق شراكة فعالاً");
  await lockOriginalPartnershipTransport(tx,command);
  const {trip,digest:originalDigest}=await resolveActivitySources(tx,actor,{vehicleId,source:command.source,id:command.sourceId});
  if(["cancelled","canceled","archived","deleted"].includes(trip.status))conflict("لا يمكن اعتماد أجرة عملية نقل ملغاة أو مؤرشفة");
  activityRange({vehicleId,from:trip.date,to:trip.date});
  if(command.recognitionDate<trip.date!)conflict("تاريخ الاعتراف لا يسبق تاريخ النقل الأصلي");
  const setup=await readVehiclePartnership(tx,actor,vehicleId);
  if(!setup.partnership||setup.partnership.id!==root.id)throw new Error("Partnership configuration changed under source lock");
  const agreement=setup.partnership.agreements.filter(a=>a.status==="approved"&&a.effectiveFrom<=trip.date!).sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  if(!agreement)conflict("يجب اعتماد اتفاق شراكة نافذ بتاريخ النقل أولاً");
  validateAgreement({vehicleId,registrationOwner:root.registrationOwner,effectiveFrom:agreement.effectiveFrom,members:agreement.members});
  if(command.incomeBasis==="external"&&(trip.customerCharge==null||trip.inTotal!==true||trip.billingSource==null||trip.billingId==null))conflict("أجرة النقل الخارجي لا ترتبط بمبلغ مفوتر في المصدر؛ صحح الحجز الأصلي أولاً");
  const amount=internalAmount??formatMoney(parseMoney(trip.customerCharge!));
  const snapshot={originalDigest,source:command.source,sourceId:command.sourceId,vehicleId,agreementId:agreement.id,agreementRevision:agreement.revision,driverNoCharge:command.driverNoCharge,originalCustomerCharge:trip.customerCharge,eventDate:trip.date,reference:trip.reference,customerName:trip.customerName,driverId:trip.driverId,billingSource:trip.billingSource,billingId:trip.billingId,inTotal:trip.inTotal};
  const sourceDigest=createHash("sha256").update(canonicalPartnershipJson({snapshot,amount,incomeBasis:command.incomeBasis,recognitionDate:command.recognitionDate,reason:command.reason})).digest("hex");
  const replay=partnershipRows(await tx.execute(sql`/* vp_transport_replay */ SELECT * FROM vehicle_partnership_activity WHERE idempotency_key=${command.idempotencyKey}`));
  if(replay.length){
   if(replay.length!==1||Number(replay[0].partnership_id)!==root.id||replay[0].source_digest!==sourceDigest)conflict("مرجع الطلب مستخدم لعملية نقل أو مبلغ مختلف");
   return requestDto(replay[0]);
  }
  if(root.version!==command.expectedVersion)conflict("نسخة اتفاق الشراكة تغيرت؛ حدّث الصفحة قبل إرسال الطلب");
  const predicate=sourcePredicate(command.source,command.sourceId);
  const active=partnershipRows(await tx.execute(sql`/* vp_transport_active */ SELECT id FROM vehicle_partnership_activity WHERE partnership_id=${root.id} AND ${predicate} AND operation_key='transportation' AND status IN ('draft','pending','approved') FOR UPDATE`));
  if(active.length)conflict("توجد أجرة أو استحقاق نشط لنفس عملية النقل؛ لا يمكن احتساب الأجرة مرتين");
  const revisions=partnershipRows(await tx.execute(sql`/* vp_transport_revision */ SELECT coalesce(max(revision),0)+1 AS revision FROM vehicle_partnership_activity WHERE partnership_id=${root.id} AND ${predicate} AND operation_key='transportation'`));
  if(revisions.length!==1||!Number.isSafeInteger(Number(revisions[0].revision))||Number(revisions[0].revision)<=0)throw new Error("Invalid transport activity revision");
  const inserted=partnershipRows(await tx.execute(sql`INSERT INTO vehicle_partnership_activity (partnership_id,agreement_id,kosha_booking_id,service_order_id,delivery_order_id,amount,recognition_date,revision,source_digest,source_snapshot,idempotency_key,income_basis,created_by,reason,operation_key,status) VALUES (${root.id},${agreement.id},${command.source==="kosha"?command.sourceId:null},${command.source==="service"?command.sourceId:null},${command.source==="delivery"?command.sourceId:null},${amount},${command.recognitionDate},${Number(revisions[0].revision)},${sourceDigest},${JSON.stringify(snapshot)}::jsonb,${command.idempotencyKey},${command.incomeBasis},${actor.id},${command.reason},'transportation','pending') RETURNING *`));
  if(inserted.length!==1)throw new Error("Transport activity request insert was not confirmed");
  const activityId=partnershipId(Number(inserted[0].id));
  const financial=await createRequest(tx,{sourceType:"vehicle_partnership_activity",sourceId:activityId},actor);
  if(!Number.isSafeInteger(financial.id)||financial.id<=0||financial.approvalStatus!=="pending")throw new Error("Source adapter must return an unexecuted pending financial request");
  const linked=partnershipRows(await tx.execute(sql`UPDATE vehicle_partnership_activity SET financial_transaction_id=${financial.id} WHERE id=${activityId} AND financial_transaction_id IS NULL AND status='pending' RETURNING id`));
  if(linked.length!==1)throw new Error("Transport financial request link was not confirmed");
  await appendPartnershipAudit(tx,{vehicleId,partnershipId:root.id,actor,action:"transport_submitted",reason:command.reason,financialTransactionId:financial.id,newValues:{activityId,source:command.source,sourceId:command.sourceId,agreementId:agreement.id,amount,incomeBasis:command.incomeBasis,recognitionDate:command.recognitionDate,status:"pending"}});
  return requestDto({...inserted[0],financial_transaction_id:financial.id});
 });
}
