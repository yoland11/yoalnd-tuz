import {sql} from 'drizzle-orm';
import {z} from 'zod/v4';
import {periodDigest,periodSourceDigest,projectPeriodAttributions} from '../../lib/vehicle-partnership/period-attributions';
import {closingMonthBounds} from '../../lib/vehicle-partnership/closing';
import {formatMoney,parseMoney} from '../../lib/vehicle-partnership/money';
import {PartnershipValidationError} from '../../lib/vehicle-partnership/types';
import {authorizePartnership,partnershipId,readOriginalVehicle,type PartnershipActor,type PartnershipDatabase} from './agreements';
import {lockClosingOriginalSources} from './closing-locks';
import {readClosingSourceEvidence} from './closing-source-repository';
import {appendPartnershipAudit,lockPartnership,partnershipRows,PartnershipRepositoryError,type PartnershipExecutor} from './repository';
import {readPeriodAttributions,provePeriodJournal,periodAttributionStore} from './period-attribution-proof';
type Root={id:number;vehicleId:number;version:number;ownershipType:string};type Row=Record<string,unknown>;
const {object}=periodAttributionStore;
function fail(message:string):never{return periodAttributionStore.fail(message);}
const nonce=z.string().trim().min(8).max(180),reason=z.string().trim().min(3).max(2000);
const approveSchema=z.object({sourceFinancialTransactionId:z.number().int().positive(),targetMonth:z.string(),expectedSourceDigest:z.string().regex(/^[a-f0-9]{64}$/),expectedVersion:z.number().int().nonnegative(),reference:z.string().trim().min(3).max(240),reason,idempotencyKey:nonce}).strict();
const revokeSchema=z.object({attributionId:z.number().int().positive(),reason,idempotencyKey:nonce}).strict();
function parse<T>(schema:z.ZodType<T>,input:unknown):T{const parsed=schema.safeParse(input);if(!parsed.success)throw new PartnershipValidationError(parsed.error.issues.map(i=>i.message).join('؛ '));return parsed.data;}
const opKey=(root:Root,actor:PartnershipActor,nonce:string,action:string)=>`vp:period:${periodDigest({root:root.id,actor:actor.id,nonce,action})}`;
async function operation(tx:PartnershipExecutor,root:Root,key:string){const rows=partnershipRows(await tx.execute(sql`/* vp_period_operation */ SELECT id,transaction_id,actor_id,action,new_values FROM financial_audit_logs WHERE new_values->>'partnershipId'=${String(root.id)} AND new_values->>'vehicleId'=${String(root.vehicleId)} AND new_values->>'operationKey'=${key} AND action IN ('vehicle_partnership_period_attribution_approved','vehicle_partnership_period_attribution_revoked') ORDER BY id LIMIT 2`));if(rows.length>1)fail('مرجع تسوية الفترة مكرر');return rows[0]??null;}
async function unused(tx:PartnershipExecutor,root:Root,key:string){const rows=partnershipRows(await tx.execute(sql`/* vp_period_consumed */ SELECT h.id,h.status FROM vehicle_partnership_closing_lines l JOIN vehicle_partnership_closings h ON h.id=l.closing_id WHERE h.partnership_id=${root.id} AND l.revision=h.revision AND l.source_key=${key} AND h.status IN ('pending','approved','distributed') ORDER BY h.id LIMIT 2`));if(rows.length)fail('المصدر مستخدم في إغلاق معتمد أو بانتظار الموافقة؛ لا يمكن نقله إلى فترة أخرى');}
async function target(tx:PartnershipExecutor,root:Root,month:string){const range=closingMonthBounds(month),rows=partnershipRows(await tx.execute(sql`/* vp_period_target */ SELECT id,status FROM vehicle_partnership_closings WHERE partnership_id=${root.id} AND period=${range.from}::date LIMIT 2`));if(rows.length>1||rows.some(r=>!['draft','review'].includes(String(r.status))))fail('شهر التسوية معتمد أو بانتظار الموافقة؛ اختر شهراً مفتوحاً');return range;}
function result(row:Row,root:Root){const values=object(row.new_values);if(row.action==='vehicle_partnership_period_attribution_revoked'){const p=object(values.revocation);if(values.revocationDigest!==periodDigest(p)||Number(row.actor_id)!==p.actorId)fail('إثبات إلغاء التسوية غير مطابق');return {attributionId:partnershipId(Number(p.attributionId)),sourceKey:String(p.sourceKey),status:'revoked' as const};}const checked=periodAttributionStore.checkedAudits([row],root),p=checked.active[0];if(!p)fail('إثبات تسوية الفترة غير موجود');return {attributionId:p.attributionId,sourceKey:p.sourceKey,targetDate:p.targetDate,status:'approved' as const};}
/** Explicit administrative classification of an ALREADY APPROVED original
 * event only. No amount override, financial request, cash or journal writer. */
