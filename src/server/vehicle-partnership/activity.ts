import {createHash} from "node:crypto";
import {sql} from "drizzle-orm";
import {z} from "zod/v4";
import {calculateTrip} from "../../lib/vehicle-partnership/domain";
import {formatMoney,parseMoney} from "../../lib/vehicle-partnership/money";
import {PartnershipValidationError,type CostFact,type IncomeFact} from "../../lib/vehicle-partnership/types";
import {authorizePartnership,partnershipId,readOriginalVehicle,readVehiclePartnership,type PartnershipActor} from "./agreements";
import {partnershipRows,PartnershipRepositoryError,type PartnershipExecutor} from "./repository";
import {partnershipCostDigest} from "./costing";
import {driverAccrualDigest} from "./driver";

export type TransportSource="kosha"|"service"|"delivery";
export type OriginalTransport={source:TransportSource;id:number;vehicleId:number;reference:string;date:string|null;driverId:number|null;customerName:string;mode:string;status:string;customerCharge:string|null;contractTotal:string|null;inTotal:boolean|null;billingSource:string|null;billingId:number|null;notes:string|null};
export type ActivityAgreement={id:number;effectiveFrom:string;status:string;members:readonly {id:number;profitBasisPoints:number;expenseBasisPoints:number}[];policy:Record<string,unknown>};
export type ActivityAnnotation={id:number;source:string;sourceId:number;operationKey:string;agreementId:number;amount:string;incomeBasis:string;recognitionDate:string;status:string;originalDigest:string|null;financialStatus:string|null;financialSourceType:string|null;financialSourceId:string|null;financialEvent:string|null;reversed:string;driverNoCharge:boolean};
export type OriginalVehicleCost={id:number;vehicleId:number;source:string|null;sourceId:number|null;activityId:number|null;date:string;expenseType:string;amount:string;driverId:number|null;status:string;financialTransactionId:number|null;financialStatus:string|null;financialDirection:string|null;financialAmount:string|null;financialSourceType:string|null;financialSourceId:string|null;reversed:string;cashInvalidReversal?:boolean;fundingKind:string|null;fundingStatus:string|null;costClass:string|null;employeeEntryId:number|null;fundingId?:number|null;fundingFinancialStatus?:string|null;fundingFinancialSourceType?:string|null;fundingFinancialSourceId?:string|null;employeeStatus?:string|null;employeeAmount?:string|null;employeeId?:number|null;fundingFinancialAmount?:string|null;fundingFinancialDirection?:string|null;fundingFinancialType?:string|null;fundingFinancialEvent?:string|null;fundingReversed?:string|null;fundingInvalidReversal?:boolean;fundingDigestMatches?:boolean;employeeSourceType?:string|null;employeeSourceId?:string|null;employeeEntryType?:string|null;employeeDirection?:string|null};
export type VehicleActivityInput={vehicleId:number;from:string;to:string;agreements:readonly ActivityAgreement[];trips:readonly OriginalTransport[];annotations:readonly ActivityAnnotation[];costs:readonly OriginalVehicleCost[];collections:readonly {source:string;id:number;amount:string}[]};
const sourceKey=(source:string,id:number)=>`${source}:${id}:transportation`;
function invalid(message:string):never{throw new PartnershipValidationError(message);}
const money=(value:unknown)=>formatMoney(parseMoney(value as string));
function validDate(value:unknown):value is string{return typeof value==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(new Date(`${value}T00:00:00Z`).valueOf())&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;}
export function activityRange(input:unknown){
 const parsed=z.object({vehicleId:z.number().int().positive(),from:z.string().refine(validDate),to:z.string().refine(validDate)}).strict().safeParse(input);
 if(!parsed.success)invalid("الفترة أو معرّف المركبة غير صالح");
 const value=parsed.data!;
 if(value.from>value.to||(Date.parse(value.to)-Date.parse(value.from))/86400000>366)invalid("اختر فترة لا تزيد عن سنة، وتاريخ نهاية بعد البداية");
 return value;
}
/** Only original money, assignment and work identity define approval freshness.
 * Names/formatting are presentation; a renamed customer does not rewrite money. */
