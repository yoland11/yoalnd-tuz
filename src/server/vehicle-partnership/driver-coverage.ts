import {sql} from "drizzle-orm";
import {z} from "zod/v4";
import {canonicalPartnershipJson} from "../../lib/vehicle-partnership/canonical";
import {formatMoney,parseMoney} from "../../lib/vehicle-partnership/money";
import {buildPayoutCoverage} from "../../lib/vehicle-partnership/payout";
import {PartnershipValidationError} from "../../lib/vehicle-partnership/types";
import {reconcilePaymentState} from "../payment-state";
import {authorizePartnership,partnershipId,readOriginalVehicle,type PartnershipActor,type PartnershipDatabase} from "./agreements";
import {lockClosingContext,verifySubmittedClosing} from "./closing-lifecycle";
import {previewClosing} from "./closing";
import {proveClosingJournal} from "./closing-posting";
import {reserveClosingConversions} from "./closing-rights";
import {prepareDriverPaymentExecution} from "./driver-payments";
import {proveDriverCashCoverageSource} from "./driver-cash-source";
import {driverCoverageDigest,driverCoverageKey,normalizeDriverCoverageMapping,readSavedDriverCoverage,proveDriverCoverageMapping} from "./driver-coverage-proof";
import {provePartnershipCashReversalHistory} from "./cash-reversal-proof";
import {appendPartnershipAudit,lockPartnership,partnershipRows,PartnershipRepositoryError,type PartnershipExecutor} from "./repository";

type Row=Record<string,unknown>;
function conflict(message:string):never{throw new PartnershipRepositoryError(message,409,"CONFLICT");}
function object(value:unknown):Row{if(!value||typeof value!=="object"||Array.isArray(value))conflict("إثبات ربط دفعات الشهر غير مكتمل");return value as Row;}
const schema=z.object({closingId:z.number().int().positive(),expectedVersion:z.number().int().nonnegative(),expectedDigest:z.string().regex(/^[a-f0-9]{64}$/),idempotencyKey:z.string().trim().min(8).max(180),reason:z.string().trim().min(3).max(2000),includeReversalSummary:z.boolean().optional()}).strict();
const resultRow=z.object({financialTransactionId:z.number().int().positive(),transactionNo:z.string().min(1),amount:z.string(),coveredAmount:z.string(),uncoveredAmount:z.string(),alreadyLinked:z.boolean()}).strict();
const resultSchema=z.object({closingId:z.number().int().positive(),revision:z.number().int().positive(),sourceDigest:z.string(),matchedPayments:z.number().int().nonnegative().max(200),reversedPayments:z.number().int().nonnegative().max(200).optional(),amount:z.string(),coveredAmount:z.string(),uncoveredAmount:z.string(),results:z.array(resultRow).max(200)}).strict();
export type DriverCoverageSyncResult=z.infer<typeof resultSchema>;
export const partnershipCoverageResultSchema=resultSchema;
type Context=Awaited<ReturnType<typeof lockClosingContext>>;

