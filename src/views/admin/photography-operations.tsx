import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Camera, Clapperboard, Gauge, HardDrive, Loader2, Radio, TrendingUp } from "lucide-react";
import { adminFetch } from "./_lib";
import { Input } from "@/components/ui/input";

/**
 * Manager view over photography field operations.
 *
 * Read-only, and deliberately built on the SAME endpoints the staff portal uses — no new
 * server surface, no duplicated aggregation, so the two can never disagree. Actions stay
 * in the portal where the crew already works.
 */

const SHOOT_STAGES: Array<{ key: string; label: string }> = [
  { key: "assigned", label: "مُسند" },
  { key: "preparing", label: "قيد التحضير" },
  { key: "on_the_way", label: "في الطريق" },
  { key: "arrived", label: "وصل الموقع" },
  { key: "shooting", label: "قيد التصوير" },
  { key: "uploading", label: "رفع الملفات" },
  { key: "editing", label: "قيد المونتاج" },
  { key: "ready_for_review", label: "جاهز للمراجعة" },
  { key: "delivered", label: "تم التسليم" },
  { key: "completed", label: "مكتمل" },
];

const EDIT_STATUSES: Array<{ key: string; label: string }> = [
  { key: "waiting", label: "بالانتظار" },
  { key: "copying_files", label: "نسخ الملفات" },
  { key: "editing", label: "قيد المونتاج" },
  { key: "color_correction", label: "تصحيح الألوان" },
  { key: "exporting", label: "التصدير" },
  { key: "quality_check", label: "فحص الجودة" },
  { key: "ready", label: "جاهز" },
  { key: "delivered", label: "تم التسليم" },
];

type Board = {
  today: string;
  stageCounts: Record<string, number>;
  todayAssignments: any[];
  upcoming: any[];
  active: any[];
  pendingUploads: number;
  pendingEditing: number;
  completed: number;
  total: number;
};

type OpsReport = {
  totals: {
    events: number; shoots: number; completed: number; delivered: number;
    photos: number; videos: number; files: number; bytes: number; sizeLabel: string;
  };
  media: Record<string, { files: number; bytes: number }>;
  turnaround: { shootToDeliveryHours: number | null; editingHours: number | null };
  photographers: Array<{ staffId: number; name: string; shoots: number; completed: number }>;
  editors: Array<{ staffId: number; name: string; projects: number; avgTurnaroundHours: number | null }>;
};