export function originalTransportDigest(trip:OriginalTransport):string{
 return createHash("sha256").update(JSON.stringify({source:trip.source,id:trip.id,vehicleId:trip.vehicleId,date:trip.date,driverId:trip.driverId,mode:trip.mode,status:trip.status,customerCharge:trip.customerCharge==null?null:money(trip.customerCharge),contractTotal:trip.contractTotal==null?null:money(trip.contractTotal),inTotal:trip.inTotal,billingSource:trip.billingSource,billingId:trip.billingId})).digest("hex");
}
export function costIdentity(cost:Pick<OriginalVehicleCost,"id"|"financialTransactionId">):string{
 return cost.financialTransactionId!=null?`financial:${partnershipId(cost.financialTransactionId)}`:`vehicle_expense:${partnershipId(cost.id)}`;
}
function approvedCost(cost:OriginalVehicleCost):{fact:CostFact;blockers:string[]}{
 const blockers:string[]=[];let amount=parseMoney(cost.amount),status:CostFact["status"]="pending";
 const reversedFunding=cost.fundingStatus==="reversed";
 const partnerFunding=["approved","reversed"].includes(String(cost.fundingStatus))&&["partner_advance","partner_capital"].includes(String(cost.fundingKind));
 const driverFunding=["approved","reversed"].includes(String(cost.fundingStatus))&&cost.fundingKind==="other"&&cost.employeeEntryId!=null;
 const rejected=["rejected","cancelled"].includes(String(cost.financialStatus))||cost.financialTransactionId==null&&["rejected","cancelled"].includes(cost.status);
 if(partnerFunding||driverFunding){
  const expectedType=driverFunding?"vp_driver_accrual":cost.costClass==="capital"?(cost.fundingKind==="partner_advance"?"vp_partner_capital_advance":"vp_partner_capital_capital"):(cost.fundingKind==="partner_advance"?"vp_partner_operating_advance":"vp_partner_operating_capital");
  if(driverFunding&&(cost.expenseType!=="driver_wage"||cost.costClass!=="operating"||cost.employeeSourceType!=="vehicle_expense"||cost.employeeSourceId!==String(cost.id)||cost.employeeEntryType!=="trip_driver_fee"||cost.employeeDirection!=="payable"))blockers.push("استحقاق السائق لا يطابق مصروف الرحلة الأصلي");
  else if(cost.financialTransactionId!=null&&!["rejected","cancelled"].includes(String(cost.financialStatus)))blockers.push("المصروف مسجل للصندوق ولتمويل آخر؛ راجع مصدره قبل اعتماد الربح");
  else if(cost.fundingId==null||cost.fundingFinancialStatus!=="executed"||cost.fundingFinancialSourceType!=="vehicle_partnership_cost"||cost.fundingFinancialSourceId!==String(cost.fundingId)||cost.fundingFinancialDirection!=="expense"||cost.fundingFinancialType!==expectedType||cost.fundingFinancialEvent!==(driverFunding?"driver_accrual":"partner_paid_cost")||cost.fundingFinancialAmount==null||parseMoney(cost.fundingFinancialAmount)!==amount||cost.fundingReversed==null||parseMoney(cost.fundingReversed)!==(reversedFunding?amount:0n)||cost.fundingDigestMatches!==true||reversedFunding&&cost.fundingInvalidReversal!==false)blockers.push("تمويل الشريك لا يطابق مبلغ المصروف وإثبات مصدره وموافقته المالية");
  else if(reversedFunding){status="rejected";amount=0n;}
  else status="approved";
 }
 else if(cost.fundingStatus==="pending"){
  if(cost.financialStatus==="executed")blockers.push("المصروف مدفوع من الشركة وله مراجعة تمويل أخرى معلقة؛ يلزم المصالحة");
  status="pending";
 }
 else if(rejected)status="rejected";
 else if(cost.financialTransactionId!=null){
  if(cost.financialStatus==null)invalid("مرجع مصروف المركبة المالي غير موجود");
  if(cost.financialStatus==="executed"){
   if(["rejected","cancelled"].includes(cost.status))blockers.push("حالة مصروف المركبة لا تطابق حركة الصندوق المنفذة؛ يلزم المصالحة");
   if(cost.financialDirection!=="expense"||cost.financialSourceType!=="vehicle_expense"||cost.financialSourceId!==String(cost.id)||cost.financialAmount==null||parseMoney(cost.financialAmount)!==amount)invalid("مبلغ أو هوية مصروف المركبة لا يطابق المرجع المالي الأصلي");
   const reversed=parseMoney(cost.reversed);if(reversed>amount)invalid("عكس مصروف المركبة يتجاوز المصروف الأصلي");
   if(cost.expenseType==="driver_wage"&&reversed>0n&&cost.cashInvalidReversal!==false)blockers.push("عكس أجرة السائق لا يطابق مصدر المصروف وحركته المالية المعتمدة");
   amount-=reversed;status=cost.expenseType==="driver_wage"&&reversed>0n&&amount===0n?"rejected":"approved";
   if(cost.fundingStatus==="approved"&&["partner_advance","partner_capital"].includes(String(cost.fundingKind)))blockers.push("المصروف مسجل مدفوعاً من الصندوق ومن الشريك؛ راجع المصدر قبل اعتماد الربح");
  }else if(!["pending","draft","rejected","cancelled"].includes(cost.financialStatus))invalid("حالة مصروف المركبة المالية غير معروفة");
 }
 if(cost.employeeEntryId!=null){
  const validEmployeeStatus=status==="rejected"?["rejected","cancelled"].includes(String(cost.employeeStatus)):["approved","partially_settled","settled"].includes(String(cost.employeeStatus));
  if(!validEmployeeStatus||cost.employeeAmount==null||parseMoney(cost.employeeAmount)!==parseMoney(cost.amount))blockers.push("استحقاق الموظف المرتبط بالمصروف غير معتمد أو غير مطابق");
  if(cost.expenseType==="driver_wage"&&cost.employeeId!==cost.driverId)blockers.push("استحقاق أجرة السائق يعود لموظف مختلف");
 }
 const knownOperating=["fuel","driver_wage","maintenance","repair","oil_change","tires","insurance","registration","washing","fees_parking","cleaning","parking","toll"];
 const classification=["approved","reversed"].includes(String(cost.fundingStatus))?cost.costClass:null;
 if(classification!=null&&!["capital","operating"].includes(classification))invalid("تصنيف تكلفة المركبة غير صالح");
 if(classification==null&&!knownOperating.includes(cost.expenseType))blockers.push("مصروف غير مصنف؛ حدد إن كان تشغيلياً أم استثماراً رأسمالياً");
 if(cost.expenseType==="driver_wage"&&classification==="capital")blockers.push("أجرة السائق لا تصنف استثماراً رأسمالياً");
 const category:CostFact["category"]=classification==="capital"?"capital":cost.expenseType==="driver_wage"?"driver":cost.expenseType==="fuel"?"fuel":"operating";
 return {fact:{sourceKey:costIdentity(cost),amount:formatMoney(amount),status,category},blockers};
}
export function deriveVehicleActivity(input:VehicleActivityInput){
 activityRange({vehicleId:input.vehicleId,from:input.from,to:input.to});
 const blockers:string[]=[],externalIncome:IncomeFact[]=[],internalIncome:IncomeFact[]=[];
 const costsByKey=new Map<string,{original:OriginalVehicleCost;fact:CostFact;blockers:string[]}>();
 for(const original of input.costs){
  if(original.vehicleId!==input.vehicleId)invalid("مصروف يعود لمركبة مختلفة");
  const normalized=approvedCost(original),key=normalized.fact.sourceKey,previous=costsByKey.get(key);
  if(previous){if(JSON.stringify(previous.fact)!==JSON.stringify(normalized.fact)||previous.original.id!==original.id)invalid("مصدر تكلفة مكرر بقيم متعارضة");continue;}
  costsByKey.set(key,{original,...normalized});
 }
 const seenTrips=new Set<string>();const trips=input.trips.map(original=>{
  if(original.vehicleId!==input.vehicleId||original.mode!=="ajn")invalid("عملية النقل لا تخص المركبة المطلوبة أو لا تستخدم نقل المحل");
  const key=sourceKey(original.source,original.id);if(seenTrips.has(key))invalid("هوية عملية النقل الأصلية مكررة");seenTrips.add(key);
  const reasons:string[]=[];
  if(!validDate(original.date))reasons.push("تاريخ النقل الأصلي غير مكتمل");
  if(["cancelled","canceled","deleted","archived"].includes(original.status))reasons.push("عملية النقل ملغاة أو مؤرشفة؛ راجع استحقاقها المعتمد");
  const agreement=input.agreements.filter(a=>a.status==="approved"&&original.date!=null&&a.effectiveFrom<=original.date).sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  if(!agreement)reasons.push("لا يوجد اتفاق معتمد نافذ بتاريخ الرحلة");
  const annotations=input.annotations.filter(a=>a.source===original.source&&a.sourceId===original.id&&a.operationKey==="transportation"&&!["rejected","cancelled","reversed"].includes(a.status));
  if(annotations.length>1)invalid("أكثر من أساس إيراد أو استحقاق نشط لنفس عملية النقل");
  const annotation=annotations[0];let income:IncomeFact|null=null;
  if(annotation){
   const internal=annotation.incomeBasis==="internal";
   if(!internal&&annotation.incomeBasis!=="external")invalid("أساس إيراد النقل غير صالح");
   let approved=annotation.status==="approved"&&annotation.financialStatus==="executed";
   if(approved&&(annotation.financialSourceType!=="vehicle_partnership_activity"||annotation.financialSourceId!==String(annotation.id)||annotation.financialEvent!==(internal?"internal_entitlement":"external_attribution")))reasons.push("موافقة النقل لا تطابق المصدر المالي المخصص لها");
   if(annotation.originalDigest!==originalTransportDigest(original))reasons.push("بيانات النقل تغيرت بعد الموافقة؛ يلزم إعادة المراجعة");
   if(annotation.agreementId!==agreement?.id)reasons.push("اتفاق الرحلة لا يطابق الاتفاق النافذ بتاريخها");
   const amount=parseMoney(annotation.amount),reversed=parseMoney(annotation.reversed);if(reversed>amount)invalid("عكس استحقاق النقل يتجاوز المبلغ الأصلي");
   if(!internal&&(original.customerCharge==null||amount!==parseMoney(original.customerCharge)))reasons.push("الإيراد الخارجي لا يطابق أجرة العميل في المصدر الأصلي");
   if(!internal&&(original.inTotal!==true||original.billingSource==null||original.billingId==null))reasons.push("أجرة العميل غير مرتبطة بمستند أصلي يشملها؛ لا تعتمد أجرة محفوظة للعلم كإيراد");
   if(!validDate(annotation.recognitionDate))reasons.push("تاريخ الاعتراف باستحقاق النقل غير موثق");
   approved=approved&&reasons.length===0;
   income={sourceKey:key,kind:internal?"internal":"external",amount:formatMoney(amount-reversed),approved,recognized:approved};
   if(annotation.recognitionDate>=input.from&&annotation.recognitionDate<=input.to)(internal?internalIncome:externalIncome).push(income);
  }
  const attributed=[...costsByKey.values()].filter(c=>c.original.source===original.source&&c.original.sourceId===original.id||annotation!=null&&c.original.activityId===annotation.id);
  // Rejected and fully reversed wages remain visible history. They cannot
  // establish a zero fee or conflict with a later approved no-charge decision.
  const driver=attributed.filter(c=>c.fact.category==="driver"&&c.fact.status!=="rejected");
  for(const cost of attributed){reasons.push(...cost.blockers);if(cost.fact.status!=="rejected"&&cost.original.expenseType==="driver_wage"&&cost.original.driverId!==original.driverId)reasons.push("أجرة الرحلة مرتبطة بسائق مختلف عن السائق المكلف");}
  // Multiple wages for the same trip must be reviewed; never pick one or add a
  // second payroll settlement by amount/name matching.
  if(driver.length>1)reasons.push("توجد أكثر من أجرة سائق للرحلة؛ راجع سجلات المصروف الأصلية");
  const noCharge=annotation?.status==="approved"&&annotation.financialStatus==="executed"&&annotation.originalDigest===originalTransportDigest(original)&&annotation.driverNoCharge===true;
  if(noCharge&&driver.length)reasons.push("تم اعتماد عدم وجود أجرة مع وجود مصروف سائق مرتبط");
  const driverFact=driver[0]?.fact??(noCharge?{sourceKey:`${key}:driver-no-charge`,category:"driver" as const,status:"approved" as const,amount:"0.00"}:null);
  const shares=agreement?.members.map(m=>({key:`member:${m.id}`,basisPoints:m.profitBasisPoints}))??[];
  const profitability=shares.length?calculateTrip({income,driver:driverFact,costs:attributed.filter(c=>c.fact.category!=="driver").map(c=>c.fact),profitShares:shares,blockers:reasons}):{complete:false,blockers:reasons,income:null,cost:null,contribution:null,provisionalShares:null};
  blockers.push(...profitability.blockers.map(reason=>`${original.reference}: ${reason}`));
  const collection=input.collections.find(c=>c.source===original.source&&c.id===original.id);
  const bookingCollected=collection?money(collection.amount):null;
  let attribution:string|null=null;
  if(bookingCollected!=null&&original.customerCharge!=null&&original.contractTotal!=null&&original.inTotal===true){const total=parseMoney(original.contractTotal),paid=parseMoney(bookingCollected);if(total>0n){const limited=paid>total?total:paid;attribution=formatMoney((parseMoney(original.customerCharge)*limited+total/2n)/total);}}
  return {...original,key,originalDigest:originalTransportDigest(original),agreementId:agreement?.id??null,activityId:annotation?.id??null,incomeBasis:annotation?.incomeBasis??null,bookingCollected,transportCashAttribution:attribution,profitability};
 });
 const monthCosts=[...costsByKey.values()].filter(c=>c.original.date>=input.from&&c.original.date<=input.to);
 for(const cost of monthCosts){blockers.push(...cost.blockers);if(cost.fact.status==="pending")blockers.push("يوجد مصروف مركبة بانتظار الاعتماد");}
 let investment=0n;for(const cost of monthCosts)if(cost.fact.category==="capital"&&cost.fact.status==="approved")investment+=parseMoney(cost.fact.amount!);
 const costs=monthCosts.map(c=>c.fact);
 const digest=createHash("sha256").update(JSON.stringify({vehicleId:input.vehicleId,from:input.from,to:input.to,trips:[...trips].sort((a,b)=>a.key.localeCompare(b.key)),costs:[...costs].sort((a,b)=>a.sourceKey.localeCompare(b.sourceKey))})).digest("hex");
 return {vehicleId:input.vehicleId,from:input.from,to:input.to,trips,externalIncome,internalIncome,costs,investment:formatMoney(investment),blockers:[...new Set(blockers)],digest,collectionNotice:"المحصل يخص مستند العميل؛ نسبة أجرة النقل مؤشر نقدي ولا تمثل إيراداً معترفاً به أو استحقاقاً للشراكة"};
}

