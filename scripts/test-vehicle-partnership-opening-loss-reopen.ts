import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import {sql} from 'drizzle-orm';
import {PgDialect} from 'drizzle-orm/pg-core';
import {z} from 'zod/v4';
import {canonicalPartnershipJson} from '../src/lib/vehicle-partnership/canonical';
import {periodDigest} from '../src/lib/vehicle-partnership/period-attributions';
import {openingLossDeclaration,openingLossClaims} from '../src/lib/vehicle-partnership/opening-loss';
import {calculatePartnershipClosing,closingMonthBounds} from '../src/lib/vehicle-partnership/closing';
import {formatMoney,parseMoney} from '../src/lib/vehicle-partnership/money';
import {PartnershipValidationError} from '../src/lib/vehicle-partnership/types';
import {closingPolicySchema} from '../src/server/vehicle-partnership/closing';
import {buildClosingJournal} from '../src/server/vehicle-partnership/closing-journal';
import {closingOpeningAllocations} from '../src/server/vehicle-partnership/closing-opening';
import {authorizePartnership,partnershipId} from '../src/server/vehicle-partnership/agreements';
import {partnershipRows,PartnershipRepositoryError,appendPartnershipAudit} from '../src/server/vehicle-partnership/repository';
const first={id:3,revision:1,effectiveFrom:'2026-08-20',status:'approved',policy:{openingLoss:'100.00'},members:[{id:11,party:{kind:'customer',id:1},profitBasisPoints:5000,expenseBasisPoints:5000},{id:12,party:{kind:'supplier',id:1},profitBasisPoints:5000,expenseBasisPoints:5000}]};
const declaration=openingLossDeclaration(first,{vehicleId:12,partnershipId:1,actorId:7,reference:'OPEN-AUG',reason:'خسارة افتتاحية مثبتة'}),openingLoss={...declaration,declarationId:90,financialTransactionId:71,sourceDigest:periodDigest({...declaration,declarationId:90})},policy={depreciation:{kind:'none'},reserve:{kind:'none'},resultAllocation:'dated_results',sharedCostBasis:'expense_date',accountingMethod:'activity_clearing'};
const claims=openingLossClaims(openingLoss,'2026-08-01'),terms=[{id:3,effectiveFrom:first.effectiveFrom,members:first.members.map(m=>({id:m.id,partyKey:`${m.party.kind}:${m.party.id}`,profitBasisPoints:5000,expenseBasisPoints:5000}))}],snapshot:any={formatVersion:1,vehicleId:12,partnershipId:1,setupVersion:3,from:'2026-08-01',to:'2026-08-31',policy,agreements:[first],sourceSnapshots:[],lossClaims:claims,previousClosing:null,openingLoss,calculation:calculatePartnershipClosing({from:'2026-08-01',to:'2026-08-31',terms,sources:[],lossClaims:claims,openingBalanceVerified:true,policy:policy as any})};
const digest=periodDigest(snapshot),actor={id:7,name:'المدير',role:'admin',isActive:true,permissions:[]},dialect=new PgDialect();
let header:any={id:5,partnership_id:1,period:'2026-08-01',status:'approved',version:4,revision:1,source_digest:digest,financial_transaction_id:null,approved_by:7,approved_at:'2026-09-01',policy_snapshot:{snapshot,journal:buildClosingJournal(snapshot)}},lines:any[]=[],rights=[{id:101,status:'approved'},{id:102,status:'approved'}],fail=false,later=false,reconciled:number[]=[];
const tx={execute:async(q:any)=>{const {sql:text,params:p}=dialect.sqlToQuery(q);assert.doesNotMatch(text,/UPDATE financial_transactions|INSERT INTO financial_transactions|INSERT INTO financial_ledger_entries|master_cash_box/);
 if(text.includes('vp_month_header'))return {rows:[structuredClone(header)]};if(text.includes('vp_month_operation'))return {rows:lines.filter(l=>l.source_key===p[1])};if(text.includes('vp_month_submission'))return {rows:lines.filter(l=>!l.source_key.startsWith('operation:'))};
 if(text.includes('vp_month_zero_approval'))return {rows:[{proven:true}]};
 if(text.includes('vp_month_zero_reverse_rights')){rights.forEach(r=>r.status='reversed');return {rows:rights};}
 if(text.includes('vp_month_reopen_zero')){header={...header,status:'draft',version:5,revision:2,approved_by:null,approved_at:null};return {rows:[structuredClone(header)]};}
 if(text.includes('vp_month_line')){const l={source_key:p[2],line_kind:p[3],agreement_id:p[4],member_id:p[5],amount:p[6],snapshot:JSON.parse(String(p[7]))};lines.push(l);return {rows:[{id:lines.length}]};}
 if(text.startsWith('INSERT INTO financial_audit_logs')){if(fail)throw Error('audit unavailable');return {rows:[{id:91}]};}throw Error(text);}};
const path='src/server/vehicle-partnership/closing-lifecycle.ts',tree=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true),body=tree.statements.filter(n=>!ts.isImportDeclaration(n)).map(n=>n.getText(tree).replace(/^export\s+/,'')).join('\n');
const api=vm.runInNewContext(ts.transpileModule(body+'\n({transitionClosing,closingSubmissionLines})',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,{sql,z,createHash,canonicalPartnershipJson,formatMoney,parseMoney,PartnershipValidationError,closingPolicySchema,buildClosingJournal,closingMonthBounds,closingOpeningAllocations,authorizePartnership,partnershipId,partnershipRows,PartnershipRepositoryError,appendPartnershipAudit,lockPartnership:async()=>({id:1,vehicleId:12,ownershipType:'partnership'}),readOriginalVehicle:async()=>({id:12}),lockClosingOriginalSources:async()=>{},assertClosingUnused:async()=>{if(later)throw new PartnershipRepositoryError('later used loss',409,'CONFLICT');return [101,102];},reconcilePaymentState:async(_tx:any,input:any)=>{reconciled.push(input.sourceId);return {approvalStatus:'reversed'};}});
lines=api.closingSubmissionLines(snapshot,1).map((l:any)=>({source_key:l.key,line_kind:l.kind,agreement_id:l.agreementId??null,member_id:l.memberId??null,amount:l.amount,snapshot:l.snapshot}));
const db={transaction:async(work:any)=>{const before=structuredClone({header,lines,rights,reconciled});try{return await work(tx);}catch(e){({header,lines,rights,reconciled}=before);throw e;}}},command={closingId:5,action:'reopen_zero',expectedVersion:4,expectedDigest:digest,idempotencyKey:'opening-zero-reopen',reason:'إعادة مراجعة شهر البداية'};
const run=()=>api.transitionClosing(db,actor,12,command,()=>{throw Error('no zero financial producer');});later=true;await assert.rejects(run);assert.ok(rights.every(r=>r.status==='approved'));later=false;fail=true;await assert.rejects(run,/audit unavailable/);assert.equal(header.status,'approved');assert.ok(rights.every(r=>r.status==='approved'));fail=false;
const result=await run();assert.equal(result.revision,2);assert.equal(header.status,'draft');assert.ok(rights.every(r=>r.status==='reversed'));assert.deepEqual(reconciled,[101,102]);assert.equal(header.policy_snapshot.snapshot.openingLoss.financialTransactionId,71,'original opening FI remains intact');assert.equal((await run()).revision,2);assert.deepEqual(reconciled,[101,102],'retry has no second derived reversal');
console.log('PASS actual zero-month reopening: exact original revision/lines, downstream blocker, derived opening rights reversed atomically, canonical release, original opening journal retained, immutable retry and audit rollback.');
