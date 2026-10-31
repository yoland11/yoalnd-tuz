import { useEffect, useRef, useState } from "react";
import { useRoute } from "wouter";
import { Wifi, WifiOff } from "lucide-react";
import { logoSrc, usePublicSettings } from "@/lib/public-settings";

type Display = { name: string; locationName: string; rotatesAt: number; serverTime: number; rotationSeconds: number; qrDataUrl: string };

const dateTime = (ms: number) => {
  const at = new Date(ms);
  return {
    date: at.toLocaleDateString("ar-IQ-u-nu-latn", { timeZone: "Asia/Baghdad", weekday: "long", year: "numeric", month: "2-digit", day: "2-digit" }),
    time: at.toLocaleTimeString("ar-IQ-u-nu-latn", { timeZone: "Asia/Baghdad", hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  };
};

/**
 * Public screen for an iPad at the door. It shows a rotating code and nothing about any employee.
 * It follows the server clock, so a wrong tablet clock cannot keep an old code on screen.
 */
export default function AttendanceKioskPage() {
  const [, params] = useRoute("/attendance-kiosk/:token");
  const token = params?.token ?? "";
  const { data: settings } = usePublicSettings();
  const [display, setDisplay] = useState<Display | null>(null);
  const [problem, setProblem] = useState("");
  const [online, setOnline] = useState(true);
  const [offsetMs, setOffsetMs] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(`/api/attendance-kiosk/${encodeURIComponent(token)}`, { cache: "no-store" });
        const body = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok) {
          setOnline(response.status < 500);
          setDisplay(null);
          setProblem(body?.error || "تعذر تحميل رمز الحضور");
          timer.current = window.setTimeout(load, 15_000);
          return;
        }
        setOnline(true);
        setProblem("");
        setDisplay(body);
        setOffsetMs(body.serverTime - Date.now());
        timer.current = window.setTimeout(load, Math.max(1000, body.rotatesAt - body.serverTime + 200));
      } catch {
        if (cancelled) return;
        setOnline(false);
        setDisplay(null);
        setProblem("لا يوجد اتصال. سيعود الرمز تلقائياً عند رجوع الاتصال.");
        timer.current = window.setTimeout(load, 5_000);
      }
    };
    void load();
    const tick = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => { cancelled = true; window.clearTimeout(timer.current); window.clearInterval(tick); };
  }, [token]);

  const serverNow = nowMs + offsetMs;
  const { date, time } = dateTime(serverNow);
  const left = display ? Math.max(0, Math.ceil((display.rotatesAt - serverNow) / 1000)) : 0;
  return (
    <main dir="rtl" className="flex min-h-dvh flex-col bg-white p-5 text-slate-900 sm:p-8">
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {logoSrc(settings) ? <img src={logoSrc(settings)} alt="" className="h-12 w-auto object-contain" /> : null}
          <div className="min-w-0"><p className="truncate text-xl font-bold">{display?.locationName ?? "شاشة تسجيل الحضور"}</p><p className="truncate text-sm text-slate-500">{settings?.site_name ?? "AJN ERP"}</p></div>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ${online ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
          {online ? <Wifi className="h-4 w-4" aria-hidden /> : <WifiOff className="h-4 w-4" aria-hidden />}{online ? "متصل" : "غير متصل"}
        </span>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-5 py-6 text-center">
        <div><p className="text-5xl font-bold tabular-nums sm:text-6xl" dir="ltr">{time}</p><p className="mt-2 text-lg text-slate-600">{date}</p></div>
        {display ? (
          <>
            <img src={display.qrDataUrl} alt="رمز تسجيل الحضور" className="aspect-square w-[min(80vw,62vh)] max-w-[34rem] rounded-2xl border border-[#f4d6da] p-3" />
            <p className="text-lg font-semibold">يتغيّر الرمز خلال <span className="tabular-nums text-[hsl(var(--primary))]">{left}</span> ثانية</p>
            <p className="max-w-md text-sm text-slate-500">افتح بوابة الموظف واختر تسجيل حضور أو انصراف، ثم امسح الرمز.</p>
          </>
        ) : <p role="alert" className="max-w-md rounded-xl bg-red-50 p-4 text-lg font-semibold text-red-700">{problem || "جارٍ تحميل الرمز…"}</p>}
      </div>
    </main>
  );
}
