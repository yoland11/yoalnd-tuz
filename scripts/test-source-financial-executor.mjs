import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import ts from 'typescript';
import {assertGenericFinancialSourceInput} from './lib/vehicle-partnership-financial-guard-test.mjs';
const source=process.env.AJN_ARCHIVE_BASELINE==='1'?execFileSync('git',['show','95a867f81:src/server/master-cash-box.ts'],{encoding:'utf8'}):readFileSync('src/server/master-cash-box.ts','utf8');
const ast=ts.createSourceFile('finance.ts',source,ts.ScriptTarget.Latest,true),names=new Set(['addAudit','createFinancialTransaction','createSourceFinancialRequest','syncSourcePaymentTarget','syncSourceFinancialRequest','cancelFinancialTransactionRequest']);
const guardAst=ts.createSourceFile('guard.ts',readFileSync('src/server/graduation-write-guard.ts','utf8'),ts.ScriptTarget.Latest,true);
const guard=guardAst.statements.filter(n=>(ts.isFunctionDeclaration(n)&&n.name?.text==='lockGraduationPaymentSource')||(ts.isClassDeclaration(n)&&n.name?.text==='GraduationOrderWriteConflict')).map(n=>n.getText(guardAst).replace(/^export /,'')).join('\n');
const code=ts.transpileModule(guard+'\n'+ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.has(n.name?.text)).map(n=>n.getText(ast).replace(/^export /,'')).join('\n')+'\nglobalThis.run=syncSourcePaymentTarget;globalThis.cancel=cancelFinancialTransactionRequest;', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
for(const mode of ['new','pending','executed','reversal','zero','audit_failure','legacy','legacy_cancel']) {
  let rows=mode==='pending'||mode==='zero'||mode==='legacy_cancel'?[{id:1,sourceType:'graduation_order',sourceId:'42',approvalStatus:'pending',direction:'revenue',amount:'40'}]:mode==='executed'||mode==='reversal'?[{id:1,sourceType:'graduation_order',sourceId:'42',approvalStatus:'executed',direction:'revenue',amount:mode==='reversal'?'70':'30'}]:[];
  let active=false,commits=0,reconciled=0;const audits=[];
  const financialTransactionsTable={id:'fin.id'},financialAuditLogsTable={id:'audit.id'};
  const connection={
    query:{financialTransactionsTable:{findFirst:async()=>rows.find(r=>r.approvalStatus!=='executed')}},
    select:()=>({from:()=>({where:()=>({orderBy:async()=>rows,limit:()=>({for:async()=>rows})})})}),
    insert:table=>({values:asyncOrBuilder(table)}),
    update:()=>({set:patch=>({where:()=>({returning:async()=>{const existing=rows.at(-1);Object.assign(existing,patch);return[existing];}})})}),
    execute:async()=>({rows:[{id:42,status:'new',archived_at:null}]}),
  };
  function asyncOrBuilder(table){return data=>{if(table===financialAuditLogsTable){if(mode==='audit_failure')throw Error('audit unavailable');audits.push(data);return Promise.resolve();}const row={...data,id:rows.length+1};rows.push(row);return{returning:async()=>[row]};};}
  const blocked=()=>assert.fail('financial helper escaped the supplied transaction');
  const db={...connection,transaction:async fn=>{if(active)assert.fail('nested pool transaction');active=true;const before=structuredClone(rows);try{const result=await fn(connection);commits++;return result;}catch(cause){rows=before;audits.length=0;throw cause;}finally{active=false;}}};
  if(!mode.startsWith('legacy')){db.select=blocked;db.insert=blocked;db.update=blocked;db.query={financialTransactionsTable:{findFirst:blocked}};}
  const context=vm.createContext({db,financialTransactionsTable,financialAuditLogsTable,assertGenericFinancialSourceInput,
    financialTransactionInputSchema:{parse:input=>({...input,attachments:input.attachments??[]})},randomUUID:()=> 'uuid',todayBaghdad:()=> '2026-10-23',transactionNumber:id=>`FIN-${id}`,money:v=>Math.round(Number(v||0)*100)/100,snapshot:v=>v,
    eq:()=>{},and:()=>{},desc:()=>{},sql:(parts,...values)=>({parts,values}),ensureMasterCashBoxTables:async()=>{},isPaymentStateSourceType:v=>v==='graduation_order',reconcilePaymentState:async tx=>{assert.equal(tx,connection);reconciled++;},
  });vm.runInContext(code,context);
  const input={sourceType:'graduation_order',sourceId:42,targetAmount:mode==='zero'?0:mode==='new'||mode==='audit_failure'||mode==='legacy'?40:mode==='reversal'?40:70,normalDirection:'revenue',department:'graduation',transactionType:'graduation_payment',description:'دفعة'};
  const call=()=>mode==='legacy_cancel'?context.cancel(1,{id:1},'إلغاء الطلب'):mode==='legacy'?context.run(input,{id:1}):db.transaction(tx=>context.run(input,{id:1},tx));
  if(mode==='audit_failure'){await assert.rejects(call,/audit unavailable/);assert.equal(rows.length,0);assert.equal(commits,0);}
  else {const result=await call();if(mode==='zero'||mode==='legacy_cancel'){assert.equal(rows[0].approvalStatus,'rejected');assert.equal(reconciled,1);}else{assert.equal(result.approvalStatus,'pending');assert.equal(Number(result.amount),mode==='pending'?70:mode==='reversal'?30:40);assert.equal(result.direction,mode==='reversal'?'expense':'revenue');assert.equal(audits.length,1);}assert.equal(rows.filter(r=>r.approvalStatus==='executed').length,mode==='executed'||mode==='reversal'?1:0);}
}
console.log('PASS actual source financial helpers: existing delta rules and legacy callers preserved; supplied executor covers create/sync/cancel/audit without nested transactions or pending cash posting (controlled I/O)');
