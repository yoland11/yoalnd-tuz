import assert from "node:assert/strict";
import {parseMoney,formatMoney,allocateMoney} from "../src/lib/vehicle-partnership/money";
import {validateAgreement,calculateTrip,calculateMonth} from "../src/lib/vehicle-partnership/domain";

// Breaks caught: unsafe decimal parsing/rounding, duplicate identities, a wrong
// fee/cost branch, treating unknown as zero, or allocating provisional as payable.
assert.equal(parseMoney("0.10")+parseMoney("0.20"),30n);
assert.equal(formatMoney(30n),"0.30");
assert.equal(parseMoney("99999999999999.99"),9999999999999999n);
assert.equal(formatMoney(-123456n),"-1234.56");
for(const value of ["1e3","NaN","Infinity","1,000"," 1","1 ","-1","+1","1.001","100000000000000","",1,null,undefined])assert.throws(()=>parseMoney(value as any),/مبلغ|دقة|نطاق/);
assert.throws(()=>formatMoney(10000000000000000n),/نطاق/);
const shares=[{key:"customer:7",basisPoints:5000},{key:"supplier:8",basisPoints:5000}];
assert.deepEqual(allocateMoney(5000000n,shares),[{key:"customer:7",amount:"25000.00"},{key:"supplier:8",amount:"25000.00"}]);
assert.deepEqual(allocateMoney(1n,[shares[1],shares[0]]),[{key:"supplier:8",amount:"0.00"},{key:"customer:7",amount:"0.01"}],"remainder tie uses stable identity, not input order");
assert.deepEqual(allocateMoney(-1n,shares),[{key:"customer:7",amount:"-0.01"},{key:"supplier:8",amount:"0.00"}]);
assert.throws(()=>allocateMoney(1n,[shares[0],shares[0]]),/مكرر/);
assert.throws(()=>allocateMoney(1n,[{key:"a",basisPoints:9999}]),/100/);
assert.throws(()=>allocateMoney(1n,[{key:"a",basisPoints:10000.1}]),/نسبة/);
const agreement={vehicleId:12,registrationOwner:"الشركة",effectiveFrom:"2026-10-01",members:[
 {party:{kind:"customer",id:7},ownershipBasisPoints:5000,profitBasisPoints:5000,expenseBasisPoints:5000,capitalContribution:"10000000.00"},
 {party:{kind:"supplier",id:8},ownershipBasisPoints:5000,profitBasisPoints:5000,expenseBasisPoints:5000,capitalContribution:"10000000.00"},
]};
assert.equal(validateAgreement(agreement).members.length,2);
assert.equal(validateAgreement({...agreement,members:[{...agreement.members[0],ownershipBasisPoints:6000,profitBasisPoints:7000,capitalContribution:"1.00"},{...agreement.members[1],ownershipBasisPoints:4000,profitBasisPoints:3000,capitalContribution:"2.00"}]}).members[0].profitBasisPoints,7000,"capital and percentage groups are independent");
for(const patch of [{effectiveFrom:"2026-02-30"},{vehicleId:0},{registrationOwner:""},{members:[agreement.members[0]]},{members:[...agreement.members,agreement.members[0]]},{members:[agreement.members[0],{...agreement.members[1],party:{kind:"customer",id:7}}]},{members:[agreement.members[0],{...agreement.members[1],expenseBasisPoints:4000}]}])assert.throws(()=>validateAgreement({...agreement,...patch}));
const driver={sourceKey:"expense:1",amount:"10000.00",status:"approved",category:"driver"} as const;
const fuel={sourceKey:"expense:2",amount:"5000.00",status:"approved",category:"fuel"} as const;
const income={sourceKey:"internal:trip:1",kind:"internal",amount:"30000.00",approved:true,recognized:true} as const;
let trip=calculateTrip({income,driver,costs:[fuel,driver],profitShares:shares});
assert.equal(trip.complete,true);assert.equal(trip.contribution,"15000.00");assert.equal(trip.cost,"15000.00");
assert.deepEqual(trip.provisionalShares,[{key:"customer:7",amount:"7500.00"},{key:"supplier:8",amount:"7500.00"}]);
assert.equal((trip as any).payable,undefined,"a provisional trip cannot create approved partner rights");
trip=calculateTrip({income,driver:null,costs:[fuel],profitShares:shares});
assert.equal(trip.complete,false);assert.equal(trip.contribution,null);assert.equal(trip.provisionalShares,null);assert.ok(trip.blockers.some(reason=>reason.includes("السائق")));
assert.equal(calculateTrip({income:{...income,approved:false},driver,costs:[fuel],profitShares:shares}).contribution,null);
assert.equal(calculateTrip({income:{...income,recognized:false},driver,costs:[fuel],profitShares:shares}).contribution,null);
assert.equal(calculateTrip({income,driver:{...driver,amount:"0.00"},costs:[fuel,{sourceKey:"purchase:9",amount:"20000000.00",status:"approved",category:"capital"}],profitShares:shares}).contribution,"25000.00");
assert.throws(()=>calculateTrip({income,driver,costs:[{...driver,amount:"20000.00"}],profitShares:shares}),/متعارض|متطابق/);
assert.equal(calculateTrip({income,driver,costs:[fuel,{...fuel,sourceKey:"expense:3"}],profitShares:shares}).cost,"20000.00","same amount on another real source is not a duplicate");
assert.equal(calculateTrip({income,driver,costs:[{...driver,amount:"10000"},fuel],profitShares:shares}).cost,"15000.00","valid decimal representations of the same expense are equal");

