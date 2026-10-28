import {sql} from "drizzle-orm";
import {allocateWeightedMoney,formatMoney,parseMoney} from "../../lib/vehicle-partnership/money";
import {PartnershipValidationError} from "../../lib/vehicle-partnership/types";
import {lockPartnership,partnershipRows,PartnershipRepositoryError,type PartnershipExecutor} from "./repository";
import {resolvePartnershipFinancialEffect} from "./financial-classification";
import {derivePartnershipConversion,type EntitlementConversion,type ConversionPayment,type ConversionCoverage} from "../../lib/vehicle-partnership/conversion";
import {proveDriverCashCoverageSource} from "./driver-cash-source";
import {proveDriverCoverageMapping} from "./driver-coverage-proof";
import {provePartnershipCashReversalHistory} from "./cash-reversal-proof";

export type PartnershipPaymentSource="vehicle_partnership_right"|"vehicle_partnership_settlement";
export type PartnershipPaymentState={sourceType:PartnershipPaymentSource;sourceId:number;totalAmount:string;approvedPaidAmount:string;remainingAmount:string;reservedAmount:string;availableAmount:string;paymentStatus:"unpaid"|"partial"|"paid";approvalStatus:string;payable:boolean;nonCashSettledAmount?:string;conversionAmount?:string;pendingConversionAmount?:string;conversionCashPaidAmount?:string;conversionCashReservedAmount?:string;availableCoverageAmount?:string};
function conflict(message:string):never{throw new PartnershipRepositoryError(message,409,"CONFLICT");}
function positiveId(value:unknown):number{const id=Number(value);if(!Number.isSafeInteger(id)||id<=0)throw new PartnershipValidationError("معرّف استحقاق الشراكة غير صالح");return id;}
const purposes:Record<string,string>={profit:"distribution",advance:"advance_reimbursement",internal_entitlement:"internal_entitlement_settlement",capital:"capital_transfer"};
type Row=Record<string,unknown>;
/** Canonical payment-state adapter, executed inside the original caller's
 * transaction. No feature-specific paid/remaining column is authoritative. */
