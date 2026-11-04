import { useEffect, useRef, useState } from "react";
import { useRoute } from "wouter";
import { Expand, MapPin, Minimize, QrCode, RefreshCw, ShieldCheck, Wifi, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { logoSrc, usePublicSettings, handleDefaultLogoError } from "@/lib/public-settings";
import { validateKioskDisplay, type KioskDisplay } from "@/lib/attendance-client";
import { adminFetch, apiErrorMessage, apiErrorStatus } from "@/views/admin/_lib";

const dateTime = (ms: number) => ({
  date: new Date(ms).toLocaleDateString("ar-IQ-u-nu-latn", { timeZone: "Asia/Baghdad", weekday: "long", year: "numeric", month: "2-digit", day: "2-digit" }),
  time: new Date(ms).toLocaleTimeString("ar-IQ-u-nu-latn", { timeZone: "Asia/Baghdad", hour: "2-digit", minute: "2-digit", second: "2-digit" }),
});

/** Original public kiosk: displays only its workplace and a short-lived server-issued QR. */
export default function AttendanceKioskPage() {
  const [, params] = useRoute("/attendance-kiosk/:token");
  const token = params?.token ?? "";
  const { data: settings } = usePublicSettings();
  const [display, setDisplay] = useState<KioskDisplay | null>(null);
  const [problem, setProblem] = useState("");
  const [online, setOnline] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [retry, setRetry] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [viewProblem, setViewProblem] = useState("");
  const clock = useRef<{ at: number; monotonic: number } | null>(null);

  useEffect(() => {
    let disposed = false, loading = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    setDisplay(null); setProblem(""); clock.current = null;
    const load = async () => {
      if (disposed || loading) return;
      loading = true;
      clearTimeout(timer);
      controller = new AbortController();
      const started = performance.now();
      try {
        const body = validateKioskDisplay(await adminFetch(`/attendance-kiosk/${encodeURIComponent(token)}`, { cache: "no-store", signal: controller.signal }));
        if (disposed) return;
        // Advance conservatively by request latency; use a monotonic clock until the next response.
        const serverNow = body.serverTime + performance.now() - started;
        clock.current = { at: serverNow, monotonic: performance.now() };
        setNowMs(serverNow); setDisplay(body); setOnline(true); setProblem("");
        timer = setTimeout(load, Math.max(250, body.rotatesAt - serverNow + 100));
      } catch (cause) {
        if (disposed) return;
        setOnline(apiErrorStatus(cause) !== 0); setDisplay(null);
        setProblem(apiErrorMessage(cause, "تعذر تحميل رمز الحضور"));
        timer = setTimeout(load, 5000);
      } finally { loading = false; }
    };
    const refreshVisible = () => { if (document.visibilityState === "visible") { if (clock.current) setNowMs(clock.current.at + performance.now() - clock.current.monotonic); void load(); } };
    void load();
    const tick = setInterval(() => setNowMs(clock.current ? clock.current.at + performance.now() - clock.current.monotonic : Date.now()), 250);
    window.addEventListener("online", load);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => { disposed = true; controller?.abort(); clearTimeout(timer); clearInterval(tick); window.removeEventListener("online", load); document.removeEventListener("visibilitychange", refreshVisible); };
  }, [token, retry]);

  useEffect(() => {
    const change = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);
  async function toggleFullscreen() {
    setViewProblem("");
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else setViewProblem("للعرض بملء الشاشة على هذا الجهاز، أضف الصفحة إلى الشاشة الرئيسية.");
    } catch { setViewProblem("تعذر تفعيل ملء الشاشة. يبقى تسجيل الحضور متاحاً."); }
  }

  const { date, time } = dateTime(nowMs);
  const valid = display && nowMs < display.rotatesAt;
  const left = valid ? Math.max(0, Math.ceil((display.rotatesAt - nowMs) / 1000)) : 0;
  return <main dir="rtl" style={{ "--primary": "337 95% 23%", "--ring": "337 95% 23%" } as React.CSSProperties} className="flex min-h-dvh flex-col gap-5 bg-[#fffafb] p-4 text-slate-900 sm:p-7">
    <header className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 border-b border-[#f4d6da] pb-4">
      <div className="flex min-w-0 items-center gap-3">{logoSrc(settings) ? <img src={logoSrc(settings)} onError={handleDefaultLogoError} alt="شعار AJN" className="h-12 w-auto max-w-28 object-contain" /> : <span className="text-3xl font-bold text-primary">AJN</span>}<div className="min-w-0"><p className="text-lg font-bold">الحضور والانصراف</p><p className="text-sm text-slate-600">{settings?.site_name ?? "AJN ERP"}</p></div></div>
      <div className="flex flex-wrap items-center gap-2"><span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold ${online ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{online ? <Wifi className="size-4" aria-hidden /> : <WifiOff className="size-4" aria-hidden />}{online ? "متصل" : "غير متصل"}</span><Button type="button" variant="outline" size="sm" onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize /> : <Expand />}{fullscreen ? "إنهاء ملء الشاشة" : "ملء الشاشة"}</Button></div>
    </header>
    <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-4 text-center">
      <div><p className="text-4xl font-bold tabular-nums sm:text-6xl" dir="ltr" aria-label="الوقت الحالي">{time}</p><p className="mt-2 text-sm text-slate-600 sm:text-base">{date}</p></div>
      <div className="flex items-center gap-2 text-lg font-bold"><MapPin className="size-5 text-primary" aria-hidden /><span>{display?.locationName ?? "موقع العمل"}</span></div>
      <div className="flex w-full max-w-xl flex-col items-center gap-4 rounded-2xl border border-[#f4d6da] bg-white p-4 sm:p-6">
        <h1 className="text-xl font-bold">امسح الرمز لتسجيل دوامك</h1>
        {valid ? <><img src={display.qrDataUrl} alt="رمز تسجيل الحضور" className="aspect-square w-[min(76vw,48dvh)] max-w-full object-contain" /><div className="w-full max-w-xs"><p className="text-sm">رمز جديد خلال <strong className="tabular-nums text-primary">{left}</strong> ثانية</p><Progress value={(left / 30) * 100} aria-label="صلاحية رمز الحضور" className="mt-2 h-1.5 w-full" /></div></> : <div className="flex min-h-64 flex-col items-center justify-center gap-4"><QrCode className="size-16 text-primary/40" aria-hidden /><p role={problem ? "alert" : "status"} className="max-w-sm text-sm font-semibold">{problem || (display ? "جارٍ تحديث الرمز؛ انتظر الرمز الجديد…" : "جارٍ تحميل رمز الحضور…")}</p>{problem ? <Button type="button" variant="outline" onClick={() => setRetry(value => value + 1)}><RefreshCw />إعادة المحاولة</Button> : null}</div>}
        <p className="max-w-md text-sm leading-6 text-slate-600">امسح بكاميرا هاتفك، سجّل الدخول إلى بوابة الموظف، ثم اضغط تسجيل حضور أو تسجيل انصراف.</p>
      </div>
      <p className="flex items-center gap-2 text-xs text-slate-600"><ShieldCheck className="size-4 text-primary" aria-hidden />رمز آمن يتجدد كل 30 ثانية · التحقق من الموقع حسب إعدادات دوامك</p>
      {viewProblem ? <p role="status" className="text-sm text-slate-600">{viewProblem}</p> : null}
    </section>
  </main>;
}
