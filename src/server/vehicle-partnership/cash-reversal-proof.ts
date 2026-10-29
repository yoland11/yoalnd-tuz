import {createHash} from "node:crypto";
import {sql} from "drizzle-orm";
import {z} from "zod/v4";
import {canonicalPartnershipJson} from "../../lib/vehicle-partnership/canonical";
import {formatMoney,parseMoney} from "../../lib/vehicle-partnership/money";
import {partnershipId} from "./agreements";
import {readSavedDriverCoverage} from "./driver-coverage-proof";
import {readSavedAdvanceCoverage} from "./advance-coverage-proof";
import {provePartnershipJournal} from "./journal";
import {partnershipRows,PartnershipRepositoryError,type PartnershipExecutor} from "./repository";

type Row=Record<string,unknown>;
const rules={vp_partner_distribution:{source:"vehicle_partnership_settlement",event:"distribution",counter:"VP-PROFIT"},vp_partner_advance_repayment:{source:"vehicle_partnership_settlement",event:"advance_reimbursement",counter:"VP-ADVANCE"},vp_driver_payment:{source:"vehicle_partnership_driver",event:"driver_fee_settlement",counter:"VP-DRIVER"}} as const;
export type CashType=keyof typeof rules;
const hash=(value:unknown)=>createHash("sha256").update(canonicalPartnershipJson(value)).digest("hex");
const positive=z.number().int().positive(),digest=z.string().regex(/^[a-f0-9]{64}$/);
const proofSchema=z.object({formatVersion:z.literal(1),originalId:positive,vehicleId:positive,partnershipId:positive,actorId:positive,nonce:z.string().min(1).max(180),reason:z.string().min(3).max(2000),key:z.string(),fingerprint:digest,amount:z.string(),sourceType:z.enum(["vehicle_partnership_settlement","vehicle_partnership_driver"]),sourceId:z.string().regex(/^[1-9]\d*$/),transactionType:z.enum(["vp_partner_distribution","vp_partner_advance_repayment","vp_driver_payment"]),counterCode:z.enum(["VP-PROFIT","VP-ADVANCE","VP-DRIVER"]),original:z.record(z.string(),z.unknown()),requestDigest:digest,allocations:z.array(z.record(z.string(),z.unknown())).max(500),driverMappingDigest:digest.nullable(),advanceMappingDigest:digest.optional(),primaryRightId:positive.nullable(),driverEntryId:positive.nullable(),closing:z.object({id:positive,revision:positive}).strict().nullable()}).strict();
export type Proof=z.infer<typeof proofSchema>;
export type PartnershipCashReversalPlan={originalId:number;vehicleId:number;partnershipId:number;alreadyReversed:boolean;reverseId:number|null;amount:string;counterCode:Proof["counterCode"];sourceType:Proof["sourceType"];sourceId:string;transactionType:CashType;idempotencyKey:string;description:string;reason:string;proof:Proof;proofDigest:string};
function conflict(message:string):never{throw new PartnershipRepositoryError(message,409,"CONFLICT");}
function object(value:unknown):Row{if(!value||typeof value!=="object"||Array.isArray(value))conflict("إثبات عكس صرف الشراكة غير مكتمل");return value as Row;}
function one(rows:Row[],message:string):Row{if(rows.length!==1)conflict(message);return rows[0];}
function signed(value:unknown){const text=String(value);return text.startsWith("-")?-parseMoney(text.slice(1)):parseMoney(text);}
function time(value:unknown):string{if(value==null)conflict("إثبات موافقة وتنفيذ الصرف غير مكتمل");const date=new Date(value instanceof Date?value.getTime():String(value));if(!Number.isFinite(date.getTime()))conflict("تاريخ إثبات الصرف غير صالح");return date.toISOString();}
function day(value:unknown):string{if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(`${value}T00:00:00Z`))||new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)!==value)conflict("تاريخ سند الصرف غير صالح");return value;}
function snapshot(row:Row){
 const approvedAt=time(row.approved_at),executedAt=time(row.executed_at),approvedBy=partnershipId(Number(row.approved_by)),executedBy=partnershipId(Number(row.executed_by));
 if(executedAt<approvedAt||row.approval_status!=="executed"||typeof row.transaction_no!=="string"||!row.transaction_no.trim()||row.transaction_no.length>50||/[\u0000-\u001f]/.test(row.transaction_no)||/^FIN-TMP-/i.test(row.transaction_no)||!["cash","transfer","pos"].includes(String(row.payment_method))||row.balance_before==null||row.balance_after==null)conflict("السند لا يثبت صرفاً نقدياً منفذاً ومعتمداً");
 return {id:partnershipId(Number(row.id)),transactionNo:row.transaction_no,date:day(row.transaction_date),direction:String(row.direction),amount:formatMoney(parseMoney(String(row.amount))),department:String(row.department),transactionType:String(row.transaction_type),paymentMethod:String(row.payment_method),sourceType:String(row.source_type),sourceId:String(row.source_id),sourceEvent:String(row.source_event),idempotencyKey:String(row.idempotency_key),approvedBy,executedBy,approvedAt,executedAt,balanceBefore:formatMoney(signed(row.balance_before)),balanceAfter:formatMoney(signed(row.balance_after))};
}
const commandFingerprint=(p:Pick<Proof,"originalId"|"actorId"|"nonce"|"reason"|"sourceType"|"sourceId"|"transactionType">)=>hash({originalId:p.originalId,actorId:p.actorId,nonce:p.nonce,reason:p.reason,sourceType:p.sourceType,sourceId:p.sourceId,transactionType:p.transactionType});
const operationKey=(originalId:number,nonce:string)=>`vp:cash-reversal:${hash({originalId,nonce})}`;
function checkedProof(value:unknown):Proof{
 const parsed=proofSchema.safeParse(value);if(!parsed.success)conflict("سجل عكس الصرف لا يطابق صيغته الأصلية");const p=parsed.data,rule=rules[p.transactionType];
 if(p.key!==operationKey(p.originalId,p.nonce)||p.fingerprint!==commandFingerprint(p)||p.sourceType!==rule.source||p.counterCode!==rule.counter||formatMoney(parseMoney(p.amount))!==p.amount||parseMoney(p.amount)<=0n||p.original.id!==p.originalId||p.original.amount!==p.amount||p.original.sourceType!==p.sourceType||p.original.sourceId!==p.sourceId||p.original.transactionType!==p.transactionType||p.original.sourceEvent!==rule.event||p.original.direction!=="expense"||signed(p.original.balanceBefore)-signed(p.original.balanceAfter)!==parseMoney(p.amount)||(p.transactionType==="vp_driver_payment"?p.driverEntryId==null||p.primaryRightId!=null:p.primaryRightId!==Number(p.sourceId)||p.driverEntryId!=null||p.transactionType==="vp_partner_distribution"&&p.closing==null))conflict("هوية أو قيمة عكس الصرف لا تطابق سندها الأصلي");return p;
}
function plan(p:Proof,alreadyReversed=false,reverseId:number|null=null):PartnershipCashReversalPlan{return {originalId:p.originalId,vehicleId:p.vehicleId,partnershipId:p.partnershipId,alreadyReversed,reverseId,amount:p.amount,counterCode:p.counterCode,sourceType:p.sourceType,sourceId:p.sourceId,transactionType:p.transactionType,idempotencyKey:p.key,description:`عكس صرف الشراكة ${p.original.transactionNo}: ${p.reason}`,reason:p.reason,proof:p,proofDigest:hash(p)};}
async function original(tx:PartnershipExecutor,id:number,lock=false){return one(partnershipRows(await tx.execute(sql`/* vp_cash_reverse_original */ SELECT f.*,f.transaction_date::date::text AS transaction_date,f.amount::text AS amount,f.balance_before::text AS balance_before,f.balance_after::text AS balance_after FROM financial_transactions f WHERE f.id=${id} LIMIT 2 ${lock?sql`FOR UPDATE`:sql``}`)),"سند صرف الشراكة الأصلي مفقود أو مكرر");}
async function request(tx:PartnershipExecutor,id:number){return object(one(partnershipRows(await tx.execute(sql`/* vp_cash_reverse_request */ SELECT new_values FROM financial_audit_logs WHERE transaction_id=${id} AND action='vehicle_partnership_financial_requested' ORDER BY id LIMIT 2`)),"إثبات طلب الصرف الأصلي مفقود أو مكرر").new_values);}
async function allocations(tx:PartnershipExecutor,id:number,rootId:number){
 const rows=partnershipRows(await tx.execute(sql`/* vp_cash_reverse_allocations */ SELECT a.id,a.right_id,a.financial_transaction_id,a.conversion_allocation_id,a.purpose,a.amount::text,a.idempotency_key,r.partnership_id FROM vehicle_partnership_settlement_allocations a JOIN vehicle_partnership_rights r ON r.id=a.right_id WHERE a.financial_transaction_id=${id} ORDER BY a.id LIMIT 501`));
 if(rows.length>500||new Set(rows.map(r=>Number(r.id))).size!==rows.length||rows.some(r=>Number(r.partnership_id)!==rootId||Number(r.financial_transaction_id)!==id))conflict("توزيعات الصرف مكررة أو خارج نطاق المركبة");
 return rows.map(r=>({id:partnershipId(Number(r.id)),rightId:partnershipId(Number(r.right_id)),financialId:id,parentId:r.conversion_allocation_id==null?null:partnershipId(Number(r.conversion_allocation_id)),purpose:String(r.purpose),amount:formatMoney(parseMoney(String(r.amount))),key:String(r.idempotency_key)}));
}
async function children(tx:PartnershipExecutor,id:number){return partnershipRows(await tx.execute(sql`/* vp_cash_reverse_children */ SELECT f.*,f.transaction_date::date::text AS transaction_date,f.amount::text AS amount,f.balance_before::text AS balance_before,f.balance_after::text AS balance_after FROM financial_transactions f WHERE f.reversed_transaction_id=${id} ORDER BY f.id LIMIT 3`));}
async function saved(tx:PartnershipExecutor,id:number){const rows=partnershipRows(await tx.execute(sql`/* vp_cash_reverse_history */ SELECT new_values FROM financial_audit_logs WHERE transaction_id=${id} AND action='vehicle_partnership_cash_reversed' ORDER BY id LIMIT 2`));if(!rows.length)return null;return object(one(rows,"سجل عكس الصرف مكرر").new_values);}
async function proveImmutable(tx:PartnershipExecutor,p:Proof){
 const row=await original(tx,p.originalId),current=snapshot(row),audit=await request(tx,p.originalId),proposal=object(audit.sourceSnapshot),command=object(proposal.command);
 if(hash(current)!==hash(p.original)||audit.sourceDigest!==p.requestDigest||hash(proposal)!==p.requestDigest||audit.vehicleId!==p.vehicleId||audit.partnershipId!==p.partnershipId||audit.sourceType!==p.sourceType||String(audit.sourceId)!==p.sourceId||audit.amount!==p.amount||proposal.vehicleId!==p.vehicleId||proposal.partnershipId!==p.partnershipId||command.amount!==p.amount||command.transactionDate!==current.date||command.paymentMethod!==current.paymentMethod||(p.driverEntryId!=null?proposal.settlementId!==Number(p.sourceId)||command.entryId!==p.driverEntryId:command.rightId!==p.primaryRightId)||hash(await allocations(tx,p.originalId,p.partnershipId))!==hash(p.allocations))conflict("مصدر الصرف أو طلبه أو توزيعاته تغيرت بعد العكس");
 if(p.transactionType==="vp_partner_advance_repayment"&&p.closing==null&&(proposal.formatVersion!==2||command.originMode!=="approved_advance"||object(proposal.origin).rightId!==p.primaryRightId))conflict("صرف السلفة بلا شهر يحتاج إثبات أصل السلفة المعتمد بصيغته المستقلة");
 if(p.transactionType==="vp_driver_payment"){const mapping=await readSavedDriverCoverage(tx,{id:p.partnershipId,vehicleId:p.vehicleId},p.originalId);if((mapping?hash(mapping):null)!==p.driverMappingDigest)conflict("تغطية صرف السائق تغيرت بعد العكس");}
 if(p.advanceMappingDigest!==undefined){if(p.transactionType!=='vp_partner_advance_repayment')conflict('تغطية السلفة تخص سند سلفة فقط');const mapping=await readSavedAdvanceCoverage(tx,{id:p.partnershipId,vehicleId:p.vehicleId},p.originalId);if(!mapping||hash(mapping)!==p.advanceMappingDigest||p.closing?.id!==mapping.closingId||p.closing?.revision!==mapping.revision)conflict('تغطية السلفة تغيرت بعد العكس');}
 await provePartnershipJournal(tx,p.originalId,p.amount,p.counterCode,"1000");return row;
}
async function provePosted(tx:PartnershipExecutor,p:Proof,reverseId:number){
 const row=await proveImmutable(tx,p),reversals=await children(tx,p.originalId),reverse=one(reversals,"عكس الصرف الأصلي مفقود أو مكرر"),r=snapshot(reverse);
 if(r.id!==reverseId||Number(row.reversal_txn_id)!==reverseId||Number(row.reversed_by)!==p.actorId||row.reversal_reason!==p.reason||time(row.reversed_at)!==time(reverse.reversed_at)||reverse.reversed_transaction_id!==p.originalId||reverse.reversal_txn_id!=null||reverse.reversal_reason!==p.reason||Number(reverse.reversed_by)!==p.actorId||r.approvedBy!==p.actorId||r.executedBy!==p.actorId||r.executedAt<String(p.original.executedAt)||r.direction!=="revenue"||r.amount!==p.amount||r.sourceType!==p.sourceType||r.sourceId!==p.sourceId||r.sourceEvent!=="reversal"||r.transactionType!==`${p.transactionType}_reversal`||r.idempotencyKey!==p.key||r.paymentMethod!==p.original.paymentMethod||r.department!==p.original.department||signed(r.balanceAfter)-signed(r.balanceBefore)!==parseMoney(p.amount))conflict("إثبات عكس الصرف لا يطابق الأصل والقيمة وحركة الصندوق");
 await provePartnershipJournal(tx,reverseId,p.amount,"1000",p.counterCode);return reverse;
}
/** Actorless immutable history proof for source-owned replay/driver sync. The
 * caller owns authorization/root locking. No mutable admission or reconciliation. */
export async function provePartnershipCashReversalHistory(tx:PartnershipExecutor,originalId:number):Promise<PartnershipCashReversalPlan>{
 partnershipId(originalId);const audit=await saved(tx,originalId);if(!audit)conflict("الحركة المعكوسة بلا سجل عكس شراكة موثق");const p=checkedProof(audit.proof),reverseId=partnershipId(Number(audit.reverseId));
 if(p.originalId!==originalId||audit.vehicleId!==p.vehicleId||audit.partnershipId!==p.partnershipId||audit.proofDigest!==hash(p))conflict("بصمة سجل العكس أو نطاق المركبة غير مطابق");
 await provePosted(tx,p,reverseId);return plan(p,true,reverseId);
}

/** Internal source-owned proof operations; no writers or canonical callbacks. */
export const cashReversalProof={rules,hash,checkedProof,plan,original,request,allocations,children,saved,proveImmutable,provePosted,object,one,conflict,snapshot,signed,commandFingerprint,operationKey};
