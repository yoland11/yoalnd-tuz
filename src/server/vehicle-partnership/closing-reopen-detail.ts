import {sql} from 'drizzle-orm';
import type {ClosingReopenDetail} from '../../lib/vehicle-partnership/master-reopen';
import {partnershipRows,type PartnershipExecutor,PartnershipRepositoryError} from './repository';
/** Read context only. Actual unused-rights/journal/permission checks remain in
 * the original transactional reversal, including revalidation under locks. */
export async function readClosingReopenDetail(tx:PartnershipExecutor,financial:{id:number;sourceType:string|null;sourceId:string|null}):Promise<ClosingReopenDetail|undefined>{
 if(financial.sourceType!=='vehicle_partnership_closing')return undefined;
 if(!financial.sourceId||!/^\d+$/.test(financial.sourceId))throw new PartnershipRepositoryError('مرجع الإغلاق المالي غير صالح',409,'CONFLICT');
 const rows=partnershipRows(await tx.execute(sql`/* vp_master_reopen_detail */ SELECT h.id,p.vehicle_id,left(h.period::text,7) AS period,h.revision,h.version,h.source_digest,h.status,h.financial_transaction_id FROM vehicle_partnership_closings h JOIN vehicle_partnerships p ON p.id=h.partnership_id WHERE h.id=${Number(financial.sourceId)} LIMIT 2`));
 if(rows.length!==1)throw new PartnershipRepositoryError('مصدر الإغلاق المالي مفقود أو مكرر',409,'CONFLICT');
 const h=rows[0];
 if(h.status!=='approved'||Number(h.financial_transaction_id)!==financial.id)return {eligible:false,reason:'الإغلاق ليس نسخة معتمدة حالية لهذا السند؛ راجع سجل الشهر والعكس السابق'};
 if(Number(h.id)!==Number(financial.sourceId)||!Number.isSafeInteger(Number(h.version))||Number(h.version)<0||!Number.isSafeInteger(Number(h.revision))||Number(h.revision)<1||!Number.isSafeInteger(Number(h.vehicle_id))||Number(h.vehicle_id)<1||typeof h.source_digest!=='string'||!/^[a-f0-9]{64}$/.test(h.source_digest)||typeof h.period!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(h.period))throw new PartnershipRepositoryError('نسخة الإغلاق أو بصمته غير مكتملة',409,'CONFLICT');
 return {eligible:true,closingId:Number(h.id),financialTransactionId:financial.id,vehicleId:Number(h.vehicle_id),month:h.period,revision:Number(h.revision),version:Number(h.version),sourceDigest:h.source_digest};
}
