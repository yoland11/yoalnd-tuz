import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Camera, CheckCircle2, ClipboardList, FileText, Loader2, MapPin, PackageCheck, QrCode, ScanLine, UserRound, Users, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { LiveScanner } from "./live-scanner";
import { filesToMedia, staffApi, type ExecutionDetail } from "./lib";

const nextAction: Record<string, { label: string; stage: string }> = {
  booked: { label: "بدء التجهيز", stage: "details_approved" },
  details_approved: { label: "تأكيد تجهيز المعدات", stage: "preparing" },
  preparing: { label: "تأكيد التحميل", stage: "loaded" },
  loaded: { label: "بدء التنصيب", stage: "installing" },
  installing: { label: "إكمال التنصيب", stage: "executed" },
  executed: { label: "بدء فك المعدات", stage: "event_active" },
  event_active: { label: "تأكيد بدء الفك", stage: "dismantled" },
  dismantled: { label: "تأكيد إعادة المعدات", stage: "returned" },
  returned: { label: "إرسال للفحص", stage: "inspection" },
};

const stageLabel: Record<string, string> = {
  booked: "بانتظار البدء", details_approved: "اعتمدت التفاصيل", preparing: "قيد التجهيز", loaded: "تم التحميل", installing: "قيد التنصيب", executed: "تم التنصيب", event_active: "المناسبة جارية", dismantled: "تم الفك", returned: "تمت الإعادة", inspection: "قيد الفحص", completed: "مكتمل",
};

