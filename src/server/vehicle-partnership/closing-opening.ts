import {canonicalPartnershipJson} from '../../lib/vehicle-partnership/canonical';
import {checkedOpeningLoss,openingLossClaims,openingLossDeclaration} from '../../lib/vehicle-partnership/opening-loss';
import {periodDigest} from '../../lib/vehicle-partnership/period-attributions';
import {parseMoney} from '../../lib/vehicle-partnership/money';
import {PartnershipValidationError} from '../../lib/vehicle-partnership/types';
import {openingLossStore} from './opening-loss-proof';
import type {ClosingSnapshot} from './closing';
import type {ClosingRightsContext} from './closing-rights';
import type {PartnershipExecutor} from './repository';
/** Additive frozen metadata only: legacy snapshots have no opening lines. */
export function closingOpeningAllocations(snapshot:ClosingSnapshot){
 if(!snapshot.openingLoss)return [];
 const p=checkedOpeningLoss(snapshot.openingLoss),first=snapshot.agreements[0],{declarationId,financialTransactionId,sourceDigest,...declaration}=p;
 const fail=():never=>{throw new PartnershipValidationError('إثبات خسارة افتتاحية لا يطابق الاتفاق الأول أو حقوق الشهر الأصلية');};
 if(snapshot.previousClosing!=null||snapshot.vehicleId!==p.vehicleId||snapshot.partnershipId!==p.partnershipId||snapshot.from!==p.effectiveFrom.slice(0,7)+'-01'||!first)return fail();
 const expected=openingLossDeclaration(first,{vehicleId:p.vehicleId,partnershipId:p.partnershipId,actorId:p.actorId,reference:p.reference,reason:p.reason});
 if(canonicalPartnershipJson(expected)!==canonicalPartnershipJson(declaration)||periodDigest({...declaration,declarationId})!==sourceDigest)return fail();
 const claims=openingLossClaims(p,snapshot.from);
 if(canonicalPartnershipJson(snapshot.lossClaims)!==canonicalPartnershipJson(claims))return fail();
 return claims.filter(c=>parseMoney(c.remaining)>0n).map(c=>({key:c.key,kind:'adjustment',category:'loss',agreementId:c.agreementId,memberId:c.memberId,amount:c.remaining,financialId:financialTransactionId,proof:{...c,openingLoss:p}}));
}
/** Live approval re-proves the existing declaration and noncash journal. It
 * never produces or repairs that source. Reopening keeps this FI intact. */
export async function proveClosingOpening(tx:PartnershipExecutor,input:ClosingRightsContext){
 if(!input.snapshot.openingLoss)return null;closingOpeningAllocations(input.snapshot);
 const p=input.snapshot.openingLoss,d=await openingLossStore.readDeclaration(tx,input.root,p.declarationId),f=await openingLossStore.financial(tx,d);
 if(!f||Number(f.id)!==p.financialTransactionId||f.reversal_txn_id!=null||f.reversed_at!=null||parseMoney(String(f.reversed_amount))!==0n)return openingLossStore.fail('مصدر الخسارة الافتتاحية غير معتمد أو معكوس');
 const actual=await openingLossStore.proveApproval(tx,d,f);if(canonicalPartnershipJson(actual)!==canonicalPartnershipJson(p))return openingLossStore.fail('تغير إثبات الخسارة الافتتاحية عن نسخة الشهر');return actual;
}
