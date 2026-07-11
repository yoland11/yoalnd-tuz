import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Award, FileDown, Loader2, Medal, ShieldAlert, Star, TrendingUp, Trophy, X,
} from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { downloadElementPdf } from "@/lib/pdf";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, apiErrorMessage, formatCurrency, type AdminMe } from "./_lib";
import { EmptyState } from "./_layout";

type Category = "commitment" | "speed" | "errors" | "assetCare" | "profit" | "satisfaction";
type Level = "elite" | "excellent" | "good" | "improve" | "poor";

type Details = {
  present: number; late: number; absent: number;
  tasksAssigned: number; tasksCompleted: number; tasksMissed: number; tasksLate: number;
  avgCompleteHours: number; onTimeRate: number;
  errorEvents: number; negativeReviews: number;
  brokenAssets: number; lostAssets: number; repairCost: number;
  jobsCompleted: number; revenue: number; salesRevenue: number; avgPerJob: number;
  reviewsCount: number; avgRating: number; positiveReviews: number; recommendRate: number;
};
type EmployeeScore = {
  staffId: number; name: string; role: string; department: string;
  categories: Record<Category, number>;
  overall: number; baseOverall: number; adjustment: number;
  level: Level; suspended: boolean; rank: number; details: Details;
};
type Leaderboard = { key: string; label: string; icon: string; staffId: number | null; name: string; score: number; metric: string };
type Overview = {
  employees: EmployeeScore[];
  leaderboards: Leaderboard[];
  levelLabels: Record<Level, string>;
  departments: Array<{ department: string; count: number; avg: number }>;
};
type Profile = EmployeeScore & {
  info: { id: number; name: string; username: string; role: string; permissions: string[]; isActive: boolean; createdAt: string; lastActivityAt: string | null };
  actions: Array<{ id: number; kind: string; points: number; title: string | null; note: string | null; by: string; at: string }>;
  timeline: Array<{ type: string; title: string; body: string | null; at: string }>;
  reviews: Array<{ rating: number; comment: string | null; kind: string; at: string }>;
  damageHistory: Array<{ name: string; status: string; cost: number }>;
};

const CATS: Array<{ key: Category; label: string; emoji: string }> = [
  { key: "commitment", label: "الالتزام", emoji: "✅" },
  { key: "speed", label: "السرعة", emoji: "⚡" },
  { key: "errors", label: "قلة الأخطاء", emoji: "❌" },
  { key: "assetCare", label: "العناية بالأصول", emoji: "🔨" },
  { key: "profit", label: "المساهمة بالربح", emoji: "💰" },
  { key: "satisfaction", label: "رضا العملاء", emoji: "😊" },
];

const LEVELS: Record<Level, { label: string; emoji: string; cls: string }> = {
  elite: { label: "النخبة", emoji: "🥇", cls: "bg-amber-500/15 text-amber-500 border-amber-500/40" },
  excellent: { label: "ممتاز", emoji: "🥈", cls: "bg-primary/15 text-primary border-primary/40" },
  good: { label: "جيد", emoji: "🥉", cls: "bg-status-success/15 text-status-success border-status-success/40" },
  improve: { label: "يحتاج تحسين", emoji: "⚠️", cls: "bg-status-warning/15 text-status-warning border-status-warning/40" },
  poor: { label: "ضعيف", emoji: "❌", cls: "bg-destructive/15 text-destructive border-destructive/40" },
};

function scoreColor(v: number): string {
  if (v >= 90) return "text-amber-500";
  if (v >= 80) return "text-primary";
  if (v >= 70) return "text-status-success";
  if (v >= 60) return "text-status-warning";
  return "text-destructive";
}
function barColor(v: number): string {
  if (v >= 90) return "bg-amber-500";
  if (v >= 80) return "bg-primary";
  if (v >= 70) return "bg-status-success";
  if (v >= 60) return "bg-status-warning";
  return "bg-destructive";
}

