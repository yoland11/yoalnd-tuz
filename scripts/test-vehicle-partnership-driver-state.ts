import assert from "node:assert/strict";
import {PgDialect} from "drizzle-orm/pg-core";
import {reconcilePaymentState,isPaymentStateSourceType} from "../src/server/payment-state";
import {PARTNERSHIP_TABLE_NAMES} from "../src/server/vehicle-partnership/repository";
const dialect=new PgDialect();let settlements:any[]=[],updates=0;
assert.equal(isPaymentStateSourceType("employee_finance_entry"),false,"do not capture unrelated legacy employee-finance source contracts");
assert.equal(await reconcilePaymentState({execute:async()=>{throw Error("legacy unknown source must not enter the driver adapter");}},{sourceType:"employee_finance_entry",sourceId:51}),null);
assert.equal(isPaymentStateSourceType("vehicle_partnership_driver_entitlement"),true,"driver settlements use a dedicated canonical source for the existing employee record");
const reconcilePartnershipDriverPaymentState=(tx:any,id:number)=>reconcilePaymentState(tx,{sourceType:"vehicle_partnership_driver_entitlement",sourceId:id});
const entry={id:51,employee_id:9,entry_type:"trip_driver_fee",direction:"payable",amount:"25000.00",status:"pending",settled_amount:"0.00",remaining_amount:"25000.00",source_type:"vehicle_expense",source_id:"21",cost_funding_id:31,partnership_id:1,funding_status:"pending",funding_kind:"other",vehicle_expense_id:21,source_amount:"25000.00",source_driver_id:9,source_expense_type:"driver_wage",accrual_id:91,accrual_status:"pending",accrual_source_type:"vehicle_partnership_cost",accrual_source_id:"31",accrual_type:"vp_driver_accrual",accrual_event:"driver_accrual",accrual_amount:"25000.00",accrual_direction:"expense",accrual_reversed:"0.00",invalid_accrual_reversal:false};
const tx={execute:async(statement:any)=>{const q=dialect.sqlToQuery(statement),p=q.params;
 if(q.sql.includes("vp_driver_state_scope"))return {rows:[{vehicle_id:12,expense_id:21}]};
 if(q.sql.includes("to_regclass"))return {rows:PARTNERSHIP_TABLE_NAMES.map(name=>({name,present:true}))};
 if(q.sql.includes("FROM vehicle_partnerships"))return {rows:[{id:1,vehicle_id:12,version:2,ownership_type:"partnership",registration_owner:"شركة"}]};
 if(q.sql.includes("vp_driver_state_expense_lock"))return {rows:[{id:21}]};
 if(q.sql.includes("vp_driver_state_entry"))return {rows:[entry]};
 if(q.sql.includes("vp_driver_state_settlements"))return {rows:settlements};
 if(q.sql.includes("UPDATE employee_finance_entries")){updates++;entry.settled_amount=p[0];entry.remaining_amount=p[1];entry.status=p[2];return {rows:[{id:51}]};}
 throw Error(`unexpected driver reconciliation SQL ${q.sql}`);
}};
let result=await reconcilePartnershipDriverPaymentState(tx,51);assert.equal(result.approvedPaidAmount,"0.00");assert.equal(result.availableAmount,"0.00");assert.equal(updates,0);
entry.status="approved";entry.funding_status="approved";entry.accrual_status="executed";
const payment={id:61,entry_id:51,settlement_type:"payment",settlement_date:"2026-10-26",payment_method:"cash",payroll_line_id:null,amount:"10000.00",financial_transaction_id:101,financial_amount:"10000.00",financial_date:"2026-10-26",financial_method:"cash",financial_status:"pending",financial_source_type:"vehicle_partnership_driver",financial_source_id:"61",financial_type:"vp_driver_payment",financial_event:"driver_fee_settlement",financial_direction:"expense",reversed_amount:"0.00",invalid_reversal:false,financial_uses:1};
// These cases must fail before either pending holds or paid cache updates can use
// an unrelated payroll settlement or a financial request with altered cash data.
const invalidSettlementProofs:[string,Record<string,unknown>][]=[
 ["payroll-linked settlement",{payroll_line_id:77}],
 ["nonpayment settlement type",{settlement_type:"payroll_deduction"}],
 ["missing settlement type",{settlement_type:null}],
 ["missing settlement date",{settlement_date:null}],
 ["missing financial date",{financial_date:null}],
 ["mismatched financial date",{financial_date:"2026-10-27"}],
 ["empty dates",{settlement_date:"",financial_date:""}],
 ["malformed dates",{settlement_date:"2026/10/26",financial_date:"2026/10/26"}],
 ["missing settlement method",{payment_method:null}],
 ["missing financial method",{financial_method:null}],
 ["mismatched financial method",{financial_method:"transfer"}],
 ["unsupported matching methods",{payment_method:"other",financial_method:"other"}],
];
const acceptedInvalidProofs:string[]=[];
for(const [label,patch] of invalidSettlementProofs){
 settlements=[{...payment,...patch}];const before=updates;
 try{await reconcilePartnershipDriverPaymentState(tx,51);acceptedInvalidProofs.push(label);}
 catch(error){assert.equal((error as any).status,409,label);}
 assert.equal(updates,before,`${label} must not update the entitlement cache`);
}
assert.deepEqual(acceptedInvalidProofs,[],"cash settlement proof must reject payroll links, wrong settlement types, and missing/mismatched date or method");
settlements=[payment];result=await reconcilePartnershipDriverPaymentState(tx,51);assert.equal(result.reservedAmount,"10000.00");assert.equal(result.approvedPaidAmount,"0.00");assert.equal(result.availableAmount,"15000.00");assert.equal(entry.settled_amount,"0.00");
for(const method of ["cash","transfer","pos"]){settlements=[{...payment,payment_method:method,financial_method:method}];result=await reconcilePartnershipDriverPaymentState(tx,51);assert.equal(result.reservedAmount,"10000.00",`${method} cash request reserves the exact amount`);}
settlements=[{...payment,financial_transaction_id:null}];await assert.rejects(()=>reconcilePartnershipDriverPaymentState(tx,51),"an unlinked staged settlement still fails closed");
settlements=[payment];payment.financial_status="executed";result=await reconcilePartnershipDriverPaymentState(tx,51);assert.equal(result.approvedPaidAmount,"10000.00");assert.equal(result.remainingAmount,"15000.00");assert.equal(entry.status,"partially_settled");
let before=updates;await reconcilePartnershipDriverPaymentState(tx,51);assert.equal(updates,before,"replaying canonical executed state does not rewrite its cache");
payment.reversed_amount="2500.00";result=await reconcilePartnershipDriverPaymentState(tx,51);assert.equal(result.approvedPaidAmount,"7500.00");assert.equal(result.remainingAmount,"17500.00");
payment.reversed_amount="10000.00";result=await reconcilePartnershipDriverPaymentState(tx,51);assert.equal(result.approvedPaidAmount,"0.00");assert.equal(result.remainingAmount,"25000.00");assert.equal(result.reservedAmount,"0.00");assert.equal(entry.status,"approved");before=updates;await reconcilePartnershipDriverPaymentState(tx,51);assert.equal(updates,before,"full reversal replay preserves the rebuilt zero-paid cache");
payment.reversed_amount="0.00";payment.financial_status="rejected";result=await reconcilePartnershipDriverPaymentState(tx,51);assert.equal(result.approvedPaidAmount,"0.00");assert.equal(result.reservedAmount,"0.00");assert.equal(result.availableAmount,"25000.00");assert.equal(updates,before,"rejected requests neither reserve nor rewrite an accurate cache");
payment.financial_status="executed";payment.reversed_amount="2500.00";
settlements=[payment,{...payment,id:62,financial_transaction_id:102,financial_source_id:"62",financial_status:"pending",amount:"20000.00",financial_amount:"20000.00",reversed_amount:"0.00"}];await assert.rejects(()=>reconcilePartnershipDriverPaymentState(tx,51),(e:any)=>e.status===409);
settlements=[{...payment,financial_uses:2}];await assert.rejects(()=>reconcilePartnershipDriverPaymentState(tx,51),(e:any)=>e.status===409);
settlements=[];entry.source_driver_id=10;await assert.rejects(()=>reconcilePartnershipDriverPaymentState(tx,51),(e:any)=>e.status===409);entry.source_driver_id=9;
entry.source_amount="26000.00";await assert.rejects(()=>reconcilePartnershipDriverPaymentState(tx,51),(e:any)=>e.status===409);entry.source_amount="25000.00";
entry.invalid_accrual_reversal=true;await assert.rejects(()=>reconcilePartnershipDriverPaymentState(tx,51),(e:any)=>e.status===409,"an unrelated financial reversal cannot erase the original wage accrual");entry.invalid_accrual_reversal=false;
console.log("PASS existing employee-finance driver state: original per-trip wage identity, approved accrual, payment-only non-payroll settlements, exact cash date/method proof, pending holds vs executed partial cash, reversals, no overpayment/duplicate source and idempotent derived snapshots only.");
