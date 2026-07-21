import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  Clapperboard, Gauge, HardDrive, Loader2, Plus, TrendingUp, Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage, type AdminMe } from "@/views/admin/_lib";
import {
  CARD_STATUSES, EDIT_STATUSES, EDIT_STATUS_LABEL, MEDIA_KINDS, nextEditStatus,
  photographyApi, postApi,
  type CardAssignment, type EditProject, type EditStatus, type MediaBatch,
  type MediaTotals, type MemoryCard, type OpsReport,
} from "./lib";

const isManager = (me: AdminMe | null | undefined) => !!me && (me.role === "admin" || me.role === "manager");

function Empty({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-border/50 p-8 text-center text-sm text-muted-foreground">{text}</div>;
}

function Spinner() {
  return <div className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" /></div>;
}

const EDIT_TONE: Record<string, string> = {
  waiting: "bg-muted text-muted-foreground",
  copying_files: "bg-status-warning/15 text-status-warning",
  editing: "bg-accent/15 text-accent",
  color_correction: "bg-accent/15 text-accent",
  exporting: "bg-accent/15 text-accent",
  quality_check: "bg-status-warning/15 text-status-warning",
  ready: "bg-status-success/15 text-status-success",
  delivered: "bg-status-success/15 text-status-success",
};

// ── Edit-room queue ──────────────────────────────────────────────────────────

export function EditingPage({ me }: { me: AdminMe }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const manager = isManager(me);
  const [data, setData] = useState<{ data: EditProject[]; statusCounts: Record<string, number> } | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(0);
  const [editors, setEditors] = useState<Array<{ id: number; name: string }>>([]);

  const load = useCallback(() => {
    postApi.editQueue(status).then(setData).catch(() => setData({ data: [], statusCounts: {} }));
  }, [status]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (manager) photographyApi.photographers().then(setEditors).catch(() => {}); }, [manager]);

  async function advance(project: EditProject, target: EditStatus) {
    if (!project.clientToken) return;
    setBusy(project.id);
    try {
      await postApi.setEditStatus(project.clientToken, target);
      toast({ title: `تم الانتقال إلى «${EDIT_STATUS_LABEL[target]}»` });
      load();
    } catch (err: any) {
      toast({ title: "تعذّر تغيير الحالة", description: apiErrorMessage(err), variant: "destructive" });
    } finally { setBusy(0); }
  }

  async function assign(project: EditProject, editorStaffId: number) {
    if (!project.clientToken || !editorStaffId) return;
    setBusy(project.id);
    try {
      await postApi.assignEditor(project.clientToken, editorStaffId);
      toast({ title: "تم إسناد المونتير" });
      load();
    } catch (err: any) {
      toast({ title: "تعذّر الإسناد", description: apiErrorMessage(err), variant: "destructive" });
    } finally { setBusy(0); }
  }

  if (!data) return <Spinner />;

  return (
    <div className="space-y-3 p-4">
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
        <button
          type="button"
          onClick={() => setStatus("")}
          className={`flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${status === "" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground"}`}
        >
          الكل
        </button>
        {EDIT_STATUSES.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setStatus(item.key)}
            className={`flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${status === item.key ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground"}`}
          >
            {item.label}
            {data.statusCounts[item.key] ? <span className="ms-1 tabular-nums opacity-70">{data.statusCounts[item.key]}</span> : null}
          </button>
        ))}
      </div>

      {data.data.length ? (
        <div className="space-y-2">
          {data.data.map((project) => {
            const upcoming = nextEditStatus(project.status);
            return (
              <article key={project.id} className="rounded-xl border border-border/30 bg-card p-3">
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => project.clientToken && navigate(`/staff/photography/shoots/${project.clientToken}`)}
                    className="min-w-0 text-right"
                  >
                    <div className="truncate font-bold text-foreground">{project.customerName}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {project.eventDate ?? "—"}{project.editorName ? ` · ${project.editorName}` : " · بلا مونتير"}
                    </div>
                  </button>
                  <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${EDIT_TONE[project.status] ?? "bg-muted"}`}>
                    {project.statusLabel}
                  </span>
                </div>

                {manager && !project.editorStaffId && editors.length ? (
                  <select
                    defaultValue=""
                    disabled={busy === project.id}
                    onChange={(event) => assign(project, Number(event.target.value))}
                    className="mt-2 h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="" disabled>اختر مونتيراً…</option>
                    {editors.map((editor) => <option key={editor.id} value={editor.id}>{editor.name}</option>)}
                  </select>
                ) : null}

                <div className="mt-2 flex gap-2">
                  {upcoming ? (
                    <Button size="sm" className="flex-1" disabled={busy === project.id} onClick={() => advance(project, upcoming)}>
                      {busy === project.id ? <Loader2 className="h-4 w-4 animate-spin" /> : EDIT_STATUS_LABEL[upcoming]}
                    </Button>
                  ) : <span className="flex-1 text-center text-xs font-bold text-status-success">اكتمل</span>}
                  {manager && project.status !== "waiting" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === project.id}
                      onClick={() => {
                        const index = EDIT_STATUSES.findIndex((item) => item.key === project.status);
                        if (index > 0) advance(project, EDIT_STATUSES[index - 1].key);
                      }}
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </div>

                {project.turnaroundHours !== null ? (
                  <p className="mt-1.5 text-[11px] text-muted-foreground">مدة المونتاج: {project.turnaroundHours} ساعة</p>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : <Empty text="لا توجد مشاريع مونتاج." />}
    </div>
  );
}

// ── Memory cards ─────────────────────────────────────────────────────────────

export function MemoryCardsPage({ me }: { me: AdminMe }) {
  const { toast } = useToast();
  const manager = isManager(me);
  const [cards, setCards] = useState<MemoryCard[] | null>(null);
  const [busy, setBusy] = useState(0);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ label: "", capacityGb: "", serialNumber: "" });

  const load = useCallback(() => {
    postApi.cards().then((res) => setCards(res.data)).catch(() => setCards([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function move(card: MemoryCard, status: string) {
    setBusy(card.id);
    try {
      // Copying is the point where the file count becomes known.
      const filesCopied = status === "copying"
        ? Number(window.prompt("كم ملفاً نُسخ من البطاقة؟", String(card.filesCopied || 0)) ?? card.filesCopied)
        : undefined;
      await postApi.setCardStatus(card.id, status, Number.isFinite(filesCopied) ? filesCopied : undefined);
      toast({ title: "تم تحديث حالة البطاقة" });
      load();
    } catch (err: any) {
      toast({ title: "تعذّر التحديث", description: apiErrorMessage(err), variant: "destructive" });
    } finally { setBusy(0); }
  }

  async function create() {
    try {
      await postApi.createCard({
        label: form.label.trim(),
        capacityGb: Number(form.capacityGb) || 0,
        serialNumber: form.serialNumber.trim() || null,
      });
      toast({ title: "تمت إضافة البطاقة" });
      setForm({ label: "", capacityGb: "", serialNumber: "" });
      setAdding(false);
      load();
    } catch (err: any) {
      toast({ title: "تعذّرت الإضافة", description: apiErrorMessage(err), variant: "destructive" });
    }
  }

  if (!cards) return <Spinner />;

  return (
    <div className="space-y-3 p-4">
      {manager ? (
        adding ? (
          <div className="space-y-2 rounded-xl border border-border/30 bg-card p-3">
            <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="اسم البطاقة (مثال: SanDisk 128 — أ)" />
            <div className="grid grid-cols-2 gap-2">
              <Input value={form.capacityGb} onChange={(e) => setForm({ ...form, capacityGb: e.target.value })} inputMode="numeric" placeholder="السعة (GB)" />
              <Input value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} placeholder="الرقم التسلسلي" />
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" disabled={form.label.trim().length < 2} onClick={create}>حفظ</Button>
              <Button variant="outline" onClick={() => setAdding(false)}>إلغاء</Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" className="w-full" onClick={() => setAdding(true)}>
            <Plus className="ms-1 h-4 w-4" /> إضافة بطاقة ذاكرة
          </Button>
        )
      ) : null}

      {cards.length ? (
        <div className="space-y-2">
          {cards.map((card) => (
            <article key={card.id} className="rounded-xl border border-border/30 bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-bold text-foreground">{card.label}</div>
                  <div className="text-xs tabular-nums text-muted-foreground">
                    {card.capacityGb ? `${card.capacityGb} GB` : "—"}
                    {card.photographerName ? ` · ${card.photographerName}` : ""}
                    {card.cameraName ? ` · ${card.cameraName}` : ""}
                  </div>
                </div>
                <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                  card.status === "damaged" ? "bg-destructive/15 text-destructive"
                  : card.status === "available" || card.status === "returned" ? "bg-status-success/15 text-status-success"
                  : "bg-status-warning/15 text-status-warning"
                }`}>{card.statusLabel}</span>
              </div>
              {card.filesCopied ? <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">نُسخ {card.filesCopied} ملف</p> : null}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {CARD_STATUSES.filter((item) => item.key !== card.status).map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    disabled={busy === card.id}
                    onClick={() => move(card, item.key)}
                    className="rounded-lg border border-border/40 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </article>
          ))}
        </div>
      ) : <Empty text="لا توجد بطاقات مسجّلة." />}
    </div>
  );
}

