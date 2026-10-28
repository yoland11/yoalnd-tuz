import assert from "node:assert/strict";
import {PgDialect} from "drizzle-orm/pg-core";
import type {SQL} from "drizzle-orm";
import {reconcilePaymentState} from "../src/server/payment-state";

const dialect=new PgDialect();
for(const sourceType of ["graduation_order","sales_invoice","purchase_invoice"] as const){
 const queries:ReturnType<PgDialect["sqlToQuery"]>[]=[];
 const tx={execute:async(q:SQL)=>{queries.push(dialect.sqlToQuery(q));return {rows:[{id:42,total_amount:"100",approved_paid_amount:"40",remaining_amount:"60",payment_status:"partial"}]};}};
 const state=await reconcilePaymentState(tx,{sourceType,sourceId:42});
 assert.equal(state!.approvedPaidAmount,"40");
 // Sales invoices first run a read-only to_regclass probe for migration 0130 (sales-return credits).
 const statements=queries.filter((query)=>!/^SELECT to_regclass\('public\.sales_return_settlements'\) IS NOT NULL AS ready$/.test(query.sql));
 assert.equal(queries.length-statements.length,sourceType==="sales_invoice"?1:0,"only sales invoices probe for sales-return credits");
 assert.equal(statements.length,sourceType==="graduation_order"?2:1,"graduation canonical approval must also project its linked invoice; unrelated sources unchanged");
 if(sourceType==="graduation_order"){
  const {sql,params}=statements[1];assert.match(sql,/UPDATE sales_invoices/);assert.match(sql,/invoice\.id = source\.invoice_id/);
  assert.match(sql,/NOT EXISTS[\s\S]*financial_transactions/,"never overwrite independent invoice financial history");
  assert.match(sql,/NOT EXISTS[\s\S]*receipt_voucher_allocations/,"never overwrite independent invoice allocations");
  assert.match(sql,/NOT EXISTS\s*\(SELECT 1 FROM installment_contracts/,"never overwrite independent installment payment authority");
  assert.ok(params.includes("40"));assert.ok(params.includes("60"));assert.ok(params.includes("partial"));
 }
}
console.log("PASS canonical graduation payment projects approved state to its original invoice only, preserving independent invoice financial history (SQL contract; no database writes)");