function wagesInMonth(snapshot:Awaited<ReturnType<typeof verifySubmittedClosing>>["snapshot"]){
 const result=new Map<number,Row>(),fundings=new Set<number>(),expenses=new Set<number>(),financials=new Set<number>();
 for(const item of snapshot.sourceSnapshots){
  const source=object(item.snapshot),financial=object(source.financial);
  if(financial.type!=="vp_driver_accrual")continue;
  if(source.sourceStatus==="reversed")continue; // Known reversed wage is not a new payment candidate.
  const wage=object(source.sourceSnapshot),entryId=partnershipId(Number(wage.employeeFinanceEntryId)),fundingId=partnershipId(Number(source.costFundingId)),expenseId=partnershipId(Number(source.expenseId)),financialId=partnershipId(Number(financial.id));
  if(source.sourceStatus!=="approved"||item.key!==`financial:${financialId}`||financial.sourceType!=="vehicle_partnership_cost"||String(financial.sourceId)!==String(fundingId)||financial.event!=="driver_accrual"||financial.direction!=="expense"||financial.status!=="executed"||financial.reversalOf!==null||source.reversedFinancialId!=null||typeof wage.date!=="string"||wage.date<snapshot.from||wage.date>snapshot.to||financial.date!==wage.date||typeof wage.amount!=="string"||formatMoney(parseMoney(wage.amount))!==formatMoney(parseMoney(String(financial.amount)))||parseMoney(wage.amount)<=0n||source.sourceDigest!==driverCoverageDigest(wage))conflict("مصدر أجرة السائق لا يطابق مصروف شهره الأصلي المعتمد");
  if(result.has(entryId)||fundings.has(fundingId)||expenses.has(expenseId)||financials.has(financialId))conflict("أجرة سائق مكررة في مصادر الشهر");
  result.set(entryId,source);fundings.add(fundingId);expenses.add(expenseId);financials.add(financialId);
 }
 if(result.size>200)throw new PartnershipRepositoryError("أجور الشهر تتجاوز حد الربط الآمن؛ يلزم كشف مقسم",409,"LIMIT_EXCEEDED");return result;
}
async function budgets(tx:PartnershipExecutor,context:Context){
 if(context.row.financial_transaction_id==null)return [];
 const rows=partnershipRows(await tx.execute(sql`/* vp_driver_coverage_budget */ SELECT a.id,a.right_id,a.amount::text,a.financial_transaction_id,a.purpose,a.conversion_allocation_id,r.partnership_id FROM vehicle_partnership_settlement_allocations a JOIN vehicle_partnership_rights r ON r.id=a.right_id WHERE a.financial_transaction_id=${Number(context.row.financial_transaction_id)} AND a.purpose='internal_conversion' ORDER BY a.id LIMIT 501`));
 if(rows.length>500)throw new PartnershipRepositoryError("تحويلات الشهر تتجاوز حد المراجعة",409,"LIMIT_EXCEEDED");
 const result=[];for(const row of rows){
  if(Number(row.partnership_id)!==context.root.id||Number(row.financial_transaction_id)!==Number(context.row.financial_transaction_id)||row.purpose!=="internal_conversion"||row.conversion_allocation_id!=null)conflict("أصل تغطية السائق لا يعود لتحويل الشهر المعتمد");
  const rightId=partnershipId(Number(row.right_id)),state=await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_right",sourceId:rightId});
  if(!state||state.approvalStatus!=="approved"||typeof state.availableCoverageAmount!=="string")conflict("الرصيد المركزي لتحويل الشهر غير متاح");
  result.push({rightId,conversionAllocationId:partnershipId(Number(row.id)),availableAmount:state.availableCoverageAmount});
 }return result;
}
async function allocationRows(tx:PartnershipExecutor,financialId:number){
 const rows=partnershipRows(await tx.execute(sql`/* vp_driver_coverage_existing_allocations */ SELECT id AS allocation_id,right_id,financial_transaction_id,conversion_allocation_id,purpose,amount::text AS allocated_amount,idempotency_key FROM vehicle_partnership_settlement_allocations WHERE financial_transaction_id=${financialId} ORDER BY id LIMIT 501`));
 if(rows.length>500)conflict("توزيعات سند السائق تتجاوز حد المراجعة");return rows;
}
function checkedResult(value:unknown,closingId:number,sourceDigest:string):DriverCoverageSyncResult{
 const parsed=resultSchema.safeParse(value);if(!parsed.success)conflict("نتيجة ربط الشهر المحفوظة غير صالحة");const result=parsed.data;
 if(result.closingId!==closingId||result.sourceDigest!==sourceDigest||result.matchedPayments!==result.results.length||result.matchedPayments+(result.reversedPayments??0)>200||new Set(result.results.map(r=>r.financialTransactionId)).size!==result.results.length)conflict("نتيجة الربط لا تطابق مصدرها الأصلي");
 for(const row of result.results)if(parseMoney(row.coveredAmount)+parseMoney(row.uncoveredAmount)!==parseMoney(row.amount))conflict("مبالغ نتيجة الربط غير متوازنة");
 for(const field of ["amount","coveredAmount","uncoveredAmount"] as const)if(result.results.reduce((sum,r)=>sum+parseMoney(r[field]),0n)!==parseMoney(result[field]))conflict("إجمالي الربط لا يطابق سطوره");return result;
}

/** Explicit classification of ORIGINAL EXECUTED cash only. It never creates
 * a payment, settlement, cost, journal or cash movement, and never rewrites
 * the original driver request proposal. All maps/audits are atomic. */