// ── Per-shoot media ledger (metadata only) ───────────────────────────────────

export function ShootMediaPanel({ shootRef }: { shootRef: string }) {
  const { toast } = useToast();
  const [state, setState] = useState<{ data: MediaBatch[]; totals: MediaTotals } | null>(null);
  const [cards, setCards] = useState<CardAssignment[]>([]);
  const [form, setForm] = useState({ kind: "raw", fileCount: "", sizeGb: "", note: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    postApi.media(shootRef).then(setState).catch(() => setState({ data: [], totals: { byKind: {}, files: 0, bytes: 0 } }));
    postApi.shootCards(shootRef).then((res) => setCards(res.data)).catch(() => {});
  }, [shootRef]);
  useEffect(() => { load(); }, [load]);

  async function record() {
    setBusy(true);
    try {
      await postApi.addMedia(shootRef, {
        kind: form.kind,
        fileCount: Number(form.fileCount) || 0,
        // Recorded in GB for convenience; stored exactly in bytes.
        totalBytes: Math.round((Number(form.sizeGb) || 0) * 1024 ** 3),
        note: form.note.trim() || null,
      });
      toast({ title: "تم تسجيل الدفعة" });
      setForm({ kind: form.kind, fileCount: "", sizeGb: "", note: "" });
      load();
    } catch (err: any) {
      toast({ title: "تعذّر التسجيل", description: apiErrorMessage(err), variant: "destructive" });
    } finally { setBusy(false); }
  }

  if (!state) return null;

  return (
    <section className="rounded-xl border border-border/30 bg-card p-4">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-bold text-foreground">
        <HardDrive className="h-4 w-4 text-primary" /> سجل الملفات
      </h2>
      <p className="mb-3 text-[11px] text-muted-foreground">
        يُسجَّل العدد والحجم فقط — الملفات نفسها تبقى على البطاقات أو القرص.
      </p>

      {state.totals.files > 0 ? (
        <div className="mb-3 grid grid-cols-2 gap-2 rounded-lg bg-muted/40 p-2 text-xs">
          <div><span className="text-muted-foreground">إجمالي الملفات: </span><b className="tabular-nums">{state.totals.files}</b></div>
          <div><span className="text-muted-foreground">الحجم: </span><b className="tabular-nums">{(state.totals.bytes / 1024 ** 3).toFixed(1)} GB</b></div>
        </div>
      ) : null}

      <div className="space-y-2 rounded-lg border border-border/30 p-2">
        <select
          value={form.kind}
          onChange={(event) => setForm({ ...form, kind: event.target.value })}
          className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
        >
          {MEDIA_KINDS.map((kind) => <option key={kind.key} value={kind.key}>{kind.label}</option>)}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <Input value={form.fileCount} onChange={(e) => setForm({ ...form, fileCount: e.target.value })} inputMode="numeric" placeholder="عدد الملفات" />
          <Input value={form.sizeGb} onChange={(e) => setForm({ ...form, sizeGb: e.target.value })} inputMode="decimal" placeholder="الحجم (GB)" />
        </div>
        <Button size="sm" className="w-full" disabled={busy || !(Number(form.fileCount) > 0)} onClick={record}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "تسجيل الدفعة"}
        </Button>
      </div>

      {state.data.length ? (
        <ul className="mt-3 space-y-1.5">
          {state.data.map((batch) => (
            <li key={batch.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate">{batch.kindLabel}</span>
              <span className="flex-shrink-0 tabular-nums text-muted-foreground">{batch.fileCount} ملف · {batch.sizeLabel}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {cards.length ? (
        <div className="mt-3 border-t border-border/30 pt-3">
          <h3 className="mb-1.5 text-xs font-bold text-foreground">بطاقات هذه المهمة</h3>
          <ul className="space-y-1">
            {cards.map((assignment) => (
              <li key={assignment.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate">{assignment.label}</span>
                <span className="flex-shrink-0 text-muted-foreground">{assignment.statusLabel}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

// ── Operations report ────────────────────────────────────────────────────────

export function OpsReportPage() {
  const [report, setReport] = useState<OpsReport | null>(null);
  const [range, setRange] = useState({ from: "", to: "" });

  useEffect(() => {
    postApi.opsReport({ from: range.from || undefined, to: range.to || undefined })
      .then(setReport)
      .catch(() => setReport(null));
  }, [range.from, range.to]);

  if (!report) return <Spinner />;

  const hours = (value: number | null) => (value === null ? "—" : `${value} ساعة`);

  return (
    <div className="space-y-4 p-4">
      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-1">
          <span className="text-[11px] text-muted-foreground">من</span>
          <Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] text-muted-foreground">إلى</span>
          <Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "المناسبات", value: report.totals.events },
          { label: "مكتملة", value: report.totals.completed },
          { label: "صور", value: report.totals.photos },
          { label: "فيديو", value: report.totals.videos },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border/30 bg-card p-3">
            <div className="text-xl font-bold tabular-nums text-foreground">{stat.value}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{stat.label}</div>
          </div>
        ))}
      </div>

      <section className="rounded-xl border border-border/30 bg-card p-4">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-foreground"><Gauge className="h-4 w-4 text-primary" /> متوسط الإنجاز</h2>
        <dl className="grid grid-cols-2 gap-2 text-xs">
          <div><dt className="text-muted-foreground">من نهاية التصوير للتسليم</dt><dd className="font-bold tabular-nums">{hours(report.turnaround.shootToDeliveryHours)}</dd></div>
          <div><dt className="text-muted-foreground">مدة المونتاج</dt><dd className="font-bold tabular-nums">{hours(report.turnaround.editingHours)}</dd></div>
          <div><dt className="text-muted-foreground">إجمالي الملفات</dt><dd className="font-bold tabular-nums">{report.totals.files}</dd></div>
          <div><dt className="text-muted-foreground">الحجم الكلي</dt><dd className="font-bold tabular-nums">{report.totals.sizeLabel}</dd></div>
        </dl>
      </section>

      {report.photographers.length ? (
        <section className="rounded-xl border border-border/30 bg-card p-4">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-foreground"><TrendingUp className="h-4 w-4 text-primary" /> إنتاجية المصورين</h2>
          <ul className="space-y-1.5">
            {report.photographers.map((row) => (
              <li key={row.staffId} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate">{row.name}</span>
                <span className="flex-shrink-0 tabular-nums text-muted-foreground">{row.completed}/{row.shoots} مكتملة</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {report.editors.length ? (
        <section className="rounded-xl border border-border/30 bg-card p-4">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-foreground"><Clapperboard className="h-4 w-4 text-primary" /> أداء المونتيرين</h2>
          <ul className="space-y-1.5">
            {report.editors.map((row) => (
              <li key={row.staffId} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate">{row.name}</span>
                <span className="flex-shrink-0 tabular-nums text-muted-foreground">
                  {row.projects} مشروع · {row.avgTurnaroundHours === null ? "—" : `${row.avgTurnaroundHours} س`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
