import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Route, Switch, useLocation } from "wouter";
import {
  ArrowRight, ClipboardList, Loader2, LogOut, Ruler,
  Save, Scissors, Search, Send, ShieldCheck, User, XCircle,
} from "lucide-react";
import {
  fetchAdminMe, hasPerm, isSessionDecision, loginAdmin, logoutAdmin,
  adminFetch, type AdminMe,
} from "@/views/admin/_lib";

/** All tailor data flows through the assignment-scoped /admin/tailoring API. */
function tailorApi<T = any>(path: string, init?: RequestInit): Promise<T> {
  return adminFetch<T>(`/admin/tailoring${path}`, init);
}

const BUCKETS: { key: string; label: string }[] = [
  { key: "today", label: "طلبات اليوم" },
  { key: "awaiting_measurements", label: "بانتظار القياسات" },
  { key: "measurements_partial", label: "قياسات غير مكتملة" },
  { key: "measurements_complete", label: "قياسات مكتملة" },
  { key: "awaiting_approval", label: "بانتظار اعتماد الإدارة" },
  { key: "cutting", label: "قيد القص" },
  { key: "sewing", label: "قيد الخياطة" },
  { key: "ready", label: "جاهز" },
  { key: "late", label: "طلبات متأخرة" },
];

const STATUS_LABEL: Record<string, string> = {
  not_started: "لم تبدأ القياسات",
  partial: "قياسات جزئية",
  complete: "القياسات مكتملة",
  needs_review: "تحتاج مراجعة",
  approved: "معتمدة",
};
const STATUS_BADGE: Record<string, string> = {
  not_started: "bg-muted text-muted-foreground",
  partial: "bg-status-warning/15 text-status-warning",
  complete: "bg-status-success/15 text-status-success",
  needs_review: "bg-accent/15 text-accent",
  approved: "bg-primary/15 text-primary",
};

const READY_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "XXXL"];
const NUMERIC_FIELDS: { key: string; label: string }[] = [
  { key: "height", label: "الطول (سم)" },
  { key: "weight", label: "الوزن (كغم)" },
  { key: "shoulder", label: "عرض الكتف" },
  { key: "chest", label: "محيط الصدر" },
  { key: "waist", label: "محيط الخصر" },
  { key: "sleeveLength", label: "طول الكم" },
  { key: "robeLength", label: "طول الروب" },
  { key: "neck", label: "محيط الرقبة" },
  { key: "capSize", label: "مقاس القبعة" },
];

function Spinner() {
  return <div className="flex min-h-dvh items-center justify-center bg-background"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
}

function Login({ onDone }: { onDone: () => void }) {
  const [u, setU] = useState(""); const [p, setP] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await loginAdmin(u.trim(), p); onDone(); }
    catch (e: any) {
      if (isSessionDecision(e) && typeof window !== "undefined" && window.confirm(e.message)) {
        try { await loginAdmin(u.trim(), p, { forceReplace: true }); onDone(); }
        catch (retry: any) { setErr(retry?.message ?? "بيانات الدخول غير صحيحة"); }
      } else setErr(e?.message ?? "بيانات الدخول غير صحيحة");
    } finally { setBusy(false); }
  }
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6" dir="rtl">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card p-6">
        <div className="text-center">
          <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10"><Scissors className="h-7 w-7 text-primary" /></div>
          <h1 className="text-lg font-bold">بوابة الخياطين</h1>
          <p className="text-sm text-muted-foreground">سجّل الدخول للمتابعة</p>
        </div>
        {err && <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</div>}
        <input value={u} onChange={(e) => setU(e.target.value)} placeholder="اسم المستخدم" className="w-full rounded-lg border border-border bg-background p-2.5 text-sm" autoComplete="username" />
        <input value={p} onChange={(e) => setP(e.target.value)} type="password" placeholder="كلمة المرور" className="w-full rounded-lg border border-border bg-background p-2.5 text-sm" autoComplete="current-password" />
        <button disabled={busy || !u || !p} className="w-full rounded-lg bg-primary py-2.5 font-bold text-primary-foreground disabled:opacity-60">
          {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "دخول"}
        </button>
      </form>
    </div>
  );
}

