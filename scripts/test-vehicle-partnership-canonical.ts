import assert from "node:assert/strict";
import {canonicalPartnershipJson} from "../src/lib/vehicle-partnership/canonical";
assert.equal(canonicalPartnershipJson({z:1,a:{second:"0.10",first:true},items:[{b:2,a:1},null]}),canonicalPartnershipJson({items:[{a:1,b:2},null],a:{first:true,second:"0.10"},z:1}),"PostgreSQL jsonb key reordering cannot invalidate unchanged financial source proof");
assert.notEqual(canonicalPartnershipJson([1,2]),canonicalPartnershipJson([2,1]),"ordered source lines remain ordered");
assert.notEqual(canonicalPartnershipJson({amount:"0.10"}),canonicalPartnershipJson({amount:"0.11"}));
for(const value of [{bad:undefined},{bad:NaN},{bad:Infinity},{bad:0.1},{bad:1n},{bad:new Date()}])assert.throws(()=>canonicalPartnershipJson(value),/بيانات|دقة|JSON/);
const cyclic:any={};cyclic.self=cyclic;assert.throws(()=>canonicalPartnershipJson(cyclic),/دائر|بيانات/);
console.log("PASS canonical partnership source serialization: jsonb order stability, ordered arrays, explicit decimal strings and invalid/cyclic source rejection.");
