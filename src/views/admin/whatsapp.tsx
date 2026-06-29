import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Send, RefreshCw, Trash2, CheckCircle2, XCircle, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch } from "./_lib";
import { formatIraqiPhone, formatIraqiPhoneInput } from "@/lib/phone";

type EnvVarStatus = { key: string; label: string; set: boolean };
type Settings = {
  provider: string;
  enabledEvents: Record<string, boolean>;
  templates: Record<string, string>;
  automationEnabled: boolean;
  events: string[];
  bookingEvents?: string[];
  providers: { id: string; label: string }[];
  providerStatus: Record<string, { configured: boolean; envVars: EnvVarStatus[] }>;
};

type LogEntry = {
  id: number; phone: string; event: string;
  status: string; error: string | null; provider: string | null;
  message: string; sentAt: string;
};

const EVENT_LABELS: Record<string, string> = {
  placed: "عند إنشاء الطلب",
  confirmed: "تأكيد الطلب",
  processing: "قيد التجهيز",
  shipped: "في الطريق",
  delivered: "تم التسليم",
  cancelled: "إلغاء الطلب",
  booking_placed: "عند استلام الحجز",
  booking_confirmed: "عند تأكيد الحجز",
  booking_processing: "الحجز قيد التحضير",
  booking_ready: "الحجز جاهز/قيد التركيب",
  booking_completed: "اكتمل الحجز",
  booking_cancelled: "إلغاء الحجز",
};

const PLACEHOLDERS = [
  { key: "{name}", desc: "اسم الزبون" },
  { key: "{tracking}", desc: "رقم التتبع" },
  { key: "{status}", desc: "الحالة" },
  { key: "{total}", desc: "إجمالي المبلغ" },
  { key: "{service}", desc: "اسم الخدمة (للحجوزات)" },
  { key: "{link}", desc: "رابط صفحة التتبع" },
];

