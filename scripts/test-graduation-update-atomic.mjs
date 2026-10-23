import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import ts from 'typescript';
const source = process.env.AJN_ARCHIVE_BASELINE === '1' ? execFileSync('git',['show','95a867f81:src/server/graduation.ts'],{encoding:'utf8'}) : readFileSync('src/server/graduation.ts','utf8');
const ast=ts.createSourceFile('graduation.ts',source,ts.ScriptTarget.Latest,true);
const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='updateOrder');
const code=ts.transpileModule(fn.getText(ast).replace(/^export /,'')+'\nglobalThis.run=updateOrder;', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
for(const mode of ['archived','wrong_group','stale_stock','stock_failure','pending','finance_failure','stage']) {
  let row={id:42,groupId:8,orderNo:'GR-42',status:'new',productionStage:'new',archivedAt:null,totalAmount:'100',discountAmount:'0',paidAmount:'0',remainingAmount:'100',inventoryApplied:true,inventoryItems:[],invoiceId:91};
  if(mode==='archived')row.archivedAt=new Date(); if(mode==='wrong_group')row.groupId=9;
  if(mode==='stale_stock')row.inventoryApplied=false;
  let active=false,locked=false,restores=0,commits=0,financial=0,reconciled=0; const writes=[];
  const graduationOrdersTable={id:'order.id',name:'order'}, salesInvoicesTable={name:'invoice'}, salesInvoiceItemsTable={name:'items'},tasksTable={name:'tasks'};
  const tx={
    select:()=>({from:()=>({where:()=>({limit:()=>({for:async()=>{assert.ok(active);locked=true;return[{...row}];}})})})}),
    query:{graduationOrdersTable:{findFirst:async()=>({...row})},graduationGroupsTable:{findFirst:async()=>null}},
    update:t=>({set:values=>({where:()=>{assert.ok(active&&locked,'writes must use the locked fresh row');writes.push({table:t.name,values}); if(t===graduationOrdersTable)Object.assign(row,values); const result=Promise.resolve([]);result.returning=async()=>[{...row}];return result;}})}),
  };
  const db={transaction:async fn=>{active=true;const before=structuredClone(row);try{const result=await fn(tx);commits++;return result;}catch(cause){row=before;writes.length=0;restores=0;financial=0;throw cause;}finally{active=false;}}};
  const scoped=async(...args)=>{assert.equal(args.at(-1),tx,'helper cannot escape a one-connection transaction');assert.ok(active&&locked);};
  const context=vm.createContext({db,ensureMasterCashBoxTables:async()=>{assert.ok(!active);},graduationOrdersTable,graduationGroupsTable:{id:'group.id'},salesInvoicesTable,salesInvoiceItemsTable,tasksTable,
    graduationAdminPatchSchema:{safeParse:raw=>({success:true,data:raw})}, money:v=>Number(v), safeJson:v=>v??{}, tailorAssignment:()=>({}),
    getGraduationProductionMeasurementBlock:async(...args)=>{await scoped(...args);return null;},
    error:(message,status)=>({message,status}),eq:(...args)=>args,and:(...args)=>args,lte:()=>{},inArray:()=>{},
    GRADUATION_STAGES:['new','design'],GRADUATION_STAGE_LABELS:{design:'تصميم'},
    addActivity:scoped,addTimeline:scoped,notify:scoped,publicOrder:v=>v,actor:v=>v,
    applyInventory:async(...args)=>{await scoped(...args);restores++;if(mode==='stock_failure')throw Error('stock unavailable');},
    restoreGraduationInventoryFromMovements:async(...args)=>{await scoped(...args);restores++;if(mode==='stock_failure')throw Error('stock unavailable');},
    syncSourcePaymentTarget:async(...args)=>{await scoped(...args);financial++;if(mode==='finance_failure')throw Error('finance unavailable');return{id:7};},
    reconcilePaymentState:async(connection,source)=>{assert.equal(connection,tx);reconciled++; if(source.sourceType==='graduation_order')Object.assign(row,{paidAmount:'0',remainingAmount:'100',paymentStatus:'unpaid'});},
  }); vm.runInContext(code,context);
  const stale={...row,groupId:8,archivedAt:null,inventoryApplied:true,paidAmount:'999',productionStage:'old'};
  const input=mode==='pending'||mode==='finance_failure'?{paidAmount:40}:mode==='stage'?{productionStage:'design'}:{status:'cancelled'};
  if(mode.endsWith('_failure')) {
    await assert.rejects(()=>context.run(stale,input,{id:1}),/unavailable/);assert.equal(commits,0);assert.equal(row.status,'new');assert.equal(restores,0);assert.equal(financial,0);assert.equal(writes.length,0);
  } else {
    const result=await context.run(stale,input,{id:1});
    if(mode==='archived'||mode==='wrong_group'){assert.ok(result.response);assert.equal(writes.length,0);}
    else {assert.ok(result.order);assert.equal(commits,1);assert.equal(reconciled,1);assert.equal(result.order.paidAmount,'0','pending request must not become approved money');if(mode==='stale_stock')assert.equal(restores,0);if(mode==='pending')assert.equal(financial,1);if(mode==='stage')assert.equal(result.order.productionStage,'design');}
  }
}
console.log('PASS actual graduation update: stale/archived rejection, transactional stock + pending finance, canonical approved-only snapshots, stage helper executor (controlled I/O)');
