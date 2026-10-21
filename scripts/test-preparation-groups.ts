import assert from 'node:assert/strict';
const module=await import('../src/lib/booking-preparation-groups').catch(()=>null);
assert.equal(typeof module?.preparationGroups,'function','group progress must separate recorded preparation from stock availability');
const items=[
 {key:'10:0',department:'flowers',name:'ورد',status:'ready',preparationState:null,shortfall:0,assigneeName:'أحمد'},
 {key:'11:0',department:'flowers',name:'ورد إضافي',status:'shortage',preparationState:null,shortfall:2,assigneeName:'أحمد'},
 {key:'manual:note',department:'flowers',name:'تنبيه',status:'note',preparationState:null,shortfall:0,infoOnly:true},
 {key:'asset:20',department:'equipment',name:'إضاءة',status:'preparing',preparationState:'ready',shortfall:0,assigneeName:'علي'},
];
const groups=module!.preparationGroups(items);
assert.equal(groups[0].total,2);assert.equal(groups[0].prepared,0,'available stock alone is NOT confirmed preparation');assert.equal(groups[0].percentage,0);assert.equal(groups[0].missing,1);assert.deepEqual(groups[0].responsible,['أحمد']);
assert.equal(groups[1].percentage,100);assert.equal(groups[1].prepared,1);assert.equal(groups[1].missing,0);
assert.deepEqual(module!.preparationGroups([]),[]);
const consumed=module!.preparationGroups([{key:'12:0',department:'flowers',status:'completed',preparationState:'completed',shortfall:4,stockIssued:true}]);assert.equal(consumed[0].prepared,1,'already consumed stock is original checkout evidence, not a fresh stock requirement');assert.equal(consumed[0].missing,0);
console.log('PASS preparation groups: real departments, explicit recorded preparation only, info-only exclusion, shortages and responsible identities');
