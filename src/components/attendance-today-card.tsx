import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { readAttendanceCode } from "@/lib/attendance-client";
import { CalendarClock, CheckCircle2, ClipboardPen, LogIn, LogOut, MapPin, QrCode, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ATTENDANCE_METHOD_LABELS, CORRECTION_TYPES, baghdadDate, baghdadTime, type AttendanceMethod } from "@/lib/attendance-rules";
import { fileToDataUrl } from "@/lib/image-tools";
import { adminFetch, apiErrorMessage } from "@/views/admin/_lib";

const LiveScanner = lazy(() => import("@/views/staff/live-scanner").then((module) => ({ default: module.LiveScanner })));

type ShiftView = { shiftId: number | null; startMs: number; endMs: number; kind: string; title: string | null; bookingSource: string | null; bookingId: number | null; locationName: string | null; method: AttendanceMethod; needsQr: boolean; needsGps: boolean; manualOnly: boolean; allowedMethods: string[] };
type Today = {
  enabled: boolean; employeeName: string; date: string; status: string; statusLabel: string; workedMinutes: number; open: { id: number; startMs: number } | null; shifts: ShiftView[]; current: ShiftView | null; canCheckIn: boolean; canCheckOut: boolean;
  recent?: Array<{ id: number; checkInMs: number | null; checkOutMs: number | null; workedMinutes: number; status: string; locationName: string | null }>;
  corrections: Array<{ id: number; workDate: string; requestType: string; status: string }>;
};
type Action = "check_in" | "check_out";
type Submission = { action: Action; shiftId?: number; qrCode?: string; gps?: { latitude: number; longitude: number; accuracy: number } | null };

const hours = (minutes: number) => `${Math.floor(minutes / 60)}س ${minutes % 60}د`;
const CORRECTION_STATUS: Record<string, string> = { pending: "بانتظار الموافقة", approved: "تمت الموافقة", rejected: "مرفوض" };
const STATUS_TONE: Record<string, string> = {
  present: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  mission: "bg-sky-500/10 text-sky-800 dark:text-sky-300",
  late: "bg-amber-500/10 text-amber-800 dark:text-amber-300",
  absent: "bg-destructive/10 text-destructive",
};

/** Asks only at the moment of submitting. Nothing watches the location afterwards. */
function currentPosition() {
  return new Promise<{ latitude: number; longitude: number; accuracy: number }>((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error("هذا المتصفح لا يدعم تحديد الموقع")); return; }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy }),
      (cause) => reject(new Error(cause.code === cause.PERMISSION_DENIED ? "اسمح للموقع باستخدام تحديد الموقع ثم أعد المحاولة" : cause.code === cause.TIMEOUT ? "تأخر تحديد الموقع. اقترب من مكان مفتوح وأعد المحاولة" : "تعذر تحديد موقعك")),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}

function CorrectionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const blank = () => ({ workDate: baghdadDate(), requestType: "forgot_check_out", checkInTime: "", checkOutTime: "", reason: "", attachment: "" });
  const [form, setForm] = useState(blank);
  const save = useMutation({
    mutationFn: () => adminFetch("/admin/attendance/corrections", { method: "POST", body: JSON.stringify(form) }),
    onSuccess: () => {
      toast({ title: "أُرسل الطلب للمدير" });
      setForm(blank());
      void queryClient.invalidateQueries({ queryKey: ["staff", "attendance"] });
      onClose();
    },
  });
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !save.isPending) onClose(); }}>
      <DialogContent dir="rtl" className="max-h-[90dvh] w-[min(calc(100%-2rem),30rem)] overflow-y-auto">
        <DialogHeader className="text-start"><DialogTitle>طلب تصحيح حضور</DialogTitle><DialogDescription>لا يتغيّر سجلك قبل موافقة المدير.</DialogDescription></DialogHeader>
        <form id="attendance-correction" className="grid gap-3" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
          <label className="text-sm font-medium">التاريخ<Input type="date" className="mt-1" value={form.workDate} onChange={(event) => setForm({ ...form, workDate: event.target.value })} /></label>
          <label className="text-sm font-medium">نوع الطلب
            <select className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-2 text-sm" value={form.requestType} onChange={(event) => setForm({ ...form, requestType: event.target.value })}>
              {Object.entries(CORRECTION_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm font-medium">وقت الحضور<Input type="time" dir="ltr" className="mt-1" value={form.checkInTime} onChange={(event) => setForm({ ...form, checkInTime: event.target.value })} /></label>
            <label className="text-sm font-medium">وقت الانصراف<Input type="time" dir="ltr" className="mt-1" value={form.checkOutTime} onChange={(event) => setForm({ ...form, checkOutTime: event.target.value })} /></label>
          </div>
          <label className="text-sm font-medium">السبب<Textarea required minLength={3} maxLength={1000} className="mt-1" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></label>
          <label className="text-sm font-medium">مرفق (اختياري)
            <input type="file" accept="image/*,application/pdf" className="mt-1 block w-full text-xs" onChange={async (event) => { const file = event.target.files?.[0]; if (file) setForm({ ...form, attachment: await fileToDataUrl(file) }); }} />
          </label>
        </form>
        {save.isError ? <p role="alert" className="text-sm text-destructive">{apiErrorMessage(save.error)}</p> : null}
        <DialogFooter className="gap-2 sm:justify-start">
          <Button type="submit" form="attendance-correction" disabled={save.isPending}>إرسال الطلب</Button>
          <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>إلغاء</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** «دوامي اليوم» in the existing staff portal. The server decides the time and what is required. */
export function AttendanceTodayCard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const today = useQuery<Today>({ queryKey: ["staff", "attendance", "me"], queryFn: () => adminFetch("/admin/attendance/me"), refetchInterval: 60_000 });
  const [scanFor, setScanFor] = useState<Action | null>(null);
  const [scannedCode, setScannedCode] = useState("");
  const [correcting, setCorrecting] = useState(false);
  const [done, setDone] = useState("");
  const [problem, setProblem] = useState("");
  const [locating, setLocating] = useState(false);
  const portalSearch = useSearch();
  const submissionActive = useRef(false);
  const mounted = useRef(true);
  const scannerGeneration = useRef(0);
  const scannerSession = scannerGeneration.current;
  const scannerActive = useRef(false);
  scannerActive.current = scanFor !== null;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; scannerActive.current = false; scannerGeneration.current++; }; }, []);
  const beginScan = (action: Action) => { if (submissionActive.current) return; scannerGeneration.current++; setProblem(""); setScanFor(action); };
  const closeScan = () => { scannerActive.current = false; scannerGeneration.current++; setScanFor(null); };

  // A phone camera opens the portal with the code in the link. It is kept until the employee chooses.
  useEffect(() => {
    const url = new URL(window.location.href);
    const raw = url.searchParams.get("attendanceQr");
    if (raw == null) return;
    const code = readAttendanceCode(raw);
    if (code) setScannedCode(code);
    else setProblem("رابط الحضور غير صالح. امسح رمز الشاشة الجديد.");
    url.searchParams.delete("attendanceQr");
    window.history.replaceState(window.history.state, "", url.toString());
  }, [portalSearch]);

  const punch = useMutation({
    mutationFn: (input: Submission) => adminFetch<{ action: Action; atMs: number; locationName: string | null; today?: Today }>("/admin/attendance/punch", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: (result) => {
      if (!mounted.current) return;
      const message = `${result.action === "check_in" ? "تم تسجيل حضورك" : "تم تسجيل انصرافك"} الساعة ${baghdadTime(result.atMs)}${result.locationName ? ` · ${result.locationName}` : ""}`;
      setDone(message);
      setProblem("");
      setScannedCode("");
      if (result.today) queryClient.setQueryData<Today>(["staff", "attendance", "me"], previous => ({ ...previous, ...result.today!, recent: previous?.recent ?? [], corrections: previous?.corrections ?? [] }));
      toast({ title: message });
      void queryClient.invalidateQueries({ queryKey: ["staff", "attendance"] });
      void queryClient.invalidateQueries({ queryKey: ["staff-portal", "dashboard"] });
    },
    onError: (cause) => { if (mounted.current) { setProblem(apiErrorMessage(cause)); setDone(""); } },
  });
  const busy = punch.isPending || locating;

  async function submit(action: Action, qrCode?: string) {
    const shift = today.data?.current;
    if (!shift || submissionActive.current) return;
    submissionActive.current = true;
    setProblem(""); setDone("");
    const wantsGps = shift.needsGps || (shift.method === "any" && (qrCode ? !shift.allowedMethods.includes("qr") && shift.allowedMethods.includes("qr_gps") : shift.allowedMethods.includes("gps")));
    try {
      let gps: Submission["gps"] = null;
      if (wantsGps) { setLocating(true); gps = await currentPosition(); }
      if (!mounted.current) return;
      setLocating(false);
      await punch.mutateAsync({ action, qrCode, gps, ...(shift.shiftId == null ? {} : { shiftId: shift.shiftId }) });
    } catch (cause) {
      if (mounted.current) setProblem(apiErrorMessage(cause, "تعذر تسجيل الدوام"));
    } finally {
      submissionActive.current = false;
      if (mounted.current) setLocating(false);
    }
  }

  function start(action: Action) {
    const shift = today.data?.current;
    if (!shift || submissionActive.current) return;
    if (shift.manualOnly) { setCorrecting(true); return; }
    const requiresQr = shift.needsQr || (shift.method === "any" && !shift.allowedMethods.includes("gps"));
    if (requiresQr || scannedCode) {
      if (scannedCode) { void submit(action, scannedCode); return; }
      beginScan(action); return;
    }
    void submit(action);
  }

  if (today.isPending) return <Skeleton className="h-40 w-full rounded-2xl" />;
  if (today.isError)
    return (
      <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        تعذر تحميل دوامك: {apiErrorMessage(today.error)} <Button type="button" variant="outline" size="sm" onClick={() => void today.refetch()}>إعادة المحاولة</Button>
      </div>
    );
  const data = today.data;
  if (!data.enabled && !data.shifts.length) return null;
  const shift = data.current;
  const tone = STATUS_TONE[data.status] ?? "bg-muted text-muted-foreground";
  return (
    <section aria-label="دوامي اليوم" className="rounded-2xl border border-[#f4d6da] bg-card p-5 dark:border-border">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-bold"><CalendarClock className="h-5 w-5 text-primary" aria-hidden />دوامي اليوم</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{data.employeeName} · <span dir="ltr">{data.date}</span></p>
        </div>
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${tone}`}>{data.statusLabel}</span>
      </div>
      <dl className="mt-4 grid gap-3 text-sm [grid-template-columns:repeat(2,minmax(0,1fr))] md:[grid-template-columns:repeat(4,minmax(0,1fr))]">
        <div className="min-w-0"><dt className="text-xs text-muted-foreground">بداية الدوام</dt><dd className="mt-0.5 font-semibold tabular-nums">{shift && shift.kind !== "flexible" ? baghdadTime(shift.startMs) : "مرن"}</dd></div>
        <div className="min-w-0"><dt className="text-xs text-muted-foreground">نهاية الدوام</dt><dd className="mt-0.5 font-semibold tabular-nums">{shift && shift.kind !== "flexible" ? baghdadTime(shift.endMs) : "—"}</dd></div>
        <div className="min-w-0"><dt className="flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3 w-3" aria-hidden />موقع العمل</dt><dd className="mt-0.5 truncate font-semibold">{shift?.locationName ?? "—"}</dd></div>
        <div className="min-w-0"><dt className="flex items-center gap-1 text-xs text-muted-foreground"><Timer className="h-3 w-3" aria-hidden />ساعات اليوم</dt><dd className="mt-0.5 font-semibold tabular-nums">{hours(data.workedMinutes)}</dd></div>
      </dl>
      {shift ? <p className="mt-3 text-xs text-muted-foreground">طريقة التسجيل: <b className="text-foreground">{ATTENDANCE_METHOD_LABELS[shift.method]}</b>{shift.needsGps ? " · نقرأ موقعك مرة واحدة عند التسجيل فقط" : ""}</p> : null}
      {scannedCode ? <p className="mt-3 rounded-lg bg-primary/5 p-2.5 text-sm"><QrCode className="me-1 inline h-4 w-4 text-primary" aria-hidden />تمت قراءة رمز الحضور. اختر حضور أو انصراف.</p> : null}
      {data.shifts.filter((row) => row.bookingId).map((row) => (
        <p key={row.shiftId} className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/50 p-2.5 text-sm">
          <span className="min-w-0">{row.title ?? `مناسبة حجز #${row.bookingId}`} <span className="tabular-nums text-muted-foreground">{baghdadTime(row.startMs)}–{baghdadTime(row.endMs)}</span></span>
          <a className="font-semibold text-primary underline underline-offset-2" href={`/admin/bookings/${row.bookingSource}/${row.bookingId}`}>فتح الحجز الأصلي</a>
        </p>
      ))}
      {done ? <p role="status" className="mt-3 flex items-center gap-1.5 rounded-lg bg-emerald-500/10 p-2.5 text-sm font-semibold text-emerald-800 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />{done}</p> : null}
      {problem ? <p role="alert" className="mt-3 rounded-lg bg-destructive/10 p-2.5 text-sm font-semibold text-destructive">{problem}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" className="min-h-11 flex-1 basis-36" disabled={busy || !data.canCheckIn} onClick={() => start("check_in")}><LogIn className="h-4 w-4" />تسجيل حضور</Button>
        <Button type="button" variant="outline" className="min-h-11 flex-1 basis-36" disabled={busy || !data.canCheckOut} onClick={() => start("check_out")}><LogOut className="h-4 w-4" />تسجيل انصراف</Button>
        {shift && (shift.needsQr || (shift.method === "any" && shift.allowedMethods.some(value => value === "qr" || value === "qr_gps"))) ? <Button type="button" variant="outline" className="min-h-11" disabled={busy || (!data.canCheckIn && !data.canCheckOut)} onClick={() => beginScan(data.canCheckOut ? "check_out" : "check_in")}><QrCode className="h-4 w-4" />{scannedCode ? "مسح QR جديد" : "مسح QR"}</Button> : null}
        <Button type="button" variant="ghost" className="min-h-11" onClick={() => setCorrecting(true)}><ClipboardPen className="h-4 w-4" />طلب تصحيح</Button>
      </div>
      {data.corrections.filter((row) => row.status === "pending").length ? <p className="mt-2 text-xs text-muted-foreground">لديك {data.corrections.filter((row) => row.status === "pending").length} طلب {CORRECTION_STATUS.pending}.</p> : null}
      {locating ? <p role="status" className="mt-3 text-sm text-muted-foreground">جارٍ التحقق من موقعك الحالي…</p> : null}
      <Dialog open={scanFor !== null} onOpenChange={(next) => { if (!next) closeScan(); }}>
        <DialogContent dir="rtl" className="w-[min(calc(100%-2rem),26rem)]">
          <DialogHeader className="text-start"><DialogTitle>امسح رمز شاشة الحضور</DialogTitle><DialogDescription>وجّه الكاميرا على الرمز الظاهر على الشاشة الآن.</DialogDescription></DialogHeader>
          {problem ? <p role="alert" className="text-sm text-destructive">{problem}</p> : null}
          {scanFor ? (
            <Suspense fallback={<Skeleton className="h-56 w-full" />}>
              <LiveScanner key={scannerSession} onDetect={(raw) => {
                if (!scannerActive.current || scannerSession !== scannerGeneration.current || submissionActive.current) return;
                const code = readAttendanceCode(raw);
                if (!code) { setProblem("هذا الرمز غير مخصص للحضور. امسح رمز شاشة الحضور."); return; }
                setScannedCode(code); setProblem(""); closeScan();
              }} />
            </Suspense>
          ) : null}
        </DialogContent>
      </Dialog>
      <details className="mt-4 border-t border-border pt-3">
        <summary className="cursor-pointer text-sm font-semibold">سجل حضوري · آخر 7 أيام</summary>
        {data.recent?.length ? <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[420px] text-right text-xs"><thead><tr>{["التاريخ", "الحضور", "الانصراف", "المدة", "الموقع"].map(label => <th key={label} className="border-b p-2">{label}</th>)}</tr></thead><tbody>{data.recent.map(row => <tr key={row.id}><td className="border-b p-2 tabular-nums">{row.checkInMs == null ? "—" : baghdadDate(row.checkInMs)}</td><td className="border-b p-2 tabular-nums">{baghdadTime(row.checkInMs)}</td><td className="border-b p-2 tabular-nums">{baghdadTime(row.checkOutMs)}</td><td className="border-b p-2 tabular-nums">{hours(row.workedMinutes)}</td><td className="border-b p-2">{row.locationName ?? "—"}</td></tr>)}</tbody></table></div> : <p className="mt-2 text-sm text-muted-foreground">لا توجد سجلات حضور خلال هذه الفترة.</p>}
      </details>
      <CorrectionDialog open={correcting} onClose={() => setCorrecting(false)} />
    </section>
  );
}
