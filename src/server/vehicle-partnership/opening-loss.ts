import {sql} from 'drizzle-orm';
import {z} from 'zod/v4';
import {periodDigest} from '../../lib/vehicle-partnership/period-attributions';
import {openingLossDeclaration} from '../../lib/vehicle-partnership/opening-loss';
import {formatMoney,parseMoney} from '../../lib/vehicle-partnership/money';
import {PartnershipValidationError} from '../../lib/vehicle-partnership/types';
import {authorizePartnership,partnershipId,readOriginalVehicle,readVehiclePartnership,type PartnershipActor,type PartnershipDatabase} from './agreements';
import {appendPartnershipAudit,lockPartnership,partnershipRows,PartnershipRepositoryError,type PartnershipExecutor} from './repository';
import type {PartnershipFinancialRequestWriter,TrustedPartnershipRequest} from './accounting';
import {openingLossStore,readOpeningLossState} from './opening-loss-proof';
const commandSchema=z.object({expectedVersion:z.number().int().nonnegative(),reference:z.string().trim().min(3).max(240),reason:z.string().trim().min(3).max(2000),idempotencyKey:z.string().trim().min(8).max(180)}).strict();
function fail(message:string):never{return openingLossStore.fail(message);}
async function firstAgreement(tx:PartnershipExecutor,actor:PartnershipActor,vehicleId:number){const setup=await readVehiclePartnership(tx,actor,vehicleId),first=setup.partnership?.agreements.filter(g=>['approved','superseded'].includes(g.status)).sort((a,b)=>a.effectiveFrom.localeCompare(b.effectiveFrom)||a.revision-b.revision)[0];if(!first)fail('اعتمد الاتفاق الأول قبل توثيق الخسارة الافتتاحية');return first;}
function dto(id:number,f:Record<string,unknown>,amount:string){return {declarationId:id,financialTransactionId:partnershipId(Number(f.id)),status:String(f.approval_status),amount};}
export async function readOpeningLossReview(db:PartnershipDatabase,actor:PartnershipActor,vehicleId:number){
 authorizePartnership(actor,true);partnershipId(vehicleId);return db.transaction(async tx=>{const root=await lockPartnership(tx,vehicleId);await readOriginalVehicle(tx,actor,vehicleId);const first=await firstAgreement(tx,actor,vehicleId);if(typeof first.policy.openingLoss!=='string')fail('حدد الخسارة الافتتاحية في الاتفاق الأول قبل إثباتها');const declaredAmount=formatMoney(parseMoney(first.policy.openingLoss)),state=await readOpeningLossState(tx,root,first);return {vehicleId,partnershipId:root.id,version:root.version,agreementId:first.id,effectiveFrom:first.effectiveFrom,declaredAmount,...state,status:declaredAmount==='0.00'?'not_needed':state.status};});
}
export async function lockOpeningLossContext(tx:PartnershipExecutor,actor:PartnershipActor,declarationId:number){
 authorizePartnership(actor,true);partnershipId(declarationId);
 const scopes=partnershipRows(await tx.execute(sql`/* vp_opening_scope */ SELECT new_values->>'vehicleId' AS vehicle_id FROM financial_audit_logs WHERE id=${declarationId} AND action='vehicle_partnership_opening_declared' LIMIT 2`));if(scopes.length!==1)fail('مصدر إثبات الخسارة الافتتاحية غير موجود');const vehicleId=partnershipId(Number(scopes[0].vehicle_id)),root=await lockPartnership(tx,vehicleId);await readOriginalVehicle(tx,actor,vehicleId);
 const declaration=await openingLossStore.readDeclaration(tx,root,declarationId),first=await firstAgreement(tx,actor,vehicleId);openingLossStore.proveAgreement(declaration,first);
 return {root,declaration,first,financial:await openingLossStore.financial(tx,declaration,true)};
}
export async function prepareOpeningLossRequest(tx:PartnershipExecutor,reference:{sourceType:'vehicle_partnership_opening';sourceId:number},actor:PartnershipActor):Promise<TrustedPartnershipRequest>{
 authorizePartnership(actor,true);const parsed=z.object({sourceType:z.literal('vehicle_partnership_opening'),sourceId:z.number().int().positive()}).strict().safeParse(reference);if(!parsed.success)throw new PartnershipValidationError('مرجع إثبات الخسارة الافتتاحية غير صالح');
 const {root,declaration:d,financial:existing}=await lockOpeningLossContext(tx,actor,reference.sourceId),vehicleId=root.vehicleId;
 if(root.ownershipType!=='partnership')fail('طلب خسارة افتتاحية جديد يحتاج شراكة فعالة');if(existing&&existing.approval_status!=='pending')fail('إثبات الخسارة مرتبط بطلب مالي سابق؛ راجع حالته الأصلية');
 return {sourceType:'vehicle_partnership_opening',sourceId:d.id,sourceEvent:'opening_loss',transactionType:'vp_opening_loss',direction:'revenue',amount:d.declaration.amount,transactionDate:d.declaration.effectiveFrom,department:'transportation',description:`إثبات خسارة افتتاحية لشراكة المركبة — ${d.declaration.reference}`,referenceNo:d.declaration.reference,idempotencyKey:`vp:opening-loss:${d.id}`,partnershipId:root.id,vehicleId,sourceDigest:d.sourceDigest,sourceSnapshot:d.sourceSnapshot,linkedFinancialTransactionId:existing?partnershipId(Number(existing.id)):null};
}
/** Explicit evidence declaration, not cash receipt or management approval.
 * Declaration + existing central pending FI are one transaction. */
