import {canonicalPartnershipJson} from "../../lib/vehicle-partnership/canonical";
import {calculatePartnershipClosing,closingMonthBounds,type ClosingSource,type ClosingTerm} from "../../lib/vehicle-partnership/closing";
import {formatMoney,parseMoney} from "../../lib/vehicle-partnership/money";
import {PartnershipValidationError} from "../../lib/vehicle-partnership/types";
import type {ClosingSnapshot} from "./closing";
import {closingOpeningAllocations} from "./closing-opening";

export type ClosingJournalLeg={accountCode:string;direction:"debit"|"credit";amount:string};
export type ClosingJournal={legs:ClosingJournalLeg[];amount:string;transactionType:"vp_month_profit"|"vp_month_loss"};
const invalid=():never=>{throw new PartnershipValidationError("نتيجة الإغلاق أو توزيع الشركاء والخسارة لا يطابق القيد الشهري المعتمد");};
function exact(value:unknown,signed=false):bigint{
 if(typeof value!=="string")return invalid();
 const negative=value.startsWith("-");if(negative&&!signed)return invalid();
 const amount=parseMoney(negative?value.slice(1):value),result=negative?-amount:amount;
 if(formatMoney(result)!==value)return invalid();return result;
}
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=="object"||Array.isArray(value))return invalid();return value as Record<string,unknown>;}
function list(value:unknown,max=5000):unknown[]{if(!Array.isArray(value)||value.length>max)return invalid();return value;}
const id=(value:unknown):number=>{if(typeof value!=="number"||!Number.isSafeInteger(value)||value<=0)return invalid();return value;};
function sameRows(actual:unknown,expected:unknown[],key:(row:Record<string,unknown>)=>string){
 const normalized=(value:unknown)=>list(value).map(object).sort((a,b)=>{const x=key(a),y=key(b);return x<y?-1:x>y?1:0;});
 if(canonicalPartnershipJson(normalized(actual))!==canonicalPartnershipJson(normalized(expected)))invalid();
}

/** Noncash reclassification only. The caller must establish source authority,
 * immutable submission digest, original-source locks and final approval before
 * using these legs. A journal plan never establishes payment or approval.
 * Reuse the actual month calculator to verify dated partner/loss allocations;
 * synthetic segment facts retain the exact already-reviewed segment results,
 * rather than duplicating that allocation algorithm inside a posting template.
 */
