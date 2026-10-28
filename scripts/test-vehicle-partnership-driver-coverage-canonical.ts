import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {sql} from "drizzle-orm";
import {PgDialect} from "drizzle-orm/pg-core";
import {formatMoney,parseMoney,allocateWeightedMoney} from "../src/lib/vehicle-partnership/money";
import {derivePartnershipConversion} from "../src/lib/vehicle-partnership/conversion";
import {PartnershipValidationError} from "../src/lib/vehicle-partnership/types";
import {partnershipRows,PartnershipRepositoryError} from "../src/server/vehicle-partnership/repository";
import {resolvePartnershipFinancialEffect} from "../src/server/vehicle-partnership/financial-classification";
const path="src/server/vehicle-partnership/payment-state.ts",tree=ts.createSourceFile(path,readFileSync(path,"utf8"),ts.ScriptTarget.Latest,true);
const body=tree.statements.filter(n=>!ts.isImportDeclaration(n)&&!ts.isExportDeclaration(n)).map(n=>n.getText(tree).replace(/^export\s+/,"")).join("\n");
const root={id:1,vehicleId:12},right={id:11,partnership_id:1,category:"internal_entitlement",status:"approved",amount:"100.00"};
const conversion={allocation_id:91,right_id:11,allocation_partnership_id:1,allocation_category:"internal_entitlement",conversion_allocation_id:null,purpose:"internal_conversion",allocated_amount:"100.00",financial_transaction_id:81,financial_amount:"100.00",financial_status:"executed",financial_direction:"expense",financial_source_type:"vehicle_partnership_closing",financial_source_id:"5",financial_event:"monthly_result",transaction_type:"vp_month_profit",reversed_amount:"0.00",invalid_reversal:false,closing_id:5,closing_partnership_id:1,closing_financial_id:81,closing_status:"approved"};
const cash={allocation_id:101,right_id:11,allocation_partnership_id:1,allocation_category:"internal_entitlement",conversion_allocation_id:91,purpose:"internal_entitlement_settlement",allocated_amount:"40.00",financial_transaction_id:71,financial_amount:"40.00",financial_status:"executed",financial_direction:"expense",financial_source_type:"vehicle_partnership_driver",financial_source_id:"61",financial_event:"driver_fee_settlement",transaction_type:"vp_driver_payment",reversed_amount:"0.00",invalid_reversal:false,idempotency_key:"vp:driver-coverage:5:r1:financial:71:coverage:91"};
let rows:any[]=[cash,conversion],proofs=0,failedProof=false;const dialect=new PgDialect();
const tx={execute:async(statement:any)=>{const q=dialect.sqlToQuery(statement);if(q.sql.includes("vp_payment_right_scope"))return {rows:[{vehicle_id:12}]};if(q.sql.includes("vp_payment_right_lock"))return {rows:[right]};if(q.sql.includes("vp_payment_allocations"))return {rows};throw Error("Unexpected canonical SQL "+q.sql);}};
const read=vm.runInNewContext(ts.transpileModule(body+"\nreconcilePartnershipPaymentState",{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,{sql,formatMoney,parseMoney,allocateWeightedMoney,derivePartnershipConversion,PartnershipValidationError,partnershipRows,PartnershipRepositoryError,resolvePartnershipFinancialEffect,lockPartnership:async()=>root,
 proveDriverCashCoverageSource:async(_tx:any,scope:any,id:number)=>{assert.equal(scope,root);assert.equal(id,71);if(failedProof)throw new PartnershipRepositoryError("driver origin invalid",409,"CONFLICT");return {financialId:71,settlementId:61,amount:"40.00",reversedAmount:rows.find(r=>r.financial_transaction_id===71)?.reversed_amount};},
 proveDriverCoverageMapping:async(_tx:any,scope:any,source:any,group:any[])=>{assert.equal(scope,root);assert.equal(source.settlementId,61);assert.equal(group.length,1);assert.equal(group[0].right_id,11);proofs++;},
});
const run=()=>read(tx,{sourceType:"vehicle_partnership_right",sourceId:11});
let result=await run();assert.equal(result.approvedPaidAmount,"40.00");assert.equal(result.nonCashSettledAmount,"60.00");assert.equal(result.remainingAmount,"0.00");assert.equal(result.availableAmount,"0.00");assert.equal(result.availableCoverageAmount,"60.00");assert.equal(proofs,1,"driver settlement61 must be proven independently from internal right11");
rows=[{...cash,reversed_amount:"20.00"},conversion];result=await run();assert.equal(result.approvedPaidAmount,"20.00");assert.equal(result.nonCashSettledAmount,"80.00");
for(const change of [{financial_status:"pending"},{financial_event:"distribution"},{financial_source_id:"11"},{purpose:"distribution"},{conversion_allocation_id:null},{allocation_category:"profit"},{allocated_amount:"100.01"},{invalid_reversal:true},{allocation_partnership_id:2}]){rows=[{...cash,...change},conversion];await assert.rejects(run,(e:any)=>e.status===409||e.status===422);}
rows=[cash,conversion];failedProof=true;await assert.rejects(run,/driver origin invalid/);failedProof=false;
rows=[cash,{...conversion,financial_status:"pending",closing_status:"pending"}];await assert.rejects(run,(e:any)=>e.status===409);
console.log("PASS actual right canonical driver coverage: original settlement identity, conversion-before-older-cash, same cash counted once, valid reversals, strict source/proof/purpose/parent checks and no recursive driver execution.");