export default function WhatsappPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "whatsapp", "settings"],
    queryFn: () => adminFetch<Settings>("/admin/whatsapp/settings"),
  });
  const { data: log, isLoading: logLoading, refetch: refetchLog } = useQuery({
    queryKey: ["admin", "whatsapp", "log"],
    queryFn: () => adminFetch<LogEntry[]>("/admin/whatsapp/log?limit=50"),
  });
  const [form, setForm] = useState<Settings | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => { if (data && !form) setForm(data); }, [data, form]);

  const save = useMutation({
    mutationFn: (s: Settings) => adminFetch("/admin/whatsapp/settings", {
      method: "PUT",
      body: JSON.stringify({
        provider: s.provider,
        enabledEvents: s.enabledEvents,
        templates: s.templates,
        automationEnabled: s.automationEnabled,
      }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "whatsapp", "settings"] });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    },
    onError: (e: any) => setTestResult("✗ " + (e?.message ?? "تعذر حفظ إعدادات واتساب")),
  });

  const sendTest = useMutation({
    mutationFn: (phone: string) => adminFetch("/admin/whatsapp/test", { method: "POST", body: JSON.stringify({ phone }) }),
    onSuccess: () => { setTestResult("✓ تم إرسال رسالة الاختبار"); refetchLog(); },
    onError: (e: any) => { setTestResult("✗ " + (e?.message ?? "فشل الإرسال")); refetchLog(); },
  });

  const clearLog = useMutation({
    mutationFn: () => adminFetch("/admin/whatsapp/log", { method: "DELETE" }),
    onSuccess: () => refetchLog(),
  });

  const [resendingId, setResendingId] = useState<number | null>(null);
  const [resendMsg, setResendMsg] = useState<string | null>(null);
  const resend = useMutation({
    mutationFn: (id: number) => adminFetch(`/admin/whatsapp/log/${id}/resend`, { method: "POST" }),
    onSuccess: () => setResendMsg("✓ تم إعادة الإرسال"),
    onError: (e: any) => setResendMsg("✗ " + (e?.message ?? "فشل إعادة الإرسال")),
    onSettled: () => {
      setResendingId(null);
      refetchLog();
      setTimeout(() => setResendMsg(null), 2500);
    },
  });

  if (isLoading || !form) {
    return <div className="space-y-4">{[1,2,3].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>;
  }

  const status = form.providerStatus[form.provider];
  const providerConfigured = !!status?.configured;

  return (
    <div className="space-y-6 max-w-4xl" dir="rtl">
      <div className="flex items-center justify-between sticky top-0 bg-background py-2 z-10 flex-wrap gap-2">
        <h1 className="text-2xl font-bold text-foreground">أتمتة الواتساب</h1>
        <Button onClick={() => save.mutate(form)} disabled={save.isPending} className="gap-2">
          <Save className="w-4 h-4" /> {save.isPending ? "جاري الحفظ..." : savedFlash ? "تم الحفظ ✓" : "حفظ التغييرات"}
        </Button>
      </div>

      <Section title="حالة التشغيل">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={form.automationEnabled}
            onChange={e => setForm(f => ({ ...f!, automationEnabled: e.target.checked }))}
            className="w-5 h-5 accent-primary"
          />
          <span className="text-sm text-foreground">
            تفعيل الإرسال التلقائي للرسائل عند تغير حالات الطلبات
          </span>
        </label>
        <p className="text-xs text-muted-foreground">
          عند الإيقاف تبقى أزرار "واتساب" اليدوية في صفحة الطلبات كبديل.
        </p>
        {form.automationEnabled && !providerConfigured && (
          <p className="text-xs text-status-warning bg-status-warning/10 border border-status-warning/30 rounded-lg p-2">
            ⚠ المزود المختار غير مكتمل الإعداد. يرجى إضافة المفاتيح المطلوبة في متغيرات البيئة أدناه.
          </p>
        )}
      </Section>

      <Section title="مزود الخدمة">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">اختر المزود</label>
          <select
            value={form.provider}
            onChange={e => setForm(f => ({ ...f!, provider: e.target.value }))}
            className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {form.providers.map(p => (
              <option key={p.id} value={p.id}>
                {p.label}{form.providerStatus[p.id]?.configured ? " ✓" : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="bg-background/40 rounded-lg p-3 border border-border/30">
          <div className="flex items-center gap-2 mb-2">
            <KeyRound className="w-4 h-4 text-primary" />
            <p className="text-sm font-semibold text-foreground">المفاتيح المطلوبة</p>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            تُحفظ المفاتيح داخل Environment Variables ولا تُخزَّن في قاعدة البيانات ولا تُعرض في الواجهة.
            بعد إضافة أي سر، أعد تشغيل خادم API لتفعيله.
          </p>
          <div className="space-y-1.5">
            {status?.envVars.map(v => (
              <div key={v.key} className="flex items-center justify-between bg-background/60 rounded-md px-3 py-2 border border-border/20">
                <div>
                  <p className="text-xs font-mono text-foreground">{v.key}</p>
                  <p className="text-[11px] text-muted-foreground">{v.label}</p>
                </div>
                {v.set
                  ? <span className="text-[11px] text-status-success bg-status-success/10 border border-status-success/30 rounded px-2 py-0.5">مضبوط ✓</span>
                  : <span className="text-[11px] text-status-danger bg-status-danger/10 border border-status-danger/30 rounded px-2 py-0.5">غير مضبوط</span>}
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section title="الأحداث المفعلة — طلبات المتجر">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {form.events.map(ev => (
            <label key={ev} className="flex items-center gap-2 bg-background/40 rounded-lg px-3 py-2 border border-border/30 cursor-pointer">
              <input
                type="checkbox"
                checked={!!form.enabledEvents[ev]}
                onChange={e => setForm(f => ({ ...f!, enabledEvents: { ...f!.enabledEvents, [ev]: e.target.checked } }))}
                className="w-4 h-4 accent-primary"
              />
              <span className="text-sm">{EVENT_LABELS[ev] ?? ev}</span>
            </label>
          ))}
        </div>
      </Section>

      {(form.bookingEvents ?? []).length > 0 && (
        <Section title="الأحداث المفعلة — حجوزات الخدمات">
          <p className="text-xs text-muted-foreground">
            تشمل: كوشات، تصوير، تجهيز تخرج، ألبومات، توزيعات، بحوث.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {(form.bookingEvents ?? []).map(ev => (
              <label key={ev} className="flex items-center gap-2 bg-background/40 rounded-lg px-3 py-2 border border-border/30 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!form.enabledEvents[ev]}
                  onChange={e => setForm(f => ({ ...f!, enabledEvents: { ...f!.enabledEvents, [ev]: e.target.checked } }))}
                  className="w-4 h-4 accent-primary"
                />
                <span className="text-sm">{EVENT_LABELS[ev] ?? ev}</span>
              </label>
            ))}
          </div>
        </Section>
      )}

      <Section title="نماذج الرسائل">
        <div className="bg-background/40 rounded-lg p-3 mb-3 border border-border/30">
          <p className="text-xs text-muted-foreground mb-2">المتغيرات المتاحة:</p>
          <div className="flex flex-wrap gap-2">
            {PLACEHOLDERS.map(p => (
              <span key={p.key} className="text-[11px] bg-primary/10 text-primary border border-primary/30 rounded px-2 py-0.5 font-mono">
                {p.key} — {p.desc}
              </span>
            ))}
          </div>
        </div>
        <h3 className="text-sm font-semibold text-foreground/80 mt-2">طلبات المتجر</h3>
        <div className="space-y-3">
          {form.events.map(ev => (
            <div key={ev}>
              <label className="block text-xs text-muted-foreground mb-1">{EVENT_LABELS[ev] ?? ev}</label>
              <textarea
                rows={3}
                value={form.templates[ev] ?? ""}
                onChange={e => setForm(f => ({ ...f!, templates: { ...f!.templates, [ev]: e.target.value } }))}
                className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          ))}
        </div>
        {(form.bookingEvents ?? []).length > 0 && (
          <>
            <h3 className="text-sm font-semibold text-foreground/80 mt-6">حجوزات الخدمات</h3>
            <div className="space-y-3">
              {(form.bookingEvents ?? []).map(ev => (
                <div key={ev}>
                  <label className="block text-xs text-muted-foreground mb-1">{EVENT_LABELS[ev] ?? ev}</label>
                  <textarea
                    rows={3}
                    value={form.templates[ev] ?? ""}
                    onChange={e => setForm(f => ({ ...f!, templates: { ...f!.templates, [ev]: e.target.value } }))}
                    className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </Section>

      <Section title="إرسال رسالة اختبار">
        <div className="flex gap-2 items-end flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-muted-foreground mb-1">رقم الهاتف</label>
            <input
              value={testPhone}
              onChange={e => setTestPhone(formatIraqiPhoneInput(e.target.value))}
              placeholder="07701234567"
              className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
          <Button
            type="button"
            onClick={() => { setTestResult(null); sendTest.mutate(testPhone); }}
            disabled={!testPhone || sendTest.isPending}
            className="gap-2"
          >
            <Send className="w-4 h-4" /> {sendTest.isPending ? "..." : "إرسال اختبار"}
          </Button>
        </div>
        {testResult && (
          <p className={`text-sm ${testResult.startsWith("✓") ? "text-status-success" : "text-status-danger"}`}>{testResult}</p>
        )}
      </Section>

      <Section title="سجل الإرسال (آخر 50)">
        <div className="flex items-center gap-2 mb-3">
          <Button type="button" variant="outline" size="sm" onClick={() => refetchLog()} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> تحديث
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => confirm("حذف كل السجل؟") && clearLog.mutate()}
            className="gap-1.5 text-status-danger border-status-danger/30 hover:bg-status-danger/10"
          >
            <Trash2 className="w-3.5 h-3.5" /> مسح السجل
          </Button>
        </div>
        {resendMsg && (
          <p className={`text-sm ${resendMsg.startsWith("✓") ? "text-status-success" : "text-status-danger"}`}>{resendMsg}</p>
        )}
        {logLoading ? <Skeleton className="h-32 rounded-lg" /> : (
          (log?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">لا يوجد سجل بعد.</p>
          ) : (
            <div className="space-y-2">
              {log!.map(r => (
                <div key={r.id} className="bg-background/40 border border-border/30 rounded-lg p-3">
                  <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
                    <div className="flex items-center gap-2 text-sm">
                      {r.status === "sent"
                        ? <CheckCircle2 className="w-4 h-4 text-status-success" />
                        : <XCircle className="w-4 h-4 text-status-danger" />}
                      <span className="font-mono">{r.phone ? formatIraqiPhone(r.phone) : "—"}</span>
                      <span className="text-xs text-muted-foreground">· {EVENT_LABELS[r.event] ?? r.event}</span>
                      {r.provider && <span className="text-[11px] text-muted-foreground">[{r.provider}]</span>}
                    </div>
                    <span className="text-[11px] text-muted-foreground">{new Date(r.sentAt).toLocaleString("ar-IQ")}</span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap">{r.message}</p>
                  {r.error && <p className="text-xs text-status-danger mt-1">{r.error}</p>}
                  {r.status !== "sent" && (
                    <div className="mt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={resendingId === r.id}
                        onClick={() => { setResendingId(r.id); resend.mutate(r.id); }}
                        className="h-7 gap-1.5 text-xs border-primary/30 text-primary hover:bg-primary/10"
                      >
                        <RefreshCw className={`w-3 h-3 ${resendingId === r.id ? "animate-spin" : ""}`} />
                        إعادة إرسال
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-card rounded-xl border border-border/30 p-6 space-y-4">
      <h2 className="font-semibold text-foreground border-b border-border/20 pb-2">{title}</h2>
      {children}
    </section>
  );
}