function CategoryBar({ label, emoji, value }: { label: string; emoji: string; value: number }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-foreground">{emoji} {label}</span>
        <span className={`font-bold ${scoreColor(value)}`}>{value}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${barColor(value)}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function LevelBadge({ level, labels }: { level: Level; labels?: Record<Level, string> }) {
  const l = LEVELS[level];
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${l.cls}`}>{l.emoji} {labels?.[level] ?? l.label}</span>;
}

export default function EmployeePerformancePage({ me }: { me: AdminMe }) {
  const isManager = me.role === "admin" || me.role === "manager";
  const [selected, setSelected] = useState<number | null>(null);

  const overview = useQuery({
    queryKey: ["admin", "employee-performance"],
    queryFn: () => adminFetch<Overview>("/admin/employee-performance"),
    refetchInterval: 60_000,
  });

  const employees = useMemo(
    () => (overview.data?.employees ?? []).slice().sort((a, b) => (a.suspended === b.suspended ? b.overall - a.overall : a.suspended ? 1 : -1)),
    [overview.data],
  );
  const active = employees.filter((e) => !e.suspended);
  const top10 = active.slice(0, 10).map((e) => ({ name: e.name.split(" ").slice(0, 2).join(" "), score: e.overall }));

  if (overview.isLoading) {
    return <div className="space-y-4"><Skeleton className="h-28 rounded-xl" /><Skeleton className="h-64 rounded-xl" /><Skeleton className="h-80 rounded-xl" /></div>;
  }

  return (
    <div className="space-y-5" dir="rtl">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground"><Trophy className="h-6 w-6 text-amber-500" /> أداء الموظفين</h1>
        <p className="mt-1 text-sm text-muted-foreground">تقييم تلقائي (0–100) من الحضور والمهام والمالية والأصول والتقييمات — آخر 12 شهراً.</p>
      </div>

      {/* Leaderboards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {(overview.data?.leaderboards ?? []).map((lb) => (
          <button
            key={lb.key}
            type="button"
            onClick={() => lb.staffId && setSelected(lb.staffId)}
            className="rounded-xl border border-border/30 bg-card p-3 text-right transition-colors hover:border-primary/40"
          >
            <div className="text-2xl">{lb.icon}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">{lb.label}</div>
            <div className="mt-0.5 truncate text-sm font-bold text-foreground">{lb.name}</div>
            <div className={`mt-1 text-xs font-bold ${scoreColor(lb.score)}`}>{lb.metric}: {lb.score}%</div>
          </button>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        {/* Top 10 chart */}
        <div className="rounded-xl border border-border/30 bg-card p-4">
          <h2 className="mb-3 flex items-center gap-2 font-semibold text-foreground"><Medal className="h-4 w-4 text-amber-500" /> أفضل 10 موظفين</h2>
          {top10.length === 0 ? <EmptyState message="لا توجد بيانات كافية" /> : (
            <div className="h-72" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={top10} layout="vertical" margin={{ left: 10, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={90} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                  <Bar dataKey="score" name="النتيجة" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Department comparison */}
        <div className="rounded-xl border border-border/30 bg-card p-4">
          <h2 className="mb-3 flex items-center gap-2 font-semibold text-foreground"><TrendingUp className="h-4 w-4 text-primary" /> مقارنة الأقسام</h2>
          {(overview.data?.departments ?? []).length === 0 ? <EmptyState message="لا توجد بيانات" /> : (
            <div className="space-y-2">
              {(overview.data?.departments ?? []).sort((a, b) => b.avg - a.avg).map((d) => (
                <div key={d.department} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 truncate text-sm text-foreground">{d.department}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className={`h-full rounded-full ${barColor(d.avg)}`} style={{ width: `${d.avg}%` }} />
                  </div>
                  <span className={`w-12 shrink-0 text-right text-sm font-bold ${scoreColor(d.avg)}`}>{d.avg}%</span>
                  <span className="w-14 shrink-0 text-left text-[11px] text-muted-foreground">{d.count} موظف</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Ranking table */}
      <div className="overflow-x-auto rounded-xl border border-border/30 bg-card">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-border/30 text-xs text-muted-foreground">
              {["#", "الموظف", "القسم", ...CATS.map((c) => c.emoji), "النتيجة", "المستوى", ""].map((h, i) => (
                <th key={i} className="px-3 py-3 text-center font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.staffId} className={`border-b border-border/15 transition-colors hover:bg-primary/[0.025] ${e.suspended ? "opacity-50" : ""}`}>
                <td className="px-3 py-3 text-center font-bold text-muted-foreground">{e.suspended ? "—" : e.rank}</td>
                <td className="px-3 py-3 text-center font-medium text-foreground">
                  <button onClick={() => setSelected(e.staffId)} className="hover:text-primary hover:underline">{e.name}</button>
                  {e.adjustment !== 0 && <span className={`ms-1 text-[11px] ${e.adjustment > 0 ? "text-status-success" : "text-destructive"}`}>({e.adjustment > 0 ? "+" : ""}{e.adjustment})</span>}
                </td>
                <td className="px-3 py-3 text-center text-xs text-muted-foreground">{e.department}</td>
                {CATS.map((c) => <td key={c.key} className={`px-3 py-3 text-center text-xs font-bold ${scoreColor(e.categories[c.key])}`}>{e.categories[c.key]}</td>)}
                <td className={`px-3 py-3 text-center text-lg font-extrabold ${scoreColor(e.overall)}`}>{e.overall}</td>
                <td className="px-3 py-3 text-center"><LevelBadge level={e.level} labels={overview.data?.levelLabels} /></td>
                <td className="px-3 py-3 text-center"><Button size="sm" variant="outline" onClick={() => setSelected(e.staffId)}>الملف</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={selected !== null} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-h-[90dvh] max-w-4xl overflow-y-auto" dir="rtl">
          <DialogHeader><DialogTitle>ملف أداء الموظف</DialogTitle></DialogHeader>
          {selected !== null && <ProfilePanel staffId={selected} isManager={isManager} levelLabels={overview.data?.levelLabels} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProfilePanel({ staffId, isManager, levelLabels }: { staffId: number; isManager: boolean; levelLabels?: Record<Level, string> }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const reportRef = useRef<HTMLDivElement>(null);
  const [gran, setGran] = useState<"week" | "month" | "year">("month");
  const [form, setForm] = useState({ kind: "note", points: "", title: "", note: "" });

  const profile = useQuery({
    queryKey: ["admin", "employee-performance", staffId],
    queryFn: () => adminFetch<Profile>(`/admin/employee-performance/${staffId}`),
  });
  const trends = useQuery({
    queryKey: ["admin", "employee-performance", staffId, "trends", gran],
    queryFn: () => adminFetch<{ trends: Array<{ period: string; revenue: number; jobs: number }> }>(`/admin/employee-performance/trends?staffId=${staffId}&granularity=${gran}`),
  });
  const action = useMutation({
    mutationFn: (payload: Record<string, unknown>) => adminFetch(`/admin/employee-performance/${staffId}/actions`, { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "employee-performance"] });
      setForm({ kind: "note", points: "", title: "", note: "" });
      toast({ title: "تم تسجيل الإجراء" });
    },
    onError: (err: Error) => toast({ title: "تعذّر التنفيذ", description: apiErrorMessage(err), variant: "destructive" }),
  });

  if (profile.isLoading || !profile.data) return <Skeleton className="h-96 rounded-xl" />;
  const p = profile.data;
  const d = p.details;

  const metrics: Array<[string, string]> = [
    ["المهام المسندة", String(d.tasksAssigned)],
    ["المهام المنجزة", String(d.tasksCompleted)],
    ["المهام المتأخرة/الفائتة", String(d.tasksMissed)],
    ["الحضور / التأخير / الغياب", `${d.present} / ${d.late} / ${d.absent}`],
    ["الأعمال المكتملة (مالياً)", String(d.jobsCompleted)],
    ["الإيراد المُولّد", formatCurrency(d.revenue)],
    ["متوسط الإيراد لكل عمل", formatCurrency(d.avgPerJob)],
    ["مساهمة المبيعات", formatCurrency(d.salesRevenue)],
    ["أصول مكسورة / مفقودة", `${d.brokenAssets} / ${d.lostAssets}`],
    ["تكلفة الإصلاحات", formatCurrency(d.repairCost)],
    ["عدد التقييمات", String(d.reviewsCount)],
    ["متوسط التقييم", `${d.avgRating.toFixed(1)} / 5 ⭐`],
    ["نسبة التوصية", `${Math.round(d.recommendRate * 100)}%`],
    ["متوسط زمن إنجاز المهمة", d.avgCompleteHours ? `${d.avgCompleteHours.toFixed(1)} ساعة` : "—"],
  ];

  return (
    <div className="space-y-4">
      <div ref={reportRef} className="space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-background/55 p-4">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold text-foreground">{p.info.name}</h3>
              <LevelBadge level={p.level} labels={levelLabels} />
              {p.suspended && <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-bold text-destructive">التقييم موقوف</span>}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{p.department} · @{p.info.username} · الترتيب #{p.rank}</p>
          </div>
          <div className="text-center">
            <div className={`text-4xl font-extrabold ${scoreColor(p.overall)}`}>{p.overall}</div>
            <div className="text-[11px] text-muted-foreground">من 100{p.adjustment !== 0 ? ` (تعديل ${p.adjustment > 0 ? "+" : ""}${p.adjustment})` : ""}</div>
          </div>
        </div>

        {/* Category bars */}
        <div className="grid gap-3 rounded-xl border border-border/30 bg-card p-4 sm:grid-cols-2">
          {CATS.map((c) => <CategoryBar key={c.key} label={c.label} emoji={c.emoji} value={p.categories[c.key]} />)}
        </div>

        {/* Metrics grid */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {metrics.map(([k, v]) => (
            <div key={k} className="rounded-lg bg-background/55 p-2.5">
              <div className="text-[11px] text-muted-foreground">{k}</div>
              <div className="mt-0.5 text-sm font-bold text-foreground">{v}</div>
            </div>
          ))}
        </div>

        {/* Trends */}
        <div className="rounded-xl border border-border/30 bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground"><TrendingUp className="h-4 w-4 text-primary" /> اتجاه الأداء المالي</h4>
            <div className="flex rounded-lg border border-border/40">
              {(["week", "month", "year"] as const).map((g) => (
                <button key={g} type="button" onClick={() => setGran(g)} className={`px-2.5 py-1 text-xs font-medium ${gran === g ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
                  {g === "week" ? "أسبوعي" : g === "month" ? "شهري" : "سنوي"}
                </button>
              ))}
            </div>
          </div>
          {(trends.data?.trends ?? []).length === 0 ? <EmptyState message="لا توجد حركات مالية" /> : (
            <div className="h-56" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trends.data?.trends ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="period" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} formatter={(v: any) => formatCurrency(Number(v))} />
                  <Legend />
                  <Line type="monotone" dataKey="revenue" name="الإيراد" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          {/* Damage history */}
          <div className="rounded-xl border border-border/30 bg-card p-4">
            <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground"><ShieldAlert className="h-4 w-4 text-status-warning" /> سجل الأضرار</h4>
            {p.damageHistory.length === 0 ? <p className="text-xs text-muted-foreground">لا توجد أضرار مسجّلة 🎉</p> : (
              <div className="space-y-1.5">
                {p.damageHistory.map((h, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg bg-background/55 px-2.5 py-1.5 text-xs">
                    <span className="truncate text-foreground">{h.name}</span>
                    <span className="flex items-center gap-2"><span className={h.status === "lost" ? "text-destructive" : "text-status-warning"}>{h.status === "lost" ? "مفقود" : "صيانة"}</span>{h.cost > 0 && <span className="text-muted-foreground">{formatCurrency(h.cost)}</span>}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Reviews */}
          <div className="rounded-xl border border-border/30 bg-card p-4">
            <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground"><Star className="h-4 w-4 text-amber-500" /> تقييمات العملاء</h4>
            {p.reviews.length === 0 ? <p className="text-xs text-muted-foreground">لا توجد تقييمات بعد</p> : (
              <div className="space-y-1.5">
                {p.reviews.slice(0, 6).map((r, i) => (
                  <div key={i} className="rounded-lg bg-background/55 px-2.5 py-1.5 text-xs">
                    <div className="flex items-center gap-1 text-amber-500">{"★".repeat(r.rating)}<span className="text-muted-foreground">{"☆".repeat(5 - r.rating)}</span></div>
                    {r.comment && <p className="mt-0.5 text-foreground">{r.comment}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Awards & actions log */}
        {p.actions.length > 0 && (
          <div className="rounded-xl border border-border/30 bg-card p-4">
            <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground"><Award className="h-4 w-4 text-amber-500" /> المكافآت والملاحظات والإجراءات</h4>
            <div className="space-y-1.5">
              {p.actions.map((a) => (
                <div key={a.id} className="flex items-start justify-between gap-3 rounded-lg bg-background/55 px-2.5 py-1.5 text-xs">
                  <div>
                    <span className="font-bold text-foreground">{ACTION_LABEL[a.kind] ?? a.kind}{a.points ? ` (${a.points})` : ""}</span>
                    {a.title && <span className="text-foreground"> — {a.title}</span>}
                    {a.note && <p className="text-muted-foreground">{a.note}</p>}
                  </div>
                  <span className="shrink-0 text-muted-foreground">{a.by} · {new Date(a.at).toLocaleDateString("ar-IQ")}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Manager actions + export */}
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => reportRef.current && downloadElementPdf(reportRef.current, `performance-${p.info.username}.pdf`)}>
          <FileDown className="h-4 w-4" /> تصدير PDF
        </Button>
      </div>

      {isManager && (
        <div className="rounded-xl border border-primary/25 bg-card p-4 print:hidden">
          <h4 className="mb-3 text-sm font-semibold text-foreground">إجراء إداري</h4>
          <div className="grid gap-2 sm:grid-cols-2">
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className="h-10 rounded-lg border border-border/40 bg-background px-3 text-sm">
              <option value="note">ملاحظة</option>
              <option value="reward">مكافأة (+نقاط)</option>
              <option value="bonus">علاوة (+نقاط)</option>
              <option value="penalty">عقوبة (−نقاط)</option>
              <option value={p.suspended ? "unsuspend" : "suspend"}>{p.suspended ? "استئناف التقييم" : "إيقاف التقييم"}</option>
            </select>
            {(form.kind === "reward" || form.kind === "bonus" || form.kind === "penalty") && (
              <input type="number" min={0} max={20} value={form.points} onChange={(e) => setForm({ ...form, points: e.target.value })} placeholder="النقاط (0–20)" className="h-10 rounded-lg border border-border/40 bg-background px-3 text-sm" />
            )}
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="العنوان" className="h-10 rounded-lg border border-border/40 bg-background px-3 text-sm" />
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="ملاحظة (اختياري)" className="h-10 rounded-lg border border-border/40 bg-background px-3 text-sm" />
          </div>
          <Button size="sm" className="mt-3 gap-1.5" disabled={action.isPending} onClick={() => action.mutate({ kind: form.kind, points: Number(form.points) || 0, title: form.title || undefined, note: form.note || undefined })}>
            {action.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="hidden" />} تسجيل الإجراء
          </Button>
        </div>
      )}
    </div>
  );
}

const ACTION_LABEL: Record<string, string> = {
  note: "ملاحظة", reward: "مكافأة", penalty: "عقوبة", bonus: "علاوة", suspend: "إيقاف التقييم", unsuspend: "استئناف التقييم",
};
