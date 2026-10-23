import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {PgDialect} from 'drizzle-orm/pg-core';
const require=createRequire(import.meta.url),module={exports:{}};
const code=ts.transpileModule(readFileSync('src/server/payment-state.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
new Function('require','module','exports',code)(require,module,module.exports);
const dialect=new PgDialect();
for(const sourceType of ['graduation_order','sales_invoice','purchase_invoice']) {
  const queries=[];
  const tx={execute:async q=>{queries.push(dialect.sqlToQuery(q));return{rows:[{id:42,total_amount:'100',approved_paid_amount:'40',remaining_amount:'60',payment_status:'partial'}]};}};
  const state=await module.exports.reconcilePaymentState(tx,{sourceType,sourceId:42});
  assert.equal(state.approvedPaidAmount,'40');
  assert.equal(queries.length,sourceType==='graduation_order'?2:1,'graduation canonical approval must also project its linked invoice; unrelated sources unchanged');
  if(sourceType==='graduation_order') {
    const {sql,params}=queries[1];assert.match(sql,/UPDATE sales_invoices/);assert.match(sql,/invoice\.id = source\.invoice_id/);
    assert.match(sql,/NOT EXISTS[\s\S]*financial_transactions/,'never overwrite independent invoice financial history');
    assert.match(sql,/NOT EXISTS[\s\S]*receipt_voucher_allocations/,'never overwrite independent invoice allocations');
    assert.match(sql,/NOT EXISTS\s*\(SELECT 1 FROM installment_contracts/,'never overwrite independent installment payment authority');
    assert.ok(params.includes('40'));assert.ok(params.includes('60'));assert.ok(params.includes('partial'));
  }
}
console.log('PASS canonical graduation payment projects approved state to its original invoice only, preserving independent invoice financial history (SQL contract; no database writes)');
