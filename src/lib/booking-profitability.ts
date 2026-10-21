export type BookingCostFact={key:string;label:string;amount:number;status:string;category:string;kind:string};
type Input={summary:{finalTotal:number;paid:number;remaining:number;paymentStatus:string};attributionAvailable:boolean;costs:BookingCostFact[];recognizedRevenue:number|null;reasons:string[]};
const round=(n:number)=>Math.round(n*100)/100;
/** Analytical only. Collection, recognized revenue and asset investment are distinct. */
export function deriveBookingProfitability(input:Input){
  const money=(n:number)=>{if(!Number.isFinite(n)||n<0)throw new Error("قيمة مالية غير صالحة في تحليل الحجز");return round(n)};
  const seen=new Map<string,BookingCostFact>();
  for(const row of input.costs){
    money(row.amount);if(!row.key||!["executed","pending","estimated","rejected","cancelled"].includes(row.status)||!["operating","investment"].includes(row.category))throw new Error("مرجع تكلفة الحجز غير صالح");
    const previous=seen.get(row.key);
    if(previous&&(previous.amount!==row.amount||previous.status!==row.status||previous.category!==row.category))throw new Error("مرجع مالي متعارض بين مصادر التكلفة");
    seen.set(row.key,row);
  }
  const costs=[...seen.values()].filter(c=>!["rejected","cancelled"].includes(c.status));
  const sum=(f:(c:BookingCostFact)=>boolean)=>round(costs.filter(f).reduce((s,c)=>s+money(c.amount),0));
  const approved=input.attributionAvailable?sum(c=>c.category==="operating"&&c.status==="executed"):null;
  const provisional=input.attributionAvailable?sum(c=>c.category==="operating"&&c.status!=="executed"):null;
  const reasons=[...input.reasons];
  if(input.recognizedRevenue===null)reasons.push("الإيراد المعترف به غير متاح من المصدر المحاسبي الحالي؛ المدفوع ليس إيراداً إضافياً.");
  reasons.push("التحليل يعرض التكاليف المرتبطة صراحة بالحجز؛ اكتمال تكاليف الأجور والمواد والإصلاحات غير موثّق.");
  const contractValue=money(input.summary.finalTotal);
  return {contractValue,collected:money(input.summary.paid),receivable:money(input.summary.remaining),paymentStatus:input.summary.paymentStatus,
    recognizedRevenue:input.recognizedRevenue===null?null:money(input.recognizedRevenue),approvedOperatingCost:approved,provisionalOperatingCost:provisional,
    capitalInvestment:input.attributionAvailable?sum(c=>c.category==="investment"):null,
    estimatedMargin:approved===null||provisional===null?null:round(contractValue-approved-provisional),
    actualProfit:null,complete:false as const,reasons:[...new Set(reasons)],costs};
}
