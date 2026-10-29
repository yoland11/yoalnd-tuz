import {createHash,randomUUID} from "node:crypto";
import {sql} from "drizzle-orm";
import {canonicalPartnershipJson} from "../../lib/vehicle-partnership/canonical";
import {formatMoney,parseMoney} from "../../lib/vehicle-partnership/money";
import {PartnershipValidationError} from "../../lib/vehicle-partnership/types";
import {authorizePartnership,partnershipId,type PartnershipActor} from "./agreements";
import {lockClosingContext,verifySubmittedClosing} from "./closing-lifecycle";
import {proveClosingJournal} from "./closing-posting";
import {assertClosingUnused,proveClosingRevisionRights} from "./closing-unused";
import {reconcileClosingAffected} from "./closing-rights";
import type {PartnershipReversalOptions} from "./posting";
import {appendPartnershipAudit,partnershipRows,PartnershipRepositoryError,type PartnershipExecutor} from "./repository";

type Row=Record<string,unknown>;
type Identity={id:number;sourceType:string|null;sourceId:string|null};
const hash=(value:unknown)=>createHash("sha256").update(canonicalPartnershipJson(value)).digest("hex");
function conflict(message:string):never{throw new PartnershipRepositoryError(message,409,"CONFLICT");}
function object(value:unknown):Row{if(!value||typeof value!=="object"||Array.isArray(value))conflict("إثبات إعادة فتح الشهر غير مكتمل");return value as Row;}

/** Full NONCASH reversal of an unused, immutable monthly revision, inside the
 * existing financial reversal transaction. Original trips, costs and all prior
 * lines/allocations remain history. Cash-bearing history needs an adjustment.
 * The original FI key and approval audit prove the old revision on retries,
 * even when the current header has subsequently been reviewed or reapproved. */
