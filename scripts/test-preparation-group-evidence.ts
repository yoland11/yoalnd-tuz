import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PgDialect} from 'drizzle-orm/pg-core';
import {getBookingPreparationSummary} from '../src/server/booking-preparation';
import {updatePreparationItems} from '../src/server/booking-preparation-update';
import {preparationGroups,preparationItemNeedsAttention} from '../src/lib/booking-preparation-groups';

// Actual summary, grouping and updater; only PostgreSQL IO is substituted.
// Removing problem precedence/raw guards or original-completion validation
// must fail these cases without issuing any inventory or financial query.
function fixture(options:{problem?:string;asset?:Record<string,unknown>}){
  let details:any={bookingOperations:{productMeta:options.problem?{'44:0':{prep:{status:options.problem}}}:{},assets:options.asset?[options.asset]:[]}};
  let writes=0;
  const dialect=new PgDialect();
  const tx={execute:async(query:any)=>{
    const {sql,params}=dialect.sqlToQuery(query);
    if(sql.includes('FROM kosha_bookings'))return {rows:[{id:12,status:'confirmed',details:structuredClone(details)}]};
    if(sql.includes('FROM stock_reservations r'))return {rows:options.asset?[]:[{reservation_id:6,product_id:44,variant_id:null,quantity:'2',reservation_status:'consumed',name:'إضاءة',category:'lighting',stock:'0',reserved_others:'0'}]};
    if(sql.includes('FROM products WHERE id IN'))return {rows:[{id:44,name:'إضاءة'}]};
    if(sql.includes('FROM entity_timeline'))return {rows:[]};
    if(sql.trimStart().startsWith('UPDATE kosha_bookings')){writes++;details.bookingOperations.productMeta=JSON.parse(params[0] as string);return {rows:[{id:12}]}};
    if(sql.includes('INSERT INTO entity_timeline')){writes++;return {rows:[]}};
    throw Error(`Unexpected operation: ${sql}`);
  }};
  const database={transaction:async(fn:any)=>{const before=structuredClone(details),count=writes;try{return await fn(tx)}catch(error){details=before;writes=count;throw error}}};
  const read=()=>getBookingPreparationSummary('kosha',12,tx);
  const update=(command:'start'|'confirm',reader:any=(_tx:any)=>read())=>updatePreparationItems(database,{source:'kosha',id:12},{id:1,name:'مدير'},[options.asset?'asset:44':'44:0'],{status:command==='start'?'preparing':'ready'},reader,{department:options.asset?'equipment':'lighting',command,requestId:`evidence-${command}-12`});
  return {read,update,writes:()=>writes,details:()=>details};
}

for(const problem of ['damaged','lost']){
  test(`consumed product preserves ${problem} in summary and group attention`,async()=>{
    const f=fixture({problem}),summary=(await f.read())!,item=summary.items[0];
    assert.equal(item.stockIssued,true);
    assert.equal(item.status,problem,'consumption is not evidence that damage/loss was resolved');
    assert.equal(preparationItemNeedsAttention(item),true);
    assert.deepEqual(preparationGroups(summary.items).map(g=>[g.prepared,g.missing,g.percentage]),[[0,1,0]]);
  });
  for(const command of ['start','confirm'] as const){
    test(`group ${command} cannot erase raw consumed ${problem} even with stale summary`,async()=>{
      const f=fixture({problem});
      await assert.rejects(()=>f.update(command,async()=>({items:[{key:'44:0',name:'إضاءة',department:'lighting',kind:'product',productId:44,required:2,shortfall:2,status:'completed',preparationState:'completed',stockIssued:true}]})),/التلف|الفقد/);
      assert.equal(f.details().bookingOperations.productMeta['44:0'].prep.status,problem);assert.equal(f.writes(),0);
    });
  }
}
for(const [field,status] of [['returnedDamagedQty','damaged'],['missingQty','lost']] as const){
  test(`original quantity ${field} remains visible in group progress and shortage filter`,async()=>{
    const f=fixture({asset:{productId:44,trackingMode:'quantity',quantity:2,reservedQty:2,preparedQty:2,checkedOutQty:2,[field]:1,stage:'out'}});
    const summary=(await f.read())!,item=summary.items[0];
    assert.equal(item.status,status);assert.equal(preparationItemNeedsAttention(item),true);
    assert.deepEqual(preparationGroups(summary.items).map(g=>[g.prepared,g.missing,g.percentage]),[[0,1,0]]);
    await assert.rejects(()=>f.update('confirm'),/النقص|حالة|تجهيز الأصل/);assert.equal(f.writes(),0);
  });
}
for(const asset of [undefined,{productId:44,trackingMode:'quantity',quantity:2,reservedQty:2,preparedQty:2,checkedOutQty:2,stage:'out'},{productId:44,trackingMode:'quantity',quantity:2,reservedQty:2,preparedQty:0,checkedOutQty:2,stage:'out'}]){
  test(`group start cannot reset original ${asset?`asset (prepared=${asset.preparedQty})`:'consumed product'} completion without an explicit metadata override`,async()=>{
    const f=fixture({asset});
    await assert.rejects(()=>f.update('start'),/مكتمل|معتمد/);assert.equal(f.writes(),0);
  });
}
