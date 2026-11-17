import {sql} from 'drizzle-orm';
import {db} from '@workspace/db';
import {ResearchFinanceError} from './research-payment-rules';
import type {ResearchAdminUser} from './research-center';
type Executor={execute:(query:any)=>Promise<any>};
const id=(value:unknown)=>{const parsed=Number(value);if(!Number.isSafeInteger(parsed)||parsed<=0)throw new ResearchFinanceError('معرف البحث أو الفاتورة غير صحيح',400,'VALIDATION_ERROR');return parsed};
const procurement=(user?:ResearchAdminUser)=>Boolean(user?.isActive&&(user.role==='admin'||user.permissions.includes('accounting')));
const readRows=(result:any)=>{if(!Array.isArray(result?.rows))throw new Error('Invalid research purchases response');return result.rows as Record<string,any>[]};
const columns=sql`p.id,p.invoice_no AS "invoiceNo",p.date,p.supplier_name AS "supplierName",p.supplier_id AS "supplierId",p.total,p.paid_amount AS "paidAmount",p.remaining_amount AS "remainingAmount",p.payment_status AS "paymentStatus",p.status,p.research_order_id AS "researchOrderId"`;
/** Attribution only. The original purchase is the cost; supplier settlement is
 * never inserted again as a research expense or second financial transaction. */
export async function getResearchPurchases(orderId:number,params=new URLSearchParams(),user?:ResearchAdminUser,executor:Executor=db){
 id(orderId);const [order]=readRows(await executor.execute(sql`/* research purchase:order */ SELECT id,status FROM research_orders WHERE id=${orderId}`));if(!order)throw new ResearchFinanceError('البحث غير موجود',404,'NOT_FOUND');
 const search=params.get('search')?.trim();if(search&&!procurement(user))throw new ResearchFinanceError('لا تملك صلاحية البحث في المشتريات',403,'PERMISSION_DENIED');
 const [itemsResult,totalsResult,candidatesResult]=await Promise.all([
  executor.execute(sql`/* research purchase:items */ SELECT ${columns} FROM purchase_invoices p WHERE p.research_order_id=${orderId} ORDER BY p.date DESC,p.id DESC LIMIT 100`),
  executor.execute(sql`/* research purchase:totals */ SELECT coalesce(sum(total::numeric),0) AS "purchaseCost",coalesce(sum(paid_amount::numeric),0) AS "paidToSuppliers",coalesce(sum(remaining_amount::numeric),0) AS "supplierRemaining",count(*)::int AS "invoiceCount" FROM purchase_invoices WHERE research_order_id=${orderId} AND status='active'`),
  search?executor.execute(sql`/* research purchase:candidates */ SELECT ${columns} FROM purchase_invoices p WHERE p.research_order_id IS NULL AND p.status='active' AND (p.invoice_no ILIKE ${`%${search.replace(/[\\%_]/g,c=>`\\${c}`)}%`} OR p.supplier_name ILIKE ${`%${search.replace(/[\\%_]/g,c=>`\\${c}`)}%`}) AND NOT EXISTS(SELECT 1 FROM purchase_invoice_items item WHERE item.invoice_id=p.id AND (item.kosha_id IS NOT NULL OR item.construction_project_id IS NOT NULL OR item.booking_id IS NOT NULL OR item.cost_category IS NOT NULL)) ORDER BY p.date DESC,p.id DESC LIMIT 20`):Promise.resolve({rows:[]}),
 ]);
 const [totals]=readRows(totalsResult);if(!totals)throw new Error('Missing purchase totals');
 const costSummary=Object.fromEntries(['purchaseCost','paidToSuppliers','supplierRemaining','invoiceCount'].map(key=>{const value=Number(totals[key]);if(!Number.isFinite(value))throw new Error('Invalid purchase cost');return[key,value]}));
 return {items:readRows(itemsResult),candidates:readRows(candidatesResult),costSummary};
}
export async function linkResearchPurchase(orderId:number,raw:unknown,user:ResearchAdminUser){
 if(!procurement(user)||!(user.role==='admin'||user.permissions.includes('research')||user.permissions.includes('research.financials.view')))throw new ResearchFinanceError('لا تملك صلاحية ربط المشتريات بالبحث',403,'PERMISSION_DENIED');
 id(orderId);const invoiceId=id((raw as any)?.purchaseInvoiceId);
 return db.transaction(async tx=>{
  const [order]=readRows(await tx.execute(sql`SELECT id,status,research_no FROM research_orders WHERE id=${orderId} FOR UPDATE`));if(!order)throw new ResearchFinanceError('البحث غير موجود',404,'NOT_FOUND');if(['archived','cancelled'].includes(order.status))throw new ResearchFinanceError('البحث مؤرشف أو ملغى',409,'CONFLICT');
  const [invoice]=readRows(await tx.execute(sql`SELECT ${columns} FROM purchase_invoices p WHERE p.id=${invoiceId} FOR UPDATE`));if(!invoice)throw new ResearchFinanceError('فاتورة الشراء غير موجودة',404,'NOT_FOUND');
  if(invoice.researchOrderId===orderId)return {invoice,duplicate:true};
  if(invoice.researchOrderId||invoice.status!=='active')throw new ResearchFinanceError('الفاتورة ملغاة أو مرتبطة ببحث آخر',409,'CONFLICT');
  const [conflict]=readRows(await tx.execute(sql`SELECT id FROM purchase_invoice_items WHERE invoice_id=${invoiceId} AND (kosha_id IS NOT NULL OR construction_project_id IS NOT NULL OR booking_id IS NOT NULL OR cost_category IS NOT NULL) LIMIT 1`));if(conflict)throw new ResearchFinanceError('الفاتورة مرتبطة بمركز تكلفة آخر؛ لا يمكن احتسابها مرة ثانية',409,'CONFLICT');
  await tx.execute(sql`UPDATE purchase_invoices SET research_order_id=${orderId},updated_at=now() WHERE id=${invoiceId}`);
  const actor=user.fullName||user.username,metadata=JSON.stringify({purchaseInvoiceId:invoiceId,invoiceNo:invoice.invoiceNo});
  await tx.execute(sql`INSERT INTO entity_timeline(entity_type,entity_id,type,title,body,actor_id,actor_name,metadata) VALUES('research_order',${orderId},'research_purchase_linked','ربط فاتورة شراء أصلية',${invoice.invoiceNo},${user.id},${actor},${metadata}::jsonb)`);
  await tx.execute(sql`INSERT INTO admin_activity_logs(staff_id,user_name,action,entity_type,entity_id,metadata) VALUES(${user.id},${actor},'research_purchase_linked','research_order',${orderId},${metadata}::jsonb)`);
  return {invoice:{...invoice,researchOrderId:orderId},duplicate:false};
 });
}
