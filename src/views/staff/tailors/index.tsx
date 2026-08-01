import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Route, Switch, useLocation } from "wouter";
import {
  ArrowRight, Camera, CheckCircle2, ClipboardList, Copy, Download, Filter,
  Loader2, LogOut, Pause, Play, Plus, Printer, QrCode, Ruler, Save, Scissors,
  Search, Send, ShieldCheck, Table2, Upload, User, Users, Wrench, X, XCircle,
} from "lucide-react";
import {
  fetchAdminMe, hasPerm, isSessionDecision, loginAdmin, logoutAdmin,
  adminFetch, compressImageFile, type AdminMe,
} from "@/views/admin/_lib";
import { LiveScanner } from "@/views/staff/live-scanner";

/** All tailor data flows through the assignment-scoped /admin/tailoring API. */
function tailorApi<T = any>(path: string, init?: RequestInit): Promise<T> {
  return adminFetch<T>(`/admin/tailoring${path}`, init);
}

const BUCKETS: { key: string; label: string }[] = [
  { key: "today", label: "طلبات اليوم" },
  { key: "awaiting_measurements", label: "بانتظار إدخال القياسات" },
  { key: "measurements_partial", label: "قياسات غير مكتملة" },
  { key: "measurements_complete", label: "قياسات مكتملة" },
  { key: "awaiting_approval", label: "بانتظار اعتماد الإدارة" },
  { key: "cutting", label: "قيد القص" },
  { key: "sewing", label: "قيد الخياطة" },
  { key: "ready", label: "جاهز" },
  { key: "late", label: "طلبات متأخرة" },
];

