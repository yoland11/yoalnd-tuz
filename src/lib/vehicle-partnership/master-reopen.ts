import {z} from 'zod/v4';
export const masterClosingReversalOptionsSchema=z.object({expectedVersion:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),expectedDigest:z.string().regex(/^[a-f0-9]{64}$/),idempotencyKey:z.string().trim().min(8).max(180)}).strict().optional();
export type ClosingReopenDetail={eligible:true;closingId:number;financialTransactionId:number;vehicleId:number;month:string;revision:number;version:number;sourceDigest:string}|{eligible:false;reason:string};
type Detail={id:number;transactionNo:string;sourceType:string|null;sourceId:string|null;sourceEvent?:string|null;approvalStatus:string;reversedAt?:string|null;reversalTxnId?:number|null;closingReopen?:unknown};
const contextSchema=z.object({eligible:z.literal(true),closingId:z.number().int().positive(),financialTransactionId:z.number().int().positive(),vehicleId:z.number().int().positive(),month:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),revision:z.number().int().positive(),version:z.number().int().nonnegative(),sourceDigest:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export function makeMasterReversalAttempt(detail:Detail,reason:string,key?:string){
 const why=z.string().trim().min(3).parse(reason);
 let closingReopen:z.infer<typeof masterClosingReversalOptionsSchema>;
 if(detail.sourceType==='vehicle_partnership_closing'){
  z.string().max(2000).parse(why);
  const context=contextSchema.parse(detail.closingReopen);
  if(detail.approvalStatus!=='executed'||detail.sourceEvent!=='monthly_result'||detail.reversedAt||detail.reversalTxnId!=null||context.financialTransactionId!==detail.id||String(context.closingId)!==detail.sourceId)throw new Error('الإغلاق المعروض لا يطابق السند الأصلي؛ حدّث البيانات');
  closingReopen=Object.freeze(masterClosingReversalOptionsSchema.parse({expectedVersion:context.version,expectedDigest:context.sourceDigest,idempotencyKey:key??`vp:closing-reversal:${detail.id}`})!);
 }
 return Object.freeze({id:detail.id,transactionNo:detail.transactionNo,body:Object.freeze({reason:why,...(closingReopen?{closingReopen}:{})})});
}
export type MasterReversalAttempt=ReturnType<typeof makeMasterReversalAttempt>;
