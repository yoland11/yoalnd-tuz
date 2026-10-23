import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const ast=ts.createSourceFile('operations.ts',readFileSync('src/server/graduation-operations.ts','utf8'),ts.ScriptTarget.Latest,true);
const names=new Set(['receivePayment']);
const code=ts.transpileModule(ast.statements.filter(n=>(ts.isFunctionDeclaration(n)&&names.has(n.name?.text))||(ts.isClassDeclaration(n)&&n.name?.text==='GraduationPaymentRejected')).map(n=>n.getText(ast).replace(/^export /,'')).join('\n')+'\nglobalThis.run=receivePayment;', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
for(const mode of ['archived','clear','update_failure','receipt_failure','duplicate','insufficient_headroom']) {
  let active=false,locked=false,commits=0,writes=[];let order={id:42,groupId:8,customerId:4,totalAmount:'100',paidAmount:'0',remainingAmount:'100',status:'new',archivedAt:null,financialTransactionId:7};
  const graduationOrdersTable={id:'order.id',createdAt:'created'}, graduationStudentPaymentsTable={name:'payment'},graduationReceiptsTable={name:'receipt'};
  const tx={
    execute:async()=>{assert.ok(active);return{rows:[{pending_amount:'40'}]};},
    select:()=>({from:()=>({where:()=>({orderBy:()=>({for:async()=>{assert.ok(active);locked=true;return mode==='archived'?[]:[{...order}];}})})})}),
    query:{graduationStudentPaymentsTable:{findFirst:async()=>mode==='duplicate'?{id:1}:null},graduationOrdersTable:{findFirst:async()=>({...order})}},
    insert:table=>({values:data=>{assert.ok(active&&locked,'payment insert must follow the order lock');writes.push({table:table.name,data});if(mode==='receipt_failure'&&table===graduationReceiptsTable)throw Error('receipt unavailable');return{returning:async()=>[{...data,id:11}],then:resolve=>resolve()};}}),
    update:()=>({set:()=>({where:async()=>{assert.ok(active&&locked);}})}),
  };
  const db={query:{graduationStudentPaymentsTable:{findFirst:async()=>{assert.fail('batch read escaped the payment transaction');}}},transaction:async fn=>{active=true;try{const result=await fn(tx);commits++;return result;}catch(cause){writes=[];throw cause;}finally{active=false;}}};
  const context=vm.createContext({db,ensureMasterCashBoxTables:async()=>{assert.ok(!active);},graduationOrdersTable,graduationStudentPaymentsTable,graduationReceiptsTable,graduationGroupsTable:{id:'group.id'},
    sql:(parts,...values)=>({parts,values}),and:()=>{},eq:()=>{},asc:()=>{},amount:v=>Number(v),randomUUID:()=> 'batch',
    paymentSchema:{safeParse:raw=>({success:true,data:raw})},fail:(message,status)=>({message,status}),
    receiptSnapshot:v=>v,actor:v=>v,audit:async(...args)=>{assert.equal(args.at(-1),tx);assert.ok(active);},
    reconcilePaymentState:async(connection)=>{assert.equal(connection,tx);assert.ok(locked);},
    updateOrder:async(_order,patch,_user,connection)=>{
      assert.equal(connection,tx);assert.ok(active&&locked);assert.equal(patch.paidAmount,70,'40 pending + 30 new must form a 70 target without counting it as approved');
      if(mode==='update_failure')throw Error('finance unavailable');return{order};
    },
  });vm.runInContext(code,context);
  if(mode.endsWith('_failure')){await assert.rejects(()=>context.run({amount:30,strategy:'selected',paymentMethod:'cash',idempotencyKey:'batch'},{id:1},undefined,42),/unavailable/);assert.equal(commits,0);assert.equal(writes.length,0);}
  else {const result=await context.run({amount:mode==='insufficient_headroom'?70:30,strategy:'selected',paymentMethod:'cash',idempotencyKey:'batch'},{id:1},undefined,42);if(['archived','duplicate','insufficient_headroom'].includes(mode)){assert.ok(result.response);assert.equal(writes.length,0);if(mode==='insufficient_headroom')assert.equal(result.response.status,409);}else{assert.equal(result.allocated,30);assert.equal(writes.filter(w=>w.table==='payment').length,1);assert.equal(writes.filter(w=>w.table==='receipt').length,1);assert.equal(commits,1);}}
}
console.log('PASS actual graduation receivePayment: fresh active order lock, pending target accumulation, payment/receipt/financial rollback, durable duplicate batch rejection (controlled I/O)');
