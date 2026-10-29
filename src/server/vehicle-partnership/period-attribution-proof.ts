import {sql} from 'drizzle-orm';
import {periodAttributionSchema,periodDigest,periodSourceDigest,type PeriodAttribution} from '../../lib/vehicle-partnership/period-attributions';
import type {ClosingSource} from '../../lib/vehicle-partnership/closing';
import {formatMoney,parseMoney} from '../../lib/vehicle-partnership/money';
import {partnershipId} from './agreements';
import {partnershipRows,PartnershipRepositoryError,type PartnershipExecutor} from './repository';
type Row=Record<string,unknown>;type Root={id:number;vehicleId:number};
function fail(message:string):never{throw new PartnershipRepositoryError(message,409,'CONFLICT');}
export function periodObject(value:unknown):Row{if(!value||typeof value!=='object'||Array.isArray(value))return fail('إثبات تسوية الفترة غير مكتمل');return value as Row;}
const approvedAction='vehicle_partnership_period_attribution_approved',revokedAction='vehicle_partnership_period_attribution_revoked';
export async function readPeriodAttributionEvents(tx:PartnershipExecutor,root:Root,keys?:readonly string[]){
 if(keys?.length===0)return [];
 const ids=keys?.map(key=>{if(!/^financial:[1-9]\d*$/.test(key))return fail('مرجع مصدر التسوية غير صالح');return partnershipId(Number(key.slice(10)));});
 const rows=partnershipRows(await tx.execute(sql`/* vp_period_attributions */ SELECT id,transaction_id,actor_id,action,new_values FROM financial_audit_logs WHERE action IN (${approvedAction},${revokedAction}) AND new_values->>'partnershipId'=${String(root.id)} AND new_values->>'vehicleId'=${String(root.vehicleId)} ${ids?sql`AND transaction_id IN (${sql.join(ids.map(id=>sql`${id}`),sql`, `)})`:sql``} ORDER BY id LIMIT 5001`));
 if(rows.length>5000)throw new PartnershipRepositoryError('سجل تسويات الفترات يتجاوز حد المراجعة',409,'LIMIT_EXCEEDED');return rows;
}
export function checkedPeriodAudits(rows:readonly Row[],root:Root){
 const approved=new Map<number,PeriodAttribution>(),revoked=new Set<number>(),seen=new Set<number>();
 for(const row of rows){const id=partnershipId(Number(row.id)),values=periodObject(row.new_values);if(seen.has(id)||values.partnershipId!==root.id||values.vehicleId!==root.vehicleId)fail('سجل تسوية مكرر أو خارج المركبة');seen.add(id);
  if(row.action===approvedAction){const body=periodObject(values.proof),parsed=periodAttributionSchema.safeParse({...body,attributionId:id});if(!parsed.success||values.proofDigest!==periodDigest(body))fail('بصمة موافقة تسوية الفترة غير مطابقة');const p=parsed.data;if(p.actorId!==Number(row.actor_id)||p.sourceKey!==`financial:${row.transaction_id}`||p.vehicleId!==root.vehicleId||p.partnershipId!==root.id)fail('هوية موافقة تسوية الفترة غير مطابقة');approved.set(id,p);}
  else if(row.action===revokedAction){const p=periodObject(values.revocation),target=approved.get(partnershipId(Number(p.attributionId)));if(!target||revoked.has(target.attributionId)||p.actorId!==Number(row.actor_id)||p.sourceKey!==target.sourceKey||p.sourceDigest!==target.sourceDigest||target.sourceKey!==`financial:${row.transaction_id}`||typeof p.reason!=='string'||p.reason.trim().length<3||values.revocationDigest!==periodDigest(p))fail('إلغاء تسوية الفترة لا يطابق موافقتها الأصلية');revoked.add(target.attributionId);}
  else fail('نوع سجل تسوية الفترة غير معروف');
 }
 const active=[...approved.values()].filter(p=>!revoked.has(p.attributionId));if(new Set(active.map(p=>p.sourceKey)).size!==active.length)fail('مصدر مالي مصنف في أكثر من فترة');return {approved,revoked,active};
}
export async function provePeriodJournal(tx:PartnershipExecutor,financialId:number,amount:string):Promise<string>{
 partnershipId(financialId);const rows=partnershipRows(await tx.execute(sql`/* vp_period_journal */ SELECT j.id,j.account_id,a.code,j.entry_side,j.amount::text FROM financial_ledger_entries j JOIN financial_accounts a ON a.id=j.account_id WHERE j.transaction_id=${financialId} ORDER BY j.id LIMIT 1001`));
 if(rows.length<2||rows.length>1000||new Set(rows.map(r=>Number(r.id))).size!==rows.length)fail('قيد المصدر الأصلي غير موجود أو مكرر');let debit=0n,credit=0n;
 const normalized=rows.map(row=>{const value=parseMoney(String(row.amount));if(value<=0n||typeof row.code!=='string'||!row.code||!['debit','credit'].includes(String(row.entry_side)))fail('قيد المصدر الأصلي غير متوازن');if(row.entry_side==='debit')debit+=value;else credit+=value;return {id:partnershipId(Number(row.id)),accountId:partnershipId(Number(row.account_id)),code:row.code,side:row.entry_side,amount:formatMoney(value)};});
 if(debit!==parseMoney(amount)||credit!==debit)fail('قيمة قيد المصدر الأصلي لا تطابق مبلغ تسوية الفترة');return periodDigest(normalized);
}
/** Independent original audit/source/journal proof; no closing admission,
 * canonical callbacks, or financial writes. */
export async function readPeriodAttributions(tx:PartnershipExecutor,root:Root,sources:readonly ClosingSource[],snapshots:readonly {key:string;snapshot:Row}[]):Promise<PeriodAttribution[]>{
 const {active}=checkedPeriodAudits(await readPeriodAttributionEvents(tx,root,sources.map(s=>s.key)),root),byKey=new Map(sources.map(source=>[source.key,source])),bySnapshot=new Map(snapshots.map(snapshot=>[snapshot.key,snapshot.snapshot]));
 for(const proof of active){const source=byKey.get(proof.sourceKey),snapshot=bySnapshot.get(proof.sourceKey);if(!source||!snapshot||periodSourceDigest(source,snapshot)!==proof.sourceDigest||await provePeriodJournal(tx,Number(proof.sourceKey.slice(10)),source.amount)!==proof.journalDigest)fail('مصدر تسوية الفترة أو قيده تغير منذ الموافقة');}
 return active;
}
export const periodAttributionStore={readEvents:readPeriodAttributionEvents,checkedAudits:checkedPeriodAudits,object:periodObject,fail};
