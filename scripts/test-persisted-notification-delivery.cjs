const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const ast=ts.createSourceFile('api.ts',fs.readFileSync('src/server/api.ts','utf8'),ts.ScriptTarget.Latest,true);
const find=name=>ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
assert.ok(find('deliverPersistedNotification'),'already-committed inbox rows need the existing push delivery without another insert');
const compile=node=>ts.transpileModule(node.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
(async()=>{let inserts=0,pushes=0,settingsReads=0,stored;
 const row={id:10,audienceType:'staff',staffId:8,customerId:null,type:'task_approved',title:'تم اعتماد المهمة',body:'تجهيز',entityType:'task',entityId:71,href:'/staff?tab=tasks',metadata:{keep:true}};
 const c=vm.createContext({notificationsTable:{id:'id'},staffTable:{isActive:'active',role:'role'},notificationSubscriptionsTable:{ownerType:'owner',customerId:'customer',staffId:'staff',isActive:'active'},and:(...a)=>a,eq:(a,b)=>[a,b],inArray:(a,b)=>[a,b],sql:(...a)=>a,
  ensureAdminExtensionsTables:async()=>{},getGlobalNotificationSettings:async()=>{settingsReads++;return {pushEnabled:1}},notificationTypeEnabled:()=>true,webPushUnavailableReason:'unavailable',
  sendPushToSubscriptions:async(subscriptions,payload)=>{pushes++;assert.equal(subscriptions[0].staffId,8);assert.equal(payload.id,10);return 'unavailable'},
  db:{insert:()=>({values:input=>({returning:async()=>{inserts++;assert.equal(input.staffId,8);return [row]}})}),update:()=>({set:input=>({where:async()=>{stored=input}})}),query:{staffTable:{findMany:async()=>[]},notificationSubscriptionsTable:{findMany:async()=>[{staffId:8}]}}},
 });
 vm.runInContext(compile(find('deliverPersistedNotification')),c);vm.runInContext(compile(find('createNotification')),c);
 const created=await c.createNotification({audienceType:'staff',staffId:8,type:'task_approved',title:'تم اعتماد المهمة'});assert.equal(created,row);assert.equal(inserts,1);assert.equal(pushes,1);assert.equal(settingsReads,1);assert.equal(stored.metadata.keep,true);
 await c.deliverPersistedNotification(row);assert.equal(inserts,1,'delivery of a transactionally queued notice must not duplicate inbox records');assert.equal(pushes,2);assert.equal(settingsReads,2);
 console.log('PASS actual notification creation/persisted delivery: same push settings and payload, one inbox insert, original metadata retained');
})().catch(e=>{console.error(e);process.exitCode=1});