export async function requestOpeningLoss(db:PartnershipDatabase,actor:PartnershipActor,vehicleId:number,input:unknown,writer:PartnershipFinancialRequestWriter){
 authorizePartnership(actor,true);partnershipId(vehicleId);const parsed=commandSchema.safeParse(input);if(!parsed.success)throw new PartnershipValidationError(parsed.error.issues.map(i=>i.message).join('؛ '));const command=parsed.data,operationKey=`vp:opening:${periodDigest({vehicleId,actorId:actor.id,nonce:command.idempotencyKey})}`,fingerprint=periodDigest({vehicleId,actorId:actor.id,command});
 return db.transaction(async tx=>{const root=await lockPartnership(tx,vehicleId);await readOriginalVehicle(tx,actor,vehicleId);const declarations=await openingLossStore.readDeclarations(tx,root),prior=declarations.filter(d=>d.operationKey===operationKey);
  if(prior.length){if(prior.length!==1||prior[0].fingerprint!==fingerprint)fail('مرجع إثبات الخسارة مستخدم لبيانات مختلفة');const financial=await openingLossStore.financial(tx,prior[0]);if(!financial)fail('إثبات الخسارة بلا طلب مالي أصلي');return dto(prior[0].id,financial,prior[0].declaration.amount);}
  if(root.ownershipType!=='partnership'||root.version!==command.expectedVersion)fail('تغير اتفاق الشراكة؛ حدّث البيانات قبل إثبات الخسارة');const first=await firstAgreement(tx,actor,vehicleId),state=await readOpeningLossState(tx,root,first);if(['pending','approved'].includes(state.status))fail('للخسارة الافتتاحية إثبات فعال بالفعل');
  const declaration=openingLossDeclaration(first,{vehicleId,partnershipId:root.id,actorId:actor.id,reference:command.reference,reason:command.reason});
  await appendPartnershipAudit(tx,{vehicleId,partnershipId:root.id,actor,action:'opening_declared',reason:command.reason,newValues:{declaration,declarationDigest:periodDigest(declaration),operationKey,fingerprint,cashImpact:'none'}});
  const created=(await openingLossStore.readDeclarations(tx,root)).filter(d=>d.operationKey===operationKey);if(created.length!==1)throw new Error('Opening declaration insert was not confirmed');const d=created[0],financial=await writer(tx,{sourceType:'vehicle_partnership_opening',sourceId:d.id},actor);
  if(financial.approvalStatus!=='pending')fail('إثبات الخسارة يبدأ بطلب مالي معلق فقط');const actual=await openingLossStore.financial(tx,d);if(!actual||Number(actual.id)!==financial.id||actual.approval_status!=='pending')fail('تعذر تأكيد طلب إثبات الخسارة المعلق');return dto(d.id,actual,d.declaration.amount);
 });
}
