import assert from "node:assert/strict";
import {calculatePartnershipCashPosting} from "../src/lib/vehicle-partnership/cash";
import {PartnershipValidationError} from "../src/lib/vehicle-partnership/types";

type CashInput={amount:string;currentBalance:string;totalRevenue:string;totalExpenses:string;netProfit:string};
const base:CashInput={amount:"0.01",currentBalance:"0.03",totalRevenue:"1234.5",totalExpenses:"200.01",netProfit:"-300.1"};

// Catches rounded/substituted cash arithmetic and accidental operating P&L changes.
assert.deepEqual(calculatePartnershipCashPosting(base),{
  amount:"0.01",before:"0.03",after:"0.02",totalRevenue:"1234.50",totalExpenses:"200.01",netProfit:"-300.10",
},"one minor-unit payout preserves every existing operating total");
assert.deepEqual(calculatePartnershipCashPosting({...base,amount:"150.5",currentBalance:"200",totalRevenue:"1000",totalExpenses:"75.25",netProfit:"924.75"}),{
  amount:"150.50",before:"200.00",after:"49.50",totalRevenue:"1000.00",totalExpenses:"75.25",netProfit:"924.75",
},"payout does not classify partner distributions as operating expense");
assert.deepEqual(calculatePartnershipCashPosting({...base,amount:"99999999999999.99",currentBalance:"99999999999999.99",totalRevenue:"99999999999999.99",totalExpenses:"99999999999999.99",netProfit:"-99999999999999.99"}),{
  amount:"99999999999999.99",before:"99999999999999.99",after:"0.00",totalRevenue:"99999999999999.99",totalExpenses:"99999999999999.99",netProfit:"-99999999999999.99",
},"numeric(16,2) maximum is exact above floating-point safe integer precision");
assert.equal(calculatePartnershipCashPosting({...base,currentBalance:"99999999999999.99"}).after,"99999999999999.98","a cent at the numeric maximum remains exact");
assert.equal(calculatePartnershipCashPosting({...base,currentBalance:"0.01",netProfit:"-0.00"}).netProfit,"0.00","negative zero is normalized without repairing operating results");

for(const currentBalance of ["0","0.00","-0.01","-99999999999999.99"]){
  assert.throws(()=>calculatePartnershipCashPosting({...base,currentBalance}),
    (error:unknown)=>error instanceof PartnershipValidationError&&/رصيد.*غير كاف|غير كاف.*رصيد/.test(error.message),
    `insufficient balance ${currentBalance} fails with a clear Arabic validation error`);
}

// Catches silent zero fallbacks, accepting malformed persisted data, and rounding.
const malformed:unknown[]=[undefined,null,0,0.01,NaN,Infinity,{},[],""," "," 1","1 ","+1","01",".01","1.","1e2","1,000","0.001","1.999","100000000000000","99999999999999.999"];
for(const key of ["amount","currentBalance","totalRevenue","totalExpenses","netProfit"] as const){
  for(const value of malformed){
    assert.throws(()=>calculatePartnershipCashPosting({...base,[key]:value} as CashInput),PartnershipValidationError,`${key} rejects malformed ${String(value)}`);
  }
}
for(const amount of ["0","0.00","-0.01","-1"]){
  assert.throws(()=>calculatePartnershipCashPosting({...base,amount}),PartnershipValidationError,`payout amount ${amount} must be positive`);
}
for(const key of ["totalRevenue","totalExpenses"] as const){
  assert.throws(()=>calculatePartnershipCashPosting({...base,[key]:"-0.01"}),PartnershipValidationError,`${key} rejects negative operating totals`);
}
for(const key of ["currentBalance","netProfit"] as const){
  for(const value of ["-","--1","-01","-0.001","-100000000000000"]){
    assert.throws(()=>calculatePartnershipCashPosting({...base,[key]:value}),PartnershipValidationError,`${key} rejects malformed signed amounts`);
  }
}
for(const input of [undefined,null]){
  assert.throws(()=>calculatePartnershipCashPosting(input as unknown as CashInput),PartnershipValidationError,"missing cash facts fail closed");
}

console.log("PASS vehicle partnership exact cash payout math and preserved operating totals");
