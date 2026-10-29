import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {z} from 'zod/v4';
import {sql} from 'drizzle-orm';
import {PgDialect} from 'drizzle-orm/pg-core';
import {canonicalPartnershipJson} from '../src/lib/vehicle-partnership/canonical';
import {periodDigest} from '../src/lib/vehicle-partnership/period-attributions';
import {openingLossDeclaration,openingLossClaims} from '../src/lib/vehicle-partnership/opening-loss';
import {calculatePartnershipClosing,closingMonthBounds} from '../src/lib/vehicle-partnership/closing';
import {projectPeriodAttributions} from '../src/lib/vehicle-partnership/period-attributions';
import {PartnershipValidationError} from '../src/lib/vehicle-partnership/types';
import {buildClosingJournal} from '../src/server/vehicle-partnership/closing-journal';
import {closingPolicySchema} from '../src/server/vehicle-partnership/closing';
import {parseMoney,formatMoney} from '../src/lib/vehicle-partnership/money';
import {partnershipId,authorizePartnership} from '../src/server/vehicle-partnership/agreements';
import {partnershipRows,PartnershipRepositoryError} from '../src/server/vehicle-partnership/repository';
assert.ok(existsSync('src/server/vehicle-partnership/closing-opening.ts'),'opening approved source must materialize original loss rights in the first real month, including zero-journal months');
const {closingOpeningAllocations}=await import('../src/server/vehicle-partnership/closing-opening');
const actor={id:7,name:'مدير',role:'admin',permissions:[],isActive:true};
const first={id:3,revision:1,effectiveFrom:'2026-08-20',status:'approved',policy:{openingLoss:'100.00'},members:[{id:11,party:{kind:'customer',id:1},profitBasisPoints:6000,expenseBasisPoints:5000},{id:12,party:{kind:'supplier',id:1},profitBasisPoints:4000,expenseBasisPoints:5000}]};
const declaration=openingLossDeclaration(first,{vehicleId:12,partnershipId:1,actorId:7,reference:'OPEN-AUG',reason:'خسارة افتتاحية مثبتة'}),openingLoss={...declaration,declarationId:90,financialTransactionId:71,sourceDigest:periodDigest({...declaration,declarationId:90})};
const terms=[{id:3,effectiveFrom:first.effectiveFrom,members:first.members.map(m=>({id:m.id,partyKey:`${m.party.kind}:${m.party.id}`,profitBasisPoints:m.profitBasisPoints,expenseBasisPoints:m.expenseBasisPoints}))}];
function snapshot(income:string){const lossClaims=openingLossClaims(openingLoss,'2026-08-01'),calculation=calculatePartnershipClosing({from:'2026-08-01',to:'2026-08-31',terms,sources:parseMoney(income)>0n?[{key:'financial:72',kind:'external',date:'2026-08-25',basisDate:'2026-08-25',agreementId:3,amount:income,approved:true,shared:false}]:[],lossClaims,openingBalanceVerified:true,policy:{depreciation:{kind:'none'},reserve:{kind:'none'},resultAllocation:'dated_results',sharedCostBasis:'expense_date'}});return {formatVersion:1 as const,vehicleId:12,partnershipId:1,setupVersion:3,from:'2026-08-01',to:'2026-08-31',policy:{depreciation:{kind:'none'},reserve:{kind:'none'},resultAllocation:'dated_results',sharedCostBasis:'expense_date',accountingMethod:'activity_clearing'},agreements:[first],sourceSnapshots:[],lossClaims,previousClosing:null,openingLoss,calculation} as any;}
const zero=snapshot('0.00'),partial=snapshot('60.00'),full=snapshot('140.00');
for(const input of [zero,partial,full]){const lines=closingOpeningAllocations(input);assert.equal(lines.length,2);assert.deepEqual(lines.map(l=>l.amount),['50.00','50.00']);assert.ok(lines.every(l=>l.kind==='adjustment'&&l.category==='loss'&&l.financialId===71));}
assert.equal(partial.calculation.summary.carriedLossOut,'40.00');assert.equal(full.calculation.summary.maxDistributable,'40.00');assert.throws(()=>closingOpeningAllocations({...zero,previousClosing:{id:1}}));assert.throws(()=>closingOpeningAllocations({...zero,openingLoss:{...openingLoss,members:[{...openingLoss.members[0],amount:'49.99'},openingLoss.members[1]]}}));assert.throws(()=>closingOpeningAllocations({...zero,lossClaims:[]}));
const dialect=new PgDialect();let rights:any[]=[],lines:any[]=[],status='approved';
function load(path:string,extra:any,expr:string){const tree=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true),body=tree.statements.filter(n=>!ts.isImportDeclaration(n)&&!ts.isExportDeclaration(n)).map(n=>n.getText(tree).replace(/^export\s+/,'')).join('\n');return vm.runInNewContext(ts.transpileModule(body+'\n('+expr+')',{compilerOptions:{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022}}).outputText,{sql,canonicalPartnershipJson,parseMoney,formatMoney,partnershipId,authorizePartnership,partnershipRows,PartnershipRepositoryError,closingOpeningAllocations,...extra});}
const context:any={root:{id:1,vehicleId:12},row:{id:5,partnership_id:1,revision:1,status:'approved',financial_transaction_id:null,source_digest:'a'.repeat(64),reason:'اعتماد الشهر'},snapshot:zero,financialId:null};
const tx={execute:async(q:any)=>{const {sql:text,params:p}=dialect.sqlToQuery(q);
 if(text.includes('vp_month_allocation_lines')||text.includes('vp_unused_allocation_lines'))return {rows:structuredClone(lines)};
 if(text.includes('vp_month_rights_proof')||text.includes('vp_unused_monthly_rights'))return {rows:structuredClone(rights)};
 if(text.includes('vp_month_converted_rights'))return {rows:[]};
 if(text.includes('vp_month_recovered_loss'))return {rows:rights.filter(r=>r.id===p[0])};
 if(text.includes('vp_month_right_insert')){const r={id:101+rights.length,partnership_id:p[0],agreement_id:p[1],member_id:p[2],closing_line_id:p[3],amount:p[4],category:p[5],direction:p[6],event_key:p[7],financial_transaction_id:p[8],source_snapshot:JSON.parse(String(p[9])),status:'approved'};rights.push(r);return {rows:[r]};}
 throw Error('unexpected opening monthly SQL '+text);}};