export async function reverseClosingFinancialTransaction(tx:PartnershipExecutor,initial:Identity,actor:PartnershipActor,value:string,options:PartnershipReversalOptions,numberFinancial:(id:number)=>string):Promise<{originalId:number;reverseId:number;alreadyReversed:boolean}>{
 authorizePartnership(actor,true);partnershipId(initial.id);
 if(initial.sourceType!=="vehicle_partnership_closing"||!initial.sourceId||!/^[1-9]\d*$/.test(initial.sourceId))throw new PartnershipValidationError("مرجع الإغلاق المالي غير صالح");
 const closingId=partnershipId(Number(initial.sourceId)),why=typeof value==="string"?value.trim():"";
 if(why.length<3||why.length>2000)throw new PartnershipValidationError("سبب واضح لإعادة فتح الشهر مطلوب");
 if(options.sourceType!=null&&options.sourceType!==initial.sourceType||options.sourceId!=null&&String(options.sourceId)!==initial.sourceId||options.sourceEvent!=null&&options.sourceEvent!=="reversal")conflict("لا يمكن تغيير مصدر عكس الإغلاق الشهري");
 if(!Number.isSafeInteger(options.expectedVersion)||Number(options.expectedVersion)<0||typeof options.expectedDigest!=="string"||!/^[a-f0-9]{64}$/.test(options.expectedDigest))throw new PartnershipValidationError("نسخة وبصمة الإغلاق المعروضتين مطلوبتان لإعادة الفتح");
 const key=options.idempotencyKey?.trim()||`vp:closing-reversal:${initial.id}`;
 const description=options.description?.trim()||`إعادة فتح حساب شراكة المركبة ${closingId}: ${why}`;
 if(key.length<8||key.length>180||description.length>4000)throw new PartnershipValidationError("مرجع أو وصف عكس الإغلاق غير صالح");
 const context=await lockClosingContext(tx,actor,closingId),{root,row}=context;
 const originals=partnershipRows(await tx.execute(sql`/* vp_month_reverse_financial */ SELECT id,source_type,source_id,source_event,transaction_type,transaction_date::text,direction,amount::text,approval_status,balance_before,balance_after,reversed_transaction_id,reversal_txn_id,reversed_at,idempotency_key,approved_by FROM financial_transactions WHERE id=${initial.id} FOR UPDATE`));
 if(originals.length!==1)conflict("طلب الإغلاق المالي الأصلي غير موجود أو مكرر");
 const financial=originals[0],match=new RegExp(`^vp:closing:${closingId}:r([1-9]\\d*)$`).exec(String(financial.idempotency_key));
 if(Number(financial.id)!==initial.id||financial.source_type!==initial.sourceType||String(financial.source_id)!==initial.sourceId||financial.source_event!=="monthly_result"||financial.approval_status!=="executed"||financial.balance_before!=null||financial.balance_after!=null||financial.reversed_transaction_id!=null||!match)conflict("المصدر ليس إغلاق شراكة منفذاً غير نقدي");
 const revision=partnershipId(Number(match[1]));
 const summaries=partnershipRows(await tx.execute(sql`/* vp_month_reverse_summary */ SELECT amount::text,snapshot FROM vehicle_partnership_closing_lines WHERE closing_id=${closingId} AND revision=${revision} AND source_key=${`summary:${revision}`} LIMIT 2`));
 if(summaries.length!==1)conflict("نسخة الإغلاق الأصلية لا تحتوي إثباتاً محفوظاً وحيداً");
 const container=object(summaries[0].snapshot),sourceDigest=hash(container.snapshot);
 const frozen={...row,revision,financial_transaction_id:initial.id,source_digest:sourceDigest,policy_snapshot:container};
 const {snapshot,journal}=await verifySubmittedClosing(tx,actor,{root,row:frozen},false);
 const amount=formatMoney(parseMoney(String(financial.amount)));
 if(parseMoney(amount)<=0n||amount!==journal.amount||parseMoney(String(summaries[0].amount))!==parseMoney(amount)||financial.transaction_type!==journal.transactionType||financial.direction!==(journal.transactionType==="vp_month_profit"?"expense":"revenue")||financial.transaction_date!==snapshot.to)conflict("مبلغ أو تاريخ أو نوع القيد لا يطابق نسخة الشهر الأصلية");
 if(options.amount!=null&&parseMoney(String(options.amount))!==parseMoney(amount))conflict("العكس الجزئي للإغلاق الشهري غير مسموح؛ استخدم تصحيحاً معتمداً");
 const approvals=partnershipRows(await tx.execute(sql`/* vp_month_reverse_approval */ SELECT id,actor_id,new_values FROM financial_audit_logs WHERE transaction_id=${initial.id} AND action='vehicle_partnership_closing_financial_approved' ORDER BY id LIMIT 2`));
 const approved=approvals.length===1?object(approvals[0].new_values):{};
 if(approvals.length!==1||Number(approvals[0].actor_id)!==Number(financial.approved_by)||Number(approved.closingId)!==closingId||Number(approved.revision)!==revision||approved.sourceDigest!==sourceDigest||approved.amount!==amount||approved.status!=="approved"||Number(approved.partnershipId)!==root.id||Number(approved.vehicleId)!==root.vehicleId)conflict("سجل الموافقة لا يثبت النسخة المالية الأصلية");
 const fingerprint=hash({originalId:initial.id,closingId,actorId:actor.id,key,why,description,amount,expectedVersion:options.expectedVersion,expectedDigest:options.expectedDigest});
 const originalJournal=await proveClosingJournal(tx,initial.id,journal);
 const prior=partnershipRows(await tx.execute(sql`/* vp_month_reverse_prior */ SELECT id,source_type,source_id,source_event,transaction_type,direction,amount::text,approval_status,reversed_transaction_id,idempotency_key,balance_before,balance_after FROM financial_transactions WHERE reversed_transaction_id=${initial.id} ORDER BY id LIMIT 2`));
 const reversedJournal={...journal,legs:journal.legs.map(leg=>({...leg,direction:leg.direction==="debit"?"credit" as const:"debit" as const}))};
 if(prior.length){
  const previous=prior[0],reverseId=partnershipId(Number(previous.id));
  if(prior.length!==1||Number(financial.reversal_txn_id)!==reverseId||financial.reversed_at==null||previous.source_type!==initial.sourceType||String(previous.source_id)!==initial.sourceId||previous.source_event!=="reversal"||previous.transaction_type!==`${journal.transactionType}_reversal`||previous.direction!==(financial.direction==="expense"?"revenue":"expense")||parseMoney(String(previous.amount))!==parseMoney(amount)||previous.approval_status!=="executed"||Number(previous.reversed_transaction_id)!==initial.id||previous.idempotency_key!==key||previous.balance_before!=null||previous.balance_after!=null)conflict("العكس السابق لا يطابق الإغلاق الشهري الأصلي");
  const operations=partnershipRows(await tx.execute(sql`/* vp_month_reverse_operation */ SELECT id,new_values FROM financial_audit_logs WHERE transaction_id=${initial.id} AND action='vehicle_partnership_closing_reopened' ORDER BY id LIMIT 2`));
  const operation=operations.length===1?object(operations[0].new_values):{};
  if(operations.length!==1||operation.fingerprint!==fingerprint||operation.key!==key||Number(operation.reverseId)!==reverseId||Number(operation.closingId)!==closingId||Number(operation.revision)!==revision||operation.sourceDigest!==sourceDigest||Number(operation.partnershipId)!==root.id||Number(operation.vehicleId)!==root.vehicleId)conflict("مرجع إعادة الفتح مستخدم لطلب مختلف أو سجلّه غير مطابق");
  await proveClosingJournal(tx,reverseId,reversedJournal);
  await proveClosingRevisionRights(tx,{root,row:frozen,snapshot,financialId:initial.id},"reversed");
  await reconcileClosingAffected(tx,{rootId:root.id,closingId,revision,financialId:initial.id});
  return {originalId:initial.id,reverseId,alreadyReversed:true};
 }
 if(financial.reversal_txn_id!=null||financial.reversed_at!=null||row.status!=="approved"||Number(row.revision)!==revision||Number(row.financial_transaction_id)!==initial.id||Number(row.version)!==options.expectedVersion||row.source_digest!==options.expectedDigest||sourceDigest!==row.source_digest)conflict("نسخة الإغلاق تغيرت أو لا تسمح بإعادة الفتح؛ أعد عرض الحساب");
 const rightIds=await assertClosingUnused(tx,actor,{root,row,snapshot,financialId:initial.id});
 const used=partnershipRows(await tx.execute(sql`/* vp_month_reverse_key */ SELECT id FROM financial_transactions WHERE idempotency_key=${key} LIMIT 1`));
 if(used.length)conflict("مرجع العكس مستخدم لحركة مالية أخرى");
 const inserted=partnershipRows(await tx.execute(sql`/* vp_month_reverse_insert */ INSERT INTO financial_transactions (transaction_no,transaction_date,direction,amount,department,transaction_type,source_type,source_id,source_event,idempotency_key,reversed_transaction_id,reversal_reason,approval_status,payment_method,requested_by,requested_by_name,approved_by,approved_by_name,approved_at,executed_by,executed_by_name,executed_at,balance_before,balance_after,description) VALUES (${`FIN-TMP-${randomUUID()}`},(now() AT TIME ZONE 'Asia/Baghdad')::date,${financial.direction==="expense"?"revenue":"expense"},${amount},'transportation',${`${journal.transactionType}_reversal`},${initial.sourceType},${initial.sourceId},'reversal',${key},${initial.id},${why},'executed','other',${actor.id},${actor.name},${actor.id},${actor.name},now(),${actor.id},${actor.name},now(),NULL,NULL,${description}) RETURNING id`));
 if(inserted.length!==1)throw new Error("Monthly reversal insert was not confirmed");const reverseId=partnershipId(Number(inserted[0].id));
 const numbered=partnershipRows(await tx.execute(sql`/* vp_month_reverse_number */ UPDATE financial_transactions SET transaction_no=${numberFinancial(reverseId)} WHERE id=${reverseId} RETURNING id`));
 if(numbered.length!==1||Number(numbered[0].id)!==reverseId)throw new Error("Monthly reversal numbering was not confirmed");
 for(const leg of originalJournal){
  const entries=partnershipRows(await tx.execute(sql`/* vp_month_reverse_leg */ INSERT INTO financial_ledger_entries (transaction_id,account_id,entry_side,amount,description) VALUES (${reverseId},${partnershipId(Number(leg.account_id))},${leg.entry_side==="debit"?"credit":"debit"},${formatMoney(parseMoney(String(leg.amount)))},${description}) RETURNING id`));
  if(entries.length!==1)throw new Error("Monthly opposite journal leg insert was not confirmed");
 }
 await proveClosingJournal(tx,reverseId,reversedJournal);
 const original=partnershipRows(await tx.execute(sql`/* vp_month_reverse_original */ UPDATE financial_transactions SET reversal_txn_id=${reverseId},reversed_at=now(),reversed_by=${actor.id},reversed_by_name=${actor.name},reversal_reason=${why},updated_at=now() WHERE id=${initial.id} AND reversal_txn_id IS NULL AND approval_status='executed' RETURNING id`));
 if(original.length!==1||Number(original[0].id)!==initial.id)conflict("المصدر المالي تغير أثناء عكس الشهر");
 const reversed=partnershipRows(await tx.execute(sql`/* vp_month_reverse_rights */ UPDATE vehicle_partnership_rights SET status='reversed' WHERE closing_line_id IN (SELECT id FROM vehicle_partnership_closing_lines WHERE closing_id=${closingId} AND revision=${revision}) AND partnership_id=${root.id} AND status='approved' RETURNING id`));
 const changedIds=reversed.map(item=>partnershipId(Number(item.id))).sort((a,b)=>a-b);
 if(canonicalPartnershipJson(changedIds)!==canonicalPartnershipJson([...rightIds].sort((a,b)=>a-b)))conflict("حقوق الشهر تغيرت أثناء إعادة الفتح");
 const changed=partnershipRows(await tx.execute(sql`/* vp_month_reverse_header */ UPDATE vehicle_partnership_closings SET status='draft',revision=revision+1,version=version+1,financial_transaction_id=NULL,approved_by=NULL,approved_at=NULL WHERE id=${closingId} AND revision=${revision} AND version=${Number(row.version)} AND status='approved' AND financial_transaction_id=${initial.id} RETURNING id`));
 if(changed.length!==1||Number(changed[0].id)!==closingId)conflict("الإغلاق تغير أثناء إعادة الفتح");
 await reconcileClosingAffected(tx,{rootId:root.id,closingId,revision,financialId:initial.id});
 await appendPartnershipAudit(tx,{vehicleId:root.vehicleId,partnershipId:root.id,actor,action:"closing_reopened",reason:why,financialTransactionId:initial.id,oldValues:{closingId,revision,sourceDigest,status:"approved"},newValues:{closingId,revision,sourceDigest,reverseId,key,fingerprint,nextRevision:revision+1,version:Number(row.version)+1,status:"draft",cashImpact:"none"}});
 return {originalId:initial.id,reverseId,alreadyReversed:false};
}
