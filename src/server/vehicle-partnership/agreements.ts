import {createHash} from "node:crypto";
import {sql} from "drizzle-orm";
import {z} from "zod/v4";
import {validateAgreement} from "../../lib/vehicle-partnership/domain";
import {parseMoney,formatMoney} from "../../lib/vehicle-partnership/money";
import {PartnershipValidationError,type PartyReference} from "../../lib/vehicle-partnership/types";
import {appendPartnershipAudit,assertPartnershipSchema,partnershipRows,PartnershipRepositoryError,type PartnershipExecutor} from "./repository";

export type PartnershipActor={id:number;name:string;role:string;permissions:readonly string[];isActive:boolean;allowedBranchIds?:readonly number[]};
export type PartnershipDatabase=PartnershipExecutor & {transaction:<T>(work:(tx:PartnershipExecutor)=>Promise<T>)=>Promise<T>};
type Row=Record<string,unknown>;
const conflict=(message:string):never=>{throw new PartnershipRepositoryError(message,409,"CONFLICT");};
export function authorizePartnership(actor:PartnershipActor,approve=false):void{
 if(!actor?.isActive||!Number.isSafeInteger(actor.id)||actor.id<=0||!actor.name?.trim()||
   (approve?actor.role!=="admin":actor.role!=="admin"&&!actor.permissions.includes("accounting")))
  throw new PartnershipRepositoryError("ليس لديك صلاحية إدارة حسابات شراكة المركبة",403,"FORBIDDEN");
}
export function partnershipId(value:unknown):number{
 if(typeof value!=="number"||!Number.isSafeInteger(value)||value<=0)throw new PartnershipValidationError("معرّف السجل غير صالح");
 return value;
}
function branchAccess(actor:PartnershipActor,row:Row):void{
 // Existing AJN accounting permission is global. Apply a narrower trusted
 // server scope if supplied; never obtain allowed branches from the request.
 if(actor.role!=="admin"&&actor.allowedBranchIds&&row.branch_id!=null&&!actor.allowedBranchIds.includes(Number(row.branch_id)))
  throw new PartnershipRepositoryError("المركبة خارج نطاق الفرع المسموح",403,"FORBIDDEN");
}
export async function readOriginalVehicle(tx:PartnershipExecutor,actor:PartnershipActor,vehicleId:number,lock=false):Promise<Row>{
 partnershipId(vehicleId);
 const rows=partnershipRows(await tx.execute(sql`SELECT id,branch_id,is_active,name,plate_number,purchase_date,purchase_price FROM fleet_vehicles WHERE id=${vehicleId} ${lock?sql`FOR KEY SHARE`:sql``}`));
 if(rows.length===0)throw new PartnershipRepositoryError("المركبة الأصلية غير موجودة",404,"NOT_FOUND");
 if(rows.length!==1||Number(rows[0].id)!==vehicleId)throw new Error("Invalid original partnership vehicle identity");
 branchAccess(actor,rows[0]);return rows[0];
}
async function rootRows(tx:PartnershipExecutor,lock=false):Promise<Row[]>{
 const rows=partnershipRows(await tx.execute(sql`SELECT id,vehicle_id,ownership_type,registration_owner,version FROM vehicle_partnerships ${lock?sql`FOR UPDATE`:sql``}`));
 if(rows.length>1)throw new Error("Invalid single-vehicle partnership configuration");return rows;
}
async function agreementHistory(tx:PartnershipExecutor,rootId:number):Promise<Row[]>{
 const rows=partnershipRows(await tx.execute(sql`/* vp_agreement_history */ SELECT id,partnership_id,revision,effective_from::text,status,policy,notes,idempotency_key,approved_at FROM vehicle_partnership_agreements WHERE partnership_id=${rootId} ORDER BY effective_from DESC,revision DESC LIMIT 81`));
 if(rows.length>80)throw new PartnershipRepositoryError("سجل الاتفاقات يتجاوز حد العرض؛ يلزم عرض مقسم قبل المتابعة",409,"LIMIT_EXCEEDED");return rows;
}
function record(value:unknown):Row{if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Invalid partnership stored policy");return value as Row;}
function memberDto(m:Row){
 const kind=String(m.party_kind) as PartyReference["kind"];
 if(!["customer","supplier","staff"].includes(kind))throw new Error("Invalid stored party kind");
 return {id:partnershipId(Number(m.id)),party:{kind,id:partnershipId(Number(m[`${kind}_id`]))},name:typeof m.name==="string"?m.name:null,
  ownershipBasisPoints:Number(m.ownership_basis_points),profitBasisPoints:Number(m.profit_basis_points),expenseBasisPoints:Number(m.expense_basis_points),capitalContribution:formatMoney(parseMoney(String(m.capital_contribution)))};
}
async function agreementDto(tx:PartnershipExecutor,a:Row){
 const members=partnershipRows(await tx.execute(sql`/* vp_agreement_members */ SELECT m.*,CASE m.party_kind WHEN 'customer' THEN coalesce(nullif(c.full_name,''),c.name) WHEN 'supplier' THEN s.name WHEN 'staff' THEN coalesce(nullif(st.full_name,''),st.username) END AS name FROM vehicle_partnership_members m LEFT JOIN customers c ON c.id=m.customer_id LEFT JOIN suppliers s ON s.id=m.supplier_id LEFT JOIN staff st ON st.id=m.staff_id WHERE m.agreement_id=${Number(a.id)} ORDER BY m.id`)).map(memberDto);
 if(members.length!==2)throw new Error("Invalid stored partnership member count");
 return {id:Number(a.id),revision:Number(a.revision),effectiveFrom:String(a.effective_from),status:String(a.status),policy:record(a.policy),members};
}
export async function readVehiclePartnership(db:PartnershipExecutor,actor:PartnershipActor,vehicleId:number){
 authorizePartnership(actor);await assertPartnershipSchema(db);
 const vehicle=await readOriginalVehicle(db,actor,vehicleId);const [root]=await rootRows(db);
 if(!root||Number(root.vehicle_id)!==vehicleId)return {vehicle,partnership:null,configuredElsewhere:Boolean(root),canApprove:actor.role==="admin"};
 const history=await agreementHistory(db,Number(root.id));const agreements=[];
 for(const a of history)agreements.push(await agreementDto(db,a));
 return {vehicle,partnership:{id:Number(root.id),ownershipType:String(root.ownership_type),registrationOwner:String(root.registration_owner),version:Number(root.version),agreements},configuredElsewhere:false,canApprove:actor.role==="admin"};
}
const money=z.string().refine(value=>{try{parseMoney(value);return true;}catch{return false;}},"مبلغ غير صالح");
const policySchema=z.object({
 depreciation:z.union([z.object({kind:z.literal("none")}).strict(),z.object({kind:z.literal("configured"),amount:money}).strict()]).nullable().optional(),
 reserve:z.union([z.object({kind:z.literal("none")}).strict(),z.object({kind:z.literal("fixed"),amount:money}).strict(),z.object({kind:z.literal("percent"),basis:z.enum(["after_loss_recovery","recognized_income"]),basisPoints:z.number().int().min(0).max(10000)}).strict()]).nullable().optional(),
 openingLoss:money.nullable().optional(),
}).strict();
const saveSchema=z.object({expectedVersion:z.number().int().nonnegative(),idempotencyKey:z.string().trim().min(8).max(180),reason:z.string().trim().min(1).max(2000),draft:z.unknown(),policy:policySchema.optional(),lossResolution:z.object({kind:z.literal("retain_original_members"),reason:z.string().trim().min(1).max(2000)}).strict().optional()}).strict();
function validated<T>(schema:z.ZodType<T>,input:unknown):T{const result=schema.safeParse(input);if(!result.success)throw new PartnershipValidationError(result.error.issues.map(i=>i.message).join("؛ "));return result.data;}
async function validateParty(tx:PartnershipExecutor,party:PartyReference):Promise<void>{
 const statement=party.kind==="customer"?sql`/* vp_party_lookup */ SELECT id,name FROM customers WHERE id=${party.id} AND status IS DISTINCT FROM 'deleted' FOR KEY SHARE`:
  party.kind==="supplier"?sql`/* vp_party_lookup */ SELECT id,name FROM suppliers WHERE id=${party.id} AND status IS DISTINCT FROM 'deleted' AND is_active IS DISTINCT FROM 0 FOR KEY SHARE`:
  sql`/* vp_party_lookup */ SELECT id,full_name AS name FROM staff WHERE id=${party.id} AND is_active IS DISTINCT FROM false FOR KEY SHARE`;
 if(partnershipRows(await tx.execute(statement)).length!==1)throw new PartnershipValidationError("الشريك المختار غير موجود أو غير متاح في سجلات AJN الأصلية");
}
async function historyBoundary(tx:PartnershipExecutor,rootId:number,effectiveFrom:string):Promise<string>{
 const boundary=partnershipRows(await tx.execute(sql`/* vp_closed_boundary */ SELECT max((period+interval '1 month'-interval '1 day')::date)::text AS closed_through FROM vehicle_partnership_closings WHERE partnership_id=${rootId} AND status IN ('approved','distributed')`));
 if(boundary.length!==1)throw new Error("Invalid partnership closed-period boundary");
 if(boundary[0].closed_through!=null&&effectiveFrom<=String(boundary[0].closed_through))conflict("لا يمكن تغيير اتفاق يغطي شهراً معتمداً؛ استخدم اتفاقاً مستقبلياً");
 const losses=partnershipRows(await tx.execute(sql`/* vp_carried_loss */ SELECT coalesce(sum(CASE WHEN category='loss' THEN amount WHEN category='loss_recovery' THEN -amount ELSE 0 END),0)::text AS amount FROM vehicle_partnership_rights WHERE partnership_id=${rootId} AND status='approved' AND category IN ('loss','loss_recovery')`));
 if(losses.length!==1)throw new Error("Invalid partnership carried loss response");
 return formatMoney(parseMoney(String(losses[0].amount)));
}
async function bumpVersion(tx:PartnershipExecutor,root:Row,registrationOwner?:string):Promise<number>{
 const rows=partnershipRows(await tx.execute(sql`UPDATE vehicle_partnerships SET version=version+1 ${registrationOwner?sql`, registration_owner=${registrationOwner}`:sql``} WHERE id=${Number(root.id)} AND version=${Number(root.version)} RETURNING id,version`));
 if(rows.length!==1)conflict("تغير إعداد الشراكة؛ حدّث الصفحة وأعد المحاولة");return Number(rows[0].version);
}
export async function saveVehicleAgreement(db:PartnershipDatabase,actor:PartnershipActor,vehicleId:number,input:unknown){
 authorizePartnership(actor);partnershipId(vehicleId);const command=validated(saveSchema,input),draft=validateAgreement(command.draft);
 if(draft.vehicleId!==vehicleId)throw new PartnershipValidationError("الاتفاق لا يخص المركبة المحددة");
 const terms={...draft,members:[...draft.members].sort((a,b)=>`${a.party.kind}:${a.party.id}`.localeCompare(`${b.party.kind}:${b.party.id}`))};
 const commandDigest=createHash("sha256").update(JSON.stringify({terms,policy:command.policy??{},lossResolution:command.lossResolution??null,reason:command.reason})).digest("hex");
 return db.transaction(async tx=>{
  await assertPartnershipSchema(tx);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ajn_vehicle_partnership_singleton'))`);
  const vehicle=await readOriginalVehicle(tx,actor,vehicleId,true);if(vehicle.is_active===false)conflict("المركبة غير فعالة");
  let [root]=await rootRows(tx,true);
  if(root&&Number(root.vehicle_id)!==vehicleId)conflict("الشراكة مخصصة لمركبة واحدة؛ توجد مركبة أخرى مرتبطة بها");
  const replay=partnershipRows(await tx.execute(sql`/* vp_agreement_replay */ SELECT * FROM vehicle_partnership_agreements WHERE idempotency_key=${command.idempotencyKey}`));
  if(replay.length){
   if(replay.length!==1||!root||Number(replay[0].partnership_id)!==Number(root.id)||record(replay[0].policy).commandDigest!==commandDigest)conflict("مرجع المحاولة مستخدم لبيانات مختلفة");
   return {agreement:await agreementDto(tx,replay[0]),version:Number(root.version)};
  }
  if(Number(root?.version??0)!==command.expectedVersion)conflict("نسخة إعداد الشراكة قديمة؛ حدّث الصفحة");
  for(const m of draft.members)await validateParty(tx,m.party);
  if(!root){
   const rows=partnershipRows(await tx.execute(sql`INSERT INTO vehicle_partnerships (vehicle_id,ownership_type,registration_owner,created_by,reason) VALUES (${vehicleId},'partnership',${draft.registrationOwner},${actor.id},${command.reason}) RETURNING *`));
   if(rows.length!==1)throw new Error("Partnership header insert was not confirmed");root=rows[0];
  }
  const history=await agreementHistory(tx,Number(root.id));
  if(history.some(a=>a.status==="pending"))conflict("يوجد اتفاق بانتظار الموافقة؛ راجعه قبل إنشاء تعديل جديد");
  if(history.some(a=>a.status!=="rejected"&&String(a.effective_from)>=draft.effectiveFrom))conflict("يجب أن يبدأ التعديل بعد آخر اتفاق محفوظ؛ لا تُستبدل الاتفاقات التاريخية");
  const loss=await historyBoundary(tx,Number(root.id),draft.effectiveFrom);
  if(parseMoney(loss)>0n&&!command.lossResolution)conflict("توجد خسارة مرحلة؛ يجب إبقاء مسؤوليتها صراحة على أصحاب الاتفاق الأصلي قبل تعديل النسب");
  const policy={...command.policy,commandDigest,registrationOwner:draft.registrationOwner,...(command.lossResolution?{lossResponsibility:{...command.lossResolution,amount:loss,originalAgreementIds:history.filter(a=>a.status==="approved"||a.status==="superseded").map(a=>Number(a.id))}}:{})};
  const revision=history.reduce((max,a)=>Math.max(max,Number(a.revision)),0)+1;
  const rows=partnershipRows(await tx.execute(sql`INSERT INTO vehicle_partnership_agreements (partnership_id,revision,effective_from,policy,idempotency_key,reason,status,created_by) VALUES (${Number(root.id)},${revision},${draft.effectiveFrom},${JSON.stringify(policy)}::jsonb,${command.idempotencyKey},${command.reason},'pending',${actor.id}) RETURNING *`));
  if(rows.length!==1)throw new Error("Partnership agreement insert was not confirmed");const agreement=rows[0];
  for(const m of draft.members){const p=m.party;const inserted=partnershipRows(await tx.execute(sql`INSERT INTO vehicle_partnership_members (agreement_id,party_kind,customer_id,supplier_id,staff_id,ownership_basis_points,profit_basis_points,expense_basis_points,capital_contribution,created_by,reason) VALUES (${Number(agreement.id)},${p.kind},${p.kind==="customer"?p.id:null},${p.kind==="supplier"?p.id:null},${p.kind==="staff"?p.id:null},${m.ownershipBasisPoints},${m.profitBasisPoints},${m.expenseBasisPoints},${m.capitalContribution},${actor.id},${command.reason}) RETURNING id`));if(inserted.length!==1)throw new Error("Partnership member insert was not confirmed");}
  const version=await bumpVersion(tx,root);
  await appendPartnershipAudit(tx,{vehicleId,partnershipId:Number(root.id),actor,action:"agreement_submitted",reason:command.reason,newValues:{agreementId:Number(agreement.id),revision,terms,policy}});
  return {agreement:await agreementDto(tx,agreement),version};
 });
}
export async function approveVehicleAgreement(db:PartnershipDatabase,actor:PartnershipActor,vehicleId:number,input:unknown){
 authorizePartnership(actor,true);partnershipId(vehicleId);
 const command=validated(z.object({agreementId:z.number().int().positive(),expectedVersion:z.number().int().nonnegative(),reason:z.string().trim().min(1).max(2000)}).strict(),input);
 return db.transaction(async tx=>{
  await assertPartnershipSchema(tx);await readOriginalVehicle(tx,actor,vehicleId,true);const [root]=await rootRows(tx,true);
  if(!root||Number(root.vehicle_id)!==vehicleId)throw new PartnershipRepositoryError("شراكة المركبة غير موجودة",404,"NOT_FOUND");
  const history=await agreementHistory(tx,Number(root.id)),agreement=history.find(a=>Number(a.id)===command.agreementId);
  if(!agreement)throw new PartnershipRepositoryError("الاتفاق غير موجود لهذه المركبة",404,"NOT_FOUND");
  if(agreement.status==="approved")return {agreement:await agreementDto(tx,agreement),version:Number(root.version)};
  if(Number(root.version)!==command.expectedVersion||agreement.status!=="pending")conflict("حالة الاتفاق أو نسخته تغيرت؛ حدّث الصفحة");
  const dto=await agreementDto(tx,agreement);
  validateAgreement({vehicleId,registrationOwner:record(agreement.policy).registrationOwner,effectiveFrom:dto.effectiveFrom,members:dto.members});
  for(const m of dto.members)await validateParty(tx,m.party);
  const loss=await historyBoundary(tx,Number(root.id),dto.effectiveFrom);
  const resolution=record(agreement.policy).lossResponsibility;
  if(parseMoney(loss)>0n&&(!resolution||record(resolution).amount!==loss))conflict("رصيد الخسارة تغير؛ أعد مراجعة مسؤولية الخسارة قبل اعتماد الاتفاق");
  const updated=partnershipRows(await tx.execute(sql`UPDATE vehicle_partnership_agreements SET status='approved',approved_by=${actor.id},approved_at=now() WHERE id=${command.agreementId} AND status='pending' RETURNING *`));
  if(updated.length!==1)conflict("تعذر تأكيد اعتماد الاتفاق");
  const version=await bumpVersion(tx,root,String(record(agreement.policy).registrationOwner));
  await appendPartnershipAudit(tx,{vehicleId,partnershipId:Number(root.id),actor,action:"agreement_approved",reason:command.reason,oldValues:{status:"pending"},newValues:{agreementId:command.agreementId,status:"approved",version}});
  return {agreement:await agreementDto(tx,updated[0]),version};
 });
}
export async function rejectVehicleAgreement(db:PartnershipDatabase,actor:PartnershipActor,vehicleId:number,input:unknown){
 authorizePartnership(actor,true);partnershipId(vehicleId);
 const command=validated(z.object({agreementId:z.number().int().positive(),expectedVersion:z.number().int().nonnegative(),reason:z.string().trim().min(1).max(2000)}).strict(),input);
 return db.transaction(async tx=>{
  await assertPartnershipSchema(tx);await readOriginalVehicle(tx,actor,vehicleId,true);const [root]=await rootRows(tx,true);
  if(!root||Number(root.vehicle_id)!==vehicleId)throw new PartnershipRepositoryError("شراكة المركبة غير موجودة",404,"NOT_FOUND");
  const history=await agreementHistory(tx,Number(root.id)),agreement=history.find(a=>Number(a.id)===command.agreementId);
  if(!agreement)throw new PartnershipRepositoryError("الاتفاق غير موجود لهذه المركبة",404,"NOT_FOUND");
  if(agreement.status==="rejected")return {agreement:await agreementDto(tx,agreement),version:Number(root.version)};
  if(agreement.status!=="pending"||Number(root.version)!==command.expectedVersion)conflict("يمكن رفض التعديل المعلّق فقط؛ الاتفاق المعتمد يبقى محفوظاً");
  const updated=partnershipRows(await tx.execute(sql`UPDATE vehicle_partnership_agreements SET status='rejected' WHERE id=${command.agreementId} AND status='pending' RETURNING *`));
  if(updated.length!==1)conflict("تعذر تأكيد رفض الاتفاق");const version=await bumpVersion(tx,root);
  await appendPartnershipAudit(tx,{vehicleId,partnershipId:Number(root.id),actor,action:"agreement_rejected",reason:command.reason,oldValues:{status:"pending"},newValues:{agreementId:command.agreementId,status:"rejected",version}});
  return {agreement:await agreementDto(tx,updated[0]),version};
 });
}
export async function searchPartnershipParties(db:PartnershipExecutor,actor:PartnershipActor,vehicleId:number,input:{kind:unknown;query:unknown}){
 authorizePartnership(actor);partnershipId(vehicleId);
 const {kind,query}=validated(z.object({kind:z.enum(["customer","supplier","staff"]),query:z.string().trim().max(100)}).strict(),input);
 await readOriginalVehicle(db,actor,vehicleId);const pattern=`%${query.replace(/[\\%_]/g,"\\$&")}%`;
 const statement=kind==="customer"?sql`/* vp_party_search */ SELECT id,coalesce(nullif(full_name,''),name) AS name,'customer' AS kind FROM customers WHERE status IS DISTINCT FROM 'deleted' AND (name ILIKE ${pattern} OR full_name ILIKE ${pattern}) ORDER BY name,id LIMIT 31`:
  kind==="supplier"?sql`/* vp_party_search */ SELECT id,name,'supplier' AS kind FROM suppliers WHERE status IS DISTINCT FROM 'deleted' AND is_active IS DISTINCT FROM 0 AND name ILIKE ${pattern} ORDER BY name,id LIMIT 31`:
  sql`/* vp_party_search */ SELECT id,coalesce(nullif(full_name,''),username) AS name,'staff' AS kind FROM staff WHERE is_active IS DISTINCT FROM false AND (full_name ILIKE ${pattern} OR username ILIKE ${pattern}) ORDER BY full_name,id LIMIT 31`;
 const rows=partnershipRows(await db.execute(statement));return {items:rows.slice(0,30).map(row=>({id:partnershipId(Number(row.id)),name:String(row.name),kind})),hasMore:rows.length>30};
}
