import type { KoshaManagerSource } from "./kosha-manager-contract";

export const bookingLabels: Record<string, string> = { new: "جديد", pending: "جديد", contacted: "قيد المتابعة", confirmed: "تم الحجز", processing: "قيد التجهيز", in_progress: "قيد التنفيذ", completed: "مكتمل", cancelled: "ملغي" };
export const paymentLabels: Record<string, string> = { paid: "مدفوع بالكامل", partial: "مدفوع جزئياً", unpaid: "غير مدفوع", pending_pricing: "بانتظار التسعير" };
export const executionLabels: Record<string, string> = { booked: "تم الحجز", preparing: "قيد التجهيز", ready: "جاهز", out_of_warehouse: "التحميل", on_the_way: "في الطريق", executing: "جاري التنصيب", executed: "تم التنصيب", event_running: "أثناء المناسبة", before_return: "قبل الإرجاع", dismantling: "فك الكوشة", returned: "العودة للمخزن", delivered: "مكتمل", arrived: "تم الوصول (سجل سابق)" };
export const bookingIdentity = (b: {source?: string; id:number}) => `${b.source === "service" ? "service" : "kosha"}:${b.id}`;
export const bookingNumber = (b: {source?: string; id:number}) => `${b.source === "service" ? "S" : "K"}-${b.id}`;
export const sourceQuery = (b: {source?: string}) => `source=${b.source === "service" ? "service" : "kosha"}`;
export function baghdadDay(now = new Date()) { return new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Baghdad",year:"numeric",month:"2-digit",day:"2-digit"}).format(now); }
export function shiftDay(day: string, amount: number) { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+amount); return d.toISOString().slice(0,10); }
export function displayEventDate(value?: string | null) { if (!value) return "غير محدد"; const d = new Date(`${value.slice(0,10)}T12:00:00Z`); return Number.isNaN(d.getTime()) ? value : new Intl.DateTimeFormat("ar-IQ-u-nu-latn", {day:"numeric",month:"long",year:"numeric",timeZone:"Asia/Baghdad"}).format(d); }
export function displayEventTime(value?: string | null) { const m = value?.match(/^(\d{1,2}):(\d{2})/); if (!m) return value || "الوقت غير محدد"; const h=Number(m[1]); return `${String(h%12||12).padStart(2,"0")}:${m[2]} ${h>=12?"م":"ص"}`; }
export type ManagerHeader = {id:number;source:KoshaManagerSource;customerName:string;phone:string;eventDate:string;status:string;paymentStatus:string;executionStage:string;koshaId:number|null;koshaName:string;remainingAmount:number;createdAt:string;searchText:string};
export function filterManagerHeaders(headers: ManagerHeader[], params: URLSearchParams, today=baghdadDay()) {
  const q=(params.get("search")||"").trim().toLocaleLowerCase();
  const quick=params.get("quick");
  const closed=(r:ManagerHeader)=>r.status==="cancelled"||r.status==="completed"||r.executionStage==="delivered";
  const inProgress=(r:ManagerHeader)=>!closed(r)&&(["in_progress","processing"].includes(r.status)||["out_of_warehouse","on_the_way","executing","executed","event_running","before_return","dismantling","returned"].includes(r.executionStage));
  const startOfWeek=shiftDay(today,-((new Date(`${today}T12:00:00Z`).getUTCDay()+1)%7));
  return headers.filter(r => (!q || `${r.searchText} ${bookingNumber(r)} ${r.id}`.toLocaleLowerCase().includes(q))
    && (!params.get("status") || r.status===params.get("status"))
    && (!params.get("paymentStatus") || r.paymentStatus===params.get("paymentStatus"))
    && (!params.get("koshaId") || String(r.koshaId)===params.get("koshaId"))
    && (!params.get("dateFrom") || r.eventDate>=params.get("dateFrom")!)
    && (!params.get("dateTo") || (!!r.eventDate&&r.eventDate<=params.get("dateTo")!))
    && (!quick || (quick==="today"&&r.eventDate===today) || (quick==="tomorrow"&&r.eventDate===shiftDay(today,1))
      || (quick==="week"&&r.eventDate>=startOfWeek&&r.eventDate<=shiftDay(startOfWeek,6))
      || (quick==="upcoming"&&r.eventDate>=today&&!closed(r)) || (quick==="unpaid"&&["unpaid","partial"].includes(r.paymentStatus))
      || (quick==="in_progress"&&inProgress(r)) || (quick==="completed"&&r.status!=="cancelled"&&(r.status==="completed"||r.executionStage==="delivered"))))
    .sort((a,b)=> params.get("sortRemaining")==="asc" ? a.remainingAmount-b.remainingAmount : params.get("sortRemaining")==="desc" ? b.remainingAmount-a.remainingAmount : b.createdAt.localeCompare(a.createdAt)||b.id-a.id||a.source.localeCompare(b.source));
}
export function managerStats(rows:ManagerHeader[],today=baghdadDay()) { return {total:rows.length,completed:filterManagerHeaders(rows,new URLSearchParams({quick:"completed"}),today).length,cancelled:rows.filter(r=>r.status==="cancelled").length,inProgress:filterManagerHeaders(rows,new URLSearchParams({quick:"in_progress"}),today).length,upcoming:filterManagerHeaders(rows,new URLSearchParams({quick:"upcoming"}),today).length}; }
