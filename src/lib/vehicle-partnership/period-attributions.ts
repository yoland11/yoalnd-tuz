import {createHash} from 'node:crypto';
import {z} from 'zod/v4';
import {canonicalPartnershipJson} from './canonical';
import type {ClosingSource} from './closing';
import {formatMoney,parseMoney} from './money';
import {PartnershipValidationError,ORIGINAL_VEHICLE_OPERATING_COST_TYPES} from './types';

type Snapshot={key:string;snapshot:Record<string,unknown>};
const positive=z.number().int().positive().max(Number.MAX_SAFE_INTEGER),digest=z.string().regex(/^[a-f0-9]{64}$/);
const date=z.string().refine(value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value);
export const periodAttributionSchema=z.object({formatVersion:z.literal(1),attributionId:positive,vehicleId:positive,partnershipId:positive,actorId:positive,sourceKey:z.string().regex(/^financial:[1-9]\d*$/),sourceDigest:digest,targetDate:date.refine(value=>value.endsWith('-01')),reason:z.string().trim().min(3).max(2000),reference:z.string().trim().min(3).max(240),journalDigest:digest}).strict();
export type PeriodAttribution=z.infer<typeof periodAttributionSchema>;
const fail=(message:string):never=>{throw new PartnershipValidationError(message);};
export const periodDigest=(value:unknown)=>createHash('sha256').update(canonicalPartnershipJson(value)).digest('hex');
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))return fail('إثبات مصدر تسوية الفترة غير مكتمل');return value as Record<string,unknown>;}
/** Financial/economic identity only. A renamed description or refunded source
 * status cannot rewrite the original event's amount/date/party identity. */
export function periodSourceDigest(source:ClosingSource,snapshot:Record<string,unknown>):string{
 const financial=object(snapshot.financial),raw=object(snapshot.sourceSnapshot),economic=Object.fromEntries(Object.entries(raw).filter(([key])=>!['status','description','attachments'].includes(key)));
 if(snapshot.expenseId!=null&&snapshot.costFundingId==null&&!ORIGINAL_VEHICLE_OPERATING_COST_TYPES.includes(String(raw.expenseType)))return fail('مصروف الفترة السابقة غير مصنف تشغيلياً أو رأسمالياً؛ راجع المصدر الأصلي');
 if(source.key!==`financial:${financial.id}`||source.approved!==true||financial.status!=='executed'||formatMoney(parseMoney(source.amount))!==source.amount||parseMoney(String(financial.amount))!==parseMoney(source.amount))return fail('التسوية تتطلب حدثاً مالياً أصلياً منفذاً ومعتمداً');
 return periodDigest({key:source.key,kind:source.kind,date:source.date,basisDate:source.basisDate,agreementId:source.agreementId,amount:source.amount,shared:source.shared,financial,sourceSnapshot:economic,activityId:snapshot.activityId??null,costFundingId:snapshot.costFundingId??null,expenseId:snapshot.expenseId??null,reversedFinancialId:snapshot.reversedFinancialId??null,originalFinancial:snapshot.originalFinancial??null});
}
/** Projection only: caller proves audit authority/actual journals under source
 * locks. It never changes original financial data or creates money/rights. */
export function projectPeriodAttributions(input:{vehicleId:number;partnershipId:number;from:string;to:string;historySources:readonly ClosingSource[];historySnapshots:readonly Snapshot[];consumedKeys:readonly string[];attributions:readonly unknown[]}){
 if(!date.safeParse(input.from).success||!date.safeParse(input.to).success||input.from>input.to||input.attributions.length>5000)return fail('فترة أو عدد تسويات المصادر غير صالح');
 const facts=new Map(input.historySources.map(source=>[source.key,source])),snapshots=new Map(input.historySnapshots.map(snapshot=>[snapshot.key,snapshot.snapshot]));
 if(facts.size!==input.historySources.length||snapshots.size!==input.historySnapshots.length)return fail('مصدر تسوية مكرر في أدلة الإغلاق');
 const mapped=new Map<string,PeriodAttribution>();
 for(const raw of input.attributions){
  const parsed=periodAttributionSchema.safeParse(raw);if(!parsed.success)return fail('إثبات تسوية الفترة لا يطابق صيغته المعتمدة');const proof=parsed.data,source=facts.get(proof.sourceKey),snapshot=snapshots.get(proof.sourceKey);
  if(proof.vehicleId!==input.vehicleId||proof.partnershipId!==input.partnershipId||mapped.has(proof.sourceKey)||!source||!snapshot||source.date>=proof.targetDate||periodSourceDigest(source,snapshot)!==proof.sourceDigest)return fail('تسوية الفترة مكررة أو لا تطابق المصدر الأصلي واتفاقه');
  if(input.consumedKeys.includes(proof.sourceKey)&&proof.targetDate>=input.from)return fail('مصدر التسوية مستخدم بالفعل في إغلاق معتمد');
  mapped.set(proof.sourceKey,proof);
 }
 const historySources:ClosingSource[]=[],historySnapshots:Snapshot[]=[],blockers:string[]=[];
 for(const source of input.historySources){const proof=mapped.get(source.key),snapshot=snapshots.get(source.key);if(!snapshot)return fail('إثبات المصدر الأصلي غير موجود');
  const projected=proof?{...source,date:proof.targetDate,evidence:periodDigest({sourceDigest:proof.sourceDigest,attribution:proof})}:{...source};
  historySources.push(projected);historySnapshots.push({key:source.key,snapshot:proof?{...snapshot,periodAttribution:proof}:snapshot});
  if(proof&&projected.date>=input.from&&projected.date<=input.to){const originalId=Number(source.key.slice(10));for(const reverse of input.historySources){const reverseSnapshot=snapshots.get(reverse.key);if(reverse.approved&&Number(reverseSnapshot?.reversedFinancialId)===originalId&&reverse.date>input.to)blockers.push(`مصدر ${source.key} عليه عكس لاحق؛ راجع تسلسل تسوية الفترة`);}}
 }
 const dates=new Map(historySources.map(source=>[source.key,source.date]));
 return {sources:historySources.filter(source=>source.date>=input.from&&source.date<=input.to),snapshots:historySnapshots.filter(snapshot=>{const day=dates.get(snapshot.key)!;return day>=input.from&&day<=input.to;}),historySources,historySnapshots,blockers:[...new Set(blockers)]};
}