export default function EventExecutionWorkspace({ source, id, onBack }: { source: "kosha" | "service"; id: number; onBack: () => void }) {
  const { toast } = useToast();
  const client = useQueryClient();
  const [scanner, setScanner] = useState<"booking" | "asset" | null>(null);
  const [assetCode, setAssetCode] = useState("");
  const [note, setNote] = useState("");
  const [damage, setDamage] = useState("");
  const [damageCode, setDamageCode] = useState("");
  const [damageType, setDamageType] = useState<"broken" | "lost">("broken");
  const key = ["staff", "event-execution", source, id];
  const query = useQuery<ExecutionDetail>({ queryKey: key, queryFn: () => staffApi.execution(source, id) });
  const refresh = () => { void client.invalidateQueries({ queryKey: key }); void client.invalidateQueries({ queryKey: ["staff", "execution-bookings"] }); };
  const update = useMutation({ mutationFn: (payload: { section: string; stage?: string; data?: Record<string, unknown> }) => staffApi.updateExecution(source, id, payload), onSuccess: () => { refresh(); toast({ title: "تم حفظ تحديث التنفيذ" }); }, onError: (error: any) => toast({ title: "تعذر حفظ التحديث", description: error?.message, variant: "destructive" }) });
  const bookingQr = useMutation({ mutationFn: (code: string) => staffApi.verifyBookingQr(source, id, code), onSuccess: () => toast({ title: "تم التحقق من QR الحجز" }), onError: (error: any) => toast({ title: "هذا الرمز لا يخص الحجز الحالي", description: error?.message, variant: "destructive" }) });
  const photo = useMutation({ mutationFn: async ({ files, purpose }: { files: FileList; purpose: string }) => staffApi.uploadExecutionPhotos(source, id, purpose, await filesToMedia(files)), onSuccess: () => { refresh(); toast({ title: "تم رفع صور التنفيذ" }); }, onError: (error: any) => toast({ title: "تعذر رفع الصور", description: error?.message, variant: "destructive" }) });
  const task = useMutation({ mutationFn: (taskId: number) => staffApi.completeExecutionTask(source, id, taskId), onSuccess: () => { refresh(); toast({ title: "تم إكمال المهمة" }); }, onError: (error: any) => toast({ title: "تعذر إكمال المهمة", description: error?.message, variant: "destructive" }) });
  const asset = useMutation({ mutationFn: (payload: { mode: "resolve" | "checkout" | "return"; code: string; problem?: "none" | "broken" | "lost"; note?: string }) => staffApi.scanAsset(id, payload), onSuccess: (result) => { refresh(); toast({ title: result.name || "تم تسجيل حركة الأصل", description: result.status === "pending_approval" ? "أُرسل بلاغ النقص لاعتماد الإدارة" : undefined }); }, onError: (error: any) => toast({ title: "تعذرت عملية الأصل", description: error?.message, variant: "destructive" }) });
  const data = query.data;
  const location = useMemo(() => data ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(data.booking.venue)}` : "#", [data]);

  if (query.isLoading) return <div className="flex min-h-[50vh] items-center justify-center" dir="rtl"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;
  if (!data) return <div className="p-5 text-center" dir="rtl"><AlertTriangle className="mx-auto mb-2 text-destructive" /><p>تعذر فتح الحجز أو ليس مخصصاً لك.</p><Button className="mt-3" variant="outline" onClick={onBack}>الرجوع</Button></div>;

  const current = data.state?.mainStage || "booked";
  const action = nextAction[current];
  const warehouse = data.state?.warehouseStage || "reserved";
  const isKosha = source === "kosha";
  const scanDetected = (value: string) => {
    setScanner(null);
    if (scanner === "booking") {
      bookingQr.mutate(value);
      return;
    }
    setAssetCode(value);
    asset.mutate({ mode: "resolve", code: value });
  };

  return <main className="mx-auto max-w-2xl space-y-4 bg-background p-4 pb-10" dir="rtl">
    <header className="rounded-xl bg-card p-4 shadow-sm">
      <button type="button" onClick={onBack} className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground"><ArrowRight className="h-4 w-4" /> الحجوزات</button>
      <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold text-primary">حجز تنفيذ {data.booking.number}</p><h1 className="mt-1 text-xl font-extrabold">{data.booking.customerName}</h1><p className="mt-1 text-sm text-muted-foreground">{data.booking.phone}</p></div><span className="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary">{stageLabel[current] || current}</span></div>
      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2"><div className="rounded-lg bg-muted/60 p-3"><b>{String(data.booking.eventDate || "").slice(0, 10)}</b><span className="mr-2 text-muted-foreground">{data.booking.eventTime || "الوقت غير محدد"}</span></div><a href={location} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg bg-muted/60 p-3 font-semibold"><MapPin className="h-4 w-4 text-primary" />{data.booking.venue || "الموقع غير محدد"}</a></div>
      <div className="mt-3 flex flex-wrap gap-1.5">{data.services.map((service) => <span key={service} className="rounded-full border border-border px-2.5 py-1 text-xs font-semibold">{({ kosha: "الكوشة", sound: "الصوتيات", lighting: "الإضاءة", furniture: "الأثاث", decoration: "الديكور", transport: "النقل", screens: "الشاشات" } as Record<string, string>)[service] || service}</span>)}</div>
    </header>

    {action && <section className="rounded-xl bg-primary p-4 text-primary-foreground"><p className="text-sm opacity-90">الخطوة التالية</p><div className="mt-2 flex items-center justify-between gap-3"><b>{action.label}</b><Button variant="secondary" disabled={update.isPending} onClick={() => update.mutate({ section: "main", stage: action.stage })}>{update.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} تأكيد</Button></div></section>}

    <section className="rounded-xl bg-card p-4 shadow-sm"><h2 className="flex items-center gap-2 font-bold"><QrCode className="h-5 w-5 text-primary" />المسح والتجهيز</h2><div className="mt-3 grid grid-cols-2 gap-2"><Button variant="outline" onClick={() => setScanner("booking")}><QrCode /> مسح QR الحجز</Button>{isKosha && <Button variant="outline" onClick={() => setScanner("asset")}><ScanLine /> مسح QR الأصل</Button>}</div>{isKosha && <div className="mt-3 flex gap-2"><Input value={assetCode} onChange={(e) => setAssetCode(e.target.value)} placeholder="رمز الأصل أو الباركود" /><Button variant="outline" disabled={!assetCode || asset.isPending} onClick={() => asset.mutate({ mode: "resolve", code: assetCode })}>تحقق</Button></div>}{scanner && <div className="mt-3 overflow-hidden rounded-lg border border-border"><LiveScanner active onDetect={scanDetected} /><Button className="m-2" variant="ghost" onClick={() => setScanner(null)}>إلغاء المسح</Button></div>}</section>

    <section className="rounded-xl bg-card p-4 shadow-sm"><h2 className="flex items-center gap-2 font-bold"><PackageCheck className="h-5 w-5 text-primary" />المستودع والمعدات</h2><p className="mt-1 text-sm text-muted-foreground">حالة المستودع: {warehouse}</p><div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" disabled={update.isPending} onClick={() => update.mutate({ section: "warehouse", stage: "out" })}>تأكيد مغادرة المستودع</Button><Button variant="outline" disabled={update.isPending} onClick={() => update.mutate({ section: "warehouse", stage: "returned" })}>تأكيد الإرجاع</Button></div><div className="mt-4 divide-y divide-border">{data.assets.map((item: any) => <div key={item.productId} className="flex items-center justify-between gap-3 py-3 text-sm"><div><b>{item.name}</b><p className="text-xs text-muted-foreground">{item.assetCode} · الكمية {item.quantity}</p></div><span className="text-xs font-semibold text-muted-foreground">{item.stage}</span></div>)}{!data.assets.length && <p className="py-3 text-sm text-muted-foreground">لا توجد معدات مسجلة لهذا الحجز.</p>}</div></section>

    <section className="rounded-xl bg-card p-4 shadow-sm"><h2 className="flex items-center gap-2 font-bold"><ClipboardList className="h-5 w-5 text-primary" />مهامي</h2><div className="mt-3 space-y-2">{data.tasks.map((item: any) => <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 p-3"><div><b className="text-sm">{item.title}</b>{item.description && <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>}</div>{item.status === "completed" ? <CheckCircle2 className="h-5 w-5 text-status-success" /> : <Button size="sm" disabled={task.isPending} onClick={() => task.mutate(item.id)}>إكمال</Button>}</div>)}{!data.tasks.length && <p className="py-3 text-sm text-muted-foreground">لا توجد مهام مكلّف بها حالياً.</p>}</div></section>

    <section className="rounded-xl bg-card p-4 shadow-sm"><h2 className="flex items-center gap-2 font-bold"><Camera className="h-5 w-5 text-primary" />صور التنفيذ</h2><div className="mt-3 grid grid-cols-2 gap-2"><PhotoButton label="رفع صور قبل التنفيذ" purpose="before_preparation" busy={photo.isPending} onFiles={(files) => photo.mutate({ files, purpose: "before_preparation" })} /><PhotoButton label="رفع صور بعد التنفيذ" purpose="after_installation" busy={photo.isPending} onFiles={(files) => photo.mutate({ files, purpose: "after_installation" })} /></div></section>

    {isKosha && <section className="rounded-xl bg-card p-4 shadow-sm"><h2 className="flex items-center gap-2 font-bold"><Wrench className="h-5 w-5 text-primary" />إبلاغ عن تلف أو نقص</h2><div className="mt-3 grid gap-2 sm:grid-cols-2"><Input value={damageCode} onChange={(e) => setDamageCode(e.target.value)} placeholder="رمز الأصل" /><select value={damageType} onChange={(e) => setDamageType(e.target.value as "broken" | "lost")} className="h-10 rounded-md border border-input bg-background px-3 text-sm"><option value="broken">تلف</option><option value="lost">نقص / فقدان</option></select></div><Textarea className="mt-2" value={damage} onChange={(e) => setDamage(e.target.value)} placeholder="وصف الحالة" /><Button className="mt-2" variant="outline" disabled={!damageCode || !damage || asset.isPending} onClick={() => asset.mutate({ mode: "return", code: damageCode, problem: damageType, note: damage })}><AlertTriangle />إرسال البلاغ</Button></section>}

    <section className="rounded-xl bg-card p-4 shadow-sm"><h2 className="flex items-center gap-2 font-bold"><FileText className="h-5 w-5 text-primary" />ملاحظة تنفيذ</h2><Textarea className="mt-3" value={note} onChange={(e) => setNote(e.target.value)} placeholder="اكتب ملاحظة للفريق أو الإدارة..." /><Button className="mt-2" disabled={!note.trim() || update.isPending} onClick={() => { update.mutate({ section: "notes", data: { note } }); setNote(""); }}>حفظ الملاحظة</Button></section>
    <section className="rounded-xl bg-card p-4 shadow-sm"><h2 className="flex items-center gap-2 font-bold"><Users className="h-5 w-5 text-primary" />فريق التنفيذ</h2><div className="mt-3 space-y-2">{(data.state?.team ?? []).map((member: any, index: number) => <div className="rounded-lg bg-muted/50 p-3 text-sm" key={`${member.name}-${index}`}><b>{member.name || "عضو الفريق"}</b><span className="mr-2 text-muted-foreground">{member.role || member.task || ""}</span></div>)}</div></section>
  </main>;
}

function PhotoButton({ label, purpose: _purpose, busy, onFiles }: { label: string; purpose: string; busy: boolean; onFiles: (files: FileList) => void }) {
  return <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 p-3 text-center text-sm font-semibold"><Camera className="h-5 w-5 text-primary" />{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : label}<input className="sr-only" type="file" accept="image/*" multiple onChange={(event) => event.target.files && onFiles(event.target.files)} /></label>;
}
