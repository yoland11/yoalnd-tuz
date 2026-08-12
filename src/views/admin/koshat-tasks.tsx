import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarDays, CheckCircle2, ClipboardList, MapPin, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { adminFetch } from "./_lib";

type Booking = { id:number; trackingCode?:string|null; customerName:string; phone:string; koshaName?:string|null; eventDate?:string|null; eventTime?:string|null; hallLocation?:string|null; area?:string|null; notes?:string|null };
type Staff = { id:number; fullName:string; username:string; availability:"available"|"nearby"|"conflict"; conflicts: unknown[] };
type WorkOrder = { id:number; workOrderNo:string; bookingId:number; status:string; customer_name?:string; customerName:string; koshaName:string; eventDate:string; eventTime:string; location:string|null; leaderName:string|null; requiredArrivalAt:string|null; unreturned_assets:number; isLate?:boolean };

const columns = [
  ["UNASSIGNED", "غير مسند"], ["ASSIGNED", "بانتظار القبول"], ["PREPARING", "قيد التجهيز"],
  ["ON_THE_WAY", "في الطريق"], ["INSTALLING", "التركيب"], ["READY", "جاهز"], ["RETURNING", "العودة"], ["COMPLETED", "مكتمل"],
] as const;

function arrivalValue(booking: Booking) { return booking.eventDate ? `${booking.eventDate}T${booking.eventTime || "00:00"}` : ""; }