const STATUS_LABEL: Record<string, string> = {
  not_started: "القياسات غير مدخلة",
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

const PROD_STAGES: { key: string; label: string }[] = [
  { key: "ready_for_cutting", label: "جاهز للقص" },
  { key: "cutting", label: "قيد القص" },
  { key: "sewing", label: "قيد الخياطة" },
  { key: "fitting", label: "البروفة" },
  { key: "adjustment", label: "التعديل" },
  { key: "ironing", label: "الكي" },
  { key: "quality_check", label: "فحص الجودة" },
  { key: "ready", label: "جاهز" },
];
const PHOTO_TYPES: { key: string; label: string }[] = [
  { key: "measurement", label: "صورة القياس" },
  { key: "robe_fitting", label: "بروفة الروب" },
  { key: "sleeve_fitting", label: "بروفة الكم" },
  { key: "adjustment", label: "صورة التعديل" },
];
const ALTER_TYPES: { key: string; label: string }[] = [
  { key: "shorten_robe", label: "تقصير الروب" },
  { key: "lengthen_robe", label: "تطويل الروب" },
  { key: "adjust_sleeve", label: "تعديل الكم" },
  { key: "adjust_shoulder", label: "تعديل الكتف" },
  { key: "adjust_chest", label: "تعديل الصدر" },
  { key: "replace_zipper", label: "تبديل السحّاب" },
  { key: "change_size", label: "تغيير المقاس" },
  { key: "other", label: "أخرى" },
];
const alterLabel = (k: string) => ALTER_TYPES.find((a) => a.key === k)?.label ?? k;

function Spinner() {
  return <div className="flex min-h-dvh items-center justify-center bg-background"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
}

/* Camera QR scanner — resolves a code to a scoped order, or 403/404. */
function ScanOverlay({ onClose }: { onClose: () => void }) {
  const [, navigate] = useLocation();
  const [status, setStatus] = useState<string | null>(null);
  const busyRef = useState({ v: false })[0];
  async function resolve(code: string) {
    if (busyRef.v) return;
    busyRef.v = true; setStatus("جارٍ فتح الطالب…");
    try {
      const r = await tailorApi(`/scan?code=${encodeURIComponent(code)}`);
      onClose(); navigate(`/staff/tailors/order/${r.orderId}`);
    } catch (e: any) { setStatus(e?.message ?? "رمز غير معروف"); busyRef.v = false; }
  }
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90" dir="rtl">
      <div className="flex items-center justify-between p-4 text-white">
        <span className="font-bold">مسح كود الطالب</span>
        <button type="button" onClick={onClose} aria-label="إغلاق" className="rounded-lg border border-white/20 p-2"><X className="h-4 w-4" /></button>
      </div>
      <div className="mx-auto w-full max-w-sm px-4">
        <div className="overflow-hidden rounded-2xl border border-primary/40"><LiveScanner onDetect={resolve} active stopOnDetect /></div>
        <p className="mt-3 text-center text-sm text-white/70">{status ?? "وجّه الكاميرا نحو رمز QR أو الباركود على الطلب"}</p>
      </div>
    </div>
  );
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
  const [groups, setGroups] = useState<any[]>([]);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    tailorApi("/dashboard").then(setData).catch(() => setData({ buckets: {}, orders: [] })).finally(() => setLoading(false));
    tailorApi("/groups").then((r) => setGroups(r.groups ?? [])).catch(() => setGroups([]));
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
      {scanning && <ScanOverlay onClose={() => setScanning(false)} />}
      <button type="button" onClick={() => setScanning(true)} className="flex w-full items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 font-bold text-primary">
        <QrCode className="h-5 w-5" /> مسح كود الطالب
      </button>
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

      {groups.length > 0 && (
        <div className="space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-bold text-muted-foreground"><Table2 className="h-4 w-4" /> مجموعات التخرج</h3>
          {groups.map((g: any) => (
            <Link key={g.id} href={`/staff/tailors/group/${g.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 active:scale-[0.99]">
              <div className="min-w-0">
                <div className="truncate font-semibold">{g.title}</div>
                <div className="truncate text-xs text-muted-foreground">{[g.groupNo, g.university, g.department].filter(Boolean).join(" — ")}</div>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">{g.completeCount}/{g.studentCount} مكتمل</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="rounded-lg border border-border bg-background px-3 py-2"><div className="text-[11px] text-muted-foreground">{label}</div><div className="mt-0.5 text-sm font-medium">{children || "—"}</div></div>;
}

function OrderPage({ id, canReview }: { id: string; canReview: boolean }) {
  const [, navigate] = useLocation();
  const [order, setOrder] = useState<any>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [method, setMethod] = useState<"custom" | "ready">("custom");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [altForm, setAltForm] = useState<any>({ type: "shorten_robe", problem: "", requiredChange: "", expectedDate: "", notes: "" });
  const [notes, setNotes] = useState<any>({ internal: "", admin: "", rep: "", warning: "" });

  const load = useCallback(() => {
    setLoading(true); setErr(null);
    tailorApi(`/order/${id}`)
      .then((r) => {
        setOrder(r.order);
        const m = r.order?.measurements ?? {};
        setForm({ ...m });
        setMethod(m.method === "ready" ? "ready" : "custom");
        setNotes({ internal: "", admin: "", rep: "", warning: "", ...(r.order?.notesTiers ?? {}) });
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

  async function uploadPhoto(type: string, file: File) {
    setMsg("جارٍ رفع الصورة…");
    try {
      const dataUrl = await compressImageFile(file, 1400, 0.8);
      const r = await tailorApi(`/order/${id}/photos`, { method: "POST", body: JSON.stringify({ type, dataUrl }) });
      setOrder((o: any) => ({ ...o, photos: r.photos })); setMsg("تم رفع الصورة");
    } catch (e: any) { setMsg(e?.message ?? "تعذر رفع الصورة"); }
  }
  async function addAlteration() {
    if (!altForm.problem && !altForm.requiredChange) { setMsg("أدخل المشكلة أو التعديل المطلوب"); return; }
    try {
      const r = await tailorApi(`/order/${id}/alterations`, { method: "POST", body: JSON.stringify({ alteration: altForm }) });
      setOrder((o: any) => ({ ...o, alterations: r.alterations }));
      setAltForm({ type: "shorten_robe", problem: "", requiredChange: "", expectedDate: "", notes: "" });
      setMsg("تمت إضافة التعديل");
    } catch (e: any) { setMsg(e?.message ?? "تعذر الحفظ"); }
  }
  async function doProduction(action: string, stage?: string) {
    try {
      const r = await tailorApi(`/order/${id}/production`, { method: "POST", body: JSON.stringify({ action, stage }) });
      setOrder((o: any) => ({ ...o, productionStage: r.productionStage })); setMsg("تم تحديث الإنتاج");
    } catch (e: any) { setMsg(e?.message ?? "تعذر التحديث"); }
  }
  async function review(decision: "approve" | "return") {
    try {
      await tailorApi(`/order/${id}/review`, { method: "POST", body: JSON.stringify({ decision, note: reviewNote || undefined }) });
      setReviewNote(""); load();
    } catch (e: any) { setMsg(e?.message ?? "تعذر تنفيذ القرار"); }
  }
  async function getQr() {
    try { const QR: any = await import("qrcode"); return await QR.toDataURL(`${location.origin}/graduation/track/${order.qrToken}`, { margin: 1, width: 150 }); }
    catch { return ""; }
  }
  function openPrint(html: string) {
    const w = window.open("", "_blank", "width=820,height=1040");
    if (!w) { setMsg("اسمح بالنوافذ المنبثقة للطباعة"); return; }
    w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 350);
  }
  const A4_STYLE = `*{font-family:'Segoe UI',system-ui,sans-serif}body{margin:0;padding:32px;color:#111}
    .head{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #C9F24A;padding-bottom:14px}
    .brand{font-size:26px;font-weight:800}.brand span{color:#7a9b1a}
    h1{font-size:20px;margin:18px 0 6px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 22px;font-size:14px}
    .grid div{padding:5px 0;border-bottom:1px dashed #ddd}table{width:100%;border-collapse:collapse;margin-top:10px;font-size:14px}
    td{border:1px solid #ccc;padding:7px 10px}td:first-child{background:#f6f6f6;font-weight:700;width:45%}
    .foot{margin-top:24px;display:flex;justify-content:space-between;font-size:13px;color:#444}
    @media print{@page{size:A4;margin:14mm}}`;
  function measureRows() {
    const m = order.measurements || {};
    return [["الطول", m.height], ["الوزن", m.weight], ["الكتف", m.shoulder], ["الصدر", m.chest], ["الخصر", m.waist], ["الكم", m.sleeveLength], ["طول الروب", m.robeLength], ["الرقبة", m.neck], ["القبعة", m.capSize], ["المقاس", m.standardSize || m.readySize || m.customSize]]
      .map(([k, v]) => `<tr><td>${k}</td><td>${v ?? "—"}</td></tr>`).join("");
  }
  const infoGrid = () => `<div class="grid">
    <div><b>رمز الطالب:</b> ${order.studentCode || "—"}</div><div><b>سنة التخرج:</b> ${order.graduationYear || "—"}</div>
    <div><b>الجامعة:</b> ${order.university || "—"}</div><div><b>الكلية:</b> ${order.college || "—"}</div>
    <div><b>القسم:</b> ${order.department || "—"}</div><div><b>المجموعة:</b> ${order.groupName || "—"}</div>
    <div><b>الروب/الموديل:</b> ${[order.robe, order.robeModel].filter(Boolean).join(" — ") || "—"}</div><div><b>الخياط:</b> ${order.tailorName || "—"}</div></div>`;

  async function printA4() {
    const qr = await getQr(); const m = order.measurements || {};
    openPrint(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>ورقة قياسات</title><style>${A4_STYLE}</style></head><body>
      <div class="head"><div class="brand">AJN <span>مجموعة علي جان</span><div style="font-size:13px;color:#666;font-weight:400">تجهيزات التخرج — ورقة قياسات الخياط</div></div>
      ${qr ? `<img src="${qr}" width="110" height="110" alt="QR"/>` : ""}</div>
      <h1>${order.name || ""}</h1>${infoGrid()}
      <h1>القياسات</h1><table>${measureRows()}</table>
      <div class="foot"><span>ملاحظات: ${(m.tailorNotes || order.productionNotes || "—")}</span><span>التاريخ: ${new Date().toLocaleDateString("ar")}</span></div>
      </body></html>`);
  }
  async function printLabel() {
    const qr = await getQr();
    openPrint(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>ملصق</title>
      <style>*{font-family:'Segoe UI',system-ui,sans-serif}body{margin:0;padding:0}
      .lbl{width:70mm;height:40mm;padding:6mm;box-sizing:border-box;display:flex;gap:6mm;align-items:center}
      .t b{font-size:15px;display:block}.t span{font-size:12px;color:#444;display:block}
      @media print{@page{size:70mm 40mm;margin:0}}</style></head><body>
      <div class="lbl">${qr ? `<img src="${qr}" width="90" height="90"/>` : ""}
      <div class="t"><b>${order.name || ""}</b><span>${order.studentCode || ""}</span><span>${order.groupName || ""}</span>
      <span>المقاس: ${(order.measurements?.standardSize || order.measurements?.readySize || order.measurements?.customSize || "—")}</span></div></div>
      </body></html>`);
  }
  async function printProductionSheet() {
    const stageLabel = PROD_STAGES.find((s) => s.key === order.productionStage)?.label ?? order.productionStage;
    const alts = (order.alterations || []).map((a: any) => `<tr><td>${alterLabel(a.type)}</td><td>${a.requiredChange || a.problem || "—"}</td></tr>`).join("") || `<tr><td colspan="2">لا يوجد</td></tr>`;
    openPrint(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>ورقة إنتاج</title><style>${A4_STYLE}</style></head><body>
      <div class="head"><div class="brand">AJN <span>مجموعة علي جان</span><div style="font-size:13px;color:#666;font-weight:400">ورقة إنتاج الخياطة</div></div></div>
      <h1>${order.name || ""} — <span style="color:#7a9b1a">${stageLabel}</span></h1>${infoGrid()}
      <h1>القياسات</h1><table>${measureRows()}</table>
      <h1>التعديلات المطلوبة</h1><table>${alts}</table>
      <div class="foot"><span>تحذيرات: ${(order.notesTiers?.warning || "—")}</span><span>التاريخ: ${new Date().toLocaleDateString("ar")}</span></div>
      </body></html>`);
  }
  async function saveNotes() {
    try { const r = await tailorApi(`/order/${id}/notes`, { method: "POST", body: JSON.stringify({ notes }) }); setOrder((o: any) => ({ ...o, notesTiers: r.notesTiers })); setMsg("حُفظت الملاحظات"); }
    catch (e: any) { setMsg(e?.message ?? "تعذر الحفظ"); }
  }
  async function pickAltPhoto(which: "beforePhoto" | "afterPhoto", file: File) {
    try { const dataUrl = await compressImageFile(file, 1000, 0.75); setAltForm((f: any) => ({ ...f, [which]: dataUrl })); }
    catch { setMsg("تعذر تجهيز الصورة"); }
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
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => navigate("/staff/tailors")} className="inline-flex items-center gap-1 text-sm text-muted-foreground"><ArrowRight className="h-4 w-4" /> رجوع</button>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <button type="button" onClick={printA4} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs"><Printer className="h-3.5 w-3.5" /> A4</button>
          <button type="button" onClick={printLabel} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs">ملصق</button>
          <button type="button" onClick={printProductionSheet} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs">ورقة إنتاج</button>
          {order.groupId ? (
            <button type="button" onClick={() => navigate(`/staff/tailors/group/${order.groupId}`)} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs"><Table2 className="h-3.5 w-3.5" /> المجموعة</button>
          ) : null}
        </div>
      </div>

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

      {/* Admin review outcome — visible to the tailor. */}
      {order.measurements?.adminReview ? (
        <div className={`rounded-xl border p-3 text-sm ${order.measurements.adminReview.decision === "approve" ? "border-status-success/40 bg-status-success/10 text-status-success" : "border-status-warning/40 bg-status-warning/10 text-status-warning"}`}>
          <b>{order.measurements.adminReview.decision === "approve" ? "✓ اعتمدت الإدارة القياسات" : "↩︎ أُعيدت للتصحيح"}</b>
          {order.measurements.adminReview.note ? <div className="mt-1 text-xs opacity-90">ملاحظة الإدارة: {order.measurements.adminReview.note}</div> : null}
          <div className="mt-0.5 text-[11px] opacity-70">{order.measurements.adminReview.byName}</div>
        </div>
      ) : null}

      {/* Manager approval panel. */}
      {canReview && order.measurementStatus === "needs_review" ? (
        <section className="rounded-2xl border border-accent/40 bg-accent/5 p-4">
          <div className="mb-2 flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-accent" /><h3 className="font-bold">اعتماد الإدارة</h3></div>
          <textarea value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} rows={2} placeholder="ملاحظة (اختياري)" className="w-full rounded-lg border border-border bg-background p-2 text-sm" />
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => review("approve")} className="inline-flex items-center gap-1 rounded-lg bg-status-success px-4 py-2 text-sm font-bold text-white"><CheckCircle2 className="h-4 w-4" /> اعتماد</button>
            <button type="button" onClick={() => review("return")} className="inline-flex items-center gap-1 rounded-lg border border-status-warning px-4 py-2 text-sm font-bold text-status-warning">إعادة للتصحيح</button>
          </div>
        </section>
      ) : null}

      {/* Production stage — tailor actions. */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2"><Wrench className="h-4 w-4 text-primary" /><h3 className="font-bold">الإنتاج</h3>
          <span className="ml-auto text-xs text-muted-foreground">المرحلة: {PROD_STAGES.find((s) => s.key === order.productionStage)?.label ?? order.productionStage}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PROD_STAGES.map((s) => (
            <button key={s.key} type="button" onClick={() => doProduction("set_stage", s.key)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs ${order.productionStage === s.key ? "border-primary bg-primary/10 text-primary" : "border-border"}`}>{s.label}</button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => doProduction("start")} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs"><Play className="h-3.5 w-3.5" /> بدء العمل</button>
          <button type="button" onClick={() => doProduction("pause")} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs"><Pause className="h-3.5 w-3.5" /> إيقاف مؤقت</button>
          <button type="button" onClick={() => doProduction("issue", undefined)} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs">الإبلاغ عن مشكلة</button>
          <button type="button" onClick={() => doProduction("material")} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs">طلب مواد</button>
          <button type="button" onClick={() => doProduction("mark_ready")} className="inline-flex items-center gap-1 rounded-lg border border-status-success/40 bg-status-success/10 px-3 py-1.5 text-xs text-status-success"><CheckCircle2 className="h-3.5 w-3.5" /> جاهز</button>
        </div>
      </section>

      {/* Optional photos. */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2"><Camera className="h-4 w-4 text-primary" /><h3 className="font-bold">الصور (اختياري)</h3></div>
        <div className="grid grid-cols-2 gap-2">
          {PHOTO_TYPES.map((p) => (
            <label key={p.key} className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground hover:border-primary">
              <Camera className="h-3.5 w-3.5" /> {p.label}
              <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files?.[0] && uploadPhoto(p.key, e.target.files[0])} />
            </label>
          ))}
        </div>
        {(order.photos ?? []).length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {order.photos.map((ph: any, i: number) => (
              <a key={i} href={ph.url} target="_blank" rel="noopener noreferrer" className="block">
                <img src={ph.url} alt={ph.type} className="h-16 w-16 rounded-lg border border-border object-cover" />
              </a>
            ))}
          </div>
        )}
      </section>

      {/* Alterations. */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2"><Scissors className="h-4 w-4 text-primary" /><h3 className="font-bold">التعديلات</h3></div>
        <div className="grid gap-2 sm:grid-cols-2">
          <select value={altForm.type} onChange={(e) => setAltForm((f: any) => ({ ...f, type: e.target.value }))} className="rounded-lg border border-border bg-background p-2 text-sm">
            {ALTER_TYPES.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
          <input type="date" value={altForm.expectedDate} onChange={(e) => setAltForm((f: any) => ({ ...f, expectedDate: e.target.value }))} className="rounded-lg border border-border bg-background p-2 text-sm" />
          <input placeholder="المشكلة" value={altForm.problem} onChange={(e) => setAltForm((f: any) => ({ ...f, problem: e.target.value }))} className="rounded-lg border border-border bg-background p-2 text-sm" />
          <input placeholder="التعديل المطلوب" value={altForm.requiredChange} onChange={(e) => setAltForm((f: any) => ({ ...f, requiredChange: e.target.value }))} className="rounded-lg border border-border bg-background p-2 text-sm" />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {([["beforePhoto", "صورة قبل"], ["afterPhoto", "صورة بعد"]] as const).map(([k, l]) => (
            <label key={k} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-primary">
              <Camera className="h-3.5 w-3.5" /> {l}{altForm[k] ? " ✓" : ""}
              <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files?.[0] && pickAltPhoto(k, e.target.files[0])} />
            </label>
          ))}
        </div>
        <button type="button" onClick={addAlteration} className="mt-2 inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-bold text-primary-foreground"><Plus className="h-4 w-4" /> إضافة تعديل</button>
        {(order.alterations ?? []).length > 0 && (
          <ul className="mt-3 space-y-2">
            {order.alterations.map((a: any) => (
              <li key={a.id} className="rounded-lg border border-border bg-background p-2 text-xs">
                <b>{alterLabel(a.type)}</b>{a.problem ? ` — ${a.problem}` : ""}{a.requiredChange ? ` → ${a.requiredChange}` : ""}
                {a.expectedDate ? <span className="text-muted-foreground"> · الموعد: {a.expectedDate}</span> : null}
                {(a.beforePhoto || a.afterPhoto) ? (
                  <span className="mt-1 flex gap-2">
                    {a.beforePhoto ? <a href={a.beforePhoto} target="_blank" rel="noopener noreferrer"><img src={a.beforePhoto} alt="قبل" className="h-12 w-12 rounded border border-border object-cover" /></a> : null}
                    {a.afterPhoto ? <a href={a.afterPhoto} target="_blank" rel="noopener noreferrer"><img src={a.afterPhoto} alt="بعد" className="h-12 w-12 rounded border border-border object-cover" /></a> : null}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Tiered notes — internal note never reaches the student. */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2"><ClipboardList className="h-4 w-4 text-primary" /><h3 className="font-bold">الملاحظات</h3></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="text-xs text-muted-foreground">ملاحظة داخلية (خاصة — لا تظهر للطالب)</label>
            <textarea value={notes.internal ?? ""} onChange={(e) => setNotes((n: any) => ({ ...n, internal: e.target.value }))} rows={2} className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-sm" /></div>
          <div><label className="text-xs text-muted-foreground">ملاحظة للإدارة</label>
            <textarea value={notes.admin ?? ""} onChange={(e) => setNotes((n: any) => ({ ...n, admin: e.target.value }))} rows={2} className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-sm" /></div>
          <div><label className="text-xs text-muted-foreground">ملاحظة للمندوب</label>
            <textarea value={notes.rep ?? ""} onChange={(e) => setNotes((n: any) => ({ ...n, rep: e.target.value }))} rows={2} className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-sm" /></div>
          <div><label className="text-xs text-status-warning">⚠ تحذير إنتاج</label>
            <textarea value={notes.warning ?? ""} onChange={(e) => setNotes((n: any) => ({ ...n, warning: e.target.value }))} rows={2} className="mt-1 w-full rounded-lg border border-status-warning/40 bg-background p-2 text-sm" /></div>
        </div>
        <button type="button" onClick={saveNotes} className="mt-2 inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-bold text-primary-foreground"><Save className="h-4 w-4" /> حفظ الملاحظات</button>
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

/* ---------------- Group measurement table (Phase 2) ---------------- */
const EDIT_COLS: { key: string; label: string }[] = [
  { key: "height", label: "الطول" },
  { key: "weight", label: "الوزن" },
  { key: "shoulder", label: "الكتف" },
  { key: "sleeveLength", label: "الكم" },
  { key: "robeLength", label: "طول الروب" },
  { key: "capSize", label: "القبعة" },
];
const CSV_HEAD = ["studentCode", "name", "height", "weight", "shoulder", "sleeveLength", "robeLength", "capSize", "finalSize", "status"];
const csvCell = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const EXCEL_COLUMNS = ["studentCode", "name", "height", "weight", "shoulder", "sleeveLength", "robeLength", "capSize", "finalSize", "status"] as const;

function GroupPage({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const [group, setGroup] = useState<any>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);
  const [applySize, setApplySize] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true); setErr(null);
    tailorApi(`/group/${id}`)
      .then((r) => { setGroup(r.group); setRows((r.students ?? []).map((s: any) => ({ ...s }))); })
      .catch((e: any) => setErr(e?.message ?? "تعذر فتح المجموعة"))
      .finally(() => setLoading(false));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const visible = useMemo(
    () => (onlyIncomplete ? rows.filter((r) => !["complete", "needs_review", "approved"].includes(r.measurementStatus)) : rows),
    [rows, onlyIncomplete],
  );

  const setCell = (oid: number, key: string, val: string) =>
    setRows((cur) => cur.map((r) => (r.id === oid ? { ...r, [key]: val, _dirty: true } : r)));
  const toggleSel = (oid: number) => setSel((s) => { const n = new Set(s); n.has(oid) ? n.delete(oid) : n.add(oid); return n; });
  const allSelected = visible.length > 0 && visible.every((r) => sel.has(r.id));
  const toggleAll = () => setSel(allSelected ? new Set() : new Set(visible.map((r) => r.id)));

  function payloadFor(r: any) {
    return { orderId: r.id, height: r.height, weight: r.weight, shoulder: r.shoulder, sleeveLength: r.sleeveLength, robeLength: r.robeLength, capSize: r.capSize, standardSize: r.finalSize };
  }
  async function saveItems(items: any[]) {
    if (!items.length) { setMsg("لا توجد صفوف محددة"); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await tailorApi(`/group/${id}/measurements`, { method: "POST", body: JSON.stringify({ items }) });
      setMsg(`تم حفظ ${r.saved} طالب`); setSel(new Set()); load();
    } catch (e: any) { setMsg(e?.message ?? "تعذر الحفظ"); }
    finally { setBusy(false); }
  }
  const saveSelected = () => saveItems(rows.filter((r) => sel.has(r.id)).map(payloadFor));
  const saveAll = () => saveItems(rows.filter((r) => r._dirty).map(payloadFor));

  function applySizeToSelected() {
    if (!applySize) return;
    setRows((cur) => cur.map((r) => (sel.has(r.id) ? { ...r, finalSize: applySize, _dirty: true } : r)));
    setMsg(`طُبّق المقاس ${applySize} على المحدد (اضغط حفظ)`);
  }
  function copyToSelected() {
    const src = rows.find((r) => sel.has(r.id));
    if (!src) { setMsg("حدّد صفاً مصدراً أولاً"); return; }
    setRows((cur) => cur.map((r) => (sel.has(r.id) && r.id !== src.id
      ? { ...r, height: src.height, weight: src.weight, shoulder: src.shoulder, sleeveLength: src.sleeveLength, robeLength: src.robeLength, capSize: src.capSize, finalSize: src.finalSize, _dirty: true }
      : r)));
    setMsg("نُسخت قياسات أول صف محدد إلى البقية (اضغط حفظ)");
  }

  function exportCSV() {
    const lines = [CSV_HEAD.join(",")];
    rows.forEach((r) => lines.push([r.studentCode, r.name, r.height, r.weight, r.shoulder, r.sleeveLength, r.robeLength, r.capSize, r.finalSize, r.measurementStatus].map(csvCell).join(",")));
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `group-${group?.groupNo || id}-measurements.csv`; a.click();
    URL.revokeObjectURL(a.href);
  }
  function importCSV(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "").replace(/^﻿/, "");
      const lines = text.split(/\r?\n/).filter(Boolean);
      if (!lines.length) return;
      const head = lines[0].split(",").map((h) => h.replace(/(^"|"$)/g, "").trim());
      const idx = (k: string) => head.indexOf(k);
      const byCode = new Map(rows.map((r) => [String(r.studentCode), r]));
      let hit = 0;
      const updates = new Map<number, any>();
      for (let i = 1; i < lines.length; i++) {
        const cells = lines[i].match(/("([^"]|"")*"|[^,]*)/g)?.filter((_, j) => j % 2 === 0).map((c) => c.replace(/(^"|"$)/g, "").replace(/""/g, '"')) ?? [];
        const code = cells[idx("studentCode")];
        const row = byCode.get(String(code));
        if (!row) continue;
        const patch: any = { ...row, _dirty: true };
        for (const c of ["height", "weight", "shoulder", "sleeveLength", "robeLength", "capSize"]) if (idx(c) >= 0 && cells[idx(c)] !== undefined) patch[c] = cells[idx(c)];
        if (idx("finalSize") >= 0 && cells[idx("finalSize")]) patch.finalSize = cells[idx("finalSize")];
        updates.set(row.id, patch); hit++;
      }
      setRows((cur) => cur.map((r) => updates.get(r.id) ?? r));
      setMsg(`استُورد ${hit} صفاً من الملف (راجع ثم احفظ)`);
    };
    reader.readAsText(file);
  }
  async function exportWorkbook() {
    const XLSX = await import("xlsx");
    const sheetRows = rows.map((r) => ({
      studentCode: r.studentCode ?? "", name: r.name ?? "", height: r.height ?? "", weight: r.weight ?? "",
      shoulder: r.shoulder ?? "", sleeveLength: r.sleeveLength ?? "", robeLength: r.robeLength ?? "",
      capSize: r.capSize ?? "", finalSize: r.finalSize ?? "", status: r.measurementStatus ?? "",
    }));
    const sheet = XLSX.utils.json_to_sheet(sheetRows, { header: [...EXCEL_COLUMNS] });
    sheet["!cols"] = [14, 24, 10, 10, 11, 14, 13, 11, 12, 16].map((wch) => ({ wch }));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Measurements");
    XLSX.writeFile(book, `group-${group?.groupNo || id}-measurements.xlsx`, { compression: true });
  }
  async function importWorkbook(file: File) {
    try {
      const XLSX = await import("xlsx");
      const book = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const firstSheet = book.SheetNames[0];
      if (!firstSheet) throw new Error("الملف لا يحتوي على ورقة عمل");
      const imported = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets[firstSheet], { defval: "" });
      const byCode = new Map(rows.map((r) => [String(r.studentCode), r]));
      const updates = new Map<number, any>();
      let hit = 0;
      for (const item of imported) {
        const row = byCode.get(String(item.studentCode ?? "").trim());
        if (!row) continue;
        const patch: any = { ...row, _dirty: true };
        for (const key of ["height", "weight", "shoulder", "sleeveLength", "robeLength", "capSize", "finalSize"])
          if (item[key] !== undefined && item[key] !== "") patch[key] = String(item[key]);
        updates.set(row.id, patch); hit += 1;
      }
      setRows((cur) => cur.map((row) => updates.get(row.id) ?? row));
      setMsg(`استورد ${hit} صفاً من ملف Excel. راجع البيانات ثم احفظ.`);
    } catch (error: any) { setMsg(error?.message ?? "تعذر استيراد ملف Excel"); }
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
      <div className="rounded-2xl border border-border bg-card p-4">
        <h2 className="flex items-center gap-2 font-bold"><Users className="h-4 w-4 text-primary" /> {group?.title || "مجموعة"}</h2>
        <p className="text-xs text-muted-foreground">{[group?.groupNo, group?.university, group?.department].filter(Boolean).join(" — ")} · {rows.length} طالب</p>
      </div>

      {/* Bulk action bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2 text-xs">
        <button type="button" disabled={busy} onClick={saveSelected} className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 font-bold text-primary-foreground disabled:opacity-60"><Save className="h-3.5 w-3.5" /> حفظ المحدد</button>
        <button type="button" disabled={busy} onClick={saveAll} className="rounded-lg border border-border px-3 py-1.5">حفظ كل المعدّل</button>
        <span className="mx-1 h-4 w-px bg-border" />
        <select value={applySize} onChange={(e) => setApplySize(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-1.5"><option value="">تطبيق مقاس…</option>{READY_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <button type="button" onClick={applySizeToSelected} className="rounded-lg border border-border px-3 py-1.5">تطبيق على المحدد</button>
        <button type="button" onClick={copyToSelected} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5"><Copy className="h-3.5 w-3.5" /> نسخ للمحدد</button>
        <span className="mx-1 h-4 w-px bg-border" />
        <button type="button" onClick={() => setOnlyIncomplete((v) => !v)} className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 ${onlyIncomplete ? "border-primary text-primary" : "border-border"}`}><Filter className="h-3.5 w-3.5" /> غير المكتملة</button>
        <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-border px-3 py-1.5"><Upload className="h-3.5 w-3.5" /> استيراد Excel<input type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" hidden onChange={(e) => e.target.files?.[0] && void importWorkbook(e.target.files[0])} /></label>
        <button type="button" onClick={() => void exportWorkbook()} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5"><Download className="h-3.5 w-3.5" /> تصدير Excel</button>
        <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5"><Printer className="h-3.5 w-3.5" /> طباعة</button>
      </div>
      {msg && <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">{msg}</div>}

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl border border-border" id="group-print">
        <table className="w-full min-w-[760px] border-collapse text-xs">
          <thead>
            <tr className="bg-muted/40 text-muted-foreground">
              <th className="p-2"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="تحديد الكل" /></th>
              <th className="p-2 text-right">رمز الطالب</th>
              <th className="p-2 text-right">الاسم</th>
              {EDIT_COLS.map((c) => <th key={c.key} className="p-2">{c.label}</th>)}
              <th className="p-2">المقاس النهائي</th>
              <th className="p-2">الحالة</th>
              <th className="p-2">الخياط</th>
              <th className="p-2">آخر تحديث</th>
              <th className="p-2">حفظ</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id} className={`border-t border-border ${r._dirty ? "bg-primary/5" : ""}`}>
                <td className="p-1.5 text-center"><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggleSel(r.id)} aria-label={`تحديد ${r.name}`} /></td>
                <td className="p-1.5 whitespace-nowrap font-mono text-[11px]">{r.studentCode}</td>
                <td className="p-1.5 whitespace-nowrap font-medium">{r.name}</td>
                {EDIT_COLS.map((c) => (
                  <td key={c.key} className="p-1">
                    <input inputMode="decimal" value={r[c.key] ?? ""} onChange={(e) => setCell(r.id, c.key, e.target.value)} className="w-14 rounded border border-border bg-background p-1 text-center" />
                  </td>
                ))}
                <td className="p-1">
                  <input value={r.finalSize ?? ""} onChange={(e) => setCell(r.id, "finalSize", e.target.value)} className="w-14 rounded border border-border bg-background p-1 text-center" />
                </td>
                <td className="p-1.5 text-center"><span className={`rounded-full px-2 py-0.5 text-[10px] ${STATUS_BADGE[r.measurementStatus] ?? "bg-muted"}`}>{STATUS_LABEL[r.measurementStatus] ?? r.measurementStatus}</span></td>
                <td className="p-1.5 whitespace-nowrap text-center text-muted-foreground">{r.tailorName || "—"}</td>
                <td className="p-1.5 whitespace-nowrap text-center text-muted-foreground" dir="ltr">{r.updatedAt ? new Date(r.updatedAt).toLocaleDateString("ar") : "—"}</td>
                <td className="p-1.5 text-center">
                  <button type="button" title="حفظ هذا الطالب" onClick={() => saveItems([payloadFor(r)])} className="rounded-md border border-border p-1 hover:border-primary"><Save className="h-3.5 w-3.5" /></button>
                </td>
              </tr>
            ))}
            {!visible.length && <tr><td colSpan={12} className="p-10 text-center text-muted-foreground">لا يوجد طلاب</td></tr>}
          </tbody>
        </table>
      </div>
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

  const canReview = me.role === "admin" || hasPerm(me, "graduation.approval.manage");
  return (
    <Shell me={me}>
      <Switch>
        <Route path="/staff/tailors/order/:id">{(params) => <OrderPage id={params.id} canReview={canReview} />}</Route>
        <Route path="/staff/tailors/group/:id">{(params) => <GroupPage id={params.id} />}</Route>
        <Route><Dashboard /></Route>
      </Switch>
    </Shell>
  );
}
