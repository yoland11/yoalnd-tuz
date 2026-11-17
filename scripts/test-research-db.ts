/** Real PostgreSQL integration. Requires a separately verified disposable TEST DB. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {readFile,readdir} from 'node:fs/promises';
import pg from 'pg';
import {NextRequest} from 'next/server';
const {assertSafeTestDatabase}=await import('./lib/test-database-guard.mjs');
const safe=assertSafeTestDatabase(process.env);
const run=`rs_${Date.now().toString(36)}_${randomUUID().slice(0,6)}`;
const databaseName=`ajn_research_test_${run}`;
const adminPool=new pg.Pool({connectionString:safe.url,max:2});
let databaseCreated=false;
if(!/^ajn_research_test_rs_[a-z0-9_]+$/.test(databaseName))throw new Error('Invalid owned test database identity');
try{
 await adminPool.query(`CREATE DATABASE "${databaseName}" TEMPLATE template0`);databaseCreated=true;
}catch(error){await adminPool.end();throw error;}
const testUrl=new URL(safe.url);testUrl.pathname=`/${databaseName}`;testUrl.searchParams.delete('options');
process.env.DATABASE_URL=testUrl.toString();process.env.NODE_ENV='test';
const pool=new pg.Pool({connectionString:testUrl.toString(),max:5});
try{
 const names=(await readdir(new URL('../lib/db/migrations/',import.meta.url))).filter(name=>/^\d+.*\.sql$/.test(name)).sort((a,b)=>a.localeCompare(b,'en'));
 for(const name of names)await pool.query(await readFile(new URL(`../lib/db/migrations/${name}`,import.meta.url),'utf8'));
 console.log('PASS research DB: fresh disposable database applies',names.length,'migrations');
}catch(error){await pool.end();if(databaseCreated)await adminPool.query(`DROP DATABASE "${databaseName}"`);await adminPool.end();throw error;}
const storedFiles=new Map<string,Buffer>();
const storage=createServer(async(req,res)=>{
 try{
  assert.equal(req.headers.authorization,'Bearer local-research-test-key');
  const url=new URL(req.url!,'http://127.0.0.1');
  if(req.method==='POST'&&url.pathname.startsWith('/storage/v1/object/sign/test-research-private/research/')) {
   const key=url.pathname.replace('/storage/v1/object/sign/','');assert.ok(storedFiles.has(key));
   res.setHeader('content-type','application/json');res.end(JSON.stringify({signedURL:`/storage/v1/object/sign/${key}?token=local-signed-only`}));return;
  }
  if(req.method==='POST'&&url.pathname.startsWith('/storage/v1/object/test-research-private/research/')) {
   const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
   storedFiles.set(url.pathname.replace('/storage/v1/object/',''),Buffer.concat(chunks));res.setHeader('content-type','application/json');res.end('{}');return;
  }
  res.statusCode=404;res.end();
 }catch(error){res.statusCode=500;res.end(String(error))}
});
await new Promise<void>(resolve=>storage.listen(0,'127.0.0.1',resolve));
process.env.SUPABASE_URL=`http://127.0.0.1:${(storage.address() as any).port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY='local-research-test-key';
process.env.AJN_RESEARCH_PRIVATE_BUCKET='test-research-private';
const {handleAdminResearch,handleResearchPublic}=await import('../src/server/research-center');
const {approveAndExecuteFinancialTransaction,reverseFinancialTransaction,ensureMasterCashBoxTables,createAndExecuteSourceFinancialTransaction,rejectFinancialTransaction}=await import('../src/server/master-cash-box');
const {readResearchCanonicalPaymentState}=await import('../src/server/research-payment-state');
const {db,pool:appPool}=await import('@workspace/db');
const {readResearchDashboard,readResearchBoard,readResearchReports}=await import('../src/server/research-analytics');
const {parseResearchFilters}=await import('../src/lib/research-contract');
const pass=(name:string)=>console.log(`PASS research DB: ${name}`);
async function one(query:string,params:any[]=[]){return (await pool.query(query,params)).rows[0]}
async function staff(suffix:string,role:string,permissions:string[]){const row=await one('INSERT INTO staff(username,password_hash,full_name,role,permissions,is_active) VALUES($1,$2,$3,$4,$5,true) RETURNING id',[`${run}_${suffix}`,'not-a-login-credential',`موظف اختبار ${suffix}`,role,JSON.stringify(permissions)]);return {id:row.id,username:`${run}_${suffix}`,fullName:`موظف اختبار ${suffix}`,role,permissions,isActive:true}}
try{
 const identity=await one('SELECT current_database() db');assert.equal(identity.db,databaseName);
 const columns=await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='research_orders' AND column_name=ANY($1::text[])",[['title_english','academic_level','research_category','payment_due_date','creation_key']]);assert.equal(columns.rowCount,5);
 assert.ok((await one("SELECT 1 FROM pg_constraint WHERE conname='expenses_research_order_id_fk'") ));pass('additive migration columns, unique creation identity and expense FK');
 const admin=await staff('admin','admin',[]),employee=await staff('researcher','employee',['research.view','research.create','research.edit','research.assign','research.financials.view','research.payment.receive','research.chapters.manage','research.files.manage']);
 const actor={id:admin.id,name:admin.fullName,role:'admin'};
 async function api(path:string,method='GET',body?:unknown,user=admin){const response=await handleAdminResearch(new NextRequest(`http://localhost/api/admin/research${path}`,{method,...(body===undefined?{}:{body:JSON.stringify(body),headers:{'content-type':'application/json'}})}),['admin','research',...path.split('?')[0].split('/').filter(Boolean)],user);assert.ok(response);return {status:response.status,data:await response.json()}}
 await ensureMasterCashBoxTables();
 const before=Number((await one("SELECT current_balance FROM master_cash_box WHERE code='MASTER'")).current_balance);
 const body={customerName:`طالب ${run}`,phone:`077${String(Date.now()).slice(-8)}`,title:'مشروع بحث علمي اختباري',titleEnglish:'Scientific Research Test',academicLevel:'master',researchCategory:'python',researchType:'master',universityName:'جامعة الاختبار',college:'الهندسة',department:'الحاسوب',language:'ar',requiredPages:30,estimatedPrice:500000,deposit:200000,paymentMethod:'cash',paymentDueDate:null,deadline:'2020-01-01',assignedWriterId:employee.id,idempotencyKey:`${run}_create`};
 const created=await api('/orders','POST',body,employee);assert.equal(created.status,201,JSON.stringify(created));const order=created.data.order;assert.equal(Number(order.paidAmount),0);assert.equal(Number(order.remainingAmount),500000);assert.equal(order.researchCategory,'python');assert.equal(order.paymentDueDate,null);
 const retry=await api('/orders','POST',body,employee);assert.equal(retry.status,201,JSON.stringify(retry));assert.equal(retry.data.order.id,order.id);assert.equal(Number((await one('SELECT count(*) n FROM research_orders WHERE creation_key=$1',[`${employee.id}:${body.idempotencyKey}`])).n),1);
 const changedRetry=await api('/orders','POST',{...body,title:'عنوان مختلف لنفس مفتاح الإنشاء'},employee);assert.equal(changedRetry.status,409);
 assert.equal(Number((await one("SELECT current_balance FROM master_cash_box WHERE code='MASTER'")).current_balance),before);pass('atomic create, assigned employee, existing customer/invoice, initial payment pending, durable creation retry');
 const initial=await one("SELECT * FROM financial_transactions WHERE source_type='research_order' AND source_id=$1 AND approval_status='pending'",[String(order.id)]);assert.ok(initial);assert.equal(Number(initial.amount),200000);
 const excessive=await api(`/orders/${order.id}/payment`,'POST',{amount:400000,paymentMethod:'cash',idempotencyKey:`${run}_excess`},employee);assert.ok(excessive.status>=400,JSON.stringify(excessive));
 await approveAndExecuteFinancialTransaction(initial.id,actor);await approveAndExecuteFinancialTransaction(initial.id,actor);
 let money=await one('SELECT paid_amount,remaining_amount FROM research_orders WHERE id=$1',[order.id]);assert.equal(Number(money.paid_amount),200000);assert.equal(Number(money.remaining_amount),300000);
 let invoice=await one('SELECT paid_amount,remaining_amount FROM sales_invoices WHERE id=$1',[order.invoiceId]);assert.equal(Number(invoice.paid_amount),200000);assert.equal(Number(invoice.remaining_amount),300000);
 assert.equal(Number((await one("SELECT current_balance FROM master_cash_box WHERE code='MASTER'")).current_balance),before+200000);pass('approval posts once to existing cashbox and synchronizes original invoice');
 const concurrent=await Promise.all(['a','b'].map(suffix=>api(`/orders/${order.id}/payment`,'POST',{amount:200000,paymentMethod:'cash',idempotencyKey:`${run}_concurrent_${suffix}`},employee)));
 assert.equal(concurrent.filter(result=>result.status<300).length,1,JSON.stringify(concurrent));
 const pending=concurrent.find(result=>result.status<300)!;await approveAndExecuteFinancialTransaction(pending.data.transaction.id,actor);
 assert.equal(Number((await one('SELECT paid_amount FROM research_orders WHERE id=$1',[order.id])).paid_amount),400000);pass('source locks prevent concurrent pending overcollection');
 const priceDrop=await api(`/orders/${order.id}`,'PATCH',{estimatedPrice:100000},admin);assert.ok(priceDrop.status>=400);assert.equal(Number((await one('SELECT total_amount FROM research_orders WHERE id=$1',[order.id])).total_amount),500000);
 await reverseFinancialTransaction(initial.id,actor,'تصحيح اختبار معزول',undefined,undefined,{amount:50000,idempotencyKey:`${run}_reverse`});
 money=await one('SELECT paid_amount,remaining_amount FROM research_orders WHERE id=$1',[order.id]);invoice=await one('SELECT paid_amount,remaining_amount FROM sales_invoices WHERE id=$1',[order.invoiceId]);assert.equal(Number(money.paid_amount),350000);assert.equal(Number(invoice.paid_amount),350000);assert.equal(Number(money.remaining_amount),150000);pass('approved reversal preserves history and restores both receivable snapshots');
 const alias=await db.transaction(tx=>createAndExecuteSourceFinancialTransaction(tx,{direction:'revenue',amount:20000,department:'research',transactionType:'research_payment',description:'اختبار تسديد الفاتورة الأصلية',paymentMethod:'cash',sourceType:'sales_invoice',sourceId:String(order.invoiceId),sourceEvent:'payment',idempotencyKey:`${run}_mirror`,customerId:order.customerId,attachments:[]},actor));
 await approveAndExecuteFinancialTransaction(alias.id,actor);assert.equal(Number((await one('SELECT paid_amount FROM research_orders WHERE id=$1',[order.id])).paid_amount),370000);
 const excessiveAlias=await db.transaction(tx=>createAndExecuteSourceFinancialTransaction(tx,{direction:'revenue',amount:200000,department:'research',transactionType:'research_payment',description:'اختبار منع تسديد زائد',paymentMethod:'cash',sourceType:'sales_invoice',sourceId:String(order.invoiceId),sourceEvent:'payment',idempotencyKey:`${run}_mirror_excess`,customerId:order.customerId,attachments:[]},actor));
 const beforeBlockedApproval=Number((await one("SELECT current_balance FROM master_cash_box WHERE code='MASTER'")).current_balance);
 await assert.rejects(()=>approveAndExecuteFinancialTransaction(excessiveAlias.id,actor),/المتبقي|الدفعة|المعلقة/);assert.equal(Number((await one("SELECT current_balance FROM master_cash_box WHERE code='MASTER'")).current_balance),beforeBlockedApproval);
 await rejectFinancialTransaction(excessiveAlias.id,actor,'رفض الدفعة الزائدة في بيئة الاختبار');pass('original invoice alias shares one balance and approval guard rejects excess before cash posting');
 const expense=await api(`/orders/${order.id}/expenses`,'POST',{amount:30000,category:'programmer',description:'أتعاب مبرمج للاختبار',paymentMethod:'cash',idempotencyKey:`${run}_expense`},employee);assert.equal(expense.status,201,JSON.stringify(expense));await approveAndExecuteFinancialTransaction(expense.data.transaction.id,actor);
 assert.equal(Number((await one('SELECT paid_amount FROM research_orders WHERE id=$1',[order.id])).paid_amount),370000);pass('approved research expense uses existing expense/cash workflow without reducing customer paid');
 const detail=await api(`/orders/${order.id}`);assert.equal(detail.status,200);const chapter=detail.data.chapters[0];
 const edited=await api(`/chapters/${chapter.id}`,'PATCH',{orderId:order.id,content:'محتوى الفصل الإصدار الثاني للاختبار',progress:30,changeNote:'اختبار الإصدار'},employee);assert.equal(edited.status,200,JSON.stringify(edited));const versions=await api(`/chapters/${chapter.id}/versions`,'GET',undefined,employee);assert.equal(versions.status,200);assert.ok(versions.data.versions.length>=2);
 const text=Buffer.from('Scientific research private version test');
 const fileBody={orderId:order.id,chapterId:chapter.id,title:'متطلبات البحث',fileName:'requirements.txt',mimeType:'text/plain',fileType:'customer_upload',fileUrl:`data:text/plain;base64,${text.toString('base64')}`,isCustomerVisible:true};
 const uploads=await Promise.all([api('/files','POST',fileBody,employee),api('/files','POST',fileBody,employee)]);for(const upload of uploads)assert.equal(upload.status,201,JSON.stringify(upload));assert.deepEqual(uploads.map(upload=>upload.data.file.version).sort(),[1,2]);
 const savedFile=uploads[0].data.file;assert.ok(savedFile.fileUrl.includes('token=local-signed-only'));assert.equal(savedFile.fileSize,text.length);assert.match(savedFile.checksum,/^[a-f0-9]{64}$/);assert.equal(storedFiles.size,2);pass('concurrent immutable file versions, private storage transport, signed access and computed metadata');
 const feedback=await api('/messages','POST',{orderId:order.id,chapterId:chapter.id,message:'مراجعة المشرف: يرجى تعديل المتطلبات',messageType:'revision_request',isInternal:false},employee);assert.equal(feedback.status,201);assert.equal((await one('SELECT approval_status FROM research_chapters WHERE id=$1',[chapter.id])).approval_status,'revision_requested');
 const other=await api('/orders','POST',{...body,phone:`077${String(Date.now()+11).slice(-8)}`,deposit:0,idempotencyKey:`${run}_second`});assert.equal(other.status,201,JSON.stringify(other));
 const unrelated=await api('/files','POST',{...fileBody,orderId:other.data.order.id},employee);assert.ok(unrelated.status>=400);pass('supervisor revisions and cross-order chapter rejection');
 const viewOnly=await staff('viewer','employee',['research.view']);const privateView=await api(`/orders/${order.id}`,'GET',undefined,viewOnly);assert.equal(privateView.status,200);assert.equal(Object.hasOwn(privateView.data.order,'paidAmount'),false);const denied=await api(`/orders/${order.id}/financials`,'GET',undefined,viewOnly);assert.equal(denied.status,403);pass('real granular employee permissions and financial redaction');
 const filters=parseResearchFilters(new URLSearchParams(`search=${encodeURIComponent(run)}`));const dashboard=await readResearchDashboard(db,filters,true);assert.equal(dashboard.summary.overdueDebt,0,'delivery deadline alone never makes unpaid debt overdue');const board=await readResearchBoard(db,filters,true);assert.equal(board.columns.length,6);
 const report=await readResearchReports(db,filters,true);assert.equal(report.summary.approvedExpenses,30000);const state=await readResearchCanonicalPaymentState(db,order.id);assert.equal(Number(state.approvedPaidAmount),370000);assert.equal(Number(state.remainingAmount),130000);pass('actual SQL dashboard, board, reports, configured due dates and expense aggregates');
 const financials=await api(`/orders/${order.id}/financials`);assert.equal(financials.status,200,JSON.stringify(financials));const statement=await api(`/students/${order.customerId}/statement`);assert.equal(statement.status,200,JSON.stringify(statement));assert.equal(Number(statement.data.documentsRemaining),130000);assert.ok(statement.data.entries.some((entry:any)=>entry.reference===alias.transactionNo));
 assert.equal(statement.data.entries.find((entry:any)=>entry.reference===alias.transactionNo)?.receivedByName,admin.fullName,'mirror payment must identify its receiving employee');
 assert.equal(statement.data.entries.find((entry:any)=>entry.reference===initial.transaction_no)?.receivedByName,employee.fullName,'original research payment must identify its receiving employee');
 pass('existing customer statement includes one original debt, both approved payment identities and original receiving employees');
 await reverseFinancialTransaction(alias.id,actor,'عكس كامل تحصيل الفاتورة الأصلية للاختبار',undefined,undefined,{idempotencyKey:`${run}_reverse_mirror`});
 const mirrorAfterReversal=await one('SELECT paid_amount,remaining_amount,financially_reversed FROM sales_invoices WHERE id=$1',[order.invoiceId]);assert.equal(Number(mirrorAfterReversal.paid_amount),350000);assert.equal(Number(mirrorAfterReversal.remaining_amount),150000);assert.equal(mirrorAfterReversal.financially_reversed,false);
 const statementAfterReversal=await api(`/students/${order.customerId}/statement`);assert.equal(Number(statementAfterReversal.data.documentsRemaining),150000);pass('full collection reversal keeps research invoice and outstanding debt visible');
 const assignmentOnly=await staff('assign','employee',['research.assign']);const assigned=await api(`/orders/${other.data.order.id}`,'PATCH',{assignedWriterId:employee.id},assignmentOnly);assert.equal(assigned.status,200,JSON.stringify(assigned));
 const archiveOnly=await staff('archive','employee',['research.archive']);const archived=await api(`/orders/${other.data.order.id}`,'PATCH',{status:'archived'},archiveOnly);assert.equal(archived.status,200,JSON.stringify(archived));pass('assignment-only and archive-only existing permission grants work independently');
 const archivedDebt=await api(`/receivables?search=${encodeURIComponent(run)}`);assert.equal(archivedDebt.status,200,JSON.stringify(archivedDebt));assert.ok(archivedDebt.data.items.some((item:any)=>item.id===other.data.order.id));assert.equal(Number(archivedDebt.data.summary.remaining),650000);pass('archived research debt remains in department receivables');
 const restored=await api(`/orders/${other.data.order.id}`,'PATCH',{status:'new'},admin);assert.equal(restored.status,200,JSON.stringify(restored));assert.equal(restored.data.order.archivedAt,null);pass('authorized unarchive restores visibility');
 const purchase=await one('INSERT INTO purchase_invoices(invoice_no,date,supplier_name,total,remaining_amount,payment_status) VALUES($1,$2,$3,$4,$4,$5) RETURNING id',[`PO-${run}`,'2026-11-16','مورد أجهزة اختبار',50000,'unpaid']);
 const financialCount=Number((await one('SELECT count(*) n FROM financial_transactions')).n);
 const linked=await api(`/orders/${order.id}/purchases`,'POST',{purchaseInvoiceId:purchase.id});assert.equal(linked.status,201,JSON.stringify(linked));const linkedAgain=await api(`/orders/${order.id}/purchases`,'POST',{purchaseInvoiceId:purchase.id});assert.equal(linkedAgain.data.duplicate,true);
 const repeatedAttribution=await api(`/orders/${other.data.order.id}/purchases`,'POST',{purchaseInvoiceId:purchase.id});assert.equal(repeatedAttribution.status,409);assert.equal(Number((await one('SELECT count(*) n FROM financial_transactions')).n),financialCount);
 const purchases=await api(`/orders/${order.id}/purchases`);assert.equal(purchases.data.costSummary.purchaseCost,50000);assert.equal(purchases.data.costSummary.supplierRemaining,50000);const purchaseReport=await readResearchReports(db,filters,true);assert.equal(purchaseReport.summary.purchaseCost,50000);assert.equal(purchaseReport.summary.approvedExpenses,30000);pass('original purchase cost and supplier liability linked once without duplicate expense/cash movement');
 const audited=await api(`/orders/${order.id}`,'PATCH',{estimatedPrice:500010,paymentDueDate:'2099-12-01'});assert.equal(audited.status,200,JSON.stringify(audited));const audit=await one("SELECT metadata FROM entity_timeline WHERE entity_type='research_order' AND entity_id=$1 AND type='research_updated' AND metadata ? 'financialChanges' ORDER BY id DESC LIMIT 1",[order.id]);assert.equal(Number(audit.metadata.financialChanges.before.totalAmount),500000);assert.equal(Number(audit.metadata.financialChanges.after.totalAmount),500010);const nonfinancialAudit=await api(`/orders/${order.id}`,'GET',undefined,viewOnly);assert.ok(nonfinancialAudit.data.timeline.every((event:any)=>!event.metadata));pass('transactional before/after price audit stays private from nonfinancial staff');
 const publicBody={...body,customerId:undefined,assignedWriterId:null,deposit:0,estimatedPrice:10000,phone:`077${String(Date.now()+29).slice(-8)}`,idempotencyKey:`${run}_public`};
 const publicResponse=await handleResearchPublic(new NextRequest('http://localhost/api/research/orders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(publicBody)}),['research','orders']);assert.equal(publicResponse.status,201,await publicResponse.clone().text());pass('legacy public request fields remain compatible without posting money');
 console.log('PASS isolated scientific research integration',run);
}catch(error){console.error('FAIL research DB assertion',error);throw error;}finally{
 await new Promise<void>((resolve,reject)=>storage.close(error=>error?reject(error):resolve()));await pool.end();await appPool.end();
 // Only the exact database created by this unique test run is eligible.
 if(databaseCreated){
  await adminPool.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[databaseName]);
  await adminPool.query(`DROP DATABASE "${databaseName}"`);console.log('Cleaned owned research test database',databaseName);
 }
 await adminPool.end();
}
