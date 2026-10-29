import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
import {sql} from 'drizzle-orm';
import {PgDialect} from 'drizzle-orm/pg-core';
import {randomUUID} from 'node:crypto';
import {periodDigest} from '../src/lib/vehicle-partnership/period-attributions';
import {openingLossDeclaration} from '../src/lib/vehicle-partnership/opening-loss';
import {parseMoney,formatMoney} from '../src/lib/vehicle-partnership/money';
import {PartnershipValidationError} from '../src/lib/vehicle-partnership/types';
import {authorizePartnership,partnershipId} from '../src/server/vehicle-partnership/agreements';
import {appendPartnershipAudit,partnershipRows,PartnershipRepositoryError} from '../src/server/vehicle-partnership/repository';
import {openingLossStore} from '../src/server/vehicle-partnership/opening-loss-proof';
import {partnershipAccount,provePartnershipJournal} from '../src/server/vehicle-partnership/journal';
const path='src/server/vehicle-partnership/opening-loss-posting.ts';
assert.ok(existsSync(path),'opening loss requires its own source-owned noncash approval/rejection/unused full reversal');
const actor={id:7,name:'المدير',role:'admin',isActive:true,permissions:[]},root={id:1,vehicleId:12,version:3,ownershipType:'partnership'};
const first={id:5,revision:1,effectiveFrom:'2026-08-20',status:'approved',policy:{openingLoss:'100.01'},members:[{id:11,party:{kind:'customer',id:1},expenseBasisPoints:5000},{id:12,party:{kind:'supplier',id:2},expenseBasisPoints:5000}]};
const declaration=openingLossDeclaration(first,{vehicleId:12,partnershipId:1,actorId:7,reference:'OPEN-2026-08',reason:'خسارة مثبتة من الاتفاق الأصلي'}),sourceSnapshot={...declaration,declarationId:90},d={id:90,declaration,sourceSnapshot,sourceDigest:periodDigest(sourceSnapshot),operationKey:'declare-001',fingerprint:'a'.repeat(64)};
const initial={id:71,sourceType:'vehicle_partnership_opening',sourceId:'90'};
let f:any,reverse:any,audits:any[],ledger:any[],blocked=false,fail='',clock='2026-10-28T10:00:00.000Z';
function reset(){f={id:71,source_type:initial.sourceType,source_id:'90',source_event:'opening_loss',transaction_type:'vp_opening_loss',direction:'revenue',amount:'100.01',transaction_date:first.effectiveFrom,payment_method:'other',department:'transportation',idempotency_key:'vp:opening-loss:90',approval_status:'pending',balance_before:null,balance_after:null,reversed_transaction_id:null,reversal_txn_id:null,reversed_at:null,reversed_amount:'0.00',invalid_reversal:false};reverse=null;audits=[];ledger=[];blocked=false;fail='';}
reset();const dialect=new PgDialect(),accounts=new Map([['VP-LOSS',1],['VP-OPENING-CLEAR',2]]);
const tx={execute:async(q:any)=>{const {sql:text,params:p}=dialect.sqlToQuery(q);if(fail&&text.includes(fail))throw Error('opening posting source unavailable');assert.doesNotMatch(text,/UPDATE master_cash_box|INSERT INTO vehicle_expenses|INSERT INTO cash_box/);
 if(text.includes('vp_opening_financial'))return {rows:[{...f,request_values:{vehicleId:12,partnershipId:1,sourceType:initial.sourceType,sourceId:90,amount:'100.01',sourceDigest:d.sourceDigest,sourceSnapshot}}]};
 if(text.includes('vp_opening_approval'))return {rows:audits.filter(a=>a.action==='vehicle_partnership_opening_approved')};
 if(text.includes('vp_opening_reverse_proof'))return {rows:reverse?[reverse]:[]};
 if(text.includes('vp_opening_reverse_audit'))return {rows:audits.filter(a=>a.action==='vehicle_partnership_opening_reversed')};
 if(text.includes('vp_opening_unused'))return {rows:blocked?[{id:5}]:[]};
 if(text.includes('vp_opening_pending_journal'))return {rows:ledger.filter(l=>l.transaction_id===71)};
 if(text.includes('vp_activity_journal_proof'))return {rows:ledger.filter(l=>l.transaction_id===Number(p[0]))};
 if(text.includes('vp_chart_account'))return {rows:[{id:accounts.get(String(p[0])),code:p[0],account_type:p[0]==='VP-LOSS'?'asset':'equity',is_active:true}]};
 if(text.includes('vp_opening_approve_write')){Object.assign(f,{approval_status:'executed',approved_by:p[0],executed_by:p[2],approved_at:clock,executed_at:clock});return {rows:[{id:71}]};}
 if(text.includes('vp_opening_reject_write')){f.approval_status='rejected';return {rows:[{id:71}]};}
 if(text.includes('vp_opening_reverse_key'))return {rows:[]};
 if(text.includes('vp_opening_reverse_insert')){reverse={id:81,transaction_no:p[0],transaction_date:'2026-10-28',direction:'expense',amount:p[1],department:'transportation',transaction_type:'vp_opening_loss_reversal',source_type:initial.sourceType,source_id:p[2],source_event:'reversal',idempotency_key:p[3],reversed_transaction_id:p[4],reversal_reason:p[5],approval_status:'executed',payment_method:'other',requested_by:p[6],approved_by:p[8],executed_by:p[10],approved_at:clock,executed_at:clock,balance_before:null,balance_after:null};return {rows:[{id:81}]};}
 if(text.includes('vp_opening_reverse_number')){reverse.transaction_no=p[0];return {rows:[{id:81}]};}
 if(text.includes('vp_opening_reverse_original')){Object.assign(f,{reversal_txn_id:p[0],reversed_by:p[1],reversal_reason:p[3],reversed_at:clock,reversed_amount:'100.01'});return {rows:[{id:71}]};}
 if(text.startsWith('INSERT INTO financial_ledger_entries')){ledger.push({id:ledger.length+1,transaction_id:p[0],account_id:p[1],code:[...accounts].find(([,id])=>id===p[1])?.[0],entry_side:p[2],amount:p[3]});return {rows:[{id:ledger.length}]};}
 if(text.startsWith('INSERT INTO financial_audit_logs')){audits.push({id:100+audits.length,transaction_id:p[0],action:p[1],actor_id:p[2],new_values:JSON.parse(String(p[5]))});return {rows:[{id:100+audits.length-1}]};}
 throw Error('unexpected opening posting SQL '+text);}};