export function buildClosingJournal(snapshot:ClosingSnapshot):ClosingJournal{
 if(snapshot.openingLoss)closingOpeningAllocations(snapshot);
 object(snapshot);id(snapshot.vehicleId);id(snapshot.partnershipId);
 if(snapshot.formatVersion!==1||!Number.isSafeInteger(snapshot.setupVersion)||snapshot.setupVersion<0||typeof snapshot.from!=="string")invalid();
 const bounds=closingMonthBounds(snapshot.from.slice(0,7));if(snapshot.from!==bounds.from||snapshot.to!==bounds.to)invalid();
 const policy=object(snapshot.policy),calculation=object(snapshot.calculation),summary=object(calculation.summary);
 if(policy.accountingMethod!=="activity_clearing"||summary.complete!==true||list(summary.blockers).length||typeof calculation.digest!=="string"||!/^[a-f0-9]{64}$/.test(calculation.digest))invalid();
 list(snapshot.sourceSnapshots);list(snapshot.lossClaims);
 if(policy.resultAllocation!==null&&policy.resultAllocation!=="dated_results"||policy.sharedCostBasis!==null&&policy.sharedCostBasis!=="expense_date")invalid();
 const depreciation=object(policy.depreciation),reservePolicy=object(policy.reserve);
 if(depreciation.kind!=="none"&&depreciation.kind!=="configured")invalid();
 if(depreciation.kind==="configured")exact(depreciation.amount);
 const internal=exact(summary.internalIncome,true),external=exact(summary.externalIncome,true),cost=exact(summary.cost,true),net=exact(summary.result,true);
 const recovered=exact(summary.lossRecovered),reserve=exact(summary.reserve),distribution=exact(summary.maxDistributable),carriedLoss=exact(summary.carriedLossOut);
 exact(calculation.investment,true);
 const positive=net>0n?net:0n,loss=net<0n?-net:0n;
 if(net!==internal+external-cost||distribution+reserve+recovered!==positive)invalid();
 let expectedReserve=0n;
 if(reservePolicy.kind==="fixed")expectedReserve=exact(reservePolicy.amount);
 else if(reservePolicy.kind==="percent"){
  const points=typeof reservePolicy.basisPoints==="number"?reservePolicy.basisPoints:invalid();
  if(!Number.isInteger(points)||points<0||points>10000||!["after_loss_recovery","recognized_income"].includes(String(reservePolicy.basis)))invalid();
  const income=internal+external,basis=reservePolicy.basis==="recognized_income"?(income>0n?income:0n):positive-recovered;
  expectedReserve=(basis*BigInt(points)+5000n)/10000n;
 }else if(reservePolicy.kind!=="none")invalid();
 if(reserve!==expectedReserve)invalid();
 const terms:ClosingTerm[]=list(snapshot.agreements,80).map(value=>{
  const agreement=object(value),effectiveFrom=typeof agreement.effectiveFrom==="string"?agreement.effectiveFrom:invalid();
  if(agreement.status!=="approved"||effectiveFrom>snapshot.to)invalid();
  return {id:id(agreement.id),effectiveFrom,members:list(agreement.members,2).map(value=>{
   const member=object(value),party=object(member.party);if(!["customer","supplier","staff"].includes(String(party.kind)))invalid();
   return {id:id(member.id),partyKey:`${party.kind}:${id(party.id)}`,profitBasisPoints:member.profitBasisPoints as number,expenseBasisPoints:member.expenseBasisPoints as number};
  })};
 });
 const byId=new Map(terms.map(term=>[term.id,term])),seen=new Set<number>();
 let segmentTotal=0n;
 const sources:ClosingSource[]=list(calculation.segments,80).map(value=>{
  const segment=object(value),agreementId=id(segment.agreementId),term=byId.get(agreementId);
  if(!term||seen.has(agreementId))return invalid();seen.add(agreementId);
  const amount=exact(segment.result,true);segmentTotal+=amount;
  return {key:`reviewed-segment:${agreementId}`,kind:amount<0n?"operating":"internal",date:snapshot.to,basisDate:term.effectiveFrom,agreementId,amount:formatMoney(amount<0n?-amount:amount),approved:true,shared:false};
 });
 if(segmentTotal!==net)invalid();
 const verified=calculatePartnershipClosing({...bounds,terms,sources,lossClaims:snapshot.lossClaims,openingBalanceVerified:true,policy:{depreciation:{kind:"none"},reserve:{kind:"fixed",amount:formatMoney(reserve)},resultAllocation:snapshot.policy.resultAllocation,sharedCostBasis:snapshot.policy.sharedCostBasis}});
 if(!verified.summary.complete||exact(verified.summary.result,true)!==net||exact(verified.summary.lossRecovered)!==recovered||exact(verified.summary.carriedLossOut)!==carriedLoss||exact(verified.summary.maxDistributable)!==distribution)invalid();
 const memberKey=(row:Record<string,unknown>)=>`${row.agreementId}:${row.memberId}`;
 sameRows(calculation.profitAllocations,verified.profitAllocations,memberKey);
 sameRows(calculation.lossAllocations,verified.lossAllocations,memberKey);
 sameRows(calculation.lossRecoveries,verified.lossRecoveries,row=>`${row.lossKey}:${memberKey(row)}`);
 sameRows(calculation.claimsRemaining,verified.claimsRemaining,row=>String(row.key));
 sameRows(summary.proposedProfitShares,verified.summary.proposedProfitShares!,row=>String(row.key));
 sameRows(summary.lossAllocations,verified.summary.lossAllocations!,row=>String(row.key));
 const legs:ClosingJournalLeg[]=[];
 const add=(accountCode:string,direction:ClosingJournalLeg["direction"],amount:bigint)=>{
  if(amount===0n)return;
  legs.push({accountCode,direction:amount<0n?(direction==="debit"?"credit":"debit"):direction,amount:formatMoney(amount<0n?-amount:amount)});
 };
 add("VP-PAYABLE","debit",internal);add("VP-RESULT","debit",external);add("VP-LOSS","debit",loss);
 add("VP-COST-CLEAR","credit",cost);add("VP-LOSS","credit",recovered);add("VP-RESERVE","credit",reserve);add("VP-PROFIT","credit",distribution);
 const total=(side:ClosingJournalLeg["direction"])=>legs.filter(leg=>leg.direction===side).reduce((sum,leg)=>sum+parseMoney(leg.amount),0n);
 const amount=total("debit");if(amount!==total("credit"))invalid();
 return {legs,amount:formatMoney(amount),transactionType:loss>0n?"vp_month_loss":"vp_month_profit"};
}
