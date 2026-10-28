import assert from "node:assert/strict";
const cash=await import("../src/lib/vehicle-partnership/cash");
assert.equal(typeof cash.calculatePartnershipCashReversal,"function","partnership cash return needs exact non-operating cash-in arithmetic");
const run=cash.calculatePartnershipCashReversal;
assert.deepEqual(run({amount:"90071992547409.91",currentBalance:"0.01",totalRevenue:"12345.67",totalExpenses:"11111.11",netProfit:"-17.23"}),{amount:"90071992547409.91",before:"0.01",after:"90071992547409.92",totalRevenue:"12345.67",totalExpenses:"11111.11",netProfit:"-17.23"});
assert.equal(run({amount:"25.00",currentBalance:"-10.01",totalRevenue:"0.00",totalExpenses:"0.00",netProfit:"0.00"}).after,"14.99");
for(const change of [{amount:"0.00"},{amount:"1e6"},{currentBalance:"bad"},{totalRevenue:"-1.00"},{netProfit:"NaN"},{amount:"99999999999999.99",currentBalance:"0.01"}])assert.throws(()=>run({amount:"25.00",currentBalance:"100.00",totalRevenue:"0.00",totalExpenses:"0.00",netProfit:"0.00",...change}));
console.log("PASS exact partnership full cash reversal math: cash-in, unchanged operating totals, signed balances, large cents and fail-closed overflow.");