const tree=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true),body=tree.statements.filter(n=>!ts.isImportDeclaration(n)).map(n=>n.getText(tree).replace(/^export\s+/,'')).join('\n');
const api=vm.runInNewContext(ts.transpileModule(body+'\n({executeOpeningLoss,rejectOpeningLoss,reverseOpeningLoss})',{compilerOptions:{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022}}).outputText,{sql,randomUUID,periodDigest,parseMoney,formatMoney,PartnershipValidationError,authorizePartnership,partnershipId,appendPartnershipAudit,partnershipRows,PartnershipRepositoryError,openingLossStore,partnershipAccount,provePartnershipJournal,lockOpeningLossContext:async(_tx:any,user:any,id:number)=>{authorizePartnership(user,true);assert.equal(id,90);return {root,declaration:d,first,financial:{...f}};}});
async function atomic(work:()=>Promise<any>){const saved=structuredClone({f,reverse,audits,ledger});try{return await work();}catch(e){({f,reverse,audits,ledger}=saved);throw e;}}
const approve=(user:any=actor)=>atomic(()=>api.executeOpeningLoss(tx,initial,user,'موافقة إثبات'));
const undo=(reason='تصحيح الإثبات قبل استخدامه',options:any={idempotencyKey:'opening-reverse-001'})=>atomic(()=>api.reverseOpeningLoss(tx,initial,actor,reason,options,(id:number)=>`FIN-${id}`));
await approve();assert.equal(f.approval_status,'executed');assert.equal(ledger.length,2);assert.equal(audits.length,1);assert.equal((await openingLossStore.proveApproval(tx,d,f)).members[0].amount,'50.01');await approve();assert.equal(ledger.length,2);assert.equal(audits.length,1);
blocked=true;await assert.rejects(undo);assert.equal(reverse,null);blocked=false;await assert.rejects(()=>undo(undefined,{amount:50}));await assert.rejects(()=>undo(undefined,{sourceId:100}));
const reversed=await undo();assert.equal(reversed.reverseId,81);assert.equal(reversed.alreadyReversed,false);assert.equal(ledger.length,4);assert.equal((await undo()).alreadyReversed,true);assert.equal(ledger.length,4);await assert.rejects(()=>undo('سبب مختلف'));await assert.rejects(()=>undo(undefined,{idempotencyKey:'other-reverse-002'}));
const proof=await openingLossStore.proveReversal(tx,d,f);assert.equal(proof.reverseId,81);reverse.source_id='91';await assert.rejects(()=>openingLossStore.proveReversal(tx,d,f));reverse.source_id='90';audits.pop();await assert.rejects(()=>openingLossStore.proveReversal(tx,d,f));
reset();fail='INSERT INTO financial_audit_logs';await assert.rejects(approve,/unavailable/);assert.equal(f.approval_status,'pending');assert.equal(ledger.length,0);fail='';await approve();fail='vp_opening_reverse_original';await assert.rejects(undo,/unavailable/);assert.equal(reverse,null);assert.equal(ledger.length,2);
reset();await assert.rejects(()=>approve({...actor,role:'employee'}),(e:any)=>e.status===403);await atomic(()=>api.rejectOpeningLoss(tx,initial,actor,'مستند غير مطابق'));assert.equal(f.approval_status,'rejected');assert.equal(ledger.length,0);await assert.rejects(approve);
reset();ledger.push({transaction_id:71});await assert.rejects(approve);assert.equal(f.approval_status,'pending');reset();await approve();f.approved_at=new Date('2026-10-28T10:00:00.900Z');f.executed_at=new Date('2026-10-28T10:00:00.800Z');await assert.rejects(()=>openingLossStore.proveApproval(tx,d,f),'Date millisecond ordering must not be rounded');
console.log('PASS opening noncash posting: exact balanced journal, source approval/retry, unused-only full reversal, original linked history/audit proof, rollback, permission and precise timestamps.');
