import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, BarChart3, Bell, CheckCircle2, ClipboardList, Clock3, Loader2, MapPin, QrCode, Truck, Users, Wrench,
} from "lucide-react";
import { Link } from "wouter";
import { apiErrorMessage, compressImageFile } from "@/views/admin/_lib";
import { LiveScanner } from "./live-scanner";
import {
  CHECKLIST_CONDITIONS, CHECKLIST_ITEMS, DAMAGE_PRIORITIES, SCAN_POINTS,
  STAGE_LABEL, koshaOpsApi, money,
  type KoshaOpsBoard, type KoshaOpsReport, type OperationsPayload,
} from "./lib";

function Spinner() {
  return <div className="p-6 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" /></div>;
}

function Banner({ kind, children }: { kind: "ok" | "error"; children: React.ReactNode }) {
  return (
    <div className={`rounded-lg px-3 py-2 text-xs ${kind === "ok" ? "border border-status-success/30 bg-status-success/10 text-status-success" : "border border-destructive/30 bg-destructive/10 text-destructive"}`}>
      {children}
    </div>
  );
}

function LoadFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-center" role="alert">
      <p className="text-sm text-destructive">{message}</p>
      <button type="button" onClick={onRetry} className="min-h-10 rounded-lg border border-border bg-card px-4 text-xs font-bold text-primary">
        إعادة المحاولة
      </button>
    </div>
  );
}

/**
 * Field-operations panel for one booking: equipment checklist, damage report and the
 * five scan points. Rendered inside the existing booking detail screen — no route,
 * navigation or permission changes.
 */
