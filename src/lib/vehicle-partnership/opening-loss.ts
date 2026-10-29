import {z} from 'zod/v4';
import {allocateMoney,formatMoney,parseMoney} from './money';
import {PartnershipValidationError} from './types';
import type {ClosingLossClaim} from './closing';
const positive=z.number().int().positive().max(Number.MAX_SAFE_INTEGER),points=z.number().int().min(0).max(10000);
const day=z.string().refine(value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value);
const party=z.object({kind:z.enum(['customer','supplier','staff']),id:positive}).strict();
const agreement=z.object({id:positive,revision:positive,effectiveFrom:day,status:z.enum(['approved','superseded']),policy:z.record(z.string(),z.unknown()),members:z.array(z.object({id:positive,party,expenseBasisPoints:points}).passthrough()).length(2)}).passthrough();
const context=z.object({vehicleId:positive,partnershipId:positive,actorId:positive,reference:z.string().trim().min(3).max(240),reason:z.string().trim().min(3).max(2000)}).strict();
const amount=z.string().refine(value=>{try{return formatMoney(parseMoney(value))===value&&parseMoney(value)>0n;}catch{return false;}});
const member=z.object({memberId:positive,partyKey:z.string().regex(/^(customer|supplier|staff):[1-9]\d*$/),expenseBasisPoints:points,amount:z.string().refine(value=>{try{return formatMoney(parseMoney(value))===value;}catch{return false;}})}).strict();
export const openingLossDeclarationSchema=z.object({formatVersion:z.literal(1),vehicleId:positive,partnershipId:positive,actorId:positive,agreementId:positive,agreementRevision:positive,effectiveFrom:day,amount,reference:z.string().trim().min(3).max(240),reason:z.string().trim().min(3).max(2000),members:z.array(member).length(2)}).strict();
export type OpeningLossDeclaration=z.infer<typeof openingLossDeclarationSchema>;
export const approvedOpeningLossSchema=openingLossDeclarationSchema.extend({declarationId:positive,financialTransactionId:positive,sourceDigest:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type ApprovedOpeningLoss=z.infer<typeof approvedOpeningLossSchema>;
function fail():never{throw new PartnershipValidationError('إثبات الخسارة الافتتاحية يحتاج اتفاقاً أولياً معتمداً ومبلغاً موجباً ومرجعاً واضحاً ونسب خسارة مكتملة للشريكين');}
/** Original loss allocation is independent of ownership, current profit shares
 * or later amendments. This declaration alone is NOT financial approval. */
export function openingLossDeclaration(first:unknown,input:unknown):OpeningLossDeclaration{
 const a=agreement.safeParse(first),c=context.safeParse(input);if(!a.success||!c.success)return fail();const g=a.data,value=c.data;
 if(typeof g.policy.openingLoss!=='string'||parseMoney(g.policy.openingLoss)<=0n||new Set(g.members.map(m=>m.id)).size!==2||new Set(g.members.map(m=>`${m.party.kind}:${m.party.id}`)).size!==2||g.members.reduce((sum,m)=>sum+m.expenseBasisPoints,0)!==10000)return fail();
 const money=formatMoney(parseMoney(g.policy.openingLoss)),members=[...g.members].sort((a,b)=>a.id-b.id),allocations=allocateMoney(parseMoney(money),members.map(m=>({key:`member:${m.id}`,basisPoints:m.expenseBasisPoints})));
 return {formatVersion:1,...value,agreementId:g.id,agreementRevision:g.revision,effectiveFrom:g.effectiveFrom,amount:money,members:members.map(m=>({memberId:m.id,partyKey:`${m.party.kind}:${m.party.id}`,expenseBasisPoints:m.expenseBasisPoints,amount:allocations.find(a=>a.key===`member:${m.id}`)!.amount}))};
}
export function checkedOpeningLoss(proof:unknown):ApprovedOpeningLoss{
 const parsed=approvedOpeningLossSchema.safeParse(proof);if(!parsed.success)return fail();const p=parsed.data;
 const allocations=allocateMoney(parseMoney(p.amount),p.members.map(m=>({key:`member:${m.memberId}`,basisPoints:m.expenseBasisPoints})));
 if(new Set(p.members.map(m=>m.memberId)).size!==2||new Set(p.members.map(m=>m.partyKey)).size!==2||p.members.some(m=>m.amount!==allocations.find(a=>a.key===`member:${m.memberId}`)?.amount))return fail();return p;
}
export function openingLossClaims(proof:unknown,period:string):ClosingLossClaim[]{
 const p=checkedOpeningLoss(proof);if(period!==p.effectiveFrom.slice(0,7)+'-01')return fail();
 return p.members.filter(m=>parseMoney(m.amount)>0n).map(m=>({key:`opening:declaration:${p.declarationId}:member:${m.memberId}`,category:'loss',period,agreementId:p.agreementId,memberId:m.memberId,partyKey:m.partyKey,remaining:m.amount}));
}