function AssignWorkOrderDialog({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const { toast } = useToast(); const client = useQueryClient();
  const [leaderId, setLeaderId] = useState(""); const [members, setMembers] = useState<number[]>([]);
  const [arrival, setArrival] = useState(arrivalValue(booking)); const [eventStart, setEventStart] = useState(arrivalValue(booking));
  const [dismantle, setDismantle] = useState(""); const [instructions, setInstructions] = useState(""); const [acknowledgment, setAcknowledgment] = useState(false);
  const staff = useQuery<Staff[]>({ queryKey:["koshat-task-staff", booking.eventDate], queryFn:()=>adminFetch(`/admin/koshat-tasks/staff?date=${encodeURIComponent(booking.eventDate ?? "")}`) });
  const save = useMutation({ mutationFn:()=>adminFetch("/admin/koshat-tasks", {method:"POST", body:JSON.stringify({ bookingId:booking.id, leaderId:Number(leaderId), memberIds:members, requiredArrivalAt:arrival || null, eventStartAt:eventStart || null, expectedDismantleAt:dismantle || null, specialInstructions:instructions || null, requireAcknowledgment:acknowledgment })}), onSuccess:()=>{ client.invalidateQueries({queryKey:["koshat-work-orders"]}); toast({title:"تم إسناد أمر العمل وإرسال التنبيهات للفريق"}); onClose(); }, onError:(error:any)=>toast({title:"تعذر إسناد المهمة",description:error?.message,variant:"destructive"}) });
  const picked = Number(leaderId); const selected = new Set([picked, ...members]);
  return <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-4" dir="rtl" onMouseDown={onClose}>
    <section className="mx-auto my-6 w-full max-w-3xl rounded-xl bg-card p-5 shadow-xl" onMouseDown={(event)=>event.stopPropagation()}>
      <div className="mb-5 flex items-start justify-between gap-3"><div><h2 className="text-lg font-bold">إسناد مهمة إلى فريق الكوشة</h2><p className="mt-1 text-sm text-muted-foreground">يُنشأ أمر عمل مستقل عن حالة الحجز ويحفظ كامل سجل التنفيذ.</p></div><Button variant="ghost" onClick={onClose}>إغلاق</Button></div>
      <div className="grid gap-2 rounded-lg bg-muted/50 p-3 text-sm sm:grid-cols-2"><div><b>رقم الحجز:</b> {booking.trackingCode || `BK-${booking.id}`}</div><div><b>العميل:</b> {booking.customerName} · <span dir="ltr">{booking.phone}</span></div><div><b>الكوشة:</b> {booking.koshaName || "كوشة"}</div><div><b>الموقع:</b> {booking.hallLocation || booking.area || "غير محدد"}</div><div><b>التاريخ والوقت:</b> {booking.eventDate || "—"} {booking.eventTime || ""}</div><div className="sm:col-span-2"><b>ملاحظات الحجز:</b> {booking.notes || "لا توجد"}</div></div>
      <div className="mt-5 grid gap-4 sm:grid-cols-3"><div><Label>وقت الوصول المطلوب</Label><Input type="datetime-local" value={arrival} onChange={(e)=>setArrival(e.target.value)} /></div><div><Label>بداية المناسبة</Label><Input type="datetime-local" value={eventStart} onChange={(e)=>setEventStart(e.target.value)} /></div><div><Label>وقت الفك المتوقع</Label><Input type="datetime-local" value={dismantle} onChange={(e)=>setDismantle(e.target.value)} /></div></div>
      <div className="mt-5"><Label>قائد المهمة *</Label><select value={leaderId} onChange={(e)=>{setLeaderId(e.target.value); setMembers((current)=>current.filter((id)=>id!==Number(e.target.value)));}} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">اختر قائد المهمة</option>{staff.data?.map((person)=><option key={person.id} value={person.id}>● {person.fullName || person.username} — {person.availability === "conflict" ? "تعارض" : person.availability === "nearby" ? "مهمة قريبة" : "متاح"}</option>)}</select></div>
      <div className="mt-4"><Label>أعضاء الفريق</Label><div className="mt-2 grid gap-2 sm:grid-cols-2">{staff.data?.filter((person)=>person.id!==picked).map((person)=>{ const active=members.includes(person.id); return <label key={person.id} className={`flex min-h-11 items-center justify-between rounded-lg border p-3 text-sm ${active ? "border-primary bg-primary/5" : "border-border"}`}><span><b>{person.fullName || person.username}</b><small className="mr-2 text-muted-foreground">{person.availability === "conflict" ? "🔴 تعارض" : person.availability === "nearby" ? "🟡 مهمة قريبة" : "🟢 متاح"}</small></span><input type="checkbox" checked={active} onChange={()=>setMembers((current)=>active?current.filter((id)=>id!==person.id):[...current,person.id])}/></label>})}</div></div>
      {staff.data?.some((person)=>selected.has(person.id) && person.availability === "conflict") && <div className="mt-3 flex gap-2 rounded-lg border border-status-warning/40 bg-status-warning/10 p-3 text-sm text-status-warning"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />يوجد تعارض زمني. سيُحفظ الإسناد فقط بعد تأكيدك بالزر أدناه.</div>}
      <div className="mt-4"><Label>تعليمات خاصة للفريق</Label><Textarea className="mt-1" value={instructions} onChange={(e)=>setInstructions(e.target.value)} placeholder="مثال: الوصول قبل 5:30 واستخدام الكنبة البيضاء الجديدة." /></div>
      <label className="mt-4 flex items-center gap-3 rounded-lg border p-3 text-sm"><Switch checked={acknowledgment} onCheckedChange={setAcknowledgment}/><span><b>يتطلب تأكيد القراءة</b><small className="mr-2 text-muted-foreground">يلزم قائد المهمة بتأكيد الاطلاع على التعليمات.</small></span></label>
      <div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>إلغاء</Button><Button disabled={!leaderId || save.isPending} onClick={()=>save.mutate()}><Users className="h-4 w-4" />إسناد المهمة للفريق</Button></div>
    </section>
  </div>;
}

export default function KoshatTasksPage() {
  const [filter,setFilter]=useState("today"); const [assigning,setAssigning]=useState<Booking|null>(null); const [bookingId,setBookingId]=useState("");
  const range=useMemo(()=>{ const today=new Date(); const iso=(d:Date)=>d.toISOString().slice(0,10); const tomorrow=new Date(today); tomorrow.setDate(today.getDate()+1); return filter==="today"?`from=${iso(today)}&to=${iso(today)}`:filter==="tomorrow"?`from=${iso(tomorrow)}&to=${iso(tomorrow)}`:""; },[filter]);
  const orders=useQuery<WorkOrder[]>({queryKey:["koshat-work-orders",range],queryFn:()=>adminFetch(`/admin/koshat-tasks?${range}`),refetchInterval:30000});
  const bookings=useQuery<Booking[]>({queryKey:["koshat-bookings-for-tasks"],queryFn:()=>adminFetch("/admin/kosha-bookings?search=&status=")});
  const availableBookings=(bookings.data??[]).filter((booking)=>!orders.data?.some((order)=>order.bookingId===booking.id));
  return <div className="space-y-5" dir="rtl"><header className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-bold">مهام تشغيل الكوشات</h1><p className="mt-1 text-sm text-muted-foreground">لوحة تنفيذ مستقلة من الإسناد حتى إعادة الأصول للمستودع.</p></div><div className="flex gap-2"><select value={bookingId} onChange={(e)=>setBookingId(e.target.value)} className="h-10 max-w-60 rounded-md border bg-background px-2 text-sm"><option value="">إسناد من حجز...</option>{availableBookings.map((booking)=><option key={booking.id} value={booking.id}>{booking.trackingCode || `BK-${booking.id}`} · {booking.customerName}</option>)}</select><Button disabled={!bookingId} onClick={()=>setAssigning(availableBookings.find((booking)=>booking.id===Number(bookingId))??null)}><Plus className="h-4 w-4"/>إسناد</Button></div></header>
    <div className="flex flex-wrap gap-2">{[["today","اليوم"],["tomorrow","غداً"],["all","الكل"]].map(([value,label])=><Button key={value} size="sm" variant={filter===value?"default":"outline"} onClick={()=>setFilter(value)}>{label}</Button>)}</div>
    {orders.isLoading?<div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">جارٍ تحميل أوامر العمل...</div>:<div className="grid gap-3 xl:grid-cols-4">{columns.map(([status,label])=>{const rows=(orders.data??[]).filter((order)=>order.status===status); return <section key={status} className="min-w-0 rounded-xl border bg-muted/20"><div className="flex items-center justify-between border-b px-3 py-2"><b className="text-sm">{label}</b><span className="rounded-full bg-background px-2 py-0.5 text-xs">{rows.length}</span></div><div className="space-y-2 p-2">{rows.map((order)=><Link key={order.id} href={`/admin/koshat-tasks?workOrder=${order.id}`} className="block rounded-lg border bg-card p-3 transition hover:border-primary/50"><div className="flex items-center justify-between gap-2"><b className="text-sm">{order.workOrderNo}</b>{order.unreturned_assets>0&&<span title="أصول لم تُعد"><AlertTriangle className="h-4 w-4 text-status-warning"/></span>}</div><p className="mt-1 truncate text-sm">{order.customerName} · {order.koshaName}</p><p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><CalendarDays className="h-3.5 w-3.5"/>{order.eventDate} {order.eventTime}</p><p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3.5 w-3.5"/>{order.location||"الموقع غير محدد"}</p><p className="mt-2 text-xs text-primary">القائد: {order.leaderName||"بانتظار الإسناد"}</p></Link>)}{!rows.length&&<p className="p-3 text-center text-xs text-muted-foreground">لا توجد مهام</p>}</div></section>})}</div>}
    {assigning&&<AssignWorkOrderDialog booking={assigning} onClose={()=>{setAssigning(null);setBookingId("")}}/>}
  </div>;
}

export { AssignWorkOrderDialog };
