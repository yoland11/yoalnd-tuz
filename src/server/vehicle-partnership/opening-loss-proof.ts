import {sql} from 'drizzle-orm';
import {canonicalPartnershipJson} from '../../lib/vehicle-partnership/canonical';
import {periodDigest} from '../../lib/vehicle-partnership/period-attributions';
import {openingLossDeclaration,openingLossDeclarationSchema,type OpeningLossDeclaration,type ApprovedOpeningLoss} from '../../lib/vehicle-partnership/opening-loss';
import {parseMoney,formatMoney} from '../../lib/vehicle-partnership/money';
import {partnershipId} from './agreements';
import {provePartnershipJournal} from './journal';
import {partnershipRows,PartnershipRepositoryError,type PartnershipExecutor} from './repository';
type Row=Record<string,unknown>;type Root={id:number;vehicleId:number};
function fail(message:string):never{throw new PartnershipRepositoryError(message,409,'CONFLICT');}
function object(value:unknown):Row{if(!value||typeof value!=='object'||Array.isArray(value))return fail('إثبات الخسارة الافتتاحية غير مكتمل');return value as Row;}
export type OpeningDeclarationRecord={id:number;declaration:OpeningLossDeclaration;sourceSnapshot:OpeningLossDeclaration&{declarationId:number};sourceDigest:string;operationKey:string;fingerprint:string};
function declaration(row:Row,root:Root):OpeningDeclarationRecord{
 const values=object(row.new_values),parsed=openingLossDeclarationSchema.safeParse(values.declaration);if(!parsed.success)fail('صيغة تصريح الخسارة الافتتاحية غير صالحة');const d=parsed.data,id=partnershipId(Number(row.id));
 if(values.vehicleId!==root.vehicleId||values.partnershipId!==root.id||d.vehicleId!==root.vehicleId||d.partnershipId!==root.id||d.actorId!==Number(row.actor_id)||values.declarationDigest!==periodDigest(d)||typeof values.operationKey!=='string'||typeof values.fingerprint!=='string')fail('هوية أو بصمة تصريح الخسارة الافتتاحية غير مطابقة');
 const sourceSnapshot={...d,declarationId:id};return {id,declaration:d,sourceSnapshot,sourceDigest:periodDigest(sourceSnapshot),operationKey:values.operationKey,fingerprint:values.fingerprint};
}
export async function readOpeningDeclarations(tx:PartnershipExecutor,root:Root){
 const rows=partnershipRows(await tx.execute(sql`/* vp_opening_declarations */ SELECT id,actor_id,new_values FROM financial_audit_logs WHERE action='vehicle_partnership_opening_declared' AND new_values->>'partnershipId'=${String(root.id)} AND new_values->>'vehicleId'=${String(root.vehicleId)} ORDER BY id LIMIT 81`));if(rows.length>80)throw new PartnershipRepositoryError('سجل إثباتات الخسارة الافتتاحية يتجاوز حد المراجعة',409,'LIMIT_EXCEEDED');return rows.map(row=>declaration(row,root));
}
export async function readOpeningDeclaration(tx:PartnershipExecutor,root:Root,id:number){
 partnershipId(id);const rows=partnershipRows(await tx.execute(sql`/* vp_opening_declaration */ SELECT id,actor_id,new_values FROM financial_audit_logs WHERE id=${id} AND action='vehicle_partnership_opening_declared' AND new_values->>'partnershipId'=${String(root.id)} AND new_values->>'vehicleId'=${String(root.vehicleId)} LIMIT 2`));if(!rows.length)throw new PartnershipRepositoryError('مصدر إثبات الخسارة الافتتاحية غير موجود',404,'NOT_FOUND');if(rows.length!==1)fail('مصدر إثبات الخسارة الافتتاحية مكرر');return declaration(rows[0],root);
}
export async function openingFinancial(tx:PartnershipExecutor,d:OpeningDeclarationRecord,lock=false):Promise<Row|null>{
 const rows=partnershipRows(await tx.execute(sql`/* vp_opening_financial */ SELECT f.*,f.transaction_date::date::text AS transaction_date,f.amount::text AS amount,a.new_values AS request_values,coalesce((SELECT sum(r.amount) FROM financial_transactions r WHERE r.reversed_transaction_id=f.id AND r.approval_status='executed'),0)::text AS reversed_amount,EXISTS(SELECT 1 FROM financial_transactions r WHERE r.reversed_transaction_id=f.id AND r.approval_status='executed' AND (r.source_type IS DISTINCT FROM f.source_type OR r.source_id IS DISTINCT FROM f.source_id OR r.source_event IS DISTINCT FROM 'reversal' OR r.transaction_type IS DISTINCT FROM 'vp_opening_loss_reversal' OR r.direction IS DISTINCT FROM 'expense' OR r.amount<=0 OR r.balance_before IS NOT NULL OR r.balance_after IS NOT NULL)) AS invalid_reversal FROM financial_transactions f LEFT JOIN financial_audit_logs a ON a.transaction_id=f.id AND a.action='vehicle_partnership_financial_requested' WHERE f.source_type='vehicle_partnership_opening' AND f.source_id=${String(d.id)} AND f.source_event='opening_loss' AND f.reversed_transaction_id IS NULL ORDER BY f.id,a.id LIMIT 3 ${lock?sql`FOR UPDATE OF f`:sql``}`));
 if(!rows.length)return null;if(rows.length!==1)fail('طلب إثبات الخسارة الافتتاحية مكرر أو بلا مصدر وحيد');const f=rows[0],request=object(f.request_values),p=d.declaration;
 if(f.source_type!=='vehicle_partnership_opening'||String(f.source_id)!==String(d.id)||f.source_event!=='opening_loss'||f.transaction_type!=='vp_opening_loss'||f.direction!=='revenue'||formatMoney(parseMoney(String(f.amount)))!==p.amount||f.transaction_date!==p.effectiveFrom||f.payment_method!=='other'||f.department!=='transportation'||f.idempotency_key!==`vp:opening-loss:${d.id}`||f.balance_before!=null||f.balance_after!=null||f.reversed_transaction_id!=null||request.vehicleId!==p.vehicleId||request.partnershipId!==p.partnershipId||request.sourceType!==f.source_type||Number(request.sourceId)!==d.id||request.sourceDigest!==d.sourceDigest||request.amount!==p.amount||canonicalPartnershipJson(request.sourceSnapshot)!==canonicalPartnershipJson(d.sourceSnapshot)||f.invalid_reversal!==false)fail('قيد الخسارة الافتتاحية لا يطابق التصريح والمصدر غير النقدي');
 if(!['pending','executed','rejected','cancelled'].includes(String(f.approval_status)))fail('حالة إثبات الخسارة الافتتاحية غير معروفة');return f;
}
export function proveOpeningAgreement(d:OpeningDeclarationRecord,first:unknown){
 const p=d.declaration,expected=openingLossDeclaration(first,{vehicleId:p.vehicleId,partnershipId:p.partnershipId,actorId:p.actorId,reference:p.reference,reason:p.reason});if(canonicalPartnershipJson(expected)!==canonicalPartnershipJson(p))fail('إثبات الخسارة لا يطابق الاتفاق الأول ونسب أطرافه الأصلية');
}
function approvalTime(value:unknown):number{const time=value instanceof Date?value.getTime():new Date(String(value)).getTime();if(value==null||!Number.isFinite(time))fail('إثبات تاريخ اعتماد الخسارة غير مكتمل');return time;}
export async function proveOpeningApproval(tx:PartnershipExecutor,d:OpeningDeclarationRecord,f:Row):Promise<ApprovedOpeningLoss>{
 const actor=partnershipId(Number(f.approved_by));if(f.approval_status!=='executed'||Number(f.executed_by)!==actor||approvalTime(f.executed_at)<approvalTime(f.approved_at))fail('الخسارة الافتتاحية تحتاج موافقة مالية منفذة موثقة');
 await provePartnershipJournal(tx,partnershipId(Number(f.id)),d.declaration.amount,'VP-LOSS','VP-OPENING-CLEAR');
 const audits=partnershipRows(await tx.execute(sql`/* vp_opening_approval */ SELECT id,actor_id,new_values FROM financial_audit_logs WHERE transaction_id=${Number(f.id)} AND action='vehicle_partnership_opening_approved' ORDER BY id LIMIT 2`));
 if(audits.length!==1)fail('اعتماد الخسارة الافتتاحية بلا سجل مصدر وحيد');const a=audits[0],v=object(a.new_values),p=d.declaration;
 if(Number(a.actor_id)!==actor||v.vehicleId!==p.vehicleId||v.partnershipId!==p.partnershipId||v.declarationId!==d.id||v.sourceDigest!==d.sourceDigest||v.amount!==p.amount||v.status!=='executed'||v.cashImpact!=='none')fail('سجل اعتماد الخسارة الافتتاحية غير مطابق');
 return {...p,declarationId:d.id,financialTransactionId:Number(f.id),sourceDigest:d.sourceDigest};
}
/** Immutable reversal evidence, independent of today's admission rules. */
export async function proveOpeningReversal(tx:PartnershipExecutor,d:OpeningDeclarationRecord,f:Row){
 await proveOpeningApproval(tx,d,f);const originalId=partnershipId(Number(f.id)),reverseId=partnershipId(Number(f.reversal_txn_id)),actor=partnershipId(Number(f.reversed_by));
 if(parseMoney(String(f.reversed_amount))!==parseMoney(d.declaration.amount)||f.invalid_reversal!==false||approvalTime(f.reversed_at)<approvalTime(f.executed_at))fail('عكس الخسارة الافتتاحية يجب أن يكون كاملاً وموثقاً');
 const rows=partnershipRows(await tx.execute(sql`/* vp_opening_reverse_proof */ SELECT *,amount::text AS amount FROM financial_transactions WHERE reversed_transaction_id=${originalId} ORDER BY id LIMIT 2`));
 if(rows.length!==1)fail('عكس الخسارة الافتتاحية لا يملك قيداً أصلياً وحيداً');const r=rows[0];
 if(Number(r.id)!==reverseId||Number(r.reversed_transaction_id)!==originalId||r.source_type!=='vehicle_partnership_opening'||String(r.source_id)!==String(d.id)||r.source_event!=='reversal'||r.transaction_type!=='vp_opening_loss_reversal'||r.direction!=='expense'||r.approval_status!=='executed'||formatMoney(parseMoney(String(r.amount)))!==d.declaration.amount||r.balance_before!=null||r.balance_after!=null||r.payment_method!=='other'||r.department!=='transportation'||Number(r.approved_by)!==actor||Number(r.executed_by)!==actor||Number(r.requested_by)!==actor||r.reversal_reason!==f.reversal_reason||approvalTime(r.executed_at)<approvalTime(r.approved_at)||approvalTime(r.approved_at)<approvalTime(f.executed_at))fail('هوية عكس الخسارة الافتتاحية لا تطابق القيد الأصلي');
 await provePartnershipJournal(tx,reverseId,d.declaration.amount,'VP-OPENING-CLEAR','VP-LOSS');
 const audits=partnershipRows(await tx.execute(sql`/* vp_opening_reverse_audit */ SELECT id,actor_id,new_values FROM financial_audit_logs WHERE transaction_id=${originalId} AND action='vehicle_partnership_opening_reversed' ORDER BY id LIMIT 2`)),v=audits.length===1?object(audits[0].new_values):{};
 if(audits.length!==1||Number(audits[0].actor_id)!==actor||v.partnershipId!==d.declaration.partnershipId||v.vehicleId!==d.declaration.vehicleId||v.declarationId!==d.id||v.reverseId!==reverseId||v.sourceDigest!==d.sourceDigest||v.amount!==d.declaration.amount||v.key!==r.idempotency_key||v.status!=='reversed'||v.cashImpact!=='none'||typeof v.fingerprint!=='string')fail('إثبات سجل عكس الخسارة الافتتاحية غير مطابق');
 return {reverseId,key:String(v.key),fingerprint:String(v.fingerprint)};
}
export async function readOpeningLossState(tx:PartnershipExecutor,root:Root,first:unknown){
 const declarations=await readOpeningDeclarations(tx,root),items:Array<{d:OpeningDeclarationRecord;f:Row;status:string;proof:ApprovedOpeningLoss|null}>=[];
 for(const d of declarations){proveOpeningAgreement(d,first);const f=await openingFinancial(tx,d);if(!f)fail('تصريح خسارة افتتاحية بلا طلب مالي أصلي');let status=String(f.approval_status),proof:ApprovedOpeningLoss|null=null;
  const reversed=parseMoney(String(f.reversed_amount));if(status!=='executed'&&(reversed>0n||f.reversal_txn_id!=null||f.reversed_at!=null))fail('إثبات خسارة غير منفذ عليه سجل عكس غير مطابق');
  if(status==='executed'){proof=await proveOpeningApproval(tx,d,f);if(reversed>0n||f.reversal_txn_id!=null||f.reversed_at!=null){await proveOpeningReversal(tx,d,f);status='reversed';proof=null;}}
  items.push({d,f,status,proof});
 }
 const active=items.filter(item=>['pending','executed'].includes(item.status));if(active.length>1)fail('يوجد أكثر من إثبات خسارة افتتاحية فعال');const current=active[0]??items.at(-1);
 return current?{status:current.status==='executed'?'approved':current.status,declarationId:current.d.id,financialTransactionId:partnershipId(Number(current.f.id)),amount:current.d.declaration.amount,reference:current.d.declaration.reference,proof:current.proof}:{status:'unproven',declarationId:null,financialTransactionId:null,amount:null,reference:null,proof:null};
}
export async function readApprovedOpeningLoss(tx:PartnershipExecutor,root:Root,first:unknown):Promise<ApprovedOpeningLoss|null>{return (await readOpeningLossState(tx,root,first)).proof;}
export const openingLossStore={readDeclarations:readOpeningDeclarations,readDeclaration:readOpeningDeclaration,financial:openingFinancial,proveAgreement:proveOpeningAgreement,proveApproval:proveOpeningApproval,proveReversal:proveOpeningReversal,object,fail};