function Dashboard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [bucket, setBucket] = useState("");
  const [list, setList] = useState<any[] | null>(null);

  useEffect(() => {
    tailorApi("/dashboard").then(setData).catch(() => setData({ buckets: {}, orders: [] })).finally(() => setLoading(false));
  }, []);

  const runSearch = useCallback(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (bucket) params.set("bucket", bucket);
    tailorApi(`/orders?${params.toString()}`).then((r) => setList(r.orders ?? [])).catch(() => setList([]));
  }, [search, bucket]);

  useEffect(() => { if (bucket) runSearch(); }, [bucket, runSearch]);

  if (loading) return <Spinner />;
  const orders = list ?? data?.orders ?? [];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {BUCKETS.map((b) => (
          <button
            key={b.key}
            type="button"
            onClick={() => setBucket((cur) => (cur === b.key ? "" : b.key))}
            className={`rounded-xl border p-3 text-right transition-colors ${bucket === b.key ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40"}`}
          >
            <div className="text-2xl font-bold">{data?.buckets?.[b.key] ?? 0}</div>
            <div className="text-xs text-muted-foreground">{b.label}</div>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && runSearch()}
          placeholder="اسم الطالب، الهاتف، رمز الطالب، رمز المجموعة، الجامعة، رقم الطلب، QR…"
          className="flex-1 bg-transparent text-sm outline-none"
        />
        <button type="button" onClick={runSearch} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground">بحث</button>
        {(bucket || list) && <button type="button" onClick={() => { setBucket(""); setSearch(""); setList(null); }} className="rounded-lg border border-border px-3 py-1.5 text-xs">مسح</button>}
      </div>

      <div className="space-y-2">
        {orders.length ? orders.map((o: any) => (
          <Link key={o.id} href={`/staff/tailors/order/${o.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 active:scale-[0.99]">
            <div className="min-w-0">
              <div className="truncate font-semibold">{o.name}</div>
              <div className="truncate text-xs text-muted-foreground" dir="ltr">{o.studentCode || o.orderNo} · {o.phone}</div>
              <div className="truncate text-xs text-muted-foreground">{[o.groupName, o.university, o.department].filter(Boolean).join(" — ")}</div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE[o.measurementStatus] ?? "bg-muted"}`}>{STATUS_LABEL[o.measurementStatus] ?? o.measurementStatus}</span>
              {o.finalSize && <span className="text-[11px] text-muted-foreground">مقاس: {o.finalSize}</span>}
            </div>
          </Link>
        )) : (
          <div className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">لا توجد طلبات مطابقة</div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="rounded-lg border border-border bg-background px-3 py-2"><div className="text-[11px] text-muted-foreground">{label}</div><div className="mt-0.5 text-sm font-medium">{children || "—"}</div></div>;
}

function OrderPage({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [method, setMethod] = useState<"custom" | "ready">("custom");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true); setErr(null);
    tailorApi(`/order/${id}`)
      .then((r) => {
        setOrder(r.order);
        const m = r.order?.measurements ?? {};
        setForm({ ...m });
        setMethod(m.method === "ready" ? "ready" : "custom");
      })
      .catch((e: any) => setErr(e?.message ?? "تعذر فتح الطلب"))
      .finally(() => setLoading(false));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function save(extra?: Record<string, any>) {
    setBusy(true); setMsg(null);
    try {
      const payload: Record<string, any> = { ...form, method, reason: reason || undefined, ...extra };
      const r = await tailorApi(`/order/${id}/measurements`, { method: "POST", body: JSON.stringify(payload) });
      setMsg("تم حفظ القياسات");
      setForm((f) => ({ ...f, ...(r.measurements ?? {}) }));
      setReason("");
    } catch (e: any) { setMsg(e?.message ?? "تعذر الحفظ"); }
    finally { setBusy(false); }
  }

  async function submitForApproval() {
    setBusy(true); setMsg(null);
    try { await tailorApi(`/order/${id}/submit`, { method: "POST" }); setMsg("أُرسلت القياسات للاعتماد"); load(); }
    catch (e: any) { setMsg(e?.message ?? "تعذر الإرسال"); }
    finally { setBusy(false); }
  }

  if (loading) return <Spinner />;
  if (err) return (
    <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-8 text-center">
      <ShieldCheck className="mx-auto mb-2 h-8 w-8 text-destructive" />
      <p className="font-bold text-destructive">{err}</p>
      <button type="button" onClick={() => navigate("/staff/tailors")} className="mt-4 rounded-lg border border-border px-4 py-2 text-sm">رجوع للوحة</button>
    </div>
  );

  return (
    <div className="space-y-4">
      <button type="button" onClick={() => navigate("/staff/tailors")} className="inline-flex items-center gap-1 text-sm text-muted-foreground"><ArrowRight className="h-4 w-4" /> رجوع</button>

      {/* Student & garment info (read-only, no financials). */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-3 flex items-center gap-2 font-bold"><User className="h-4 w-4 text-primary" /> {order.name}
          <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] ${STATUS_BADGE[order.measurementStatus] ?? "bg-muted"}`}>{STATUS_LABEL[order.measurementStatus] ?? order.measurementStatus}</span>
        </h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="رمز الطالب">{order.studentCode}</Field>
          <Field label="الهاتف 1">{order.phone}</Field>
          <Field label="الهاتف 2">{order.phone2}</Field>
          <Field label="المجموعة">{order.groupName}</Field>
          <Field label="الجامعة">{order.university}</Field>
          <Field label="الكلية">{order.college}</Field>
          <Field label="القسم">{order.department}</Field>
          <Field label="سنة التخرج">{order.graduationYear}</Field>
          <Field label="الروب / الموديل">{[order.robe, order.robeModel].filter(Boolean).join(" — ")}</Field>
          <Field label="الوشاح">{order.sash}</Field>
          <Field label="القبعة">{order.cap}</Field>
          <Field label="الإكسسوارات">{(order.accessories ?? []).join("، ")}</Field>
        </div>
        {order.productionNotes && <p className="mt-3 rounded-lg bg-muted/50 p-2 text-xs text-muted-foreground">ملاحظات الإنتاج: {order.productionNotes}</p>}
      </section>

      {/* Measurements — all optional, partial save allowed. */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Ruler className="h-4 w-4 text-primary" /><h3 className="font-bold">القياسات</h3>
          <div className="ml-auto flex overflow-hidden rounded-lg border border-border text-xs">
            <button type="button" onClick={() => setMethod("ready")} className={`px-3 py-1.5 ${method === "ready" ? "bg-primary text-primary-foreground" : ""}`}>مقاس جاهز</button>
            <button type="button" onClick={() => setMethod("custom")} className={`px-3 py-1.5 ${method === "custom" ? "bg-primary text-primary-foreground" : ""}`}>قياسات مخصصة</button>
          </div>
        </div>

        {method === "ready" ? (
          <div className="flex flex-wrap gap-2">
            {READY_SIZES.map((s) => (
              <button key={s} type="button"
                onClick={() => setForm((f) => ({ ...f, readySize: s, standardSize: s }))}
                className={`rounded-lg border px-4 py-2 text-sm font-bold ${form.readySize === s ? "border-primary bg-primary/10 text-primary" : "border-border"}`}>{s}</button>
            ))}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {NUMERIC_FIELDS.map((f) => (
              <div key={f.key}>
                <label className="text-xs text-muted-foreground">{f.label}</label>
                <input type="number" inputMode="decimal" value={form[f.key] ?? ""} onChange={(e) => setForm((cur) => ({ ...cur, [f.key]: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-sm" />
              </div>
            ))}
            <div>
              <label className="text-xs text-muted-foreground">المقاس القياسي</label>
              <select value={form.standardSize ?? ""} onChange={(e) => setForm((c) => ({ ...c, standardSize: e.target.value }))} className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-sm">
                <option value="">—</option>{READY_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">مقاس مخصص</label>
              <input value={form.customSize ?? ""} onChange={(e) => setForm((c) => ({ ...c, customSize: e.target.value }))} className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">الجنس</label>
              <select value={form.gender ?? ""} onChange={(e) => setForm((c) => ({ ...c, gender: e.target.value }))} className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-sm">
                <option value="">—</option><option value="male">ذكر</option><option value="female">أنثى</option>
              </select>
            </div>
          </div>
        )}

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div><label className="text-xs text-muted-foreground">ملاحظات شكل الجسم</label>
            <textarea value={form.bodyShapeNotes ?? ""} onChange={(e) => setForm((c) => ({ ...c, bodyShapeNotes: e.target.value }))} rows={2} className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-sm" /></div>
          <div><label className="text-xs text-muted-foreground">ملاحظات الخياط</label>
            <textarea value={form.tailorNotes ?? ""} onChange={(e) => setForm((c) => ({ ...c, tailorNotes: e.target.value }))} rows={2} className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-sm" /></div>
        </div>
        <div className="mt-3">
          <label className="text-xs text-muted-foreground">سبب التعديل (يُحفظ في السجل)</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="اختياري" className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-sm" />
        </div>

        {msg && <div className="mt-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">{msg}</div>}

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => save()} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} حفظ القياسات (جزئي مسموح)
          </button>
          <button type="button" disabled={busy} onClick={submitForApproval} className="inline-flex items-center gap-1.5 rounded-lg border border-accent bg-accent/10 px-4 py-2 text-sm font-bold text-accent disabled:opacity-60">
            <Send className="h-4 w-4" /> إرسال القياسات للاعتماد
          </button>
        </div>
      </section>

      {/* Measurement history — never overwritten. */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <h3 className="mb-3 flex items-center gap-2 font-bold"><ClipboardList className="h-4 w-4 text-primary" /> سجل القياسات</h3>
        {(order.history ?? []).length ? (
          <ul className="space-y-2">
            {order.history.map((h: any) => (
              <li key={h.id} className="rounded-lg border border-border bg-background p-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{h.action === "submit" ? "إرسال للاعتماد" : "تعديل قياسات"}</span>
                  <span className="text-muted-foreground" dir="ltr">{new Date(h.created_at).toLocaleString("ar")}</span>
                </div>
                <div className="mt-1 text-muted-foreground">{h.changed_by_name}{h.reason ? ` — ${h.reason}` : ""}</div>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted-foreground">لا يوجد سجل بعد.</p>}
      </section>
    </div>
  );
}

function Shell({ me, children }: { me: AdminMe; children: React.ReactNode }) {
  const [, navigate] = useLocation();
  return (
    <div className="min-h-dvh bg-background" dir="rtl">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-card px-4 py-3">
        <Scissors className="h-5 w-5 text-primary" />
        <div className="min-w-0"><h1 className="truncate font-bold leading-tight">بوابة الخياطين</h1><p className="truncate text-xs text-muted-foreground">{me.fullName || me.username}</p></div>
        <button type="button" onClick={async () => { await logoutAdmin(); navigate("/staff/tailors"); location.reload(); }} className="ml-auto inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs">
          <LogOut className="h-3.5 w-3.5" /> خروج
        </button>
      </header>
      <main className="mx-auto max-w-4xl p-4">{children}</main>
    </div>
  );
}

export default function TailorsPortal() {
  const [me, setMe] = useState<AdminMe | null | undefined>(undefined);
  const refresh = useCallback(() => {
    fetchAdminMe({ force: true }).then((u) => setMe(u ? { ...u, permissions: Array.isArray(u.permissions) ? u.permissions : [] } : null));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  if (me === undefined) return <Spinner />;
  if (!me) return <Login onDone={refresh} />;
  if (!hasPerm(me, "tailoring.portal.access")) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background p-6 text-center" dir="rtl">
        <XCircle className="h-10 w-10 text-destructive" />
        <h1 className="text-lg font-bold">لا تملك صلاحية بوابة الخياطين</h1>
        <p className="text-sm text-muted-foreground">تواصل مع الإدارة لمنحك صلاحية <code>tailoring.portal.access</code>.</p>
        <button type="button" onClick={async () => { await logoutAdmin(); refresh(); }} className="rounded-lg border border-border px-4 py-2 text-sm">تسجيل الخروج</button>
      </div>
    );
  }

  return (
    <Shell me={me}>
      <Switch>
        <Route path="/staff/tailors/order/:id">{(params) => <OrderPage id={params.id} />}</Route>
        <Route><Dashboard /></Route>
      </Switch>
    </Shell>
  );
}