const reconcilePaymentState=async(_tx:any,{sourceId}:any)=>({totalAmount:rights.find(r=>r.id===sourceId)?.amount,approvalStatus:status,approvedPaidAmount:'0.00',reservedAmount:'0.00'});
const proof=async()=>openingLoss;
const rightsApi=load('src/server/vehicle-partnership/closing-rights.ts',{reconcilePaymentState,proveClosingOpening:proof},'({approveClosingRights})');
function allocationLines(s:any){const result=closingOpeningAllocations(s).map((l:any,i:number)=>({id:81+i,source_key:l.key,line_kind:l.kind,agreement_id:l.agreementId,member_id:l.memberId,amount:l.amount,snapshot:l.proof}));for(const [kind,items] of [['profit_allocation',s.calculation.profitAllocations],['loss_allocation',s.calculation.lossAllocations],['loss_recovery',s.calculation.lossRecoveries]] as any){for(const [i,l] of items.entries())if(parseMoney(l.amount)>0n)result.push({id:81+result.length,source_key:`${kind}:${i}:${l.agreementId}:${l.memberId}`,line_kind:kind,agreement_id:l.agreementId,member_id:l.memberId,amount:l.amount,snapshot:l});}return result;}
lines=allocationLines(zero);await rightsApi.approveClosingRights(tx,actor,context);assert.equal(rights.length,2);assert.ok(rights.every(r=>r.category==='loss'&&r.financial_transaction_id===71));await rightsApi.approveClosingRights(tx,actor,context);assert.equal(rights.length,2,'zero-month approval replay must not duplicate opening rights');
const unusedApi=load('src/server/vehicle-partnership/closing-unused.ts',{reconcilePaymentState},'({proveClosingRevisionRights})');assert.equal((await unusedApi.proveClosingRevisionRights(tx,context)).length,2);rights.forEach(r=>r.status='reversed');assert.equal((await unusedApi.proveClosingRevisionRights(tx,context,'reversed')).length,2);
rights=[];context.snapshot=partial;context.financialId=91;context.row.financial_transaction_id=91;lines=allocationLines(partial);await rightsApi.approveClosingRights(tx,actor,context);assert.equal(rights.length,4);assert.deepEqual(rights.filter(r=>r.category==='loss_recovery').map(r=>r.source_snapshot.lossRightId),[101,102]);assert.ok(rights.filter(r=>r.category==='loss_recovery').every(r=>r.financial_transaction_id===91));assert.equal((await unusedApi.proveClosingRevisionRights(tx,context)).length,4);rights[0].financial_transaction_id=91;await assert.rejects(()=>unusedApi.proveClosingRevisionRights(tx,context));
// Actual preview chooses only the authoritative opening source; pending evidence
// blocks, rather than fabricating a zero-loss month or inferring approval.
let approvedProof:any=null;
const previewApi=load('src/server/vehicle-partnership/closing.ts',{createHash,z,PartnershipValidationError,calculatePartnershipClosing,closingMonthBounds,projectPeriodAttributions,readPeriodAttributions:async()=>[],readApprovedOpeningLoss:async()=>approvedProof,openingLossClaims,readOriginalVehicle:async()=>({id:12}),lockPartnership:async()=>({id:1,vehicleId:12,version:3}),readVehicleActivity:async()=>({trips:[],blockers:[]}),readClosingSourceEvidence:async()=>({terms,agreements:[first],sources:[],snapshots:[],historySources:[],historySnapshots:[],blockers:[]})},'({previewClosing})');
const previewTx={execute:async(q:any)=>{const text=dialect.sqlToQuery(q).sql;if(text.includes('vp_closing_periods')||text.includes('vp_closing_consumed_sources'))return {rows:[]};throw Error(text);}};
assert.equal((await previewApi.previewClosing(previewTx,actor,12,'2026-08',zero.policy)).calculation.summary.complete,false);approvedProof=openingLoss;
const proven=await previewApi.previewClosing(previewTx,actor,12,'2026-08',zero.policy);assert.equal(proven.calculation.summary.complete,true);assert.equal(proven.snapshot.openingLoss.financialTransactionId,71);assert.equal(proven.calculation.summary.carriedLossOut,'100.00');assert.equal(buildClosingJournal(proven.snapshot).amount,'0.00');
const lifecycle=load('src/server/vehicle-partnership/closing-lifecycle.ts',{createHash,z,PartnershipValidationError,closingMonthBounds,closingPolicySchema,buildClosingJournal},'({closingSubmissionLines})');
assert.equal(lifecycle.closingSubmissionLines(proven.snapshot,1).filter((l:any)=>l.kind==='adjustment').length,2);
console.log('PASS actual opening monthly preview/lines/rights: unapproved evidence blocks, real zero month, original FI/loss shares, partial/full recovery, exact replay and unused/reversed revision proof; no opening journal repost.');
