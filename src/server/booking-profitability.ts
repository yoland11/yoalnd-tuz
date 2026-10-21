import {sql} from "drizzle-orm";
import {deriveBookingProfitability,type BookingCostFact} from "../lib/booking-profitability";
import type {BookingFinancialSummary} from "./booking-finance";
type Ref={source:"kosha"|"service";id:number};
type Executor={execute(query:any):Promise<any>};
export class BookingProfitabilityError extends Error{constructor(message:string,public status=409){super(message)}}

/** Read-only, authorized by caller. Native booking FKs never imply service-order attribution. */
export async function getBookingProfitability(executor:Executor,ref:Ref,summaryReader:(source:Ref["source"],id:number,executor:Executor)=>Promise<BookingFinancialSummary|null>){
  if(!["kosha","service"].includes(ref.source)||!Number.isSafeInteger(ref.id)||ref.id<=0)throw new BookingProfitabilityError("هوية الحجز غير صحيحة",422);
  const summary=await summaryReader(ref.source,ref.id,executor);
  if(!summary)throw new BookingProfitabilityError("الحجز غير موجود أو مؤرشف",404);
  const reasons:string[]=[];const costs:BookingCostFact[]=[];
  if(ref.source==="service")reasons.push("ربط تكاليف المصروفات والمركبات والمشتريات الحالي يخص حجز الكوشة الأصلي فقط؛ لا يُنقل لحجز خدمة يحمل نفس الرقم.");
  else{
    const result=await executor.execute(sql`
      WITH attributed AS (
        SELECT 'expense:'||e.id AS key,e.name AS label,e.amount::numeric AS amount,
          CASE WHEN e.cost_category='investment' THEN 'investment' ELSE 'operating' END AS category,
          'expense' AS kind,e.approval_status AS snapshot_status,e.financial_transaction_id AS transaction_id
        FROM expenses e WHERE e.booking_id=${ref.id} AND e.deleted_at IS NULL
        UNION ALL
        SELECT 'vehicle:'||v.id,coalesce(v.description,v.expense_type),v.amount::numeric,'operating','expense',v.status,v.financial_transaction_id
        FROM vehicle_expenses v WHERE v.booking_id=${ref.id}
        UNION ALL
        SELECT 'purchase:'||i.id,i.product_name,i.total::numeric,
          CASE WHEN i.cost_category='investment' THEN 'investment' WHEN i.cost_category IN ('booking','operating') THEN 'operating' ELSE 'unclassified' END,
          'purchase',p.status,NULL::integer
        FROM purchase_invoice_items i JOIN purchase_invoices p ON p.id=i.invoice_id
        WHERE i.booking_id=${ref.id} AND p.status NOT IN ('cancelled','void','deleted')
      )
      SELECT a.*,t.approval_status AS tx_status,t.direction AS tx_direction,t.amount::numeric AS tx_amount,
        coalesce((SELECT sum(r.amount::numeric) FROM financial_transactions r WHERE r.reversed_transaction_id=t.id AND r.approval_status='executed' AND r.direction='revenue'),0) AS reversed
      FROM attributed a LEFT JOIN financial_transactions t ON t.id=a.transaction_id ORDER BY a.key LIMIT 5001`);
    if(!Array.isArray(result?.rows))throw new Error("Invalid booking cost query response");
    if(result.rows.length>5000)throw new BookingProfitabilityError("تجاوزت تكاليف الحجز حد القراءة؛ لا يمكن عرض إجمالي مقتطع",422);
    for(const row of result.rows){
      if(!["investment","operating"].includes(String(row.category)))throw new BookingProfitabilityError("تصنيف بند شراء قديم غير موثّق؛ راجعه قبل احتسابه ضمن ربحية الحجز");
      const amount=Number(row.amount);
      if(!Number.isFinite(amount)||amount<0)throw new BookingProfitabilityError("قيمة تكلفة الحجز غير صالحة");
      let value=amount,status:string;
      if(row.transaction_id!=null){
        if(!row.tx_status)throw new BookingProfitabilityError("مصروف الحجز مرتبط بمرجع مالي غير متاح؛ راجع السجل الأصلي");
        status=String(row.tx_status);
        if(status==="executed"){
          if(row.tx_direction!=="expense")throw new BookingProfitabilityError("مرجع المصروف لا يمثل تكلفة تشغيلية");
          const original=Number(row.tx_amount),reversed=Number(row.reversed);
          if(!Number.isFinite(original)||!Number.isFinite(reversed)||original<0||reversed<0||reversed>original+.005||Math.abs(original-amount)>.005)throw new BookingProfitabilityError("قيمة المصروف أو عكسه لا تطابق المرجع المالي");
          value=Math.round((original-reversed)*100)/100;
        }else if(["draft","submitted","pending"].includes(status))status="pending";
        else if(!["rejected","cancelled"].includes(status))throw new BookingProfitabilityError("حالة مالية غير معروفة في تحليل الحجز");
      }else{
        status=["rejected","cancelled"].includes(String(row.snapshot_status))?String(row.snapshot_status):"estimated";
        reasons.push(row.kind==="purchase"?"بنود الشراء تقديرية: توزيع خصم وضريبة وشحن الفاتورة على الحجز غير موثّق؛ تسديد المورد لا يضاف كتلفة ثانية.":"يوجد مصروف قديم دون مرجع مالي؛ يُعرض تقديرياً ولا يُعتبر تكلفة معتمدة.");
      }
      costs.push({key:row.transaction_id!=null?`transaction:${row.transaction_id}`:String(row.key),label:String(row.label||"تكلفة مرتبطة"),amount:value,status,category:String(row.category),kind:String(row.kind)});
    }
  }
  return {...deriveBookingProfitability({summary,attributionAvailable:ref.source==="kosha",costs,recognizedRevenue:null,reasons}),source:ref.source,id:ref.id,generatedAt:new Date().toISOString()};
}
