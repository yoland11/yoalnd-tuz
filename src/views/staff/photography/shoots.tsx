import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  BadgeCheck, Boxes, CheckCircle2, ChevronLeft, Circle, ClipboardCheck,
  Loader2, MapPin, Navigation, QrCode, Radio, Undo2, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage, type AdminMe } from "@/views/admin/_lib";
import { formatCurrency } from "@/lib/money";
import { LiveScanner } from "../live-scanner";
import { ShootMediaPanel } from "./post";
import { ShootGalleryPanel } from "./gallery";
import {
  CHECKLIST_ITEMS, SHOOT_STAGES, SHOOT_STAGE_LABEL, nextStage, readPositionOnce, shootApi,
  type PhotographyAsset, type ShootBoard, type ShootCard, type ShootDetail, type ShootStage,
} from "./lib";

const isManager = (me: AdminMe | null | undefined) => !!me && (me.role === "admin" || me.role === "manager");

/** Stage → badge tone. Grouped so the pipeline reads as prep → field → post → done. */
const STAGE_TONE: Record<ShootStage, string> = {
  assigned: "bg-muted text-muted-foreground",
  preparing: "bg-status-warning/15 text-status-warning",
  on_the_way: "bg-status-warning/15 text-status-warning",
  arrived: "bg-accent/15 text-accent",
  shooting: "bg-primary/15 text-primary",
  uploading: "bg-accent/15 text-accent",
  editing: "bg-accent/15 text-accent",
  ready_for_review: "bg-status-warning/15 text-status-warning",
  delivered: "bg-status-success/15 text-status-success",
  completed: "bg-status-success/15 text-status-success",
};

function StageBadge({ stage }: { stage: ShootStage }) {
  const meta = SHOOT_STAGES.find((item) => item.key === stage);
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${STAGE_TONE[stage]}`}>
      <span aria-hidden>{meta?.icon}</span>
      {meta?.label ?? stage}
    </span>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-border/50 p-8 text-center text-sm text-muted-foreground">{text}</div>;
}

function Spinner() {
  return <div className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" /></div>;
}

function Stat({ label, value, tone = "text-foreground" }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-xl border border-border/30 bg-card p-3">
      <div className={`text-xl font-bold tabular-nums ${tone}`}>{value}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function ShootRow({ card, onOpen }: { card: ShootCard; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-xl border border-border/30 bg-card p-3 text-right transition-transform active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-bold text-foreground">{card.customerName}</div>
          {card.eventName ? <div className="truncate text-xs text-muted-foreground">{card.eventName}</div> : null}
        </div>
        <StageBadge stage={card.stage} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="tabular-nums">{card.eventDate}{card.eventTime ? ` · ${card.eventTime}` : ""}</span>
        {card.venue ? <span className="inline-flex min-w-0 items-center gap-1"><MapPin className="h-3 w-3 flex-shrink-0" /><span className="truncate">{card.venue}</span></span> : null}
        {card.checklistComplete ? <span className="inline-flex items-center gap-1 text-status-success"><BadgeCheck className="h-3 w-3" />القائمة مكتملة</span> : null}
      </div>
    </button>
  );
}

// ── Board ────────────────────────────────────────────────────────────────────

export function ShootBoardPage() {
  const [, navigate] = useLocation();
  const [data, setData] = useState<ShootBoard | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    shootApi.board().then(setData).catch((err) => setError(apiErrorMessage(err)));
  }, []);

  if (error) return <div className="p-4"><Empty text={error} /></div>;
  if (!data) return <Spinner />;

  const open = (card: ShootCard) => navigate(`/staff/photography/shoots/${card.clientToken}`);

  return (
    <div className="space-y-5 p-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="مهام اليوم" value={data.todayAssignments.length} tone="text-primary" />
        <Stat label="قيد التنفيذ" value={data.active.length} tone="text-accent" />
        <Stat label="بانتظار الرفع" value={data.pendingUploads} tone="text-status-warning" />
        <Stat label="بانتظار المونتاج" value={data.pendingEditing} tone="text-status-warning" />
      </div>

      <section>
        <h2 className="mb-2 text-sm font-bold text-foreground">مهام اليوم</h2>
        {data.todayAssignments.length ? (
          <div className="space-y-2">
            {data.todayAssignments.map((card) => <ShootRow key={card.eventId} card={card} onOpen={() => open(card)} />)}
          </div>
        ) : <Empty text="لا توجد مهام تصوير اليوم." />}
      </section>

      {data.active.length ? (
        <section>
          <h2 className="mb-2 text-sm font-bold text-foreground">قيد التنفيذ</h2>
          <div className="space-y-2">
            {data.active.map((card) => <ShootRow key={card.eventId} card={card} onOpen={() => open(card)} />)}
          </div>
        </section>
      ) : null}

      {data.upcoming.length ? (
        <section>
          <h2 className="mb-2 text-sm font-bold text-foreground">حجوزات قادمة</h2>
          <div className="space-y-2">
            {data.upcoming.map((card) => <ShootRow key={card.eventId} card={card} onOpen={() => open(card)} />)}
          </div>
        </section>
      ) : null}
    </div>
  );
}

// ── List (stage-filtered) ────────────────────────────────────────────────────

export function ShootsListPage() {
  const [, navigate] = useLocation();
  const [rows, setRows] = useState<ShootCard[] | null>(null);
  const [stage, setStage] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      shootApi.list({ stage: stage || undefined, search: search || undefined })
        .then((res) => { if (!cancelled) setRows(res.data); })
        .catch(() => { if (!cancelled) setRows([]); });
    }, search ? 250 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [stage, search]);

  return (
    <div className="space-y-3 p-4">
      {/* Post-production surfaces live one tap away rather than crowding the tab bar. */}
      <nav className="grid grid-cols-3 gap-2">
        {[
          { href: "/staff/photography/editing", label: "المونتاج" },
          { href: "/staff/photography/cards", label: "البطاقات" },
          { href: "/staff/photography/ops-reports", label: "تقارير العمليات" },
        ].map((link) => (
          <button
            key={link.href}
            type="button"
            onClick={() => navigate(link.href)}
            className="min-h-11 rounded-lg border border-border/40 bg-card text-xs font-bold text-foreground"
          >
            {link.label}
          </button>
        ))}
      </nav>
      <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث باسم الزبون أو الموقع" />
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
        <button
          type="button"
          onClick={() => setStage("")}
          className={`flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${stage === "" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground"}`}
        >
          الكل
        </button>
        {SHOOT_STAGES.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setStage(item.key)}
            className={`flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${stage === item.key ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground"}`}
          >
            {item.icon} {item.label}
          </button>
        ))}
      </div>
      {rows === null ? <Spinner /> : rows.length ? (
        <div className="space-y-2">
          {rows.map((card) => (
            <ShootRow key={card.eventId} card={card} onOpen={() => navigate(`/staff/photography/shoots/${card.clientToken}`)} />
          ))}
        </div>
      ) : <Empty text="لا توجد مهام مطابقة." />}
    </div>
  );
}

