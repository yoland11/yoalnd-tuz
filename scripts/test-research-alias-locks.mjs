import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {sql} from 'drizzle-orm';
import {PgDialect} from 'drizzle-orm/pg-core';
const dialect=new PgDialect();
const runSource=(source,context)=>vm.runInContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,context);
const installment=ts.createSourceFile('installments.ts',readFileSync('src/server/installments.ts','utf8'),ts.ScriptTarget.Latest,true);
let convert;const visit=node=>{if(ts.isCallExpression(node)&&node.expression.getText(installment)==='db.transaction'&&node.arguments[0]?.getText(installment).includes("nextval('installment_contracts_id_seq')"))convert=node.arguments[0];ts.forEachChild(node,visit)};visit(installment);assert.ok(convert);
for(const name of ['convert','postInstallmentPayment','reconcileInstallmentPaymentsInTransaction']){
 const fn=installment.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);
 const source=name==='convert'?`globalThis.run=${convert.getText(installment)};`:fn.getText(installment).replace(/^export /,'')+`\nglobalThis.run=${name};`;
 let guarded=false;const tx={execute:()=>assert.fail(`${name}: contract/invoice lock preceded research original`)};
 const context=vm.createContext({sql,db:{transaction:fn=>fn(tx)},invoice:{id:91},money:Number,ensureMasterCashBoxTables:async()=>{},lockGraduationPaymentSource:async()=>{},lockResearchPaymentSources:async(connection,source)=>{assert.equal(connection,tx);assert.equal(source.sourceType,name==='convert'?'sales_invoice':'installment_contract');guarded=true;throw Error('research lock acquired');}});
 runSource(source,context);
 await assert.rejects(()=>name==='convert'?context.run(tx):name==='postInstallmentPayment'?context.run(5,{amount:40,idempotencyKey:'same'},{id:1}):context.run(tx,5,{id:1}),/research lock acquired/);assert.ok(guarded);
}
const returns=ts.createSourceFile('sales-returns.ts',readFileSync('src/server/sales-returns.ts','utf8'),ts.ScriptTarget.Latest,true);
for(const name of ['reverseSettlement','reverseSalesReturn']){
 const fn=returns.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);let guarded=false;
 const settlements=[{id:1,return_id:3,invoice_id:8,status:'applied',kind:'invoice_credit'}];
 const tx={execute:async query=>{const statement=dialect.sqlToQuery(query).sql;if(statement.includes('FROM sales_return_settlements'))return{rows:settlements};if(statement.includes('sales_invoices')&&statement.includes('FOR UPDATE'))assert.fail('invoice locked before research original');return{rows:[]}}};
 const context=vm.createContext({sql,rows:result=>result.rows,text:String,requireReady:async()=>{},requireReturnPermission:()=>{},lockReturn:async()=>({status:'approved'}),lockResearchPaymentSources:async(connection,source)=>{assert.equal(connection,tx);const sources=Array.isArray(source)?source:[source];assert.ok(sources.some(item=>item.sourceType==='sales_invoice'&&item.sourceId===8));guarded=true;throw Error('research lock acquired');}});
 runSource(fn.getText(returns).replace(/^export /,'')+`\nglobalThis.run=${name};`,context);
 await assert.rejects(()=>context.run({transaction:fn=>fn(tx)},{id:1},name==='reverseSettlement'?1:3,'سبب العكس'),/research lock acquired/);assert.ok(guarded);
}
const api=ts.createSourceFile('api.ts',readFileSync('src/server/api.ts','utf8'),ts.ScriptTarget.Latest,true);
const callbacks=[];const collect=node=>{if(ts.isCallExpression(node)&&node.expression.getText(api)==='db.transaction'&&node.arguments[0])callbacks.push(node.arguments[0]);ts.forEachChild(node,collect)};collect(api);
for(const [name,marker] of [['invoice edit','date: b.date ?? existing.date'],['invoice cancellation','SELECT DISTINCT receipt_voucher_id'],['receipt request','lockEquipmentRentalReceiptAllocations(tx, allocations, customer)']]){
 const callback=callbacks.find(node=>node.getText(api).includes(marker));assert.ok(callback,name);let guarded=false;
 const tx={update:()=>assert.fail(`${name}: invoice mutation before original research lock`),execute:async query=>{const statement=dialect.sqlToQuery(query).sql;if(statement.includes('FOR UPDATE'))assert.fail(`${name}: invoice lock before original research lock`);return{rows:[{receipt_voucher_id:12}]}}};
 const context=vm.createContext({sql,id:8,allocations:[{sourceType:'sales_invoice',sourceId:8}],lockGraduationPaymentSource:async()=>{},lockResearchPaymentSources:async(connection,source)=>{assert.equal(connection,tx);const sources=Array.isArray(source)?source:[source];assert.ok(sources.some(item=>item.sourceType==='sales_invoice'&&item.sourceId===8));if(name==='invoice cancellation')assert.ok(sources.some(item=>item.sourceType==='receipt_voucher'&&item.sourceId===12));guarded=true;throw Error('research lock acquired');}});
 runSource(`globalThis.run=${callback.getText(api)};`,context);
 await assert.rejects(()=>context.run(tx),/research lock acquired/);assert.ok(guarded);
}
console.log('PASS research original locks precede installment contracts, legacy return invoices and generic invoice/receipt writes (real handlers, controlled I/O).');