export async function approvePeriodAttribution(db:PartnershipDatabase,actor:PartnershipActor,vehicleId:number,input:unknown){
 authorizePartnership(actor,true);partnershipId(vehicleId);const command=parse(approveSchema,input),range=closingMonthBounds(command.targetMonth);
 return db.transaction(async tx=>{const root=await lockPartnership(tx,vehicleId);await readOriginalVehicle(tx,actor,vehicleId);const operationKey=opKey(root,actor,command.idempotencyKey,'approve'),fingerprint=periodDigest({actorId:actor.id,vehicleId,command}),prior=await operation(tx,root,operationKey);
  if(prior){if(object(prior.new_values).fingerprint!==fingerprint)fail('مرجع التسوية مستخدم لبيانات مختلفة');return result(prior,root);}
  if(root.ownershipType!=='partnership'||root.version!==command.expectedVersion)fail('تغير اتفاق الشراكة؛ حدّث البيانات قبل اعتماد التسوية');
  await lockClosingOriginalSources(tx,actor,vehicleId,command.targetMonth);await target(tx,root,command.targetMonth);const evidence=await readClosingSourceEvidence(tx,actor,vehicleId,command.targetMonth),key=`financial:${command.sourceFinancialTransactionId}`,source=evidence.historySources.find(s=>s.key===key),snapshot=evidence.historySnapshots.find(s=>s.key===key)?.snapshot;
  if(!source||!snapshot||source.date>=range.from||source.approved!==true||parseMoney(source.amount)<=0n||periodSourceDigest(source,snapshot)!==command.expectedSourceDigest)fail('المصدر المالي غير معتمد أو لا يطابق الفترة السابقة وبصمتها');
  await unused(tx,root,key);const active=await readPeriodAttributions(tx,root,[source],[{key,snapshot}]);if(active.some(p=>p.sourceKey===key))fail('للمصدر تسوية فترة معتمدة بالفعل');
  const proof={formatVersion:1 as const,vehicleId,partnershipId:root.id,actorId:actor.id,sourceKey:key,sourceDigest:command.expectedSourceDigest,targetDate:range.from,reason:command.reason,reference:command.reference,journalDigest:await provePeriodJournal(tx,command.sourceFinancialTransactionId,source.amount)};
  await appendPartnershipAudit(tx,{vehicleId,partnershipId:root.id,actor,action:'period_attribution_approved',reason:command.reason,financialTransactionId:command.sourceFinancialTransactionId,newValues:{proof,proofDigest:periodDigest(proof),operationKey,fingerprint,cashImpact:'none',newExpense:false}});
  const saved=await operation(tx,root,operationKey);if(!saved)throw new Error('Period attribution audit insert was not confirmed');return result(saved,root);
 });
}
export async function revokePeriodAttribution(db:PartnershipDatabase,actor:PartnershipActor,vehicleId:number,input:unknown){
 authorizePartnership(actor,true);partnershipId(vehicleId);const command=parse(revokeSchema,input);
 return db.transaction(async tx=>{const root=await lockPartnership(tx,vehicleId);await readOriginalVehicle(tx,actor,vehicleId);const operationKey=opKey(root,actor,command.idempotencyKey,'revoke'),fingerprint=periodDigest({actorId:actor.id,vehicleId,command}),prior=await operation(tx,root,operationKey);if(prior){if(object(prior.new_values).fingerprint!==fingerprint)fail('مرجع إلغاء التسوية مستخدم لبيانات مختلفة');return result(prior,root);}
  const checked=periodAttributionStore.checkedAudits(await periodAttributionStore.readEvents(tx,root),root),original=checked.approved.get(command.attributionId);if(!original||checked.revoked.has(command.attributionId))fail('التسوية غير موجودة أو ملغاة بالفعل');
  await lockClosingOriginalSources(tx,actor,vehicleId,original.targetDate.slice(0,7));await target(tx,root,original.targetDate.slice(0,7));await unused(tx,root,original.sourceKey);
  const revocation={attributionId:original.attributionId,sourceKey:original.sourceKey,sourceDigest:original.sourceDigest,actorId:actor.id,reason:command.reason};
  await appendPartnershipAudit(tx,{vehicleId,partnershipId:root.id,actor,action:'period_attribution_revoked',reason:command.reason,financialTransactionId:Number(original.sourceKey.slice(10)),newValues:{revocation,revocationDigest:periodDigest(revocation),operationKey,fingerprint,cashImpact:'none'}});const saved=await operation(tx,root,operationKey);if(!saved)throw new Error('Period revocation audit insert was not confirmed');return result(saved,root);
 });
}
export async function readPeriodAttributionReview(db:PartnershipDatabase,actor:PartnershipActor,vehicleId:number,month:string){
 authorizePartnership(actor,true);partnershipId(vehicleId);const range=closingMonthBounds(month);
 return db.transaction(async tx=>{const root=await lockPartnership(tx,vehicleId);await readOriginalVehicle(tx,actor,vehicleId);const evidence=await readClosingSourceEvidence(tx,actor,vehicleId,month),attributions=await readPeriodAttributions(tx,root,evidence.historySources,evidence.historySnapshots),consumed=partnershipRows(await tx.execute(sql`/* vp_period_consumed_review */ SELECT DISTINCT l.source_key FROM vehicle_partnership_closing_lines l JOIN vehicle_partnership_closings h ON h.id=l.closing_id WHERE h.partnership_id=${root.id} AND l.revision=h.revision AND h.status IN ('pending','approved','distributed') AND l.source_key LIKE 'financial:%' LIMIT 10001`));if(consumed.length>10000)throw new PartnershipRepositoryError('سجل المصادر المستخدمة يتجاوز حد المراجعة',409,'LIMIT_EXCEEDED');const used=new Set(consumed.map(r=>String(r.source_key)));
  const candidates=evidence.historySources.filter(source=>source.approved&&source.date<range.from&&!used.has(source.key)&&!attributions.some(p=>p.sourceKey===source.key)).map(source=>{const snapshot=evidence.historySnapshots.find(s=>s.key===source.key)?.snapshot;if(!snapshot)fail('إثبات المصدر غير موجود');return {financialTransactionId:Number(source.key.slice(10)),sourceKey:source.key,kind:source.kind,date:source.date,basisDate:source.basisDate,agreementId:source.agreementId,amount:source.amount,sourceDigest:periodSourceDigest(source,snapshot!)};});
  return {vehicleId,partnershipId:root.id,version:root.version,targetMonth:month,candidates,attributions};
 });
}