// ── Detail ───────────────────────────────────────────────────────────────────

export function ShootDetailPage({ shootRef, me }: { shootRef: string; me: AdminMe }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [data, setData] = useState<ShootDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const manager = isManager(me);

  const load = useCallback(() => {
    shootApi.detail(shootRef).then(setData).catch((err) => setError(apiErrorMessage(err)));
  }, [shootRef]);

  useEffect(() => { load(); }, [load]);

  const upcoming = useMemo(() => (data ? nextStage(data.stage) : null), [data]);

  async function advance(target: ShootStage) {
    if (!data) return;
    setBusy(true);
    try {
      // Arriving records where the photographer actually is; a refused permission
      // is not an error — the stage still moves, just without coordinates.
      const position = target === "arrived" ? await readPositionOnce() : null;
      await shootApi.setStage(shootRef, target, position ? { lat: position.lat, lng: position.lng } : {});
      toast({ title: `تم الانتقال إلى «${SHOOT_STAGE_LABEL[target]}»` });
      load();
    } catch (err: any) {
      toast({ title: "تعذّر تغيير المرحلة", description: apiErrorMessage(err), variant: "destructive" });
    } finally { setBusy(false); }
  }

  async function toggleChecklistItem(key: string, value: boolean) {
    if (!data) return;
    const next = { ...data.checklist, [key]: value };
    setData({ ...data, checklist: next });
    try {
      const res = await shootApi.setChecklist(shootRef, next);
      setData((current) => (current ? { ...current, checklist: res.checklist, checklistComplete: res.checklistComplete } : current));
    } catch (err: any) {
      setData((current) => (current ? { ...current, checklist: data.checklist } : current));
      toast({ title: "تعذّر حفظ القائمة", description: apiErrorMessage(err), variant: "destructive" });
    }
  }

  if (error) return <div className="p-4"><Empty text={error} /></div>;
  if (!data) return <Spinner />;

  const checklistDone = CHECKLIST_ITEMS.filter((item) => data.checklist[item.key]).length;
  const blockedByChecklist = upcoming === "on_the_way" && !data.checklistComplete;

  return (
    <div className="space-y-4 p-4">
      <button type="button" onClick={() => navigate("/staff/photography/shoots")} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <ChevronLeft className="h-3.5 w-3.5" /> رجوع للمهام
      </button>

      {/* Header */}
      <header className="rounded-xl border border-border/30 bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold text-foreground">{data.customerName}</h1>
            {data.eventName ? <p className="truncate text-sm text-muted-foreground">{data.eventName}</p> : null}
          </div>
          <StageBadge stage={data.stage} />
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div><dt className="text-muted-foreground">التاريخ</dt><dd className="font-medium tabular-nums">{data.eventDate}{data.eventTime ? ` · ${data.eventTime}` : ""}</dd></div>
          <div><dt className="text-muted-foreground">المصور</dt><dd className="truncate font-medium">{data.assignedStaffName || "—"}</dd></div>
          <div><dt className="text-muted-foreground">الموقع</dt><dd className="truncate font-medium">{data.venue || "غير محدد"}</dd></div>
          <div><dt className="text-muted-foreground">المتبقي</dt><dd className="font-medium tabular-nums">{formatCurrency(data.remainingPayment)}</dd></div>
        </dl>
        {data.mapsUrl ? (
          <a
            href={data.mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border/40 text-sm font-bold text-primary"
          >
            <Navigation className="h-4 w-4" /> فتح في خرائط جوجل
          </a>
        ) : null}
      </header>

      {/* Lifecycle */}
      <section className="rounded-xl border border-border/30 bg-card p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-foreground"><Radio className="h-4 w-4 text-primary" /> مسار المهمة</h2>
        <ol className="space-y-1.5">
          {SHOOT_STAGES.map((item, index) => {
            const currentIndex = SHOOT_STAGES.findIndex((stage) => stage.key === data.stage);
            const done = index < currentIndex;
            const active = index === currentIndex;
            return (
              <li key={item.key} className="flex items-center gap-2 text-xs">
                {done ? <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-status-success" />
                  : active ? <span className="grid h-4 w-4 flex-shrink-0 place-items-center"><span className="h-2.5 w-2.5 rounded-full bg-primary" /></span>
                  : <Circle className="h-4 w-4 flex-shrink-0 text-muted-foreground/40" />}
                <span className={active ? "font-bold text-foreground" : done ? "text-muted-foreground" : "text-muted-foreground/60"}>
                  {item.label}
                </span>
              </li>
            );
          })}
        </ol>
        {upcoming ? (
          <>
            <Button className="mt-4 w-full" disabled={busy || blockedByChecklist} onClick={() => advance(upcoming)}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : `الانتقال إلى «${SHOOT_STAGE_LABEL[upcoming]}»`}
            </Button>
            {blockedByChecklist ? (
              <p className="mt-2 text-center text-[11px] font-medium text-status-warning">
                أكمل قائمة ما قبل التصوير ({checklistDone}/{CHECKLIST_ITEMS.length}) قبل بدء المهمة
              </p>
            ) : null}
          </>
        ) : <p className="mt-4 text-center text-xs font-bold text-status-success">اكتملت المهمة</p>}
        {manager && data.stage !== "assigned" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const currentIndex = SHOOT_STAGES.findIndex((stage) => stage.key === data.stage);
              if (currentIndex > 0) advance(SHOOT_STAGES[currentIndex - 1].key);
            }}
            className="mt-2 flex min-h-11 w-full items-center justify-center gap-1.5 text-xs text-muted-foreground"
          >
            <Undo2 className="h-3.5 w-3.5" /> إرجاع لمرحلة سابقة
          </button>
        ) : null}
      </section>

      {/* Pre-shoot checklist */}
      <section className="rounded-xl border border-border/30 bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-bold text-foreground"><ClipboardCheck className="h-4 w-4 text-primary" /> قائمة ما قبل التصوير</h2>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${data.checklistComplete ? "bg-status-success/15 text-status-success" : "bg-status-warning/15 text-status-warning"}`}>
            {checklistDone}/{CHECKLIST_ITEMS.length}
          </span>
        </div>
        <ul className="space-y-1">
          {CHECKLIST_ITEMS.map((item) => {
            const checked = data.checklist[item.key] === true;
            return (
              <li key={item.key}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-1 text-sm">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => toggleChecklistItem(item.key, event.target.checked)}
                    className="h-5 w-5 flex-shrink-0 accent-primary"
                  />
                  <span className={checked ? "text-muted-foreground line-through" : "text-foreground"}>{item.label}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </section>

      <ShootEquipment shootRef={shootRef} equipment={data.equipment} onChanged={load} />

      <ShootMediaPanel shootRef={shootRef} />

      <ShootGalleryPanel shootRef={shootRef} />

      {/* Crew */}
      {data.crew.length ? (
        <section className="rounded-xl border border-border/30 bg-card p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-foreground"><Users className="h-4 w-4 text-primary" /> الفريق</h2>
          <ul className="space-y-1.5">
            {data.crew.map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">{member.staffName}</span>
                {member.isLead ? <span className="flex-shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-bold text-primary">قائد</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Timeline */}
      <section className="rounded-xl border border-border/30 bg-card p-4">
        <h2 className="mb-3 text-sm font-bold text-foreground">السجل الزمني</h2>
        {data.timeline.length ? (
          <ol className="space-y-3">
            {data.timeline.map((entry) => (
              <li key={entry.id} className="border-r-2 border-border/40 pr-3 text-xs">
                <div className="font-medium text-foreground">
                  {entry.toStage ? SHOOT_STAGE_LABEL[entry.toStage] ?? entry.toStage : entry.type}
                </div>
                <div className="mt-0.5 text-muted-foreground">
                  {entry.staffName} · {new Date(entry.createdAt).toLocaleString("ar-IQ")}
                </div>
                {entry.note ? <div className="mt-0.5 text-muted-foreground">{entry.note}</div> : null}
              </li>
            ))}
          </ol>
        ) : <p className="text-xs text-muted-foreground">لا توجد حركات بعد.</p>}
      </section>
    </div>
  );
}

// ── Equipment ────────────────────────────────────────────────────────────────

function ShootEquipment({
  shootRef, equipment, onChanged,
}: { shootRef: string; equipment: PhotographyAsset[]; onChanged: () => void }) {
  const { toast } = useToast();
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);

  async function operate(payload: Record<string, unknown>, successTitle: string) {
    setBusy(true);
    try {
      await shootApi.equipmentOp(shootRef, payload);
      toast({ title: successTitle });
      onChanged();
    } catch (err: any) {
      toast({ title: "تعذّر تنفيذ العملية", description: apiErrorMessage(err), variant: "destructive" });
    } finally { setBusy(false); }
  }

  return (
    <section className="rounded-xl border border-border/30 bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-foreground"><Boxes className="h-4 w-4 text-primary" /> المعدات</h2>
        <button
          type="button"
          onClick={() => setScanning(true)}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border/40 px-2.5 text-xs font-bold text-primary"
        >
          <QrCode className="h-3.5 w-3.5" /> مسح
        </button>
      </div>

      {scanning ? (
        <div className="mb-3 space-y-2">
          <LiveScanner onDetect={(code) => { setScanning(false); operate({ mode: "link", code }, "تم ربط المعدة"); }} />
          <Button variant="outline" size="sm" className="w-full" onClick={() => setScanning(false)}>إلغاء المسح</Button>
        </div>
      ) : null}

      {equipment.length ? (
        <ul className="space-y-2">
          {equipment.map((asset) => (
            <li key={asset.productId} className="rounded-lg border border-border/30 p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{asset.name}</div>
                  <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">{asset.assetCode}</div>
                </div>
                <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                  asset.checkedOut ? "bg-status-warning/15 text-status-warning"
                  : asset.status === "maintenance" ? "bg-destructive/15 text-destructive"
                  : asset.status === "lost" ? "bg-destructive/15 text-destructive"
                  : "bg-status-success/15 text-status-success"
                }`}>
                  {asset.checkedOut ? "بالعهدة" : asset.status === "maintenance" ? "صيانة" : asset.status === "lost" ? "مفقود" : "متاح"}
                </span>
              </div>
              <div className="mt-2 flex gap-2">
                {asset.checkedOut ? (
                  <>
                    <Button size="sm" variant="outline" className="flex-1" disabled={busy}
                      onClick={() => operate({ mode: "return", productId: asset.productId, problem: "none" }, "تم إرجاع المعدة")}>
                      إرجاع
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1 text-destructive" disabled={busy}
                      onClick={() => {
                        const note = window.prompt("صف العطل أو التلف:");
                        if (note === null) return;
                        operate({ mode: "return", productId: asset.productId, problem: "broken", note }, "تم تسجيل بلاغ الصيانة");
                      }}>
                      بلاغ تلف
                    </Button>
                  </>
                ) : (
                  <Button size="sm" className="flex-1" disabled={busy}
                    onClick={() => operate({ mode: "checkout", productId: asset.productId }, "تم إخراج المعدة بعهدتك")}>
                    إخراج بعهدتي
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="text-xs text-muted-foreground">لم تُربط أي معدات بعد. استخدم زر المسح لإضافة معدة.</p>}
    </section>
  );
}