const rowSource=(row:Record<string,unknown>):TransportSource=>{if(!["kosha","service","delivery"].includes(String(row.source)))invalid("نوع مصدر النقل غير صالح");return row.source as TransportSource;};
const optionalId=(v:unknown)=>v==null?null:partnershipId(Number(v));
const optionalMoney=(v:unknown)=>v==null?null:money(String(v));
function transportRow(row:Record<string,unknown>):OriginalTransport{
 return {source:rowSource(row),id:partnershipId(Number(row.id)),vehicleId:partnershipId(Number(row.vehicle_id)),reference:String(row.reference),date:row.event_date==null?null:String(row.event_date).slice(0,10),driverId:optionalId(row.driver_id),customerName:String(row.customer_name??""),mode:String(row.mode),status:String(row.status),customerCharge:optionalMoney(row.customer_charge),contractTotal:optionalMoney(row.contract_total),inTotal:row.in_total==null?null:row.in_total===true,billingSource:row.billing_source==null?null:String(row.billing_source),billingId:optionalId(row.billing_id),notes:row.notes==null?null:String(row.notes)};
}
async function readTrips(tx:PartnershipExecutor,vehicleId:number,from:string,to:string,ref?:{source:TransportSource;id:number}){
 const result=await tx.execute(sql`/* vp_original_trips */ WITH original AS (
 SELECT 'kosha' AS source,k.id,k.transportation_vehicle_id AS vehicle_id,k.transportation_driver_id AS driver_id,k.tracking_code AS reference,k.event_date,k.customer_name,k.transportation_mode AS mode,k.status,k.transportation_fee::text AS customer_charge,k.total_amount::text AS contract_total,true AS in_total,'kosha_booking' AS billing_source,k.id AS billing_id,k.transportation_notes AS notes
 FROM kosha_bookings k WHERE (k.transportation_vehicle_id=${vehicleId} AND k.transportation_mode='ajn' AND k.archived_at IS NULL AND k.status NOT IN ('cancelled','canceled')) OR EXISTS(SELECT 1 FROM vehicle_partnership_activity a JOIN vehicle_partnerships p ON p.id=a.partnership_id WHERE p.vehicle_id=${vehicleId} AND a.kosha_booking_id=k.id AND a.status='approved' AND a.recognition_date BETWEEN ${from}::date AND ${to}::date)
 UNION ALL
 SELECT 'service',s.id,CASE WHEN (s.custom_fields->'bookingOperations'->'transportation'->>'vehicleId') ~ '^[1-9][0-9]*$' THEN (s.custom_fields->'bookingOperations'->'transportation'->>'vehicleId')::int END,CASE WHEN (s.custom_fields->'bookingOperations'->'transportation'->>'driverId') ~ '^[1-9][0-9]*$' THEN (s.custom_fields->'bookingOperations'->'transportation'->>'driverId')::int END,s.tracking_code,s.event_date,s.customer_name,s.custom_fields->'bookingOperations'->'transportation'->>'mode',s.status,s.custom_fields->'bookingOperations'->'transportation'->>'fee',s.total_amount::text,CASE s.custom_fields->'bookingOperations'->'transportation'->>'inTotal' WHEN 'true' THEN true WHEN 'false' THEN false ELSE NULL END,'service_order',s.id,s.custom_fields->'bookingOperations'->'transportation'->>'notes'
 FROM service_orders s WHERE (s.custom_fields->'bookingOperations'->'transportation'->>'vehicleId'=${String(vehicleId)} AND s.custom_fields->'bookingOperations'->'transportation'->>'mode'='ajn' AND s.archived_at IS NULL AND s.status NOT IN ('cancelled','canceled')) OR EXISTS(SELECT 1 FROM vehicle_partnership_activity a JOIN vehicle_partnerships p ON p.id=a.partnership_id WHERE p.vehicle_id=${vehicleId} AND a.service_order_id=s.id AND a.status='approved' AND a.recognition_date BETWEEN ${from}::date AND ${to}::date)
 UNION ALL
 SELECT 'delivery',d.id,da.vehicle_id,NULL::int,d.delivery_no,dd.expected_ship_date::text,dd.receiver_name,'ajn',d.status,dd.delivery_fee::text,coalesce(si.total,o.total)::text,true,CASE WHEN d.sales_invoice_id IS NOT NULL THEN 'sales_invoice' WHEN d.order_id IS NOT NULL THEN 'order' END,coalesce(d.sales_invoice_id,d.order_id),dd.notes
 FROM delivery_orders d JOIN dispatch_assignments da ON da.entity_type='delivery_order' AND da.entity_id=d.id JOIN delivery_details dd ON dd.id=d.delivery_details_id LEFT JOIN sales_invoices si ON si.id=d.sales_invoice_id LEFT JOIN orders o ON o.id=d.order_id WHERE da.vehicle_id=${vehicleId} AND d.status NOT IN ('cancelled','returned')
 ) SELECT * FROM original WHERE ${ref?sql`source=${ref.source} AND id=${ref.id}`:sql`(left(event_date,10) BETWEEN ${from} AND ${to} OR event_date IS NULL OR event_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' OR EXISTS(SELECT 1 FROM vehicle_partnership_activity a JOIN vehicle_partnerships p ON p.id=a.partnership_id WHERE p.vehicle_id=${vehicleId} AND a.status='approved' AND a.recognition_date BETWEEN ${from}::date AND ${to}::date AND ((original.source='kosha' AND a.kosha_booking_id=original.id) OR (original.source='service' AND a.service_order_id=original.id) OR (original.source='delivery' AND a.delivery_order_id=original.id))))`} ORDER BY source,id LIMIT 501`);
 const rows=partnershipRows(result);if(rows.length>500)invalid("تجاوزت الرحلات حد القراءة؛ لا يمكن إظهار ربح مقتطع");return rows.map(transportRow);
}
export async function resolveActivitySources(tx:PartnershipExecutor,actor:PartnershipActor,reference:{vehicleId:number;source:TransportSource;id:number}){
 authorizePartnership(actor);partnershipId(reference.vehicleId);partnershipId(reference.id);if(!["kosha","service","delivery"].includes(reference.source))invalid("مصدر النقل غير صالح");
 await readOriginalVehicle(tx,actor,reference.vehicleId);
 const trips=await readTrips(tx,reference.vehicleId,"0001-01-01","9999-12-31",reference);
 if(trips.length!==1)throw new PartnershipRepositoryError("عملية النقل الأصلية غير موجودة أو لا تخص المركبة",404,"NOT_FOUND");
 if(trips[0].vehicleId!==reference.vehicleId||trips[0].mode!=="ajn")invalid("عملية النقل لا تخص المركبة");
 return {trip:trips[0],digest:originalTransportDigest(trips[0])};
}
export async function readVehicleActivity(tx:PartnershipExecutor,actor:PartnershipActor,input:unknown){
 authorizePartnership(actor);const range=activityRange(input),{vehicleId,from,to}=range;
 const setup=await readVehiclePartnership(tx,actor,vehicleId);
 if(!setup.partnership)throw new PartnershipRepositoryError("لا يوجد إعداد شراكة لهذه المركبة",404,"NOT_FOUND");
 const rootId=setup.partnership.id,trips=await readTrips(tx,vehicleId,from,to);
 const ids=(source:TransportSource,asText=false)=>{const values=trips.filter(t=>t.source===source).map(t=>asText?sql`${String(t.id)}`:sql`${t.id}`);return values.length?sql.join(values,sql`, `):sql`NULL`;};
 const annotations=partnershipRows(await tx.execute(sql`/* vp_activity_annotations */ SELECT a.*,f.approval_status AS financial_status,f.source_type AS financial_source_type,f.source_id AS financial_source_id,f.source_event AS financial_event,coalesce((SELECT sum(r.amount) FROM financial_transactions r WHERE r.reversed_transaction_id=f.id AND r.approval_status='executed'),0)::text AS reversed FROM vehicle_partnership_activity a LEFT JOIN financial_transactions f ON f.id=a.financial_transaction_id WHERE a.partnership_id=${rootId} AND (a.recognition_date BETWEEN ${from}::date AND ${to}::date ${trips.length?sql`OR (a.kosha_booking_id IN (${ids("kosha")}) OR a.service_order_id IN (${ids("service")}) OR a.delivery_order_id IN (${ids("delivery")}))`:sql``}) ORDER BY a.id LIMIT 1001`));
 if(annotations.length>1000)invalid("تجاوزت مراجع النقل حد القراءة");
 const costs=partnershipRows(await tx.execute(sql`/* vp_original_costs */ SELECT e.*,to_jsonb(e)->>'service_order_id' AS service_order_id,e.expense_date::date::text AS cost_date,f.approval_status AS financial_status,f.direction AS financial_direction,f.amount::text AS financial_amount,f.source_type AS financial_source_type,f.source_id AS financial_source_id,coalesce((SELECT sum(r.amount) FROM financial_transactions r WHERE r.reversed_transaction_id=f.id AND r.approval_status='executed' AND r.direction='revenue'),0)::text AS reversed,cf.id AS funding_id,cf.activity_id,cf.funding_kind,cf.status AS funding_status,cf.cost_class,cf.employee_finance_entry_id,ff.approval_status AS funding_financial_status,ff.source_type AS funding_financial_source_type,ff.source_id AS funding_financial_source_id,ef.status AS employee_status,ef.amount::text AS employee_amount,ef.employee_id,ef.source_type AS employee_source_type,ef.source_id AS employee_source_id,ef.entry_type AS employee_entry_type,ef.direction AS employee_direction,to_jsonb(cf) AS funding_proof,ff.amount::text AS funding_financial_amount,ff.direction AS funding_financial_direction,ff.transaction_type AS funding_financial_type,ff.source_event AS funding_financial_event,coalesce((SELECT sum(r.amount) FROM financial_transactions r WHERE r.reversed_transaction_id=ff.id AND r.approval_status='executed'),0)::text AS funding_reversed
 ,EXISTS(SELECT 1 FROM financial_transactions r WHERE r.reversed_transaction_id=f.id AND r.approval_status='executed' AND (r.direction IS DISTINCT FROM 'revenue' OR r.amount<=0 OR r.source_type IS DISTINCT FROM f.source_type OR r.source_id IS DISTINCT FROM f.source_id OR coalesce(r.source_event,'') NOT IN ('reversal','vehicle_expense_reversal') OR (r.transaction_type IS DISTINCT FROM 'manual_reversal' AND r.transaction_type IS DISTINCT FROM f.transaction_type||'_reversal'))) AS cash_invalid_reversal
 ,EXISTS(SELECT 1 FROM financial_transactions r WHERE r.reversed_transaction_id=ff.id AND r.approval_status='executed' AND (r.direction IS DISTINCT FROM 'revenue' OR r.amount<=0 OR r.source_type IS DISTINCT FROM ff.source_type OR r.source_id IS DISTINCT FROM ff.source_id OR r.source_event IS DISTINCT FROM 'reversal' OR r.transaction_type IS DISTINCT FROM ff.transaction_type||'_reversal')) AS funding_invalid_reversal
 FROM vehicle_expenses e LEFT JOIN financial_transactions f ON f.id=e.financial_transaction_id LEFT JOIN LATERAL (SELECT c.* FROM vehicle_partnership_cost_funding c WHERE c.vehicle_expense_id=e.id AND c.partnership_id=${rootId} ORDER BY (c.status IN ('pending','approved')) DESC,c.id DESC LIMIT 1) cf ON true LEFT JOIN financial_transactions ff ON ff.id=cf.financial_transaction_id LEFT JOIN employee_finance_entries ef ON ef.id=cf.employee_finance_entry_id
 WHERE e.vehicle_id=${vehicleId} AND (e.expense_date::date BETWEEN ${from}::date AND ${to}::date ${trips.length?sql`OR e.booking_id IN (${ids("kosha")}) OR (to_jsonb(e)->>'service_order_id') IN (${ids("service",true)})`:sql``}) ORDER BY e.id LIMIT 2001`));
 if(costs.length>2000)invalid("تجاوزت مصاريف المركبة حد القراءة؛ لا يمكن اعتماد إجمالي مقتطع");
 const collections:VehicleActivityInput["collections"][number][]=[];
 const billed=trips.filter(t=>t.billingSource&&t.billingId!=null&&t.contractTotal!=null);
 if(billed.length){
  const rows=partnershipRows(await tx.execute(sql`/* vp_canonical_collections */ WITH documents(source,original_id,source_type,source_id,total_amount) AS (VALUES ${sql.join(billed.map(t=>sql`(${t.source}::text,${t.id}::int,${t.billingSource}::text,${t.billingId}::int,${t.contractTotal}::numeric)`),sql`, `)})
  SELECT d.source,d.original_id AS id,least(d.total_amount,greatest(coalesce((SELECT sum(CASE WHEN f.direction='revenue' THEN f.amount ELSE -f.amount END) FROM financial_transactions f WHERE f.source_type=d.source_type AND f.source_id=d.source_id::text AND f.approval_status='executed'),0)+coalesce((SELECT sum(greatest(a.amount-coalesce(a.reversed_amount,0),0)) FROM receipt_voucher_allocations a JOIN receipt_vouchers v ON v.id=a.receipt_voucher_id WHERE a.source_type=d.source_type AND a.source_id=d.source_id AND a.posted_at IS NOT NULL AND coalesce(v.approval_status,'executed')='executed'),0)+CASE WHEN d.source_type='sales_invoice' THEN coalesce((SELECT sum(CASE WHEN f.direction='revenue' THEN f.amount ELSE -f.amount END) FROM financial_transactions f WHERE f.approval_status='executed' AND ((f.source_type='installment_payment' AND EXISTS(SELECT 1 FROM installment_payments p JOIN installment_contracts c ON c.id=p.contract_id WHERE p.id::text=f.source_id AND c.sales_invoice_id=d.source_id)) OR (f.source_type='installment_contract' AND f.source_event IN ('payment','reconciliation','reversal') AND EXISTS(SELECT 1 FROM installment_contracts c WHERE c.id::text=f.source_id AND c.sales_invoice_id=d.source_id)))),0) ELSE 0 END,0))::text AS amount FROM documents d`));
  if(rows.length!==billed.length)throw new Error("Invalid canonical transport collection response");
  for(const row of rows)collections.push({source:String(row.source),id:Number(row.id),amount:money(String(row.amount))});
 }
 const facts:VehicleActivityInput={...range,agreements:setup.partnership.agreements,trips,collections,
  annotations:annotations.map(a=>{const snapshot=a.source_snapshot as Record<string,unknown>|null;return {id:Number(a.id),source:a.kosha_booking_id!=null?"kosha":a.service_order_id!=null?"service":"delivery",sourceId:Number(a.kosha_booking_id??a.service_order_id??a.delivery_order_id),operationKey:String(a.operation_key),agreementId:Number(a.agreement_id),amount:money(String(a.amount)),incomeBasis:String(a.income_basis),recognitionDate:String(a.recognition_date),status:String(a.status),originalDigest:typeof snapshot?.originalDigest==="string"?snapshot.originalDigest:null,financialStatus:a.financial_status==null?null:String(a.financial_status),financialSourceType:a.financial_source_type==null?null:String(a.financial_source_type),financialSourceId:a.financial_source_id==null?null:String(a.financial_source_id),financialEvent:a.financial_event==null?null:String(a.financial_event),reversed:money(String(a.reversed)),driverNoCharge:snapshot?.driverNoCharge===true};}),
  costs:costs.map(e=>({id:Number(e.id),vehicleId:Number(e.vehicle_id),source:e.booking_id!=null?"kosha":e.service_order_id!=null?"service":null,sourceId:optionalId(e.booking_id??e.service_order_id),activityId:optionalId(e.activity_id),date:String(e.cost_date),expenseType:String(e.expense_type),amount:money(String(e.amount)),driverId:optionalId(e.driver_id),status:String(e.status),financialTransactionId:optionalId(e.financial_transaction_id),financialStatus:e.financial_status==null?null:String(e.financial_status),financialDirection:e.financial_direction==null?null:String(e.financial_direction),financialAmount:optionalMoney(e.financial_amount),financialSourceType:e.financial_source_type==null?null:String(e.financial_source_type),financialSourceId:e.financial_source_id==null?null:String(e.financial_source_id),reversed:money(String(e.reversed)),fundingId:optionalId(e.funding_id),fundingKind:e.funding_kind==null?null:String(e.funding_kind),fundingStatus:e.funding_status==null?null:String(e.funding_status),costClass:e.cost_class==null?null:String(e.cost_class),employeeEntryId:optionalId(e.employee_finance_entry_id),employeeStatus:e.employee_status==null?null:String(e.employee_status),employeeAmount:optionalMoney(e.employee_amount),employeeId:optionalId(e.employee_id),fundingFinancialStatus:e.funding_financial_status==null?null:String(e.funding_financial_status),fundingFinancialSourceType:e.funding_financial_source_type==null?null:String(e.funding_financial_source_type),fundingFinancialSourceId:e.funding_financial_source_id==null?null:String(e.funding_financial_source_id)}))};
 facts.costs=facts.costs.map((cost,index)=>({...cost,cashInvalidReversal:typeof costs[index].cash_invalid_reversal==="boolean"?costs[index].cash_invalid_reversal as boolean:undefined,...readFundingProof(costs[index],rootId)}));
 return deriveVehicleActivity(facts);
}

/** jsonb is used only for the reference annotation, which has no money column.
 * Financial amounts stay explicit SQL ::text to preserve full IQD precision. */
function readFundingProof(row:Record<string,unknown>,rootId:number):Partial<OriginalVehicleCost>{
 if(row.funding_id==null)return {};
 const value=row.funding_proof;
 if(!value||typeof value!=="object"||Array.isArray(value))invalid("إثبات تمويل مصروف المركبة غير صالح");
 const proof=value as Record<string,unknown>;
 if(Number(proof.id)!==Number(row.funding_id)||Number(proof.partnership_id)!==rootId)invalid("إثبات تمويل المصروف يعود لسجل أو شراكة مختلفة");
 const digest=proof.funding_kind==="other"&&proof.employee_finance_entry_id!=null?driverAccrualDigest(row,Number(proof.employee_finance_entry_id),String(proof.reason)):proof.payer_member_id==null?null:partnershipCostDigest(row,{partnership_id:proof.partnership_id,payer_member_id:proof.payer_member_id,funding_kind:proof.funding_kind,cost_class:proof.cost_class,reason:proof.reason});
 return {fundingFinancialAmount:optionalMoney(row.funding_financial_amount),fundingFinancialDirection:row.funding_financial_direction==null?null:String(row.funding_financial_direction),fundingFinancialType:row.funding_financial_type==null?null:String(row.funding_financial_type),fundingFinancialEvent:row.funding_financial_event==null?null:String(row.funding_financial_event),fundingReversed:optionalMoney(row.funding_reversed),fundingInvalidReversal:typeof row.funding_invalid_reversal==="boolean"?row.funding_invalid_reversal:undefined,fundingDigestMatches:digest!=null&&digest===proof.source_digest,employeeSourceType:row.employee_source_type==null?null:String(row.employee_source_type),employeeSourceId:row.employee_source_id==null?null:String(row.employee_source_id),employeeEntryType:row.employee_entry_type==null?null:String(row.employee_entry_type),employeeDirection:row.employee_direction==null?null:String(row.employee_direction)};
}
