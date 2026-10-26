import {createHash} from "node:crypto";
import {sql} from "drizzle-orm";
import {z} from "zod/v4";
import {canonicalPartnershipJson} from "../../lib/vehicle-partnership/canonical";
import {calculatePartnershipClosing,closingMonthBounds,type ClosingCalculation,type ClosingLossClaim} from "../../lib/vehicle-partnership/closing";
import {allocateMoney,formatMoney,parseMoney} from "../../lib/vehicle-partnership/money";
import {PartnershipValidationError} from "../../lib/vehicle-partnership/types";
import {authorizePartnership,partnershipId,readOriginalVehicle,type PartnershipActor} from "./agreements";
import {readVehicleActivity} from "./activity";
import {readClosingSourceEvidence} from "./closing-source-repository";
import {buildClosingJournal,type ClosingJournal} from "./closing-journal";
import {lockPartnership,partnershipRows,PartnershipRepositoryError,type PartnershipExecutor} from "./repository";

type Row=Record<string,unknown>;
function conflict(message:string):never{throw new PartnershipRepositoryError(message,409,"CONFLICT");}
function record(value:unknown):Row{if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Invalid stored monthly closing object");return value as Row;}
const digest=(value:unknown)=>createHash("sha256").update(canonicalPartnershipJson(value)).digest("hex");
const money=z.string().regex(/^(0|[1-9]\d{0,13})(?:\.\d{1,2})?$/);
const depreciation=z.union([z.object({kind:z.literal("none")}).strict(),z.object({kind:z.literal("configured"),amount:money}).strict()]);
const reserve=z.union([z.object({kind:z.literal("none")}).strict(),z.object({kind:z.literal("fixed"),amount:money}).strict(),z.object({kind:z.literal("percent"),basis:z.enum(["after_loss_recovery","recognized_income"]),basisPoints:z.number().int().min(0).max(10000)}).strict()]);
export const closingPolicySchema=z.object({depreciation:depreciation.nullable().default(null),reserve:reserve.nullable().default(null),resultAllocation:z.literal("dated_results").nullable().default(null),sharedCostBasis:z.literal("expense_date").nullable().default(null),accountingMethod:z.literal("activity_clearing").nullable().default(null)}).strict();
export type ClosingPolicy=z.infer<typeof closingPolicySchema>;
type SourceBundle=Awaited<ReturnType<typeof readClosingSourceEvidence>>;
export type ClosingSnapshot={formatVersion:1;vehicleId:number;partnershipId:number;setupVersion:number;from:string;to:string;policy:ClosingPolicy;agreements:SourceBundle["agreements"];sourceSnapshots:SourceBundle["snapshots"];lossClaims:ClosingLossClaim[];previousClosing:{id:number;revision:number;sourceDigest:string}|null;calculation:ClosingCalculation};
function policyFrom(value:Row):ClosingPolicy{
 const parsed=closingPolicySchema.safeParse({depreciation:value.depreciation,reserve:value.reserve,resultAllocation:value.resultAllocation,sharedCostBasis:value.sharedCostBasis,accountingMethod:value.accountingMethod});
 if(!parsed.success)throw new PartnershipValidationError("سياسة إغلاق الشراكة غير صالحة؛ راجع الإهلاك والاحتياطي وأساس التوزيع");return parsed.data;
}
function approvedFinancial(row:Row,rootId:number,journal:ClosingJournal){
 if(Number(row.partnership_id)!==rootId)conflict("مصدر الإغلاق يخص شراكة مختلفة");
 if(parseMoney(journal.amount)===0n){
  if(journal.legs.length||row.financial_transaction_id!=null||row.zero_approval_proven!==true||!Number.isSafeInteger(Number(row.approved_by))||Number(row.approved_by)<=0||row.approved_at==null)conflict("الإغلاق الصفري يحتاج اعتماداً إدارياً مثبتاً دون حركة مالية");
  return;
 }
 if(row.financial_status!=="executed"||row.financial_source_type!=="vehicle_partnership_closing"||String(row.financial_source_id)!==String(row.id)||row.financial_event!=="monthly_result"||row.financial_type!==journal.transactionType||row.financial_direction!==(journal.transactionType==="vp_month_profit"?"expense":"revenue")||typeof row.financial_amount!=="string"||parseMoney(row.financial_amount)!==parseMoney(journal.amount)||row.financial_date!==closingMonthBounds(String(row.period).slice(0,7)).to||parseMoney(String(row.financial_reversed))!==0n||!Number.isSafeInteger(Number(row.financial_transaction_id))||Number(row.financial_transaction_id)<=0)conflict("إثبات اعتماد الإغلاق الشهري لا يطابق مصدره وقيده المالي");
}
function frozen(row:Row,vehicleId:number,rootId:number){
 const snapshot=record(record(row.policy_snapshot).snapshot);
 if(snapshot.formatVersion!==1||snapshot.vehicleId!==vehicleId||snapshot.partnershipId!==rootId||snapshot.from!==String(row.period)||snapshot.to!==closingMonthBounds(String(row.period).slice(0,7)).to||digest(snapshot)!==row.source_digest)conflict("بصمة الإغلاق المحفوظة لا تطابق نسخته المعتمدة");
 if(record(snapshot.policy).accountingMethod!=="activity_clearing")conflict("سياسة الإغلاق المحفوظة غير معتمدة");
 const calculation=record(snapshot.calculation),summary=record(calculation.summary);
 if(summary.complete!==true||typeof calculation.digest!=="string"||!/^[a-f0-9]{64}$/.test(calculation.digest))conflict("نتيجة الإغلاق المحفوظة غير مكتملة");
 for(const field of ["externalIncome","internalIncome","cost","result","lossRecovered","carriedLossOut","reserve","maxDistributable"]){
  const value=summary[field];if(typeof value!=="string")conflict("مبلغ إغلاق محفوظ غير صالح");
  const negative=value.startsWith("-"),amount=parseMoney(negative?value.slice(1):value);
  if(formatMoney(negative?-amount:amount)!==value)conflict("دقة المبلغ المحفوظ لا تطابق نتيجة الإغلاق");
 }
 approvedFinancial(row,rootId,buildClosingJournal(snapshot as unknown as ClosingSnapshot));
 return {snapshot:snapshot as unknown as ClosingSnapshot,calculation:calculation as unknown as ClosingCalculation};
}
const previousMonth=(from:string)=>new Date(Date.UTC(Number(from.slice(0,4)),Number(from.slice(5,7))-1,0)).toISOString().slice(0,7)+"-01";

/** Caller owns the transaction. Root locking serializes feature financial
 * sources; final approval must additionally re-lock/revalidate original sources
 * before writing. This preview itself never creates a close, journal or right.
 * No public monthly approval handler is enabled by this read implementation. */
export async function previewClosing(tx:PartnershipExecutor,actor:PartnershipActor,vehicleId:number,month:string,policyOverride?:ClosingPolicy){
 authorizePartnership(actor);partnershipId(vehicleId);const range=closingMonthBounds(month);
 const root=await lockPartnership(tx,vehicleId);
 await readOriginalVehicle(tx,actor,vehicleId);
 const periods=partnershipRows(await tx.execute(sql`/* vp_closing_periods */ SELECT h.*,h.period::text AS period,f.approval_status AS financial_status,f.source_type AS financial_source_type,f.source_id AS financial_source_id,f.source_event AS financial_event,f.transaction_type AS financial_type,f.direction AS financial_direction,f.amount::text AS financial_amount,f.transaction_date::text AS financial_date,EXISTS(SELECT 1 FROM financial_audit_logs a WHERE a.action='vehicle_partnership_closing_approved_zero' AND a.actor_id=h.approved_by AND a.transaction_id IS NULL AND a.new_values->>'closingId'=h.id::text AND a.new_values->>'sourceDigest'=h.source_digest AND a.new_values->>'revision'=h.revision::text AND a.new_values->>'version'=h.version::text AND a.new_values->>'status'='approved') AS zero_approval_proven,coalesce((SELECT sum(r.amount) FROM financial_transactions r WHERE r.reversed_transaction_id=f.id AND r.approval_status='executed'),0)::text AS financial_reversed FROM vehicle_partnership_closings h LEFT JOIN financial_transactions f ON f.id=h.financial_transaction_id WHERE h.partnership_id=${root.id} AND h.period<=${range.from}::date ORDER BY h.period DESC LIMIT 241`));
 if(periods.length>240)throw new PartnershipRepositoryError("سجل الإغلاقات يتجاوز حد المراجعة؛ يلزم تقسيم السجل قبل المتابعة",409,"LIMIT_EXCEEDED");
 if(new Set(periods.map(h=>h.period)).size!==periods.length||periods.some(h=>Number(h.partnership_id)!==root.id||!["draft","review","pending","approved","distributed"].includes(String(h.status))))conflict("سجل إغلاقات الشراكة غير صالح أو مكرر");
 const current=periods.find(h=>h.period===range.from);
 // Original branch permission is checked even when the approved result is
 // rendered from frozen data. Never re-read today's activity for this branch.
 if(current&&["approved","distributed"].includes(String(current.status))){
  const stored=frozen(current,vehicleId,root.id);
  return {stored:true,provisional:false,vehicleId,partnershipId:root.id,...range,closingId:Number(current.id),status:String(current.status),version:Number(current.version),sourceDigest:String(current.source_digest),snapshot:stored.snapshot,calculation:stored.calculation,approvalBlockers:[] as string[]};
 }
 const evidence=await readClosingSourceEvidence(tx,actor,vehicleId,month);
 const currentActivity=await readVehicleActivity(tx,actor,{vehicleId,...range});
 const blockers=[...evidence.blockers,...currentActivity.blockers];
 const policyContainer=current?record(current.policy_snapshot):{};
 const policy=policyFrom(policyOverride??(policyContainer.policy==null?evidence.agreements.at(-1)!.policy:record(policyContainer.policy)));
 const consumed=partnershipRows(await tx.execute(sql`/* vp_closing_consumed_sources */ SELECT l.source_key,h.id AS closing_id,h.period::text FROM vehicle_partnership_closing_lines l JOIN vehicle_partnership_closings h ON h.id=l.closing_id WHERE h.partnership_id=${root.id} AND h.status IN ('approved','distributed') AND l.revision=h.revision AND h.period<${range.from}::date AND l.source_key LIKE 'financial:%' ORDER BY l.id LIMIT 10001`));
 if(consumed.length>10000)throw new PartnershipRepositoryError("سجل مصادر الإغلاقات يتجاوز حد المراجعة؛ لا يمكن تجاهل مصادر قديمة",409,"LIMIT_EXCEEDED");
 const consumedKeys=new Set<string>();for(const line of consumed){const key=String(line.source_key);if(!/^financial:[1-9]\d*$/.test(key)||consumedKeys.has(key))conflict("مصدر مالي مستخدم في أكثر من إغلاق معتمد");consumedKeys.add(key);}
 for(const source of evidence.historySources){
  if(source.date>range.to)continue;
  if(source.date<range.from&&!consumedKeys.has(source.key))blockers.push(`مصدر ${source.key} من فترة سابقة غير مسوّاة؛ يلزم إغلاق فترته أو تصحيح مؤرخ معتمد`);
  if(source.date>=range.from&&consumedKeys.has(source.key))blockers.push(`مصدر ${source.key} مستخدم في إغلاق معتمد سابقاً`);
 }
 // Existing trip profit validation supplies real driver-fee/no-fee, source
 // freshness and booking billing checks. A late-recognized original trip uses
 // that SAME reader for its original day instead of guessing a zero driver fee.
 const reports=new Map<string,typeof currentActivity>([[range.from,currentActivity]]);
 const oldDays=new Set(evidence.snapshots.filter(s=>s.snapshot.activityId!=null&&s.snapshot.reversedFinancialId==null).map(s=>String(record(s.snapshot.sourceSnapshot).eventDate)).filter(day=>day<range.from));
 if(oldDays.size>31)throw new PartnershipRepositoryError("مصادر النقل المتأخرة تحتاج مراجعة مقسمة قبل الإغلاق",409,"LIMIT_EXCEEDED");
 for(const day of [...oldDays].sort())reports.set(day,await readVehicleActivity(tx,actor,{vehicleId,from:day,to:day}));
 for(const line of evidence.snapshots){
  if(line.snapshot.activityId==null||line.snapshot.reversedFinancialId!=null)continue;
  const original=record(line.snapshot.sourceSnapshot),day=String(original.eventDate),report=day<range.from?reports.get(day):currentActivity;
  const trip=report?.trips.find(t=>t.source===original.source&&t.id===Number(original.sourceId));
  if(!trip)blockers.push(`مصدر النقل ${String(original.reference??line.key)} لم يعد مرتبطاً بالمركبة؛ يلزم المراجعة`);
  else blockers.push(...trip.profitability.blockers.map(reason=>`${trip.reference}: ${reason}`));
 }
 const approved=periods.filter(h=>["approved","distributed"].includes(String(h.status))&&String(h.period)<range.from).sort((a,b)=>String(a.period).localeCompare(String(b.period)));
 const initialPeriod=evidence.agreements[0].effectiveFrom.slice(0,7)+"-01";
 let openingVerified=false;
 const claims:ClosingLossClaim[]=[];
 if(range.from===initialPeriod&&approved.length===0){
  const opening=evidence.agreements[0].policy.openingLoss;
  if(typeof opening==="string"){
   const openingAmount=parseMoney(opening);openingVerified=true;
   const term=evidence.terms[0];
   for(const line of allocateMoney(openingAmount,term.members.map(m=>({key:`member:${m.id}`,basisPoints:m.expenseBasisPoints})))){
    const member=term.members.find(m=>`member:${m.id}`===line.key)!;
    if(parseMoney(line.amount)>0n)claims.push({key:`opening:agreement:${term.id}:member:${member.id}`,category:"loss",period:range.from,agreementId:term.id,memberId:member.id,partyKey:member.partyKey,remaining:line.amount});
   }
  }
 }else{
  let next=initialPeriod;
  for(const header of approved){if(String(header.period)!==next){blockers.push("يوجد شهر غير مغلق بين بداية الشراكة والشهر المحدد");break;}frozen(header,vehicleId,root.id);const [year,m]=String(header.period).slice(0,7).split("-").map(Number);next=new Date(Date.UTC(year,m,1)).toISOString().slice(0,10);}
  const prior=approved.at(-1);
  if(!prior||prior.period!==previousMonth(range.from)||next!==range.from)blockers.push("اعتمد الأشهر السابقة بالتسلسل قبل إغلاق الشهر المحدد");
  else{
   const lossRows=partnershipRows(await tx.execute(sql`/* vp_closing_loss_claims */ SELECT r.id,r.agreement_id,r.member_id,r.amount::text,m.party_kind,m.customer_id,m.supplier_id,m.staff_id,h.period::text,coalesce((SELECT sum(rr.amount) FROM vehicle_partnership_rights rr JOIN vehicle_partnership_closing_lines rl ON rl.id=rr.closing_line_id JOIN vehicle_partnership_closings rh ON rh.id=rl.closing_id WHERE rr.partnership_id=r.partnership_id AND rr.category='loss_recovery' AND rr.status='approved' AND rr.agreement_id=r.agreement_id AND rr.member_id=r.member_id AND rr.source_snapshot->>'lossRightId'=r.id::text AND rh.status IN ('approved','distributed') AND rl.revision=rh.revision AND rh.period<${range.from}::date),0)::text AS recovered FROM vehicle_partnership_rights r JOIN vehicle_partnership_members m ON m.id=r.member_id JOIN vehicle_partnership_closing_lines l ON l.id=r.closing_line_id JOIN vehicle_partnership_closings h ON h.id=l.closing_id WHERE r.partnership_id=${root.id} AND r.category='loss' AND r.status='approved' AND h.status IN ('approved','distributed') AND l.revision=h.revision AND h.period<${range.from}::date ORDER BY h.period,r.id LIMIT 5001`));
   if(lossRows.length>5000)throw new PartnershipRepositoryError("سجل الخسارة المرحلة يتجاوز حد المراجعة",409,"LIMIT_EXCEEDED");
   const seen=new Set<number>();let outstanding=0n;
   for(const row of lossRows){
    const id=partnershipId(Number(row.id)),amount=parseMoney(String(row.amount)),recovered=parseMoney(String(row.recovered)),kind=String(row.party_kind);
    if(seen.has(id)||recovered>amount||!["customer","supplier","staff"].includes(kind))conflict("سجل رصيد الخسارة المرحلة غير مطابق");seen.add(id);
    const remaining=amount-recovered;outstanding+=remaining;
    if(remaining>0n)claims.push({key:`right:${id}`,category:"loss",period:String(row.period),agreementId:partnershipId(Number(row.agreement_id)),memberId:partnershipId(Number(row.member_id)),partyKey:`${kind}:${partnershipId(Number(row[`${kind}_id`]))}`,remaining:formatMoney(remaining)});
   }
   const previous=frozen(prior,vehicleId,root.id);
   openingVerified=outstanding===parseMoney(previous.calculation.summary.carriedLossOut!);
   if(!openingVerified)blockers.push("رصيد حقوق الخسارة لا يطابق المرحل من آخر إغلاق معتمد");
  }
 }
 const calculation=calculatePartnershipClosing({...range,terms:evidence.terms,sources:evidence.sources,lossClaims:claims,openingBalanceVerified:openingVerified,policy,blockers});
 const snapshot:ClosingSnapshot={formatVersion:1,vehicleId,partnershipId:root.id,setupVersion:root.version,...range,policy,agreements:evidence.agreements,sourceSnapshots:evidence.snapshots,lossClaims:claims,previousClosing:approved.at(-1)?{id:Number(approved.at(-1)!.id),revision:Number(approved.at(-1)!.revision),sourceDigest:String(approved.at(-1)!.source_digest)}:null,calculation};
 const approvalBlockers=[...calculation.summary.blockers];
 if(policy.accountingMethod!=="activity_clearing")approvalBlockers.push("يجب إقرار سياسة الإغلاق المحاسبي وتصفية استحقاق النقل الداخلي قبل الاعتماد");
 const dateParts=new Map(new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Baghdad",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date()).map(part=>[part.type,part.value]));
 const today=`${dateParts.get("year")}-${dateParts.get("month")}-${dateParts.get("day")}`,periodStillOpen=range.to>=today;
 if(periodStillOpen)approvalBlockers.push("الشهر لم ينتهِ بعد؛ النتيجة تقديرية حتى نهاية الفترة");
 return {stored:false,provisional:true,periodStillOpen,vehicleId,partnershipId:root.id,...range,closingId:current?Number(current.id):null,status:current?String(current.status):"unsaved",version:current?Number(current.version):0,sourceDigest:digest(snapshot),snapshot,calculation,approvalBlockers:[...new Set(approvalBlockers)]};
}