export async function syncClosingDriverCoverage(db:PartnershipDatabase,actor:PartnershipActor,vehicleId:number,input:unknown):Promise<DriverCoverageSyncResult>{
 authorizePartnership(actor,true);partnershipId(vehicleId);const parsed=schema.safeParse(input);
 if(!parsed.success)throw new PartnershipValidationError(parsed.error.issues.map(i=>i.message).join("؛ "));
 const command=parsed.data,operationKey=`vp:driver-sync:${driverCoverageDigest({vehicleId,actorId:actor.id,closingId:command.closingId,key:command.idempotencyKey})}`,fingerprint=driverCoverageDigest({vehicleId,actorId:actor.id,command});
 return db.transaction(async tx=>{
  const root=await lockPartnership(tx,vehicleId);await readOriginalVehicle(tx,actor,vehicleId);
  const replay=partnershipRows(await tx.execute(sql`/* vp_driver_coverage_operation */ SELECT new_values FROM financial_audit_logs WHERE action='vehicle_partnership_driver_conversion_sync' AND new_values->>'vehicleId'=${String(vehicleId)} AND new_values->>'partnershipId'=${String(root.id)} AND new_values->>'operationKey'=${operationKey} ORDER BY id LIMIT 2`));
  if(replay.length){const saved=object(replay[0].new_values);if(replay.length!==1||saved.vehicleId!==vehicleId||saved.partnershipId!==root.id||saved.fingerprint!==fingerprint)conflict("مرجع ربط الشهر مستخدم لطلب مختلف");return checkedResult(saved.result,command.closingId,command.expectedDigest);}
  // Closing ownership is immutable. Reject crossed URL/month references before
  // the existing helper can acquire a second vehicle's partnership root.
  const scoped=partnershipRows(await tx.execute(sql`/* vp_driver_coverage_closing_scope */ SELECT id FROM vehicle_partnership_closings WHERE id=${command.closingId} AND partnership_id=${root.id} LIMIT 2`));
  if(scoped.length!==1||Number(scoped[0].id)!==command.closingId)conflict("الشهر المحدد لا يخص شراكة هذه المركبة");
  // The existing closing source locks acquire bookings before fleet/expense.
  // Never run the old driver preflight before this original month barrier.
  const context=await lockClosingContext(tx,actor,command.closingId),{row}=context;
  if(context.root.id!==root.id||context.root.vehicleId!==vehicleId||!["approved","distributed"].includes(String(row.status))||Number(row.version)!==command.expectedVersion||row.source_digest!==command.expectedDigest)conflict("نسخة الشهر غير معتمدة أو تغيرت؛ حدّث الحساب قبل ربط الدفعات");
  const approved=await previewClosing(tx,actor,vehicleId,String(row.period).slice(0,7));
  if(!approved.stored||approved.closingId!==command.closingId||approved.version!==command.expectedVersion||approved.sourceDigest!==command.expectedDigest)conflict("اعتماد الشهر أو بصمته غير مثبت");
  const verified=await verifySubmittedClosing(tx,actor,context,false),monthlyId=row.financial_transaction_id==null?null:partnershipId(Number(row.financial_transaction_id));
  if(monthlyId!=null)await proveClosingJournal(tx,monthlyId,verified.journal);
  await reserveClosingConversions(tx,actor,{root,row,snapshot:verified.snapshot,financialId:monthlyId},true);
  const wages=wagesInMonth(verified.snapshot);
  for(const entryId of wages.keys()){const state=await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_driver_entitlement",sourceId:entryId});if(!state)conflict("رصيد أجرة السائق الأصلي غير متاح");}
  const payments=wages.size?partnershipRows(await tx.execute(sql`/* vp_driver_coverage_payments */ SELECT f.id AS financial_id,s.id AS settlement_id,s.entry_id,f.source_type,f.source_id,f.transaction_no,f.reversal_txn_id,f.reversed_at,coalesce((SELECT sum(r.amount) FROM financial_transactions r WHERE r.reversed_transaction_id=f.id AND r.approval_status='executed'),0)::text AS reversed_amount FROM employee_finance_settlements s JOIN financial_transactions f ON f.id=s.financial_transaction_id WHERE s.entry_id IN (${sql.join([...wages.keys()].map(id=>sql`${id}`),sql`, `)}) AND s.settlement_type='payment' AND f.approval_status='executed' ORDER BY f.id,s.id LIMIT 201`)):[];
  if(payments.length>200)throw new PartnershipRepositoryError("دفعات السائقين تتجاوز حد الربط الآمن؛ يلزم كشف مقسم",409,"LIMIT_EXCEEDED");
  if(new Set(payments.map(p=>partnershipId(Number(p.financial_id)))).size!==payments.length)conflict("سند صرف سائق مكرر بين التسويات");
  const results:DriverCoverageSyncResult["results"]=[];
  let reversedPayments=0;
  let availableBudgets:Awaited<ReturnType<typeof budgets>>|null=null;
  for(const payment of payments){
   const financialId=partnershipId(Number(payment.financial_id)),settlementId=partnershipId(Number(payment.settlement_id)),entryId=partnershipId(Number(payment.entry_id)),frozen=wages.get(entryId);
   if(!frozen||payment.source_type!=="vehicle_partnership_driver"||String(payment.source_id)!==String(settlementId))conflict("دفعة السائق لا تعود لتسويتها الأصلية");
   const reversed=parseMoney(String(payment.reversed_amount));
   if(reversed>0n||payment.reversal_txn_id!=null||payment.reversed_at!=null){
    const history=await provePartnershipCashReversalHistory(tx,financialId);
    if(history.originalId!==financialId||history.partnershipId!==root.id||history.vehicleId!==vehicleId||history.sourceType!=="vehicle_partnership_driver"||history.sourceId!==String(settlementId)||history.transactionType!=="vp_driver_payment"||history.proof.driverEntryId!==entryId||history.reverseId!==Number(payment.reversal_txn_id)||parseMoney(history.amount)!==reversed||payment.reversed_at==null)conflict("عكس أجرة السائق غير كامل أو لا يطابق سندها الأصلي");
    reversedPayments++;continue; // Proven full return, never another coverage.
   }
   const plan=await prepareDriverPaymentExecution(tx,{id:financialId,sourceType:"vehicle_partnership_driver",sourceId:String(settlementId)},actor),source=await proveDriverCashCoverageSource(tx,root,financialId),origin=plan.context.proof;
   const wage=object(frozen.sourceSnapshot),financial=object(frozen.financial);
   if(!plan.alreadyExecuted||plan.financialId!==financialId||plan.context.root.id!==root.id||plan.context.root.vehicleId!==vehicleId||source.settlementId!==settlementId||source.entryId!==entryId||origin.entryId!==entryId||origin.expenseId!==Number(frozen.expenseId)||origin.costFundingId!==Number(frozen.costFundingId)||origin.accrualFinancialId!==Number(financial.id)||origin.sourceDigest!==frozen.sourceDigest||source.sourceDigest!==origin.sourceDigest||source.entryAmount!==origin.amount||source.entryDate!==origin.entryDate||canonicalPartnershipJson(plan.context.funding.source_snapshot)!==canonicalPartnershipJson(wage)||source.amount!==plan.amount||source.entryDate.slice(0,7)!==String(row.period).slice(0,7)||parseMoney(source.reversedAmount)!==0n||source.reversalTxnId!=null||source.reversedAt!=null)conflict("صرف السائق معكوس أو لا يطابق أجرة شهره الأصلي المجمدة");
   const existing=await allocationRows(tx,financialId),saved=await readSavedDriverCoverage(tx,root,financialId);
   let coveredAmount:string,uncoveredAmount:string,alreadyLinked=false;
   if(saved){
    if(saved.closingId!==command.closingId||saved.revision!==Number(row.revision)||saved.closingDigest!==command.expectedDigest||saved.driverRequestDigest!==driverCoverageDigest(plan.proposal))conflict("سبق ربط السند بنسخة شهر مختلفة");
    await proveDriverCoverageMapping(tx,root,source,existing);coveredAmount=saved.coveredAmount;uncoveredAmount=saved.uncoveredAmount;alreadyLinked=true;
   }else{
    if(existing.length)conflict("توزيعات سند السائق بلا إثبات ربط؛ راجع المصدر قبل المتابعة");
    // Root/source locks serialize all conversion consumers. Existing mappings
    // already reduce canonical capacity; subtract each new map exactly once
    // rather than re-reading every monthly right for every driver payment.
    availableBudgets??=await budgets(tx,context);
    const coverage=buildPayoutCoverage(source.amount,availableBudgets),covered=coverage.reduce((sum,c)=>sum+parseMoney(c.amount),0n);
    for(const c of coverage){const budget=availableBudgets.find(b=>b.rightId===c.rightId&&b.conversionAllocationId===c.conversionAllocationId);if(!budget||parseMoney(budget.availableAmount)<parseMoney(c.amount))conflict("تغطية دفعات الشهر تتجاوز رصيد التحويل");budget.availableAmount=formatMoney(parseMoney(budget.availableAmount)-parseMoney(c.amount));}
    coveredAmount=formatMoney(covered);uncoveredAmount=formatMoney(parseMoney(source.amount)-covered);
    if(coverage.length){
     if(monthlyId==null)conflict("تغطية الأجرة تحتاج تحويل شهر مالي أصلياً");
     const proof=normalizeDriverCoverageMapping({formatVersion:1,mappingKey:driverCoverageKey(command.closingId,Number(row.revision),financialId),vehicleId,partnershipId:root.id,financialId,settlementId,entryId,expenseId:source.expenseId,costFundingId:source.costFundingId,accrualFinancialId:source.accrualFinancialId,amount:source.amount,entryAmount:source.entryAmount,entryDate:source.entryDate,transactionDate:source.transactionDate,paymentMethod:source.paymentMethod,driverSourceDigest:source.sourceDigest,driverRequestDigest:driverCoverageDigest(plan.proposal),closingId:command.closingId,revision:Number(row.revision),closingDigest:command.expectedDigest,closingFinancialId:monthlyId,coveredAmount,uncoveredAmount,coverage});
     for(const c of coverage){const inserted=partnershipRows(await tx.execute(sql`/* vp_driver_coverage_insert */ INSERT INTO vehicle_partnership_settlement_allocations (right_id,financial_transaction_id,conversion_allocation_id,purpose,amount,idempotency_key,created_by,reason) VALUES (${c.rightId},${financialId},${c.conversionAllocationId},'internal_entitlement_settlement',${c.amount},${`${proof.mappingKey}:coverage:${c.conversionAllocationId}`},${actor.id},${command.reason}) RETURNING id`));if(inserted.length!==1||!Number.isSafeInteger(Number(inserted[0].id))||Number(inserted[0].id)<=0)throw new Error("Driver cash coverage insert was not confirmed");}
     await appendPartnershipAudit(tx,{vehicleId,partnershipId:root.id,actor,action:"driver_conversion_mapped",reason:command.reason,financialTransactionId:financialId,newValues:{mappingKey:proof.mappingKey,mappingDigest:driverCoverageDigest(proof),proof,cashImpact:"none",newPayment:false}});
     await proveDriverCoverageMapping(tx,root,source,await allocationRows(tx,financialId));
    }
   }
   const actual=await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_driver_entitlement",sourceId:entryId});if(!actual)conflict("تعذر مصالحة أجرة السائق الأصلية");
   const mapped=await readSavedDriverCoverage(tx,root,financialId);
   for(const c of mapped?.coverage??[])await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_right",sourceId:c.rightId});
   results.push({financialTransactionId:financialId,transactionNo:source.transactionNo,amount:source.amount,coveredAmount,uncoveredAmount,alreadyLinked});
  }
  const sum=(field:"amount"|"coveredAmount"|"uncoveredAmount")=>formatMoney(results.reduce((s,r)=>s+parseMoney(r[field]),0n));
  const result=checkedResult({closingId:command.closingId,revision:Number(row.revision),sourceDigest:command.expectedDigest,matchedPayments:results.length,...(command.includeReversalSummary?{reversedPayments}:{}),amount:sum("amount"),coveredAmount:sum("coveredAmount"),uncoveredAmount:sum("uncoveredAmount"),results},command.closingId,command.expectedDigest);
  await appendPartnershipAudit(tx,{vehicleId,partnershipId:root.id,actor,action:"driver_conversion_sync",reason:command.reason,newValues:{operationKey,fingerprint,result,cashImpact:"none",newPayment:false}});return result;
 });
}