export function KoshaOperationsPanel({ bookingId, source = "kosha", activeTab }: { bookingId: number; source?: string; activeTab?: "checklist" | "scan" | "damage" }) {
  const [data, setData] = useState<OperationsPayload | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"checklist" | "scan" | "damage">("checklist");

  useEffect(() => { if (activeTab) setTab(activeTab); }, [activeTab]);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setData(await koshaOpsApi.get(bookingId, source));
    } catch (err: any) {
      setData(null);
      setLoadError(apiErrorMessage(err, "تعذّر تحميل مركز العمليات"));
    }
  }, [bookingId, source]);
  useEffect(() => { load(); }, [load]);

  async function setCondition(item: string, condition: string) {
    setBusy(true);
    try {
      const res = await koshaOpsApi.saveChecklist(bookingId, [{ item, condition }], source);
      setData((current) => (current ? { ...current, checklist: res.checklist, checklistCovered: res.checklistCovered, checklistIssues: res.checklistIssues } : current));
      setMsg(null);
    } catch (err: any) {
      setMsg({ ok: false, text: apiErrorMessage(err, "تعذر حفظ القائمة") });
    } finally { setBusy(false); }
  }

  const checklistProgress = useMemo(() => {
    if (!data) return { completed: 0, total: CHECKLIST_ITEMS.length, percent: 0 };
    const completed = data.checklist.filter((row) => row.condition === "available").length;
    return { completed, total: CHECKLIST_ITEMS.length, percent: Math.round((completed / CHECKLIST_ITEMS.length) * 100) };
  }, [data]);

  if (loadError && !data) return <LoadFailure message={loadError} onRetry={() => void load()} />;
  if (!data) return <Spinner />;

  const conditionOf = (item: string) =>
    data.checklist.find((row) => row.item === item)?.condition ?? "";

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-3" aria-label="مركز تجهيز وتنفيذ الحجز">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold">مركز التجهيز الميداني</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">تحقق من القائمة ثم وثّق حركة الأصول والأضرار من نفس الحجز.</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-bold ${data.checklistCovered && !data.checklistIssues.length ? "bg-status-success/15 text-status-success" : "bg-status-warning/15 text-status-warning"}`}>
          {checklistProgress.completed}/{checklistProgress.total}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-label={`نسبة جاهزية المعدات ${checklistProgress.percent}%`}>
        <div className={`h-full rounded-full transition-[width] duration-200 motion-reduce:transition-none ${data.checklistIssues.length ? "bg-destructive" : "bg-status-success"}`} style={{ width: `${checklistProgress.percent}%` }} />
      </div>
      <div className="flex gap-1.5">
        {([
          { key: "checklist", label: "قائمة المعدات", icon: ClipboardList },
          { key: "scan", label: "المسح", icon: QrCode },
          { key: "damage", label: "الأضرار", icon: AlertTriangle },
        ] as const).map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            aria-pressed={tab === item.key}
            className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-2 text-xs font-bold ${tab === item.key ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground"}`}
          >
            <item.icon className="h-3.5 w-3.5" />{item.label}
          </button>
        ))}
      </div>

      {msg && <Banner kind={msg.ok ? "ok" : "error"}>{msg.text}</Banner>}

      {tab === "checklist" && (
        <>
          <div className={`rounded-lg px-3 py-2 text-xs font-bold ${data.checklistCovered && !data.checklistIssues.length ? "bg-status-success/10 text-status-success" : "bg-status-warning/10 text-status-warning"}`}>
            {data.checklistCovered && !data.checklistIssues.length
              ? "القائمة مكتملة — يمكن التحميل"
              : data.checklistCovered
                ? `عناصر تمنع التحميل: ${data.checklistIssues.length}`
                : `تبقى ${CHECKLIST_ITEMS.length - data.checklist.length} عنصراً`}
          </div>
          <ul className="space-y-1.5">
            {CHECKLIST_ITEMS.map((item) => {
              const current = conditionOf(item.key);
              return (
                <li key={item.key} className="rounded-lg border border-border/40 p-2">
                  <div className="mb-1.5 text-xs font-bold">{item.label}</div>
                  <div className="flex flex-wrap gap-1">
                    {CHECKLIST_CONDITIONS.map((condition) => (
                      <button
                        key={condition.key}
                        type="button"
                        disabled={busy}
                        onClick={() => setCondition(item.key, condition.key)}
                        aria-pressed={current === condition.key}
                        className={`rounded-lg px-2 py-1 text-[11px] font-bold disabled:opacity-50 ${
                          current === condition.key
                            ? condition.key === "available"
                              ? "bg-status-success text-white"
                              : "bg-destructive text-white"
                            : "bg-background text-muted-foreground"
                        }`}
                      >
                        {condition.label}
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {tab === "scan" && <ScanTab bookingId={bookingId} source={source} counts={data.scanCounts} onDone={load} />}

      {tab === "damage" && (
        <DamageTab
          bookingId={bookingId}
          source={source}
          damages={data.damages}
          answered={data.damageAnswered}
          onDone={load}
        />
      )}
    </section>
  );
}

function ScanTab({
  bookingId, source, counts, onDone,
}: { bookingId: number; source: string; counts: Record<string, number>; onDone: () => void }) {
  const [point, setPoint] = useState(SCAN_POINTS[0].key);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const requestInFlight = useRef(false);

  async function submit(code: string) {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setSubmitting(true);
    try {
      const res = await koshaOpsApi.scanItem(bookingId, { scanPoint: point, code }, source);
      setMsg({ ok: true, text: `${res.name} — ${res.scanPointLabel}` });
      onDone();
    } catch (err: any) {
      setMsg({ ok: false, text: apiErrorMessage(err, "تعذر تسجيل المسح") });
    } finally {
      requestInFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {SCAN_POINTS.map((item) => (
          <button
            key={item.key}
            type="button"
            disabled={submitting}
            onClick={() => setPoint(item.key)}
            aria-pressed={point === item.key}
            className={`rounded-lg px-2 py-1.5 text-[11px] font-bold disabled:opacity-50 ${point === item.key ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground"}`}
          >
            {item.label}
            {counts[item.key] ? <span className="ms-1 opacity-70">{counts[item.key]}</span> : null}
          </button>
        ))}
      </div>
      {msg && <Banner kind={msg.ok ? "ok" : "error"}>{msg.text}</Banner>}
      {submitting && <div className="flex items-center justify-center gap-1.5 py-1 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> جارٍ تسجيل المسح…</div>}
      {scanning ? (
        <>
          {/* Batch scanning: the camera stays open so a whole load can be swept. */}
          <LiveScanner onDetect={submit} />
          <button type="button" onClick={() => setScanning(false)} className="w-full rounded-lg border border-border py-1.5 text-xs">
            إغلاق الماسح
          </button>
        </>
      ) : (
        <button type="button" onClick={() => setScanning(true)} className="w-full rounded-lg bg-primary py-2 text-sm font-bold text-primary-foreground">
          <QrCode className="ms-1 inline h-4 w-4" /> بدء المسح
        </button>
      )}
    </div>
  );
}

function DamageTab({
  bookingId, source, damages, answered, onDone,
}: {
  bookingId: number; source: string;
  damages: OperationsPayload["damages"]; answered: boolean; onDone: () => void;
}) {
  const [form, setForm] = useState({ productId: "", description: "", priority: "medium", costEstimate: "", responsibleStaffId: "" });
  const [photo, setPhoto] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    try {
      // compressImageFile already returns a data URL.
      setPhoto(await compressImageFile(file));
    } catch {
      setMsg({ ok: false, text: "تعذر تجهيز الصورة" });
    }
  }

  async function send(payload: Record<string, unknown>) {
    setBusy(true);
    try {
      await koshaOpsApi.reportDamage(bookingId, payload, source);
      setMsg({ ok: true, text: "تم التسجيل" });
      setForm({ productId: "", description: "", priority: "medium", costEstimate: "", responsibleStaffId: "" });
      setPhoto("");
      onDone();
    } catch (err: any) {
      setMsg({ ok: false, text: apiErrorMessage(err, "تعذر تسجيل البلاغ") });
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-2">
      {!answered && (
        <Banner kind="error">لم يُجب سؤال الأضرار بعد — لا يمكن إغلاق الحجز قبل الإجابة.</Banner>
      )}
      {msg && <Banner kind={msg.ok ? "ok" : "error"}>{msg.text}</Banner>}

      {damages.length > 0 && (
        <ul className="space-y-1.5">
          {damages.map((row) => (
            <li key={row.id} className="rounded-lg border border-border/40 p-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{row.description}</span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${row.status === "pending_approval" ? "bg-status-warning/15 text-status-warning" : row.status === "none" ? "bg-status-success/15 text-status-success" : "bg-destructive/15 text-destructive"}`}>
                  {row.status === "pending_approval" ? "بانتظار الاعتماد" : row.status === "none" ? "لا أضرار" : "مفتوح"}
                </span>
              </div>
              {row.costEstimate > 0 && (
                <div className="mt-0.5 text-muted-foreground">التكلفة التقديرية: {money(row.costEstimate)}</div>
              )}
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={() => send({ noDamage: true })}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-status-success/40 py-2 text-xs font-bold text-status-success disabled:opacity-50"
      >
        <CheckCircle2 className="h-4 w-4" /> لا توجد أضرار
      </button>

      <details className="rounded-lg border border-border/40">
        <summary className="cursor-pointer px-3 py-2 text-xs font-bold">تسجيل ضرر</summary>
        <div className="space-y-2 p-2">
          <input value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })} inputMode="numeric" placeholder="رقم الأصل" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="وصف الضرر" className="min-h-16 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          <div className="flex flex-wrap gap-1">
            {DAMAGE_PRIORITIES.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setForm({ ...form, priority: item.key })}
                aria-pressed={form.priority === item.key}
                className={`rounded-lg px-2 py-1 text-[11px] font-bold ${form.priority === item.key ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input value={form.costEstimate} onChange={(e) => setForm({ ...form, costEstimate: e.target.value })} inputMode="numeric" placeholder="التكلفة التقديرية" className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            <input value={form.responsibleStaffId} onChange={(e) => setForm({ ...form, responsibleStaffId: e.target.value })} inputMode="numeric" placeholder="رقم الموظف المسؤول" className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          </div>
          <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
            <input type="file" accept="image/*" className="hidden" onChange={(e) => pickPhoto(e.target.files?.[0])} />
            {photo ? "تم اختيار الصورة ✓" : "إرفاق صورة"}
          </label>
          <button
            type="button"
            disabled={busy || !form.description.trim() || !form.productId}
            onClick={() => send({ ...form, productId: Number(form.productId), costEstimate: Number(form.costEstimate) || 0, responsibleStaffId: Number(form.responsibleStaffId) || null, photoUrl: photo || null })}
            className="w-full rounded-lg bg-destructive py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "إرسال البلاغ"}
          </button>
        </div>
      </details>
    </div>
  );
}

// ── Live board (Part 7) ──────────────────────────────────────────────────────

export function KoshaOpsBoardPage() {
  const [data, setData] = useState<KoshaOpsBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  useEffect(() => {
    let mounted = true;
    const load = () => koshaOpsApi.board().then((next) => {
      if (!mounted) return;
      setData(next);
      setError(null);
    }).catch((err) => {
      if (mounted) setError(apiErrorMessage(err, "تعذّر تحميل لوحة العمليات"));
    });
    load();
    const timer = window.setInterval(load, 30_000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [retryKey]);
  if (error && !data) return <div className="p-4"><LoadFailure message={error} onRetry={() => setRetryKey((key) => key + 1)} /></div>;
  if (!data) return <Spinner />;
  const stats = [
    { label: "حجوزات اليوم", value: data.counts.today, icon: ClipboardList },
    { label: "قيد التجهيز", value: data.counts.preparing, icon: Clock3 },
    { label: "قيد التنفيذ", value: data.counts.inProgress, icon: Truck },
    { label: "مكتملة", value: data.counts.completed, icon: CheckCircle2 },
    { label: "متأخرة", value: data.counts.delayed, icon: AlertTriangle, danger: true },
    { label: "طاقم متاح", value: data.counts.availableStaff, icon: Users },
    { label: "مركبات متاحة", value: data.counts.availableVehicles, icon: Truck },
    { label: "مهام معلقة", value: data.counts.pendingTasks, icon: ClipboardList },
    { label: "إشعارات", value: data.counts.unreadNotifications, icon: Bell },
  ];
  return (
    <div className="space-y-4 p-4">
      <div className="flex items-end justify-between gap-3"><div><h1 className="text-lg font-bold">مركز العمليات الحي</h1><p className="text-xs text-muted-foreground">يتجدد تلقائياً كل 30 ثانية · {data.today}</p></div><span className="rounded-full bg-status-success/10 px-2 py-1 text-[11px] font-bold text-status-success">مباشر</span></div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border bg-card p-3">
            <stat.icon className={`mb-2 h-4 w-4 ${stat.danger && stat.value > 0 ? "text-destructive" : "text-primary"}`} />
            <div className="text-xl font-bold tabular-nums">{stat.value}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{stat.label}</div>
          </div>
        ))}
      </div>

      <section className="rounded-xl border border-border bg-card p-3">
        <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-bold">العمليات الجارية الآن</h2><span className="text-xs text-muted-foreground">{data.currentJobs.length}</span></div>
        {data.currentJobs.length ? <ul className="divide-y divide-border/70">{data.currentJobs.map((job) => <li key={`${job.source ?? "kosha"}-${job.bookingId}`}><Link href={`/staff/koshas/booking/${job.bookingId}?source=${job.source === "service" ? "service" : "kosha"}`} className="flex min-h-12 items-center justify-between gap-3 py-2 text-sm"><div className="min-w-0"><b className="block truncate">{job.customerName}</b><span className="flex items-center gap-1 truncate text-xs text-muted-foreground"><MapPin className="h-3 w-3" />{job.hall || "الموقع غير محدد"}</span></div><div className="shrink-0 text-left"><b className="block text-xs text-primary">{STAGE_LABEL[job.stage] ?? job.stage}</b><span className="text-xs text-muted-foreground">{job.eventTime || "—"}</span></div></Link></li>)}</ul> : <p className="py-3 text-sm text-muted-foreground">لا توجد عملية ميدانية جارية الآن.</p>}
      </section>

      {data.missingAssets.length > 0 && (
        <section>
          <h2 className="mb-1.5 text-sm font-bold text-destructive">أصول مفقودة</h2>
          <ul className="space-y-1">
            {data.missingAssets.map((row, index) => (
              <li key={`${row.bookingId}-${row.item}-${index}`} className="rounded-lg border border-border bg-card px-3 py-2 text-xs">
                {row.customerName} — {CHECKLIST_ITEMS.find((i) => i.key === row.item)?.label ?? row.item}
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.damagedAssets.length > 0 && (
        <section>
          <h2 className="mb-1.5 text-sm font-bold text-destructive">أضرار مُبلَّغة</h2>
          <ul className="space-y-1">
            {data.damagedAssets.map((row, index) => (
              <li key={`${row.bookingId}-${index}`} className="rounded-lg border border-border bg-card px-3 py-2 text-xs">
                {row.customerName} — {row.description}
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.employeeWorkload.length > 0 && (
        <section>
          <h2 className="mb-1.5 text-sm font-bold">توزيع العمل اليوم</h2>
          <ul className="space-y-1">
            {data.employeeWorkload.map((row) => (
              <li key={row.staffId} className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-xs">
                <span className="truncate">{row.name}</span>
                <span className="tabular-nums text-muted-foreground">{row.bookings} حجز</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ── Reports (Part 8) ─────────────────────────────────────────────────────────

export function KoshaOpsReportsPage() {
  const [data, setData] = useState<KoshaOpsReport | null>(null);
  const [range, setRange] = useState({ from: "", to: "" });
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  useEffect(() => {
    setError(null);
    koshaOpsApi.reports({ from: range.from || undefined, to: range.to || undefined })
      .then((next) => { setData(next); setError(null); })
      .catch((err) => { setData(null); setError(apiErrorMessage(err, "تعذّر تحميل التقارير التشغيلية")); });
  }, [range.from, range.to, retryKey]);
  if (error && !data) return <div className="p-4"><LoadFailure message={error} onRetry={() => setRetryKey((key) => key + 1)} /></div>;
  if (!data) return <Spinner />;

  const section = (title: string, rows: React.ReactNode) => (
    <section>
      <h2 className="mb-1.5 text-sm font-bold">{title}</h2>
      {rows}
    </section>
  );
  const empty = <p className="text-xs text-muted-foreground">لا توجد بيانات.</p>;

  return (
    <div className="space-y-4 p-4">
      <h1 className="flex items-center gap-2 text-lg font-bold"><BarChart3 className="h-5 w-5 text-primary" /> التقارير</h1>
      <div className="grid grid-cols-2 gap-2">
        <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
      </div>

      {section("العمل اليومي", data.daily.length ? (
        <ul className="space-y-1">
          {data.daily.map((row) => (
            <li key={row.date} className="flex justify-between rounded-lg border border-border bg-card px-3 py-2 text-xs">
              <span className="tabular-nums">{row.date}</span>
              <span className="tabular-nums text-muted-foreground">{row.completed}/{row.bookings} مكتمل</span>
            </li>
          ))}
        </ul>
      ) : empty)}

      {section("أداء الموظفين", data.employees.length ? (
        <ul className="space-y-1">
          {data.employees.map((row) => (
            <li key={row.staffId} className="flex justify-between rounded-lg border border-border bg-card px-3 py-2 text-xs">
              <span className="truncate">{row.name}</span>
              <span className="tabular-nums text-muted-foreground">{row.stageEvents} مرحلة · {row.scans} مسح</span>
            </li>
          ))}
        </ul>
      ) : empty)}

      {section("استخدام المعدات", data.equipment.length ? (
        <ul className="space-y-1">
          {data.equipment.map((row) => (
            <li key={row.productId} className="flex justify-between rounded-lg border border-border bg-card px-3 py-2 text-xs">
              <span className="truncate">{row.name}</span>
              <span className="tabular-nums text-muted-foreground">{row.scans}</span>
            </li>
          ))}
        </ul>
      ) : empty)}

      {section("الأضرار", data.damages.length ? (
        <ul className="space-y-1">
          {data.damages.map((row) => (
            <li key={row.priority} className="flex justify-between rounded-lg border border-border bg-card px-3 py-2 text-xs">
              <span>{DAMAGE_PRIORITIES.find((p) => p.key === row.priority)?.label ?? row.priority}</span>
              <span className="tabular-nums text-muted-foreground">{row.count} · {money(row.cost)}</span>
            </li>
          ))}
        </ul>
      ) : empty)}

      {section("أصول مفقودة", data.missing.length ? (
        <ul className="space-y-1">
          {data.missing.map((row, index) => (
            <li key={`${row.bookingId}-${index}`} className="rounded-lg border border-border bg-card px-3 py-2 text-xs">
              {row.customerName} — {CHECKLIST_ITEMS.find((i) => i.key === row.item)?.label ?? row.item}
            </li>
          ))}
        </ul>
      ) : empty)}

      {section("إرجاعات متأخرة", data.lateReturns.length ? (
        <ul className="space-y-1">
          {data.lateReturns.map((row) => (
            <li key={row.bookingId} className="flex justify-between rounded-lg border border-border bg-card px-3 py-2 text-xs">
              <span className="truncate">{row.customerName}</span>
              <span className="text-muted-foreground">{STAGE_LABEL[row.stage] ?? row.stage}</span>
            </li>
          ))}
        </ul>
      ) : empty)}

      {section("تحتاج صيانة", data.maintenance.length ? (
        <ul className="space-y-1">
          {data.maintenance.map((row, index) => (
            <li key={`${row.bookingId}-${index}`} className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs">
              <Wrench className="h-3 w-3 text-status-warning" />
              {row.customerName} — {CHECKLIST_ITEMS.find((i) => i.key === row.item)?.label ?? row.item}
            </li>
          ))}
        </ul>
      ) : empty)}
    </div>
  );
}
