import {sql,type SQL} from "drizzle-orm";
import {PartnershipValidationError} from "../../lib/vehicle-partnership/types";

export type PartnershipExecutor={execute:(statement:SQL)=>Promise<unknown>};
export const PARTNERSHIP_TABLE_NAMES=["vehicle_partnerships","vehicle_partnership_agreements","vehicle_partnership_members","vehicle_partnership_activity","vehicle_partnership_cost_funding","vehicle_partnership_closings","vehicle_partnership_closing_lines","vehicle_partnership_rights","vehicle_partnership_settlement_allocations"] as const;
export class PartnershipRepositoryError extends Error{
 constructor(message:string,public readonly status:number,public readonly code:string){super(message);this.name="PartnershipRepositoryError";}
}
export function partnershipRows(result:unknown):Record<string,unknown>[]{
 if(!result||typeof result!=="object"||!Array.isArray((result as {rows?:unknown}).rows))throw new Error("Invalid partnership database response");
 const rows=(result as {rows:unknown[]}).rows;
 if(rows.some(row=>!row||typeof row!=="object"||Array.isArray(row)))throw new Error("Invalid partnership database row response");
 return rows as Record<string,unknown>[];
}
const positiveId=(value:number)=>{if(!Number.isSafeInteger(value)||value<=0)throw new PartnershipValidationError("معرّف سجل الشراكة غير صالح");return value;};
/** Availability is read-only. No runtime DDL, fallback credentials or fabricated
 * empty results when a migration/database read is missing or broken. */
export async function assertPartnershipSchema(tx:PartnershipExecutor):Promise<void>{
 const rows=partnershipRows(await tx.execute(sql`SELECT required.name,to_regclass('public.'||required.name) IS NOT NULL AS present FROM (VALUES ${sql.join(PARTNERSHIP_TABLE_NAMES.map(name=>sql`(${name}::text)`),sql`, `)}) AS required(name)`));
 const names=new Map(rows.map(row=>[row.name,row.present]));
 if(rows.length!==PARTNERSHIP_TABLE_NAMES.length||PARTNERSHIP_TABLE_NAMES.some(name=>names.get(name)!==true))throw new PartnershipRepositoryError("ترقية بيانات شراكة المركبة غير مكتملة؛ يلزم التحقق من الترقية قبل الاستخدام",503,"SETUP_REQUIRED");
}
export type PartnershipRecord={id:number;vehicleId:number;ownershipType:"company"|"personal"|"partnership";registrationOwner:string;version:number};
/** Caller owns the transaction. Every financial writer starts from this same
 * original vehicle relationship lock before child rights or requests. */
export async function lockPartnership(tx:PartnershipExecutor,vehicleId:number):Promise<PartnershipRecord>{
 positiveId(vehicleId);await assertPartnershipSchema(tx);
 const rows=partnershipRows(await tx.execute(sql`SELECT id,vehicle_id,ownership_type,registration_owner,version FROM vehicle_partnerships WHERE vehicle_id=${vehicleId} FOR UPDATE`));
 if(rows.length===0)throw new PartnershipRepositoryError("لا يوجد اتفاق شراكة مسجل لهذه المركبة",404,"NOT_FOUND");
 if(rows.length!==1)throw new Error("Ambiguous partnership vehicle identity");
 const row=rows[0],id=Number(row.id),version=Number(row.version);
 if(!Number.isSafeInteger(id)||id<=0||Number(row.vehicle_id)!==vehicleId||!Number.isInteger(version)||version<0||!["company","personal","partnership"].includes(String(row.ownership_type))||typeof row.registration_owner!=="string")throw new Error("Invalid partnership locked row identity");
 return {id,vehicleId,ownershipType:row.ownership_type as PartnershipRecord["ownershipType"],registrationOwner:row.registration_owner,version};
}
export type PartnershipAuditEvent={vehicleId:number;partnershipId:number;action:string;actor:{id:number;name:string};reason:string;oldValues?:Record<string,unknown>;newValues?:Record<string,unknown>;financialTransactionId?:number|null};
export async function appendPartnershipAudit(tx:PartnershipExecutor,event:PartnershipAuditEvent):Promise<void>{
 positiveId(event.vehicleId);positiveId(event.partnershipId);positiveId(event.actor.id);
 if(!/^[a-z][a-z_]{0,37}$/.test(event.action)||typeof event.actor.name!=="string"||!event.actor.name.trim()||typeof event.reason!=="string"||!event.reason.trim())throw new PartnershipValidationError("بيانات تدقيق الشراكة أو سبب العملية غير صالح");
 if(event.financialTransactionId!=null)positiveId(event.financialTransactionId);
 const context={vehicleId:event.vehicleId,partnershipId:event.partnershipId,feature:"vehicle_partnership"};
 const oldValues={...event.oldValues,...context},newValues={...event.newValues,...context};
 const rows=partnershipRows(await tx.execute(sql`INSERT INTO financial_audit_logs (transaction_id,action,actor_id,actor_name,old_values,new_values,reason) VALUES (${event.financialTransactionId??null},${`vehicle_partnership_${event.action}`},${event.actor.id},${event.actor.name.trim()},${JSON.stringify(oldValues)}::jsonb,${JSON.stringify(newValues)}::jsonb,${event.reason.trim()}) RETURNING id`));
 if(rows.length!==1||!Number.isSafeInteger(Number(rows[0].id)))throw new Error("Partnership audit insert was not confirmed");
}