export async function reconcilePartnershipPaymentState(tx:PartnershipExecutor,input:{sourceType:PartnershipPaymentSource;sourceId:string|number|null|undefined}):Promise<PartnershipPaymentState>{
 if(typeof input.sourceId==="string"&&!/^[1-9]\d*$/.test(input.sourceId))throw new PartnershipValidationError("معرّف استحقاق الشراكة غير صالح");
 const sourceId=positiveId(input.sourceId);
 const scope=partnershipRows(await tx.execute(sql`/* vp_payment_right_scope */ SELECT p.vehicle_id FROM vehicle_partnership_rights r JOIN vehicle_partnerships p ON p.id=r.partnership_id WHERE r.id=${sourceId}`));
 if(scope.length===0)throw new PartnershipRepositoryError("استحقاق الشريك غير موجود",404,"NOT_FOUND");
 if(scope.length!==1)throw new Error("Ambiguous partnership payment source");
 const root=await lockPartnership(tx,positiveId(scope[0].vehicle_id));
 const rights=partnershipRows(await tx.execute(sql`/* vp_payment_right_lock */ SELECT r.* FROM vehicle_partnership_rights r WHERE r.id=${sourceId} AND r.partnership_id=${root.id} FOR UPDATE`));
 if(rights.length!==1)conflict("تغير مصدر استحقاق الشراكة أثناء المصالحة");
 const right=rights[0],category=String(right.category),status=String(right.status);
 if(positiveId(right.id)!==sourceId||Number(right.partnership_id)!==root.id||!["pending","approved","cancelled","reversed"].includes(status)||!["capital","profit","loss","advance","loss_recovery","internal_entitlement"].includes(category))conflict("بيانات استحقاق الشراكة أو حالته غير صالحة");
 const total=parseMoney(String(right.amount));
 const rows=partnershipRows(await tx.execute(sql`/* vp_payment_allocations */ SELECT a.id AS allocation_id,a.right_id,a.purpose,a.conversion_allocation_id,a.idempotency_key,a.amount::text AS allocated_amount,a.financial_transaction_id,f.amount::text AS financial_amount,f.approval_status AS financial_status,f.direction AS financial_direction,f.source_type AS financial_source_type,f.source_id AS financial_source_id,f.source_event AS financial_event,f.transaction_type,ar.partnership_id AS allocation_partnership_id,ar.category AS allocation_category,h.id AS closing_id,h.partnership_id AS closing_partnership_id,h.financial_transaction_id AS closing_financial_id,h.status AS closing_status,e.vehicle_id AS cost_vehicle_id,e.financial_transaction_id AS cost_financial_transaction_id,
 coalesce((SELECT sum(r.amount) FROM financial_transactions r WHERE r.reversed_transaction_id=f.id AND r.approval_status='executed'),0)::text AS reversed_amount,
 EXISTS(SELECT 1 FROM financial_transactions r WHERE r.reversed_transaction_id=f.id AND r.approval_status='executed' AND (r.direction=f.direction OR r.amount<=0 OR r.source_type IS DISTINCT FROM f.source_type OR r.source_id IS DISTINCT FROM f.source_id OR (CASE WHEN f.source_type='vehicle_expense' THEN coalesce(r.source_event,'') NOT IN ('reversal','vehicle_expense_reversal') ELSE r.source_event IS DISTINCT FROM 'reversal' END) OR r.transaction_type IS DISTINCT FROM CASE WHEN f.source_type='vehicle_expense' THEN 'manual_reversal' ELSE f.transaction_type||'_reversal' END)) AS invalid_reversal
 FROM vehicle_partnership_settlement_allocations a JOIN financial_transactions f ON f.id=a.financial_transaction_id JOIN vehicle_partnership_rights ar ON ar.id=a.right_id LEFT JOIN vehicle_partnership_closings h ON f.source_type='vehicle_partnership_closing' AND f.source_id=h.id::text LEFT JOIN vehicle_expenses e ON f.source_type='vehicle_expense' AND f.source_id=e.id::text
 WHERE a.financial_transaction_id IN (SELECT target.financial_transaction_id FROM vehicle_partnership_settlement_allocations target WHERE target.right_id=${sourceId}) ORDER BY a.financial_transaction_id,a.purpose,a.id LIMIT 5001`));
 if(rows.length>5000)throw new PartnershipValidationError("تجاوزت توزيعات الاستحقاق حد القراءة؛ لا يمكن عرض رصيد مقتطع");
 const seen=new Set<number>(),transactions=new Map<number,Row[]>();
 for(const row of rows){
  const id=positiveId(row.allocation_id),financialId=positiveId(row.financial_transaction_id);
  if(seen.has(id))conflict("توزيع مالي مكرر في سجل الاستحقاق");seen.add(id);
  if(Number(row.allocation_partnership_id)!==root.id)conflict("توزيع مالي يخص شراكة مختلفة");
  if(parseMoney(String(row.allocated_amount))<=0n)conflict("مبلغ توزيع الاستحقاق غير صالح");
  const group=transactions.get(financialId)??[];group.push(row);transactions.set(financialId,group);
 }
 const conversions:EntitlementConversion[]=[],direct:ConversionPayment[]=[],coverage:ConversionCoverage[]=[];
 const conversionIds=new Set<number>();
 // Resolve conversions before cash groups: a reused original vehicle-cost FI
 // may predate the new closing FI after an eligible controlled reopening.
 for(const [financialId,group] of transactions){
  const first=group[0];if(first.financial_source_type!=="vehicle_partnership_closing")continue;
  const amount=parseMoney(String(first.financial_amount)),reversed=parseMoney(String(first.reversed_amount)),financialStatus=String(first.financial_status);
  const effect=resolvePartnershipFinancialEffect({sourceType:String(first.financial_source_type),transactionType:String(first.transaction_type),sourceEvent:String(first.financial_event),direction:String(first.financial_direction)});
  if(!effect||effect.cash!=="none"||effect.reversal||first.invalid_reversal!==false||amount<=0n||reversed!==0n&&reversed!==amount||String(positiveId(first.closing_id))!==String(first.financial_source_id)||Number(first.closing_partnership_id)!==root.id||!["draft","review","pending","approved","distributed"].includes(String(first.closing_status)))conflict("تحويل الاستحقاق لا يطابق مصدر إغلاق شهري موثق");
  if(financialStatus==="executed"&&reversed===0n&&(!["approved","distributed"].includes(String(first.closing_status))||Number(first.closing_financial_id)!==financialId))conflict("الإغلاق لا يطابق تحويله المالي المعتمد");
  if(["draft","pending","approved"].includes(financialStatus)&&(first.closing_status!=="pending"||Number(first.closing_financial_id)!==financialId))conflict("تحويل الإغلاق المعلق لا يطابق طلبه المالي");
  const sum=group.reduce((value,row)=>value+parseMoney(String(row.allocated_amount)),0n);
  if(sum>amount||group.some(row=>row.purpose!=="internal_conversion"||row.conversion_allocation_id!=null||row.allocation_category!=="internal_entitlement"))conflict("تحويل مكرر أو مبلغ يتجاوز مصدر الإغلاق الشهري");
  for(const row of group){
   if(Number(row.right_id)!==sourceId)continue;
   if(category!=="internal_entitlement")conflict("تحويل الإغلاق لا يخص استحقاق نقل داخلي");
   const id=positiveId(row.allocation_id);conversionIds.add(id);
   const conversionStatus=financialStatus==="executed"?(reversed===amount?"reversed":"approved"):["draft","pending","approved"].includes(financialStatus)?"pending":financialStatus==="rejected"?"rejected":financialStatus==="cancelled"?"cancelled":null;
   if(!conversionStatus)conflict("حالة تحويل الإغلاق المالي غير معروفة");
   conversions.push({key:`allocation:${id}`,amount:String(row.allocated_amount),status:conversionStatus});
  }
 }
 let paid=0n,reserved=0n;
 for(const [financialId,group] of transactions){
  const first=group[0],amount=parseMoney(String(first.financial_amount)),reversed=parseMoney(String(first.reversed_amount)),financialStatus=String(first.financial_status);
  if(amount<=0n||reversed>amount||first.invalid_reversal!==false)conflict("قيمة أو اتجاه عكس الحركة المالية غير صالح");
  if(!["draft","pending","approved","executed","rejected","cancelled"].includes(financialStatus))conflict("حالة مالية غير معروفة في كشف الشراكة");
  if(reversed>0n&&financialStatus!=="executed")conflict("عكس مالي مرتبط بحركة غير منفذة");
  for(const row of group)for(const field of ["financial_amount","financial_status","financial_direction","financial_source_type","financial_source_id","financial_event","transaction_type","reversed_amount","invalid_reversal"]){if(row[field]!==first[field])conflict("بيانات الحركة المالية نفسها متعارضة");}
  if(first.financial_source_type==="vehicle_partnership_closing")continue;
  const originalCost=first.financial_source_type==="vehicle_expense";
  if(originalCost){
   if(first.financial_direction!=="expense"||Number(first.cost_vehicle_id)!==root.vehicleId||Number(first.cost_financial_transaction_id)!==financialId||group.some(row=>row.purpose!=="internal_entitlement_settlement"))conflict("حركة المصروف لا تمثل تسوية أصلية لاستحقاق نقل هذه المركبة");
  }else if(first.financial_source_type==="vehicle_partnership_driver"){
   const effect=resolvePartnershipFinancialEffect({sourceType:"vehicle_partnership_driver",transactionType:String(first.transaction_type),sourceEvent:String(first.financial_event),direction:String(first.financial_direction)});
   if(financialStatus!=="executed"||effect?.cash!=="out"||effect.operating!=="none"||effect.reversal||group.some(row=>row.purpose!=="internal_entitlement_settlement"||row.allocation_category!=="internal_entitlement"||row.conversion_allocation_id==null))conflict("تغطية السائق تخص صرفاً منفذاً وتحويلاً داخلياً أصلياً فقط");
   // Driver FI.source_id remains the employee settlement ID. It never becomes
   // an internal right ID or a second primary partner distribution.
   if(reversed===amount){
    // A fully refunded historical wage may later be cancelled/reopened. Prove
    // its immutable cash return, without re-admitting that old wage as payable.
    const history=await provePartnershipCashReversalHistory(tx,financialId),saved=history.proof.allocations;
    if(history.originalId!==financialId||history.sourceType!=="vehicle_partnership_driver"||history.sourceId!==String(first.financial_source_id)||history.transactionType!=="vp_driver_payment"||history.partnershipId!==root.id||history.vehicleId!==root.vehicleId||parseMoney(history.amount)!==amount||!history.proof.driverMappingDigest||saved.length!==group.length||group.some(r=>!saved.some(a=>a.id===Number(r.allocation_id)&&a.rightId===Number(r.right_id)&&a.financialId===financialId&&a.parentId===Number(r.conversion_allocation_id)&&a.purpose===r.purpose&&a.amount===formatMoney(parseMoney(String(r.allocated_amount)))&&a.key===r.idempotency_key)))conflict("توزيعات عكس أجرة السائق لا تطابق سجلها الأصلي");
   }else{
    const source=await proveDriverCashCoverageSource(tx,root,financialId);
    if(String(source.settlementId)!==String(first.financial_source_id)||parseMoney(source.amount)!==amount||parseMoney(source.reversedAmount)!==reversed)conflict("تغطية الصرف لا تطابق تسوية أجرة السائق الأصلية");
    await proveDriverCoverageMapping(tx,root,source,group);
   }
  }else{
   const effect=resolvePartnershipFinancialEffect({sourceType:first.financial_source_type==null?null:String(first.financial_source_type),transactionType:String(first.transaction_type),sourceEvent:String(first.financial_event),direction:String(first.financial_direction)});
   if(first.financial_source_type!=="vehicle_partnership_settlement"||!effect||effect.cash==="none"||effect.reversal)conflict("توزيع الاستحقاق لا يرتبط بحركة صرف أو قبض أصلية");
   if(!group.some(row=>String(row.right_id)===String(first.financial_source_id)&&row.purpose===first.financial_event))conflict("هوية مصدر الصرف لا تطابق توزيع الاستحقاق الأساسي");
   const allowed=first.financial_event==="distribution"?["distribution","internal_entitlement_settlement"]:first.financial_event==="advance_reimbursement"?["advance_reimbursement","internal_entitlement_settlement"]:[String(first.financial_event)];
   if(group.some(row=>!allowed.includes(String(row.purpose))))conflict("غرض توزيع الصرف غير مطابق للمصدر");
  }
  const byPurpose=new Map<string,Row[]>();for(const row of group){const purpose=String(row.purpose),items=byPurpose.get(purpose)??[];items.push(row);byPurpose.set(purpose,items);}
  for(const [purpose,items] of byPurpose){
   const weight=items.reduce((sum,row)=>sum+parseMoney(String(row.allocated_amount)),0n);
   if(weight>amount)conflict("توزيع يتجاوز أصل الحركة المالية؛ لا يمكن احتساب الدفع مرتين");
   const weights=items.map(row=>({key:`allocation:${positiveId(row.allocation_id)}`,weight:parseMoney(String(row.allocated_amount))}));
   if(weight<amount)weights.push({key:"unallocated",weight:amount-weight});
   const net=new Map(allocateWeightedMoney(amount-reversed,weights).map(line=>[line.key,parseMoney(line.amount)]));
   for(const row of items){
    if(Number(row.right_id)!==sourceId)continue;
    if(purpose!==purposes[category])conflict("غرض الصرف لا يطابق فئة استحقاق الشريك");
    const expectedDirection=category==="capital"?"revenue":"expense";
    if(first.financial_direction!==expectedDirection)conflict("اتجاه الصرف لا يطابق فئة الاستحقاق");
    if(financialStatus==="executed")paid+=net.get(`allocation:${Number(row.allocation_id)}`)!;
    else if(["draft","pending","approved"].includes(financialStatus))reserved+=parseMoney(String(row.allocated_amount));
    if(category==="internal_entitlement"){
     const payment:ConversionPayment={key:`allocation:${positiveId(row.allocation_id)}`,financialKey:`financial:${financialId}`,financialAmount:formatMoney(amount),amount:String(row.allocated_amount),paid:formatMoney(financialStatus==="executed"?net.get(`allocation:${Number(row.allocation_id)}`)!:0n),reserved:formatMoney(["draft","pending","approved"].includes(financialStatus)?parseMoney(String(row.allocated_amount)):0n)};
     if(row.conversion_allocation_id==null)direct.push(payment);
     else{const parentId=positiveId(row.conversion_allocation_id);if(!conversionIds.has(parentId))conflict("مرجع تحويل تغطية الصرف لا يخص الاستحقاق الأصلي");coverage.push({...payment,conversionKey:`allocation:${parentId}`});}
    }else if(row.conversion_allocation_id!=null)conflict("تغطية التحويل تخص استحقاق النقل الداخلي فقط");
   }
  }
 }
 if(conversions.length||coverage.length){
  let converted:ReturnType<typeof derivePartnershipConversion>;
  try{converted=derivePartnershipConversion({totalAmount:formatMoney(total),conversions,direct,coverage});}
  catch(cause){if(cause instanceof PartnershipValidationError)throw new PartnershipRepositoryError(cause.message,409,"CONFLICT");throw cause;}
  if(status!=="approved"&&(parseMoney(converted.approvedPaidAmount)>0n||parseMoney(converted.reservedAmount)>0n||parseMoney(converted.conversionAmount)>0n))conflict("تحويل أو صرف مرتبط باستحقاق غير معتمد");
  const actualPaid=parseMoney(converted.approvedPaidAmount),payable=status==="approved"&&category==="internal_entitlement";
  return {...converted,sourceType:input.sourceType,sourceId,paymentStatus:total<=0n||actualPaid<=0n?"unpaid":actualPaid>=total?"paid":"partial",approvalStatus:status,payable,availableAmount:payable?converted.availableAmount:"0.00"};
 }
 if(paid>total||paid+reserved>total)conflict("المدفوع أو الطلبات المعلقة تتجاوز الاستحقاق؛ راجع التوزيعات قبل المتابعة");
 if(status!=="approved"&&(paid>0n||reserved>0n))conflict("توجد حركة صرف لاستحقاق غير معتمد؛ يلزم مراجعة مصدره");
 const payable=status==="approved"&&Object.hasOwn(purposes,category),remaining=total-paid;
 return {sourceType:input.sourceType,sourceId,totalAmount:formatMoney(total),approvedPaidAmount:formatMoney(paid),remainingAmount:formatMoney(remaining),reservedAmount:formatMoney(reserved),availableAmount:formatMoney(payable?remaining-reserved:0n),paymentStatus:total<=0n||paid<=0n?"unpaid":paid>=total?"paid":"partial",approvalStatus:status,payable};
}