function PageHeader({ icon: Icon, title, description }: { icon: any; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <h1 className="text-lg font-bold text-foreground">{title}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function Stat({ label, value, tone = "text-foreground" }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border/40 bg-card p-3">
      <div className={`text-2xl font-bold tabular-nums ${tone}`}>{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-lg border border-dashed border-border/50 p-6 text-center text-sm text-muted-foreground">{text}</p>;
}

export default function PhotographyOperationsPage() {
  const [range, setRange] = useState({ from: "", to: "" });

  const boardQuery = useQuery<Board>({
    queryKey: ["admin", "photography-ops", "board"],
    queryFn: () => adminFetch("/staff/photography/board"),
  });
  const editQuery = useQuery<{ data: any[]; statusCounts: Record<string, number> }>({
    queryKey: ["admin", "photography-ops", "editing"],
    queryFn: () => adminFetch("/staff/photography/editing"),
  });
  const cardsQuery = useQuery<{ data: any[] }>({
    queryKey: ["admin", "photography-ops", "cards"],
    queryFn: () => adminFetch("/staff/photography/cards"),
  });
  const reportQuery = useQuery<OpsReport>({
    queryKey: ["admin", "photography-ops", "report", range.from, range.to],
    queryFn: () => {
      const params = new URLSearchParams();
      if (range.from) params.set("from", range.from);
      if (range.to) params.set("to", range.to);
      const query = params.toString();
      return adminFetch(`/staff/photography/ops-reports${query ? `?${query}` : ""}`);
    },
  });

  const board = boardQuery.data;
  const report = reportQuery.data;

  // Cards still out in the field are the ones a manager needs to chase.
  const outstandingCards = useMemo(
    () => (cardsQuery.data?.data ?? []).filter((card) => !["available", "returned"].includes(card.status)),
    [cardsQuery.data],
  );

  const loading = boardQuery.isLoading || reportQuery.isLoading;
  const hours = (value: number | null | undefined) =>
    value === null || value === undefined ? "—" : `${value} ساعة`;

  return (
    <div className="space-y-4" dir="rtl">
      <PageHeader
        icon={Camera}
        title="عمليات التصوير"
        description="متابعة المهام الميدانية وغرفة المونتاج وبطاقات الذاكرة."
      />

      {loading ? (
        <div className="py-12 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Stat label="مهام اليوم" value={board?.todayAssignments.length ?? 0} tone="text-primary" />
            <Stat label="قيد التنفيذ" value={board?.active.length ?? 0} tone="text-accent" />
            <Stat label="بانتظار الرفع" value={board?.pendingUploads ?? 0} tone="text-status-warning" />
            <Stat label="بانتظار المونتاج" value={board?.pendingEditing ?? 0} tone="text-status-warning" />
            <Stat label="مكتملة" value={board?.completed ?? 0} tone="text-status-success" />
          </div>

          {/* Stage distribution — where the pipeline is congested. */}
          <section className="rounded-xl border border-border/40 bg-card p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold"><Radio className="h-4 w-4 text-primary" /> توزيع المراحل</h2>
            <div className="flex flex-wrap gap-2">
              {SHOOT_STAGES.map((stage) => (
                <span
                  key={stage.key}
                  className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                    (board?.stageCounts?.[stage.key] ?? 0) > 0
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {stage.label}
                  <span className="ms-1.5 tabular-nums">{board?.stageCounts?.[stage.key] ?? 0}</span>
                </span>
              ))}
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-border/40 bg-card p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold"><Clapperboard className="h-4 w-4 text-primary" /> غرفة المونتاج</h2>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {EDIT_STATUSES.map((status) => (
                  <span key={status.key} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    {status.label}
                    <span className="ms-1 tabular-nums">{editQuery.data?.statusCounts?.[status.key] ?? 0}</span>
                  </span>
                ))}
              </div>
              {editQuery.data?.data.length ? (
                <ul className="space-y-1.5">
                  {editQuery.data.data.slice(0, 10).map((project) => (
                    <li key={project.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate">{project.customerName}</span>
                      <span className="flex-shrink-0 text-muted-foreground">
                        {project.statusLabel}{project.editorName ? ` · ${project.editorName}` : " · بلا مونتير"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : <Empty text="لا توجد مشاريع مونتاج." />}
            </section>

            <section className="rounded-xl border border-border/40 bg-card p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold"><HardDrive className="h-4 w-4 text-primary" /> بطاقات خارج المخزن</h2>
              {outstandingCards.length ? (
                <ul className="space-y-1.5">
                  {outstandingCards.map((card) => (
                    <li key={card.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate">
                        {card.label}
                        {card.photographerName ? ` · ${card.photographerName}` : ""}
                      </span>
                      <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${card.status === "damaged" ? "bg-destructive/15 text-destructive" : "bg-status-warning/15 text-status-warning"}`}>
                        {card.statusLabel}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : <Empty text="كل البطاقات في المخزن." />}
            </section>
          </div>

          <section className="rounded-xl border border-border/40 bg-card p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-bold"><Gauge className="h-4 w-4 text-primary" /> الأداء</h2>
              <div className="flex gap-2">
                <Input type="date" value={range.from} onChange={(event) => setRange({ ...range, from: event.target.value })} className="h-9 w-40" />
                <Input type="date" value={range.to} onChange={(event) => setRange({ ...range, to: event.target.value })} className="h-9 w-40" />
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <div><dt className="text-muted-foreground">المناسبات</dt><dd className="text-lg font-bold tabular-nums">{report?.totals.events ?? 0}</dd></div>
              <div><dt className="text-muted-foreground">صور</dt><dd className="text-lg font-bold tabular-nums">{report?.totals.photos ?? 0}</dd></div>
              <div><dt className="text-muted-foreground">فيديو</dt><dd className="text-lg font-bold tabular-nums">{report?.totals.videos ?? 0}</dd></div>
              <div><dt className="text-muted-foreground">حجم الملفات</dt><dd className="text-lg font-bold tabular-nums">{report?.totals.sizeLabel ?? "0 B"}</dd></div>
              <div><dt className="text-muted-foreground">من التصوير للتسليم</dt><dd className="font-bold tabular-nums">{hours(report?.turnaround.shootToDeliveryHours)}</dd></div>
              <div><dt className="text-muted-foreground">مدة المونتاج</dt><dd className="font-bold tabular-nums">{hours(report?.turnaround.editingHours)}</dd></div>
            </dl>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-border/40 bg-card p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold"><TrendingUp className="h-4 w-4 text-primary" /> إنتاجية المصورين</h2>
              {report?.photographers.length ? (
                <ul className="space-y-1.5">
                  {report.photographers.map((row) => (
                    <li key={row.staffId} className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate">{row.name}</span>
                      <span className="flex-shrink-0 tabular-nums text-muted-foreground">{row.completed}/{row.shoots} مكتملة</span>
                    </li>
                  ))}
                </ul>
              ) : <Empty text="لا توجد بيانات." />}
            </section>

            <section className="rounded-xl border border-border/40 bg-card p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold"><Clapperboard className="h-4 w-4 text-primary" /> أداء المونتيرين</h2>
              {report?.editors.length ? (
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
              ) : <Empty text="لا توجد بيانات." />}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