const monthly={externalIncome:[],internalIncome:[income],costs:[driver,fuel],depreciation:{kind:"none"},reserve:{kind:"none"},carriedLoss:"0.00",profitShares:shares,lossShares:shares} as const;
let month=calculateMonth(monthly);
assert.equal(month.result,"15000.00");assert.equal(month.maxDistributable,"15000.00");assert.equal(month.complete,true);
assert.equal(month.internalIncome,"30000.00");assert.equal(month.externalIncome,"0.00");
month=calculateMonth({...monthly,internalIncome:[{...income,amount:"0.00"}],costs:[{...driver,amount:"100.00"}]});
assert.equal(month.result,"-100.00");assert.equal(month.carriedLossOut,"100.00");assert.equal(month.maxDistributable,"0.00");
assert.deepEqual(month.lossAllocations,[{key:"customer:7",amount:"50.00"},{key:"supplier:8",amount:"50.00"}]);
month=calculateMonth({...monthly,internalIncome:[{...income,amount:"150.00"}],costs:[],carriedLoss:"100.00"});
assert.equal(month.result,"150.00");assert.equal(month.lossRecovered,"100.00");assert.equal(month.carriedLossOut,"0.00");assert.equal(month.maxDistributable,"50.00");
assert.deepEqual(month.proposedProfitShares,[{key:"customer:7",amount:"25.00"},{key:"supplier:8",amount:"25.00"}]);
month=calculateMonth({...monthly,reserve:{kind:"percent",basis:"after_loss_recovery",basisPoints:1000}});
assert.equal(month.reserve,"1500.00");assert.equal(month.maxDistributable,"13500.00");
month=calculateMonth({...monthly,reserve:{kind:"fixed",amount:"20000.00"}});
assert.equal(month.complete,false);assert.equal(month.maxDistributable,null,"reserve cannot exceed eligible profit");
for(const patch of [{depreciation:null},{reserve:null},{carriedLoss:null},{costs:[{...driver,amount:null}]},{internalIncome:[{...income,recognized:false}]}]){
 const result=calculateMonth({...monthly,...patch} as any);assert.equal(result.complete,false);assert.equal(result.maxDistributable,null);assert.ok(result.blockers.length>0);
}
assert.throws(()=>calculateMonth({...monthly,externalIncome:[{...income,kind:"external"}]}),/متعارض|مكرر/);
assert.throws(()=>calculateMonth({...monthly,lossShares:[{key:"staff:99",basisPoints:5000},shares[1]]}),/شركاء|أطراف/);
assert.equal(JSON.stringify(agreement).includes("financialTransaction"),false);
console.log("PASS exact partnership domain: money precision, independent share groups, source deduplication, unknown blockers, provisional results, losses/reserve and exact 50/50 allocations");
