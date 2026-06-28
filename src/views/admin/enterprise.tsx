import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Boxes,
  BrainCircuit,
  Building2,
  CalendarClock,
  Car,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  CloudRain,
  Gauge,
  History,
  Images,
  Loader2,
  MapPin,
  MessageSquare,
  PackageCheck,
  PenLine,
  RefreshCw,
  Route,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  Timer,
  Trash2,
  Upload,
  UserRound,
  Users,
  Wallet,
  Warehouse,
  Wrench,
  X,
  HeartPulse,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, apiErrorMessage, compressImageFile, formatCurrency } from "./_lib";
import { EmptyState } from "./_layout";

type CommandCenter = {
  generatedAt: string;
  summary: Record<string, number>;
  branches: Array<{ id: number; name: string; city?: string | null; latitude?: number | null; longitude?: number | null }>;
  vehicles: Array<{ id: number; name: string; plateNumber: string; status: string; latitude?: number | null; longitude?: number | null }>;
  locations: Array<{ id: number; resourceType: string; resourceId: number; resourceName: string; status: string; latitude: number; longitude: number; recordedAt: string }>;
  upcoming: Array<{ id: number; type: string; title: string; subtitle: string; eventAt: string; status: string; href: string }>;
  tasks: Array<{ id: number; title: string; status: string; priority: string; dueAt?: string | null }>;
  alerts: Array<{ id: number; title: string; body?: string; type: string; href?: string }>;
};

type QueueRow = { id: number; queueNo: string; customerName: string; phone?: string | null; serviceType: string; status: string; waitMinutes: number; arrivedAt: string };
type AssetRow = { id: number; productId: number; productName: string; stock: number; shelfCode?: string | null; lastLocation?: string | null; usageCount: number; revenueTotal: number; maintenanceCost: number; profit: number; roi: number; purchasePrice?: number; currentValue?: number; assetStatus?: string; custody?: Array<{ staffName?: string | null; staffId?: number | null }> };
type Intelligence = {
  kpis: { totalWork: number; completionRate: number; averageRevenue: number; customerSatisfaction: number; lostMinutes: number; stockMovements: number };
  smartPricing: { min: number; max: number; average: number };
  itemProfit: AssetRow[];
  recommendations: Array<{ type: string; severity: string; title: string; reason: string; productId: number }>;
  marketing: Array<{ source: string; count: number }>;
  lostTime: Array<{ reason: string; minutes: number }>;
};

const TABS = [
  { value: "overview", label: "مركز القيادة", icon: Gauge },
  { value: "operations", label: "العمليات الحية", icon: Route },
  { value: "queue", label: "الطابور", icon: Users },
  { value: "assets", label: "الأصول", icon: Boxes },
  { value: "intelligence", label: "الذكاء والتحليل", icon: BrainCircuit },
  { value: "knowledge", label: "المعرفة", icon: BookOpen },
  { value: "closing", label: "إغلاق اليوم", icon: ClipboardCheck },
] as const;

const STATUS_LABELS: Record<string, string> = {
  waiting: "بانتظار الخدمة",
  serving: "قيد الخدمة",
  completed: "مكتمل",
  cancelled: "ملغي",
  available: "متاح",
  outside: "بالخارج",
  maintenance: "صيانة",
  new: "جديد",
  pending: "قيد الانتظار",
  active: "نشط",
};

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-border/30 bg-card p-4 ${className}`}>{children}</section>;
}

function SectionTitle({ icon: Icon, title, description }: { icon: typeof Gauge; title: string; description?: string }) {
  return (
    <div className="mb-4 flex min-w-0 items-start gap-2.5">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="h-4 w-4" /></span>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {description ? <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p> : null}
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value, warning = false }: { icon: typeof Gauge; label: string; value: React.ReactNode; warning?: boolean }) {
  return (
    <div className={`rounded-xl border bg-card p-4 transition-colors ${warning ? "border-destructive/30" : "border-border/30 hover:border-primary/30"}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{label}</p>
        <Icon className={`h-4 w-4 shrink-0 ${warning ? "text-destructive" : "text-primary"}`} />
      </div>
      <p className="mt-3 truncate text-xl font-bold text-foreground">{value}</p>
    </div>
  );
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ar-IQ", { dateStyle: "medium", timeStyle: "short" });
}

function Countdown({ value }: { value: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const timer = window.setInterval(() => setNow(Date.now()), media.matches ? 60_000 : 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const target = new Date(value).getTime();
  const remaining = target - now;
  if (!Number.isFinite(target) || remaining <= 0) return <span className="text-xs text-muted-foreground">انتهى الوقت</span>;
  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.floor((remaining % 86_400_000) / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  return <span className="font-mono text-xs text-primary" dir="rtl">{days} يوم · {hours} ساعة · {minutes} دقيقة</span>;
}

function LoadingGrid() {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-24 rounded-xl" />)}</div>;
}

function Empty({ message }: { message: string }) {
  return <EmptyState message={message} />;
}

export default function EnterpriseCommandCenterPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["value"]>("overview");
  const queryClient = useQueryClient();
  const command = useQuery<CommandCenter>({
    queryKey: ["admin", "enterprise", "command-center"],
    queryFn: () => adminFetch("/admin/enterprise/command-center"),
    staleTime: 20_000,
    refetchInterval: 30_000,
  });
  const risks = useQuery<any>({
    queryKey: ["admin", "enterprise", "risks"],
    queryFn: () => adminFetch("/admin/enterprise/risks"),
    enabled: tab === "overview" || tab === "operations",
    staleTime: 30_000,
  });
  const summary = command.data?.summary ?? {};

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin", "enterprise"] });

  return (
    <div className="space-y-5" dir="rtl">
      <header className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 truncate text-2xl font-bold text-foreground"><Gauge className="h-6 w-6 shrink-0 text-primary" />مركز القيادة المؤسسي</h1>
          <p className="mt-1 text-sm text-muted-foreground">نظرة تشغيلية موحدة على الحجوزات والفرق والمركبات والمخزون والمال.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link href="/admin/smart-search"><Button variant="outline" size="sm" className="gap-2"><Search className="h-4 w-4" />البحث الذكي</Button></Link>
          <Button variant="outline" size="icon" onClick={refresh} disabled={command.isFetching} title="تحديث البيانات"><RefreshCw className={`h-4 w-4 ${command.isFetching ? "animate-spin" : ""}`} /></Button>
        </div>
      </header>

      <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)} dir="rtl">
        <div className="overflow-x-auto pb-1">
          <TabsList className="h-auto min-w-max justify-start gap-1 bg-muted/60 p-1">
            {TABS.map(({ value, label, icon: Icon }) => <TabsTrigger key={value} value={value} className="gap-2 px-3 py-2"><Icon className="h-4 w-4" />{label}</TabsTrigger>)}
          </TabsList>
        </div>

        <TabsContent value="overview" className="space-y-4">
          {command.isLoading ? <LoadingGrid /> : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <Metric icon={PackageCheck} label="الكوشات المنصبة" value={summary.koshasInstalled ?? 0} />
              <Metric icon={Users} label="فرق التصوير" value={summary.photographyTeams ?? 0} />
              <Metric icon={Users} label="فرق الكوشات" value={summary.koshaTeams ?? 0} />
              <Metric icon={Car} label="سيارات بالخارج" value={summary.vehiclesOutside ?? 0} />
              <Metric icon={CalendarClock} label="حجوزات اليوم" value={summary.bookingsToday ?? 0} />
              <Metric icon={Boxes} label="مواد مؤجرة" value={summary.rentedItems ?? 0} />
              <Metric icon={AlertTriangle} label="مواد متأخرة" value={summary.overdueItems ?? 0} warning={Boolean(summary.overdueItems)} />
              <Metric icon={Wallet} label="المبالغ المستحقة" value={formatCurrency(summary.outstandingAmount ?? 0)} warning={Boolean(summary.outstandingAmount)} />
              <Metric icon={BarChart3} label="ربح اليوم" value={formatCurrency(summary.todayProfit ?? 0)} />
              <Metric icon={ShieldAlert} label="تنبيهات حرجة" value={summary.criticalAlerts ?? 0} warning={Boolean(summary.criticalAlerts)} />
              <Metric icon={ClipboardCheck} label="مهام مفتوحة" value={summary.openTasks ?? 0} />
              <Metric icon={Building2} label="الفروع" value={summary.branches ?? 0} />
            </div>
          )}
          <div className="grid gap-4 xl:grid-cols-3">
            <Panel className="xl:col-span-2">
              <SectionTitle icon={CalendarClock} title="المناسبات القادمة" description="عداد مباشر لأقرب الحجوزات في جميع الأقسام." />
              {!command.data?.upcoming.length ? <Empty message="لا توجد مناسبات قادمة" /> : (
                <div className="grid gap-2 md:grid-cols-2">
                  {command.data.upcoming.slice(0, 10).map((row) => (
                    <Link key={`${row.type}-${row.id}`} href={row.href} className="rounded-lg border border-border/30 bg-background/40 p-3 transition-colors hover:border-primary/40">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0"><p className="truncate text-sm font-semibold text-foreground">{row.title}</p><p className="truncate text-xs text-muted-foreground">{row.subtitle}</p></div>
                        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-1 text-[10px] text-primary">{STATUS_LABELS[row.status] ?? row.status}</span>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{formatDateTime(row.eventAt)}</span><Countdown value={row.eventAt} /></div>
                    </Link>
                  ))}
                </div>
              )}
            </Panel>
            <Panel>
              <SectionTitle icon={ShieldAlert} title="المخاطر المقترحة" description="قواعد تشغيلية تشرح المشكلة وتقترح الإجراء." />
              {risks.isLoading ? <Skeleton className="h-48 rounded-lg" /> : !risks.data?.risks?.length ? (
                <div className="flex min-h-40 flex-col items-center justify-center text-center"><CheckCircle2 className="h-8 w-8 text-primary" /><p className="mt-2 text-sm font-medium">لا توجد مخاطر نشطة</p></div>
              ) : <div className="space-y-2">{risks.data.risks.map((risk: any) => <Link key={risk.key} href={risk.href} className="block rounded-lg border border-destructive/20 bg-destructive/5 p-3"><div className="flex justify-between gap-2"><p className="text-sm font-semibold">{risk.title}</p><span className="text-xs text-destructive">{risk.count}</span></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{risk.solution}</p></Link>)}</div>}
            </Panel>
          </div>
          <QuickLinks />
        </TabsContent>

        <TabsContent value="operations"><OperationsTab command={command.data} /></TabsContent>
        <TabsContent value="queue"><QueueTab active={tab === "queue"} /></TabsContent>
        <TabsContent value="assets"><AssetsTab active={tab === "assets"} /></TabsContent>
        <TabsContent value="intelligence"><IntelligenceTab active={tab === "intelligence"} /></TabsContent>
        <TabsContent value="knowledge"><KnowledgeTab active={tab === "knowledge"} /></TabsContent>
        <TabsContent value="closing"><ClosingTab active={tab === "closing"} /></TabsContent>
      </Tabs>
    </div>
  );
}

function QuickLinks() {
  const links = [
    ["/admin/live-operations", "العمليات المباشرة", Route],
    ["/admin/calendar", "تقويم المعدات والحجوزات", CalendarClock],
    ["/admin/tasks", "مهام الفرق", ClipboardCheck],
    ["/admin/approvals", "مركز الموافقات", ShieldAlert],
    ["/admin/documents", "مركز المستندات", BookOpen],
    ["/admin/disaster-recovery", "الطوارئ والاسترجاع", RefreshCw],
  ] as const;
  return <Panel><SectionTitle icon={Sparkles} title="اختصارات المؤسسة" /><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{links.map(([href, label, Icon]) => <Link key={href} href={href} className="flex items-center gap-3 rounded-lg border border-border/30 bg-background/40 p-3 text-sm font-medium transition-colors hover:border-primary/40 hover:text-primary"><Icon className="h-4 w-4 shrink-0 text-primary" />{label}</Link>)}</div></Panel>;
}

function OperationsTab({ command }: { command?: CommandCenter }) {
  const locations = command?.locations ?? [];
  const first = locations[0] ?? command?.branches.find((row) => row.latitude != null && row.longitude != null);
  const weather = useQuery<any>({
    queryKey: ["admin", "enterprise", "weather", first?.latitude, first?.longitude],
    queryFn: () => adminFetch(`/admin/enterprise/weather?lat=${first?.latitude}&lng=${first?.longitude}`),
    enabled: first?.latitude != null && first?.longitude != null,
    staleTime: 15 * 60_000,
  });
  const mapUrl = first?.latitude != null && first?.longitude != null ? `https://www.google.com/maps?q=${first.latitude},${first.longitude}&z=12&output=embed` : null;
  return <div className="space-y-4"><div className="grid gap-4 xl:grid-cols-3">
    <Panel className="overflow-hidden xl:col-span-2">
      <SectionTitle icon={MapPin} title="خريطة العمليات" description="آخر مواقع محفوظة للفرق والمركبات. تحديث الموقع يتم من أجهزة الكادر المصرح لها." />
      {mapUrl ? <iframe title="خريطة عمليات AJN" src={mapUrl} className="h-80 w-full rounded-lg border border-border/30" loading="lazy" referrerPolicy="no-referrer-when-downgrade" /> : <Empty message="لا توجد إحداثيات مسجلة لعرض الخريطة" />}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">{locations.slice(0, 8).map((row) => <div key={`${row.resourceType}-${row.resourceId}`} className="rounded-lg border border-border/30 p-3"><div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-medium">{row.resourceName || `${row.resourceType} #${row.resourceId}`}</p><span className="text-xs text-primary">{STATUS_LABELS[row.status] ?? row.status}</span></div><p className="mt-1 text-xs text-muted-foreground">{formatDateTime(row.recordedAt)}</p></div>)}</div>
    </Panel>
    <div className="space-y-4">
      <Panel><SectionTitle icon={CloudRain} title="حالة الطقس" />{weather.isLoading ? <Skeleton className="h-28 rounded-lg" /> : weather.data ? <><p className="text-3xl font-bold">{Math.round(Number(weather.data.current?.temperature_2m ?? 0))}°</p><p className="mt-1 text-xs text-muted-foreground">سرعة الرياح {weather.data.current?.wind_speed_10m ?? 0} كم/س</p>{weather.data.alerts?.map((alert: any) => <p key={alert.type} className="mt-2 rounded-lg bg-destructive/10 p-2 text-xs text-destructive">{alert.label}</p>)}</> : <Empty message="حدد موقع الفرع لعرض الطقس" />}</Panel>
      <Panel><SectionTitle icon={Car} title="المركبات" />{!command?.vehicles.length ? <Empty message="لا توجد مركبات" /> : <div className="space-y-2">{command.vehicles.map((vehicle) => <div key={vehicle.id} className="flex items-center justify-between rounded-lg border border-border/30 p-3"><div><p className="text-sm font-medium">{vehicle.name}</p><p className="text-xs text-muted-foreground">{vehicle.plateNumber}</p></div><span className="text-xs text-primary">{STATUS_LABELS[vehicle.status] ?? vehicle.status}</span></div>)}</div>}</Panel>
    </div>
  </div><div className="grid gap-4 xl:grid-cols-2"><DispatchPanel command={command} /><InternalChatPanel /><RepeatEventPanel command={command} /><EventCostPanel command={command} /><BranchManagementPanel command={command} /></div></div>;
}

function DispatchPanel({ command }: { command?: CommandCenter }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({ entityType: "kosha_booking", entityId: "" });
  const [suggestion, setSuggestion] = useState<any>(null);
  const suggest = useMutation({
    mutationFn: () => adminFetch("/admin/enterprise/dispatch/suggest", { method: "POST", body: JSON.stringify({ entityType: form.entityType, entityId: Number(form.entityId) }) }),
    onSuccess: setSuggestion,
    onError: (error) => toast({ title: "تعذر إعداد الاقتراح", description: apiErrorMessage(error), variant: "destructive" }),
  });
  const assign = useMutation({
    mutationFn: () => adminFetch("/admin/enterprise/dispatch", { method: "POST", body: JSON.stringify({
      entityType: form.entityType,
      entityId: Number(form.entityId),
      crewId: suggestion?.suggestion?.crew?.id ?? null,
      vehicleId: suggestion?.suggestion?.vehicle?.id ?? null,
      warehouseId: suggestion?.suggestion?.warehouse?.id ?? null,
      score: suggestion?.score ?? 0,
      suggestions: suggestion?.suggestion ?? {},
    }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "enterprise"] }); toast({ title: "تم اعتماد توزيع الحجز" }); },
    onError: (error) => toast({ title: "تعذر اعتماد التوزيع", description: apiErrorMessage(error), variant: "destructive" }),
  });
  return <Panel><SectionTitle icon={Route} title="التوزيع الذكي" description="يقارن توفر الفريق والسيارة والمخزن قبل اعتماد التوزيع." /><div className="grid gap-2 sm:grid-cols-2"><select value={form.entityType} onChange={(event) => { setForm({ ...form, entityType: event.target.value }); setSuggestion(null); }} className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm"><option value="kosha_booking">حجز كوشة</option><option value="service_order">حجز خدمة</option><option value="photography_event">مناسبة تصوير</option></select><select value={form.entityId} onChange={(event) => { const selected = command?.upcoming.find((row) => String(row.id) === event.target.value && row.type === form.entityType); setForm({ ...form, entityId: event.target.value }); setSuggestion(null); if (selected) setForm({ entityType: selected.type, entityId: String(selected.id) }); }} className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm"><option value="">اختر الحجز</option>{command?.upcoming.filter((row) => row.type === form.entityType).map((row) => <option key={`${row.type}-${row.id}`} value={row.id}>{row.title} · {row.subtitle}</option>)}</select></div><Button variant="outline" className="mt-3 w-full gap-2" onClick={() => suggest.mutate()} disabled={!form.entityId || suggest.isPending}>{suggest.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}اقترح الموارد</Button>{suggestion ? <div className="mt-3 space-y-2 rounded-lg border border-primary/25 bg-primary/5 p-3"><div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">درجة الملاءمة</span><span className="font-bold text-primary">{suggestion.score}%</span></div><Progress value={suggestion.score} /><div className="grid gap-2 text-xs sm:grid-cols-3"><p>الفريق: <strong>{suggestion.suggestion?.crew?.name ?? "غير متاح"}</strong></p><p>السيارة: <strong>{suggestion.suggestion?.vehicle?.name ?? "غير متاحة"}</strong></p><p>المخزن: <strong>{suggestion.suggestion?.warehouse?.name ?? "غير متاح"}</strong></p></div><Button className="w-full" onClick={() => assign.mutate()} disabled={assign.isPending || !suggestion.suggestion?.crew?.id}>{assign.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "اعتماد التوزيع"}</Button></div> : null}</Panel>;
}

type ChatChannel = { id: number; title: string; department: string; updatedAt: string };
type ChatMessage = { id: number; senderName: string; body?: string | null; voiceUrl?: string | null; createdAt: string };

function InternalChatPanel() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [channelId, setChannelId] = useState("");
  const [newChannel, setNewChannel] = useState("");
  const [message, setMessage] = useState("");
  const channels = useQuery<{ data: ChatChannel[] }>({ queryKey: ["admin", "enterprise", "chat"], queryFn: () => adminFetch("/admin/enterprise/chat"), refetchInterval: 30_000 });
  const messages = useQuery<{ data: ChatMessage[] }>({ queryKey: ["admin", "enterprise", "chat", channelId], queryFn: () => adminFetch(`/admin/enterprise/chat/messages?channelId=${channelId}`), enabled: Boolean(channelId), refetchInterval: channelId ? 15_000 : false });
  useEffect(() => { if (!channelId && channels.data?.data[0]) setChannelId(String(channels.data.data[0].id)); }, [channelId, channels.data]);
  const create = useMutation({ mutationFn: () => adminFetch("/admin/enterprise/chat", { method: "POST", body: JSON.stringify({ title: newChannel, department: "general" }) }), onSuccess: (row: any) => { setNewChannel(""); setChannelId(String(row.id)); qc.invalidateQueries({ queryKey: ["admin", "enterprise", "chat"] }); }, onError: (error) => toast({ title: "تعذر إنشاء المحادثة", description: apiErrorMessage(error), variant: "destructive" }) });
  const send = useMutation({ mutationFn: () => adminFetch("/admin/enterprise/chat/messages", { method: "POST", body: JSON.stringify({ channelId: Number(channelId), body: message }) }), onSuccess: () => { setMessage(""); qc.invalidateQueries({ queryKey: ["admin", "enterprise", "chat", channelId] }); }, onError: (error) => toast({ title: "تعذر إرسال الرسالة", description: apiErrorMessage(error), variant: "destructive" }) });
  return <Panel><SectionTitle icon={MessageSquare} title="التواصل الداخلي" description="محادثات مرتبطة بالعمل مع دعم الملاحظات الصوتية عبر الـ API." /><div className="flex gap-2"><input value={newChannel} onChange={(event) => setNewChannel(event.target.value)} placeholder="اسم قناة جديدة" className="min-w-0 flex-1 rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" /><Button size="sm" variant="outline" onClick={() => create.mutate()} disabled={!newChannel.trim() || create.isPending}>إنشاء</Button></div>{channels.data?.data.length ? <select value={channelId} onChange={(event) => setChannelId(event.target.value)} className="mt-3 w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm">{channels.data.data.map((row) => <option key={row.id} value={row.id}>{row.title}</option>)}</select> : null}<div className="my-3 max-h-52 min-h-32 space-y-2 overflow-y-auto rounded-lg border border-border/30 bg-background/40 p-3">{messages.isLoading ? <Skeleton className="h-20" /> : !messages.data?.data.length ? <Empty message="لا توجد رسائل في هذه القناة" /> : messages.data.data.map((row) => <div key={row.id} className="rounded-lg bg-card p-2"><div className="flex justify-between gap-2 text-[10px] text-muted-foreground"><span>{row.senderName}</span><span>{formatDateTime(row.createdAt)}</span></div>{row.body ? <p className="mt-1 text-xs leading-5">{row.body}</p> : null}{row.voiceUrl ? <audio controls preload="none" src={row.voiceUrl} className="mt-2 h-8 w-full" /> : null}</div>)}</div><div className="flex gap-2"><input value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && message.trim() && channelId) send.mutate(); }} placeholder="اكتب رسالة داخلية..." className="min-w-0 flex-1 rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" /><Button size="icon" onClick={() => send.mutate()} disabled={!message.trim() || !channelId || send.isPending} title="إرسال"><Send className="h-4 w-4" /></Button></div></Panel>;
}

function RepeatEventPanel({ command }: { command?: CommandCenter }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({ entityKey: "", eventDate: "" });
  const selected = command?.upcoming.find((row) => `${row.type}:${row.id}` === form.entityKey);
  const repeat = useMutation({ mutationFn: () => adminFetch("/admin/enterprise/repeat-event", { method: "POST", body: JSON.stringify({ entityType: selected?.type, entityId: selected?.id, eventDate: form.eventDate }) }), onSuccess: () => { setForm({ entityKey: "", eventDate: "" }); qc.invalidateQueries({ queryKey: ["admin", "enterprise"] }); toast({ title: "تم نسخ الحجز إلى التاريخ الجديد" }); }, onError: (error) => toast({ title: "تعذر نسخ الحجز", description: apiErrorMessage(error), variant: "destructive" }) });
  return <Panel><SectionTitle icon={RefreshCw} title="تكرار مناسبة" description="ينسخ تفاصيل الحجز والاختيارات ويعيد إنشاء المهام مع تاريخ جديد." /><div className="space-y-3"><select value={form.entityKey} onChange={(event) => setForm({ ...form, entityKey: event.target.value })} className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm"><option value="">اختر حجزاً سابقاً أو قادماً</option>{command?.upcoming.map((row) => <option key={`${row.type}-${row.id}`} value={`${row.type}:${row.id}`}>{row.title} · {row.subtitle}</option>)}</select><input type="date" value={form.eventDate} onChange={(event) => setForm({ ...form, eventDate: event.target.value })} className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" /><Button variant="outline" className="w-full gap-2" onClick={() => repeat.mutate()} disabled={!selected || !form.eventDate || repeat.isPending}>{repeat.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}نسخ الحجز</Button></div></Panel>;
}

function EventCostPanel({ command }: { command?: CommandCenter }) {
  const { toast } = useToast();
  const [entityKey, setEntityKey] = useState("");
  const [costs, setCosts] = useState({ materialsCost: "", transportCost: "", fuelCost: "", laborCost: "", depreciationCost: "", expectedRevenue: "" });
  const [result, setResult] = useState<any>(null);
  const selected = command?.upcoming.find((row) => `${row.type}:${row.id}` === entityKey);
  const calculate = useMutation({ mutationFn: () => adminFetch("/admin/enterprise/cost-estimates", { method: "POST", body: JSON.stringify({ ...costs, entityType: selected?.type, entityId: selected?.id }) }), onSuccess: setResult, onError: (error) => toast({ title: "تعذر حساب التكلفة", description: apiErrorMessage(error), variant: "destructive" }) });
  const fields: Array<[keyof typeof costs, string]> = [["materialsCost", "المواد"], ["transportCost", "النقل"], ["fuelCost", "الوقود"], ["laborCost", "العمال"], ["depreciationCost", "الاستهلاك"], ["expectedRevenue", "الإيراد المتوقع"]];
  return <Panel><SectionTitle icon={BarChart3} title="حاسبة تكلفة المناسبة" description="تحسب الربح المتوقع وتنبه عند انخفاض هامش الربح." /><select value={entityKey} onChange={(event) => { setEntityKey(event.target.value); setResult(null); }} className="mb-3 w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm"><option value="">اختر الحجز</option>{command?.upcoming.map((row) => <option key={`${row.type}-${row.id}`} value={`${row.type}:${row.id}`}>{row.title} · {row.subtitle}</option>)}</select><div className="grid grid-cols-2 gap-2">{fields.map(([key, label]) => <label key={key} className="text-xs text-muted-foreground">{label}<input type="number" min="0" value={costs[key]} onChange={(event) => setCosts({ ...costs, [key]: event.target.value })} className="mt-1 w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm text-foreground" /></label>)}</div><Button className="mt-3 w-full" onClick={() => calculate.mutate()} disabled={!selected || calculate.isPending}>{calculate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "حساب الربح"}</Button>{result ? <div className={`mt-3 rounded-lg border p-3 ${result.warning ? "border-destructive/30 bg-destructive/5" : "border-primary/30 bg-primary/5"}`}><div className="flex justify-between gap-2"><span className="text-xs text-muted-foreground">الربح المتوقع</span><strong>{formatCurrency(result.expectedProfit)}</strong></div><div className="mt-2 flex justify-between gap-2"><span className="text-xs text-muted-foreground">هامش الربح</span><strong>{Number(result.profitMargin).toLocaleString("ar-IQ")}%</strong></div>{result.warning ? <p className="mt-2 text-xs text-destructive">{result.warning}</p> : null}</div> : null}</Panel>;
}

function BranchManagementPanel({ command }: { command?: CommandCenter }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [branch, setBranch] = useState({ code: "", name: "", city: "" });
  const [vehicle, setVehicle] = useState({ name: "", plateNumber: "", branchId: "" });
  const createBranch = useMutation({ mutationFn: () => adminFetch("/admin/enterprise/branches", { method: "POST", body: JSON.stringify(branch) }), onSuccess: () => { setBranch({ code: "", name: "", city: "" }); qc.invalidateQueries({ queryKey: ["admin", "enterprise"] }); toast({ title: "تم إنشاء الفرع" }); }, onError: (error) => toast({ title: "تعذر إنشاء الفرع", description: apiErrorMessage(error), variant: "destructive" }) });
  const createVehicle = useMutation({ mutationFn: () => adminFetch("/admin/enterprise/vehicles", { method: "POST", body: JSON.stringify({ ...vehicle, branchId: vehicle.branchId ? Number(vehicle.branchId) : null }) }), onSuccess: () => { setVehicle({ name: "", plateNumber: "", branchId: "" }); qc.invalidateQueries({ queryKey: ["admin", "enterprise"] }); toast({ title: "تمت إضافة المركبة" }); }, onError: (error) => toast({ title: "تعذر إضافة المركبة", description: apiErrorMessage(error), variant: "destructive" }) });
  return <Panel className="xl:col-span-2"><SectionTitle icon={Building2} title="إدارة الفروع والمركبات" description="كل فرع قابل للربط بالمخزن والصندوق والموظفين عبر نظام التعيين المؤسسي." /><div className="grid gap-4 lg:grid-cols-2"><div><p className="mb-2 text-xs font-semibold text-muted-foreground">فرع جديد</p><div className="grid gap-2 sm:grid-cols-3"><input value={branch.code} onChange={(event) => setBranch({ ...branch, code: event.target.value.toUpperCase() })} placeholder="رمز الفرع" className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" /><input value={branch.name} onChange={(event) => setBranch({ ...branch, name: event.target.value })} placeholder="اسم الفرع" className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" /><input value={branch.city} onChange={(event) => setBranch({ ...branch, city: event.target.value })} placeholder="المدينة" className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" /></div><Button variant="outline" size="sm" className="mt-2 w-full" onClick={() => createBranch.mutate()} disabled={!branch.code.trim() || !branch.name.trim() || createBranch.isPending}>إضافة الفرع</Button></div><div><p className="mb-2 text-xs font-semibold text-muted-foreground">مركبة جديدة</p><div className="grid gap-2 sm:grid-cols-3"><input value={vehicle.name} onChange={(event) => setVehicle({ ...vehicle, name: event.target.value })} placeholder="اسم المركبة" className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" /><input value={vehicle.plateNumber} onChange={(event) => setVehicle({ ...vehicle, plateNumber: event.target.value })} placeholder="رقم اللوحة" className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" /><select value={vehicle.branchId} onChange={(event) => setVehicle({ ...vehicle, branchId: event.target.value })} className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm"><option value="">بدون فرع</option>{command?.branches.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></div><Button variant="outline" size="sm" className="mt-2 w-full" onClick={() => createVehicle.mutate()} disabled={!vehicle.name.trim() || !vehicle.plateNumber.trim() || createVehicle.isPending}>إضافة المركبة</Button></div></div></Panel>;
}

function QueueTab({ active }: { active: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState({ customerName: "", phone: "", serviceType: "general" });
  const query = useQuery<{ data: QueueRow[] }>({ queryKey: ["admin", "enterprise", "queue"], queryFn: () => adminFetch("/admin/enterprise/queue"), enabled: active, refetchInterval: active ? 20_000 : false });
  const add = useMutation({ mutationFn: () => adminFetch("/admin/enterprise/queue", { method: "POST", body: JSON.stringify(form) }), onSuccess: () => { setForm({ customerName: "", phone: "", serviceType: "general" }); qc.invalidateQueries({ queryKey: ["admin", "enterprise", "queue"] }); toast({ title: "تم تسجيل وصول العميل" }); }, onError: (error) => toast({ title: "تعذر إضافة العميل", description: apiErrorMessage(error), variant: "destructive" }) });
  const update = useMutation({ mutationFn: ({ id, status }: { id: number; status: string }) => adminFetch(`/admin/enterprise/queue/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "enterprise", "queue"] }), onError: (error) => toast({ title: "تعذر تحديث الطابور", description: apiErrorMessage(error), variant: "destructive" }) });
  return <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
    <Panel><SectionTitle icon={UserRound} title="وصل العميل" description="أضف العميل إلى الطابور وابدأ الخدمة من نفس الشاشة." /><div className="space-y-3"><input value={form.customerName} onChange={(event) => setForm({ ...form, customerName: event.target.value })} placeholder="اسم العميل" className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" /><input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} inputMode="tel" placeholder="رقم الهاتف" className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" /><select value={form.serviceType} onChange={(event) => setForm({ ...form, serviceType: event.target.value })} className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm"><option value="general">خدمة عامة</option><option value="kosha">كوشة</option><option value="photography">تصوير</option><option value="store">متجر</option><option value="payments">دفعات</option></select><Button className="w-full gap-2" onClick={() => add.mutate()} disabled={add.isPending || !form.customerName.trim()}>{add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRound className="h-4 w-4" />}تسجيل الوصول</Button></div></Panel>
    <Panel><SectionTitle icon={Users} title="الطابور الحالي" />{query.isLoading ? <Skeleton className="h-64 rounded-lg" /> : !query.data?.data.length ? <Empty message="لا يوجد عملاء في الطابور" /> : <div className="space-y-2">{query.data.data.map((row) => <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/30 p-3"><div className="flex min-w-0 items-center gap-3"><span className="rounded-lg bg-primary/10 px-2 py-1 text-xs font-bold text-primary">{row.queueNo}</span><div className="min-w-0"><p className="truncate text-sm font-semibold">{row.customerName}</p><p className="text-xs text-muted-foreground">{row.serviceType} · انتظار {row.waitMinutes} دقيقة</p></div></div><div className="flex gap-2">{row.status === "waiting" ? <Button size="sm" variant="outline" onClick={() => update.mutate({ id: row.id, status: "serving" })}>بدء الخدمة</Button> : null}{row.status === "serving" ? <Button size="sm" onClick={() => update.mutate({ id: row.id, status: "completed" })}>إكمال</Button> : null}<span className="self-center text-xs text-primary">{STATUS_LABELS[row.status] ?? row.status}</span></div></div>)}</div>}</Panel>
  </div>;
}

function assetHealth(row: AssetRow) {
  const purchase = Number(row.purchasePrice ?? 0);
  const value = Number(row.currentValue ?? purchase);
  const maintRatio = purchase > 0 ? Math.min(1, row.maintenanceCost / purchase) : 0;
  const valueRatio = purchase > 0 ? Math.min(1, Math.max(0, value / purchase)) : 1;
  const usagePenalty = Math.min(300, Math.max(0, row.usageCount)) / 300;
  const score = Math.max(0, Math.min(100, Math.round(100 - maintRatio * 55 - (1 - valueRatio) * 25 - usagePenalty * 15)));
  if (score >= 70) return { score, emoji: "🟢", label: "ممتاز", tone: "bg-status-success/15 text-status-success", bar: "bg-status-success" };
  if (score >= 40) return { score, emoji: "🟡", label: "جيد", tone: "bg-status-warning/15 text-status-warning", bar: "bg-status-warning" };
  return { score, emoji: "🔴", label: "يحتاج صيانة", tone: "bg-status-danger/15 text-status-danger", bar: "bg-status-danger" };
}

function PassportStat({ label, value, tone = "text-foreground" }: { label: string; value: string; tone?: string }) {
  return <div className="rounded-lg border border-border/30 bg-background/50 p-2.5 text-center"><div className="text-[11px] text-muted-foreground">{label}</div><div className={`mt-1 text-sm font-bold ${tone}`}>{value}</div></div>;
}

function AssetPassportModal({ row, onClose }: { row: AssetRow; onClose: () => void }) {
  const [tab, setTab] = useState<"overview" | "advisor" | "timeline" | "photos" | "damage" | "signature">("overview");
  const qc = useQueryClient();
  const { toast } = useToast();
  const [lockReason, setLockReason] = useState("");
  const locked = row.assetStatus === "locked";
  const lock = useMutation({
    mutationFn: (payload: { locked: boolean; reason?: string }) => adminFetch("/admin/assets/lock", { method: "POST", body: JSON.stringify({ productId: row.productId, ...payload }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "enterprise", "assets"] }); qc.invalidateQueries({ queryKey: ["asset-timeline", row.productId] }); toast({ title: locked ? "تم إلغاء القفل" : "تم قفل الأصل" }); onClose(); },
    onError: (e) => toast({ title: "تعذّر تنفيذ القفل", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const purchaseSource = useQuery<{ data: Array<{ supplierName: string | null; costPrice: string | number; date: string }>; summary: { lastPrice: number; bestPrice: number; bestSupplier: string } }>({
    queryKey: ["asset-purchase-source", row.productId],
    queryFn: () => adminFetch(`/admin/purchase-comparison?productId=${row.productId}`),
    retry: false,
    enabled: tab === "overview",
  });
  const health = assetHealth(row);
  const purchase = Number(row.purchasePrice ?? 0);
  const value = Number(row.currentValue ?? purchase);
  const custody = row.custody ?? [];
  const status = custody.length
    ? { label: "بعهدة موظف", tone: "bg-blue-500/15 text-blue-400" }
    : (row.lastLocation && /صيان/.test(row.lastLocation) ? { label: "صيانة", tone: "bg-status-warning/15 text-status-warning" } : { label: "متاح", tone: "bg-status-success/15 text-status-success" });
  const tabs: Array<{ key: typeof tab; label: string; icon: typeof BarChart3 }> = [
    { key: "overview", label: "نظرة عامة", icon: BarChart3 },
    { key: "advisor", label: "المستشار", icon: BrainCircuit },
    { key: "timeline", label: "الخط الزمني", icon: History },
    { key: "photos", label: "الألبوم", icon: Images },
    { key: "damage", label: "الأضرار", icon: AlertTriangle },
    { key: "signature", label: "التوقيع", icon: PenLine },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="my-6 w-full max-w-2xl rounded-2xl border border-border/40 bg-card p-5" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-foreground">جواز الأصل</h2>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">{row.productName} · {row.shelfCode || "بدون رف"}</p>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="إغلاق"><X className="h-5 w-5" /></button>
        </div>

        <div className="mb-4 flex flex-wrap gap-1.5 border-b border-border/30 pb-3">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button key={key} type="button" onClick={() => setTab(key)} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${tab === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-background/60"}`}>
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>

        {locked && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-status-danger/40 bg-status-danger/10 px-4 py-3 text-sm font-semibold text-status-danger">
            <ShieldAlert className="h-5 w-5 shrink-0" /> هذا الأصل مقفول (قفل طارئ) — خارج الخدمة حتى إلغاء القفل.
          </div>
        )}

        {tab === "advisor" && <AssetAdvisorPanel productId={row.productId} />}
        {tab === "timeline" && <AssetTimelinePanel productId={row.productId} />}
        {tab === "photos" && <AssetPhotosPanel productId={row.productId} />}
        {tab === "damage" && <AssetDamagePanel productId={row.productId} />}
        {tab === "signature" && <AssetSignaturePanel productId={row.productId} />}

        {tab === "overview" && (<>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border/30 bg-background/50 p-4">
            <div className="flex items-center justify-between"><span className="flex items-center gap-1.5 text-sm text-muted-foreground"><HeartPulse className="h-4 w-4" /> الحالة الصحية</span><span className="text-2xl">{health.emoji}</span></div>
            <div className="mt-2 flex items-baseline gap-2"><span className="text-3xl font-bold text-foreground">{health.score}</span><span className="text-sm text-muted-foreground">/ 100 · {health.label}</span></div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${health.bar}`} style={{ width: `${health.score}%` }} /></div>
          </div>
          <div className="rounded-xl border border-border/30 bg-background/50 p-4">
            <div className="text-sm text-muted-foreground">الحالة الحالية والموقع</div>
            <div className="mt-2"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${status.tone}`}>{status.label}</span></div>
            <div className="mt-2 flex items-center gap-1.5 text-sm text-foreground"><MapPin className="h-4 w-4 text-muted-foreground" />{row.lastLocation || row.shelfCode || "داخل المخزن"}</div>
            {custody.length ? <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><UserRound className="h-3.5 w-3.5" />بعهدة: {custody.map((c) => c.staffName).filter(Boolean).join("، ")}</div> : null}
          </div>
        </div>

        <div className="mt-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary"><BarChart3 className="h-4 w-4" /> العائد والاستخدام (ROI)</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <PassportStat label="سعر الشراء" value={formatCurrency(purchase)} />
            <PassportStat label="القيمة الحالية" value={formatCurrency(value)} />
            <PassportStat label="إجمالي الإيراد" value={formatCurrency(row.revenueTotal)} tone="text-status-success" />
            <PassportStat label="تكلفة الصيانة" value={formatCurrency(row.maintenanceCost)} tone="text-status-danger" />
            <PassportStat label="صافي الربح" value={formatCurrency(row.profit)} tone={row.profit >= 0 ? "text-primary" : "text-destructive"} />
            <PassportStat label="نسبة العائد ROI" value={`${row.roi.toLocaleString("ar-IQ")}%`} tone={row.roi >= 0 ? "text-primary" : "text-destructive"} />
            <PassportStat label="مرات الاستخدام" value={row.usageCount.toLocaleString("ar-IQ")} />
            <PassportStat label="المخزون" value={String(row.stock)} />
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border/30 bg-background/50 p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground"><PackageCheck className="h-4 w-4 text-primary" /> مصدر الشراء</div>
            {purchaseSource.isLoading ? <Skeleton className="h-12 rounded-lg" />
              : purchaseSource.isError || !purchaseSource.data?.data?.length ? <p className="text-xs text-muted-foreground">لا توجد فاتورة شراء مرتبطة بهذا الأصل.</p>
              : (
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between gap-2"><span className="text-muted-foreground">المورّد</span><span className="font-medium text-foreground">{purchaseSource.data.data[0].supplierName || "—"}</span></div>
                  <div className="flex justify-between gap-2"><span className="text-muted-foreground">آخر سعر شراء</span><span className="font-medium text-foreground">{formatCurrency(purchaseSource.data.summary.lastPrice)}</span></div>
                  <div className="flex justify-between gap-2"><span className="text-muted-foreground">التاريخ</span><span className="font-medium text-foreground">{purchaseSource.data.data[0].date ? new Date(purchaseSource.data.data[0].date).toLocaleDateString("ar-IQ") : "—"}</span></div>
                  <Link href="/admin/purchases" onClick={onClose} className="mt-1 inline-block text-xs text-primary hover:underline">فتح المشتريات ←</Link>
                </div>
              )}
          </div>

          <div className={`rounded-xl border p-4 ${locked ? "border-status-success/30 bg-status-success/5" : "border-status-danger/30 bg-status-danger/5"}`}>
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground"><ShieldAlert className={`h-4 w-4 ${locked ? "text-status-success" : "text-status-danger"}`} /> {locked ? "إلغاء القفل الطارئ" : "قفل طارئ"}</div>
            {locked ? (
              <p className="mb-2 text-xs text-muted-foreground">سيعيد الأصل إلى الخدمة.</p>
            ) : (
              <input value={lockReason} onChange={(e) => setLockReason(e.target.value)} placeholder="سبب القفل (اختياري)" className="mb-2 w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" />
            )}
            <Button
              variant={locked ? "outline" : "destructive"}
              size="sm"
              disabled={lock.isPending}
              onClick={() => lock.mutate({ locked: !locked, reason: lockReason.trim() || undefined })}
              className="w-full gap-1"
            >
              <ShieldAlert className="h-4 w-4" /> {locked ? "إلغاء القفل وإعادة للخدمة" : "قفل الأصل فوراً"}
            </Button>
          </div>
        </div>
        </>)}
      </div>
    </div>
  );
}

const ASSET_TIMELINE_ICON: Record<string, typeof History> = {
  depreciation_updated: Gauge,
  damage: AlertTriangle,
  document_added: Images,
  signature_added: PenLine,
  note: History,
};

type AssetTimelineRow = { id: number; type: string; title: string; body: string; actorName: string; metadata: Record<string, any>; createdAt: string };
type AssetDocRow = { id: number; documentType: string; title: string; fileUrl: string; uploadedByName: string; metadata: Record<string, any>; createdAt: string };

function fmtAssetDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ar-IQ", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function AssetTimelinePanel({ productId }: { productId: number }) {
  const { data, isLoading } = useQuery<{ data: AssetTimelineRow[] }>({
    queryKey: ["asset-timeline", productId],
    queryFn: () => adminFetch(`/admin/entity-timeline?entityType=asset&entityId=${productId}`),
  });
  const rows = data?.data ?? [];
  if (isLoading) return <Skeleton className="h-40 rounded-xl" />;
  if (!rows.length) return <EmptyState message="لا توجد أحداث على هذا الأصل بعد" />;
  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const Icon = ASSET_TIMELINE_ICON[row.type] ?? History;
        return (
          <div key={row.id} className="flex gap-3">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Icon className="h-3.5 w-3.5" /></div>
            <div className="min-w-0 flex-1 border-b border-border/20 pb-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-foreground">{row.title}</p>
                <span className="shrink-0 text-[11px] text-muted-foreground">{fmtAssetDate(row.createdAt)}</span>
              </div>
              {row.body ? <p className="mt-0.5 text-xs text-muted-foreground">{row.body}</p> : null}
              {row.actorName ? <p className="mt-0.5 text-[11px] text-muted-foreground">بواسطة: {row.actorName}</p> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AssetPhotosPanel({ productId }: { productId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ data: AssetDocRow[] }>({
    queryKey: ["asset-docs", productId],
    queryFn: () => adminFetch(`/admin/documents?entityType=asset&entityId=${productId}`),
  });
  const photos = (data?.data ?? []).filter((d) => d.documentType === "photo");
  const upload = useMutation({
    mutationFn: async (files: FileList) => {
      for (const file of Array.from(files)) {
        const fileUrl = await compressImageFile(file, 1600, 0.82);
        await adminFetch("/admin/documents", { method: "POST", body: JSON.stringify({ entityType: "asset", entityId: productId, documentType: "photo", title: file.name || "صورة", fileName: file.name, mimeType: file.type, fileUrl }) });
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["asset-docs", productId] }); qc.invalidateQueries({ queryKey: ["asset-timeline", productId] }); toast({ title: "تمت إضافة الصور" }); },
    onError: (e) => toast({ title: "تعذّر رفع الصور", description: apiErrorMessage(e), variant: "destructive" }),
  });
  return (
    <div className="space-y-3">
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border/50 bg-background/40 py-4 text-sm text-muted-foreground hover:border-primary hover:text-primary">
        <Upload className="h-4 w-4" /> {upload.isPending ? "جارٍ الرفع..." : "إضافة صور للأصل"}
        <input type="file" accept="image/*" multiple className="hidden" disabled={upload.isPending} onChange={(e) => { if (e.target.files?.length) upload.mutate(e.target.files); e.target.value = ""; }} />
      </label>
      {isLoading ? <Skeleton className="h-32 rounded-xl" /> : !photos.length ? <EmptyState message="لا توجد صور بعد" /> : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((p) => (
            <a key={p.id} href={p.fileUrl} target="_blank" rel="noreferrer" className="group relative aspect-square overflow-hidden rounded-lg border border-border/30">
              <img src={p.fileUrl} alt={p.title} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function AssetDamagePanel({ productId }: { productId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ data: AssetTimelineRow[] }>({
    queryKey: ["asset-timeline", productId],
    queryFn: () => adminFetch(`/admin/entity-timeline?entityType=asset&entityId=${productId}`),
  });
  const damages = (data?.data ?? []).filter((r) => r.type === "damage");
  const [desc, setDesc] = useState("");
  const [cost, setCost] = useState("");
  const [severity, setSeverity] = useState("minor");
  const inputClass = "w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none";
  const log = useMutation({
    mutationFn: () => adminFetch("/admin/entity-timeline", { method: "POST", body: JSON.stringify({ entityType: "asset", entityId: productId, type: "damage", title: severity === "major" ? "ضرر جسيم" : "ضرر طفيف", body: desc.trim(), metadata: { cost: Number(cost) || 0, severity } }) }),
    onSuccess: () => { setDesc(""); setCost(""); setSeverity("minor"); qc.invalidateQueries({ queryKey: ["asset-timeline", productId] }); toast({ title: "تم تسجيل الضرر" }); },
    onError: (e) => toast({ title: "تعذّر التسجيل", description: apiErrorMessage(e), variant: "destructive" }),
  });
  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-xl border border-border/30 bg-background/40 p-3">
        <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} placeholder="وصف الضرر..." className={inputClass} />
        <div className="grid grid-cols-2 gap-2">
          <input type="number" min={0} value={cost} onChange={(e) => setCost(e.target.value)} placeholder="تكلفة الإصلاح" className={inputClass} />
          <select value={severity} onChange={(e) => setSeverity(e.target.value)} className={inputClass}>
            <option value="minor">ضرر طفيف</option>
            <option value="major">ضرر جسيم</option>
          </select>
        </div>
        <Button disabled={log.isPending || !desc.trim()} onClick={() => log.mutate()} className="w-full gap-1">
          <AlertTriangle className="h-4 w-4" /> تسجيل ضرر
        </Button>
      </div>
      {isLoading ? <Skeleton className="h-24 rounded-xl" /> : !damages.length ? <EmptyState message="لا توجد أضرار مسجلة" /> : (
        <div className="space-y-2">
          {damages.map((d) => (
            <div key={d.id} className="rounded-lg border border-status-danger/20 bg-status-danger/5 p-3">
              <div className="flex items-start justify-between gap-2">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground"><AlertTriangle className="h-4 w-4 text-status-danger" /> {d.title}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{fmtAssetDate(d.createdAt)}</span>
              </div>
              {d.body ? <p className="mt-1 text-xs text-muted-foreground">{d.body}</p> : null}
              {Number(d.metadata?.cost) > 0 ? <p className="mt-1 text-xs text-status-danger">تكلفة الإصلاح: {formatCurrency(Number(d.metadata.cost))}</p> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AssetSignaturePanel({ productId }: { productId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const inked = useRef(false);
  const { data, isLoading } = useQuery<{ data: AssetDocRow[] }>({
    queryKey: ["asset-docs", productId],
    queryFn: () => adminFetch(`/admin/documents?entityType=asset&entityId=${productId}`),
  });
  const signatures = (data?.data ?? []).filter((d) => d.documentType === "signature");

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * (canvas.width / rect.width), y: (e.clientY - rect.top) * (canvas.height / rect.height) };
  }
  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawing.current = true;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    canvasRef.current?.setPointerCapture(e.pointerId);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const p = pos(e);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#111827";
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    inked.current = true;
  }
  function end() { drawing.current = false; }
  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    inked.current = false;
  }

  const save = useMutation({
    mutationFn: () => {
      const fileUrl = canvasRef.current!.toDataURL("image/png");
      return adminFetch("/admin/documents", { method: "POST", body: JSON.stringify({ entityType: "asset", entityId: productId, documentType: "signature", title: "توقيع", mimeType: "image/png", fileUrl }) });
    },
    onSuccess: () => { clear(); qc.invalidateQueries({ queryKey: ["asset-docs", productId] }); qc.invalidateQueries({ queryKey: ["asset-timeline", productId] }); toast({ title: "تم حفظ التوقيع" }); },
    onError: (e) => toast({ title: "تعذّر حفظ التوقيع", description: apiErrorMessage(e), variant: "destructive" }),
  });

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-xl border border-border/30 bg-background/40 p-3">
        <p className="text-xs text-muted-foreground">وقّع داخل الإطار ثم احفظ:</p>
        <canvas
          ref={canvasRef}
          width={500}
          height={150}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          className="h-[150px] w-full touch-none rounded-lg border border-border/40 bg-white"
        />
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={clear} className="gap-1"><Trash2 className="h-3.5 w-3.5" /> مسح</Button>
          <Button size="sm" disabled={save.isPending} onClick={() => { if (!inked.current) { toast({ title: "الرجاء التوقيع أولاً", variant: "destructive" }); return; } save.mutate(); }} className="flex-1 gap-1"><PenLine className="h-3.5 w-3.5" /> حفظ التوقيع</Button>
        </div>
      </div>
      {isLoading ? <Skeleton className="h-24 rounded-xl" /> : !signatures.length ? <EmptyState message="لا توجد توقيعات محفوظة" /> : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {signatures.map((s) => (
            <div key={s.id} className="rounded-lg border border-border/30 bg-white p-2">
              <img src={s.fileUrl} alt="توقيع" className="h-16 w-full object-contain" />
              <p className="mt-1 text-center text-[11px] text-muted-foreground">{fmtAssetDate(s.createdAt)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type AdvisorResponse = {
  productId: number;
  suggestions: Array<{ severity: "high" | "medium" | "low"; title: string; detail: string }>;
  replacement: { recommended: boolean; reason: string; estimatedCost: number };
  related: Array<{ productId: number; name: string; usageCount: number; expectedLifeUses: number; status: string; stock: number }>;
  availability: { status: string; holderName: string | null; since: string | null; nextMaintenance: string | null; warrantyUntil: string | null; stock: number };
};

const SEVERITY_TONE: Record<string, string> = {
  high: "border-status-danger/30 bg-status-danger/5",
  medium: "border-status-warning/30 bg-status-warning/5",
  low: "border-border/30 bg-background/40",
};
const AVAILABILITY_LABEL: Record<string, { label: string; tone: string }> = {
  available: { label: "متاح", tone: "bg-status-success/15 text-status-success" },
  in_custody: { label: "بعهدة موظف", tone: "bg-blue-500/15 text-blue-400" },
  locked: { label: "مقفول", tone: "bg-status-danger/15 text-status-danger" },
  out_of_stock: { label: "غير متوفر", tone: "bg-status-warning/15 text-status-warning" },
};
const CHECKLIST_ITEMS = ["النظافة العامة", "سلامة الأجزاء والوصلات", "اختبار التشغيل", "اكتمال الملحقات", "تصوير الحالة قبل التسليم"];

function AssetAdvisorPanel({ productId }: { productId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<AdvisorResponse>({ queryKey: ["asset-advisor", productId], queryFn: () => adminFetch(`/admin/assets/advisor?productId=${productId}`) });
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const checkCount = Object.values(checked).filter(Boolean).length;
  const submitChecklist = useMutation({
    mutationFn: () => adminFetch("/admin/entity-timeline", { method: "POST", body: JSON.stringify({ entityType: "asset", entityId: productId, type: "checklist", title: "قائمة الفحص قبل الاستخدام", body: CHECKLIST_ITEMS.filter((i) => checked[i]).join(" · "), metadata: { items: CHECKLIST_ITEMS.map((i) => ({ item: i, ok: !!checked[i] })) } }) }),
    onSuccess: () => { setChecked({}); qc.invalidateQueries({ queryKey: ["asset-timeline", productId] }); toast({ title: "تم حفظ قائمة الفحص" }); },
    onError: (e) => toast({ title: "تعذّر الحفظ", description: apiErrorMessage(e), variant: "destructive" }),
  });

  if (isLoading || !data) return <Skeleton className="h-60 rounded-xl" />;
  const avail = AVAILABILITY_LABEL[data.availability.status] ?? AVAILABILITY_LABEL.available;

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary"><Sparkles className="h-4 w-4" /> اقتراحات المستشار</div>
        <div className="space-y-2">
          {data.suggestions.map((s, i) => (
            <div key={i} className={`rounded-lg border p-3 ${SEVERITY_TONE[s.severity]}`}>
              <p className="text-sm font-semibold text-foreground">{s.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{s.detail}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className={`rounded-xl border p-4 ${data.replacement.recommended ? "border-status-danger/30 bg-status-danger/5" : "border-border/30 bg-background/40"}`}>
          <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground"><RefreshCw className="h-4 w-4 text-primary" /> الاستبدال الذكي</div>
          <p className={`text-sm font-bold ${data.replacement.recommended ? "text-status-danger" : "text-status-success"}`}>{data.replacement.recommended ? "يُنصح بالاستبدال" : "لا حاجة للاستبدال"}</p>
          <p className="mt-1 text-xs text-muted-foreground">{data.replacement.reason}</p>
          {data.replacement.recommended ? <p className="mt-1 text-xs text-foreground">تكلفة تقديرية للبديل: {formatCurrency(data.replacement.estimatedCost)}</p> : null}
        </div>
        <div className="rounded-xl border border-border/30 bg-background/40 p-4">
          <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground"><CalendarClock className="h-4 w-4 text-primary" /> التوفر</div>
          <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-bold ${avail.tone}`}>{avail.label}</span>
          {data.availability.holderName ? <p className="mt-1 text-xs text-muted-foreground">بعهدة: {data.availability.holderName}{data.availability.since ? ` · منذ ${new Date(data.availability.since).toLocaleDateString("ar-IQ")}` : ""}</p> : null}
          {data.availability.nextMaintenance ? <p className="mt-1 text-xs text-muted-foreground">الصيانة القادمة: {new Date(data.availability.nextMaintenance).toLocaleDateString("ar-IQ")}</p> : null}
          {data.availability.warrantyUntil ? <p className="mt-1 text-xs text-muted-foreground">الضمان حتى: {new Date(data.availability.warrantyUntil).toLocaleDateString("ar-IQ")}</p> : null}
          <p className="mt-1 text-xs text-muted-foreground">المخزون: {data.availability.stock}</p>
        </div>
      </div>

      <div className="rounded-xl border border-border/30 bg-background/40 p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground"><ClipboardCheck className="h-4 w-4 text-primary" /> قائمة الفحص الذكية</div>
        <div className="space-y-1.5">
          {CHECKLIST_ITEMS.map((item) => (
            <label key={item} className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
              <input type="checkbox" checked={!!checked[item]} onChange={(e) => setChecked((p) => ({ ...p, [item]: e.target.checked }))} className="h-4 w-4 rounded border-border/50" />
              {item}
            </label>
          ))}
        </div>
        <Button size="sm" disabled={submitChecklist.isPending || checkCount === 0} onClick={() => submitChecklist.mutate()} className="mt-3 w-full gap-1"><CheckCircle2 className="h-4 w-4" /> تأكيد الفحص ({checkCount}/{CHECKLIST_ITEMS.length})</Button>
      </div>

      <div>
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground"><Boxes className="h-4 w-4 text-primary" /> معدات مرتبطة (نفس الفئة)</div>
        {!data.related.length ? <p className="text-xs text-muted-foreground">لا توجد معدات بنفس الفئة.</p> : (
          <div className="grid gap-2 sm:grid-cols-2">
            {data.related.map((r) => (
              <div key={r.productId} className="rounded-lg border border-border/30 bg-background/40 p-3">
                <p className="text-sm font-medium text-foreground">{r.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">الاستخدام {r.usageCount}/{r.expectedLifeUses} · المخزون {r.stock}{r.status === "locked" ? " · 🔒 مقفول" : ""}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AssetsTab({ active }: { active: boolean }) {
  const query = useQuery<{ data: AssetRow[] }>({ queryKey: ["admin", "enterprise", "assets"], queryFn: () => adminFetch("/admin/enterprise/assets"), enabled: active, staleTime: 30_000 });
  const [selected, setSelected] = useState<AssetRow | null>(null);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric icon={Boxes} label="الأصول المسجلة" value={query.data?.data.length ?? 0} />
        <Metric icon={Wallet} label="إجمالي ربح الأصول" value={formatCurrency(query.data?.data.reduce((sum, row) => sum + row.profit, 0) ?? 0)} />
        <Metric icon={Wrench} label="تكلفة الصيانة" value={formatCurrency(query.data?.data.reduce((sum, row) => sum + row.maintenanceCost, 0) ?? 0)} />
      </div>
      <Panel>
        <SectionTitle icon={Warehouse} title="الجواز الرقمي ومواقع الرفوف" description="اضغط أي قطعة لفتح جوازها الكامل: الحالة الصحية، الموقع، العهدة، والعائد." />
        {query.isLoading ? <Skeleton className="h-72 rounded-lg" /> : !query.data?.data.length ? <Empty message="لم تُسجل جوازات رقمية للأصول بعد" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-background/50 text-muted-foreground"><tr><th className="p-3 text-right">القطعة</th><th className="p-3 text-right">الصحة</th><th className="p-3 text-right">الموقع</th><th className="p-3 text-right">الاستخدام</th><th className="p-3 text-right">الإيراد</th><th className="p-3 text-right">الصيانة</th><th className="p-3 text-right">الربح</th><th className="p-3 text-right">ROI</th></tr></thead>
              <tbody className="divide-y divide-border/20">
                {query.data.data.map((row) => {
                  const health = assetHealth(row);
                  return (
                    <tr key={row.id} onClick={() => setSelected(row)} className="cursor-pointer transition-colors hover:bg-background/40">
                      <td className="p-3 font-medium">{row.productName}</td>
                      <td className="p-3"><span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${health.tone}`}>{health.emoji} {health.score}</span></td>
                      <td className="p-3 text-muted-foreground">{row.shelfCode || row.lastLocation || "غير محدد"}</td>
                      <td className="p-3">{row.usageCount}</td>
                      <td className="p-3">{formatCurrency(row.revenueTotal)}</td>
                      <td className="p-3">{formatCurrency(row.maintenanceCost)}</td>
                      <td className="p-3 font-semibold">{formatCurrency(row.profit)}</td>
                      <td className="p-3"><span className={row.roi >= 0 ? "text-primary" : "text-destructive"}>{row.roi.toLocaleString("ar-IQ")}%</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <QuickAssetLinks />
      {selected && <AssetPassportModal row={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

const OPERATION_LINKS: Array<{ href: string; icon: typeof PackageCheck; title: string; description: string }> = [
  { href: "/admin/assets", icon: PackageCheck, title: "إهلاك الأصول", description: "القيمة الحالية والعمر المتوقع." },
  { href: "/admin/maintenance-scheduler", icon: Wrench, title: "جدولة الصيانة", description: "المواعيد حسب الاستخدام." },
  { href: "/admin/purchase-comparison", icon: Search, title: "مقارنة المشتريات", description: "أفضل مورّد وأقل سعر." },
  { href: "/admin/purchases", icon: Wallet, title: "المشتريات", description: "فواتير الشراء والموردين." },
  { href: "/admin/warehouse-transfers", icon: Warehouse, title: "تحويل المخازن", description: "نقل المواد باعتماد المدير." },
];

function QuickAssetLinks() {
  return (
    <Panel>
      <SectionTitle icon={Route} title="العمليات" description="روابط سريعة لإدارة الأصول والصيانة والمشتريات." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {OPERATION_LINKS.map(({ href, icon: Icon, title, description }) => (
          <Link key={href} href={href}>
            <div className="flex items-start gap-3 rounded-xl border border-border/30 bg-background/40 p-3 transition-colors hover:border-primary/40 hover:bg-background/60">
              <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div className="min-w-0"><p className="text-sm font-semibold text-foreground">{title}</p><p className="mt-0.5 text-xs text-muted-foreground">{description}</p></div>
            </div>
          </Link>
        ))}
      </div>
    </Panel>
  );
}

function IntelligenceTab({ active }: { active: boolean }) {
  const query = useQuery<Intelligence>({ queryKey: ["admin", "enterprise", "intelligence"], queryFn: () => adminFetch("/admin/enterprise/intelligence"), enabled: active, staleTime: 60_000 });
  if (query.isLoading || !query.data) return <LoadingGrid />;
  const data = query.data;
  return <div className="space-y-4"><div className="grid grid-cols-2 gap-3 lg:grid-cols-6"><Metric icon={ClipboardCheck} label="إجمالي الأعمال" value={data.kpis.totalWork} /><Metric icon={CheckCircle2} label="نسبة الإنجاز" value={`${data.kpis.completionRate}%`} /><Metric icon={Wallet} label="متوسط الإيراد" value={formatCurrency(data.kpis.averageRevenue)} /><Metric icon={Sparkles} label="رضا العملاء" value={`${data.kpis.customerSatisfaction}/5`} /><Metric icon={Timer} label="الوقت الضائع" value={`${data.kpis.lostMinutes.toLocaleString("ar-IQ")} د`} warning={data.kpis.lostMinutes > 0} /><Metric icon={Boxes} label="حركات المخزون" value={data.kpis.stockMovements} /></div><div className="grid gap-4 xl:grid-cols-2"><Panel><SectionTitle icon={BrainCircuit} title="التوصيات الذكية" description="اقتراحات عملية مبنية على المخزون والاستخدام والصيانة." />{!data.recommendations.length ? <Empty message="لا توجد توصيات حالياً" /> : <div className="space-y-2">{data.recommendations.map((row, index) => <div key={`${row.type}-${row.productId}-${index}`} className={`rounded-lg border p-3 ${row.severity === "high" ? "border-destructive/25 bg-destructive/5" : "border-border/30"}`}><p className="text-sm font-semibold">{row.title}</p><p className="mt-1 text-xs text-muted-foreground">{row.reason}</p></div>)}</div>}</Panel><Panel><SectionTitle icon={BarChart3} title="التسعير الذكي" /><div className="grid grid-cols-3 gap-2"><div className="rounded-lg bg-background/50 p-3"><p className="text-xs text-muted-foreground">الأقل</p><p className="mt-2 font-bold">{formatCurrency(data.smartPricing.min)}</p></div><div className="rounded-lg bg-background/50 p-3"><p className="text-xs text-muted-foreground">المتوسط</p><p className="mt-2 font-bold">{formatCurrency(data.smartPricing.average)}</p></div><div className="rounded-lg bg-background/50 p-3"><p className="text-xs text-muted-foreground">الأعلى</p><p className="mt-2 font-bold">{formatCurrency(data.smartPricing.max)}</p></div></div><SectionTitle icon={Timer} title="أسباب الوقت الضائع" />{data.lostTime.map((row) => <div key={row.reason} className="mb-2"><div className="mb-1 flex justify-between text-xs"><span>{row.reason}</span><span>{row.minutes} دقيقة</span></div><Progress value={Math.min(100, data.kpis.lostMinutes ? row.minutes / data.kpis.lostMinutes * 100 : 0)} /></div>)}</Panel></div><Panel><SectionTitle icon={BarChart3} title="مصادر العملاء" />{!data.marketing.length ? <Empty message="لا توجد بيانات مصدر العميل بعد" /> : <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{data.marketing.map((row) => <div key={row.source} className="rounded-lg border border-border/30 p-3"><p className="text-xs text-muted-foreground">{row.source}</p><p className="mt-1 text-xl font-bold">{row.count}</p></div>)}</div>}</Panel></div>;
}

function KnowledgeTab({ active }: { active: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [form, setForm] = useState({ problem: "", solution: "" });
  const query = useQuery<{ data: Array<{ id: number; problem: string; solution: string; timesReused: number }> }>({ queryKey: ["admin", "enterprise", "knowledge", deferredSearch], queryFn: () => adminFetch(`/admin/enterprise/knowledge/cases?q=${encodeURIComponent(deferredSearch)}`), enabled: active, staleTime: 20_000 });
  const add = useMutation({ mutationFn: () => adminFetch("/admin/enterprise/knowledge/cases", { method: "POST", body: JSON.stringify(form) }), onSuccess: () => { setForm({ problem: "", solution: "" }); qc.invalidateQueries({ queryKey: ["admin", "enterprise", "knowledge"] }); toast({ title: "تم حفظ المشكلة وحلها في ذاكرة الشركة" }); }, onError: (error) => toast({ title: "تعذر حفظ المعرفة", description: apiErrorMessage(error), variant: "destructive" }) });
  return <div className="space-y-4"><div className="grid gap-4 xl:grid-cols-[380px_1fr]"><Panel><SectionTitle icon={BookOpen} title="تحويل مشكلة إلى معرفة" /><div className="space-y-3"><textarea value={form.problem} onChange={(event) => setForm({ ...form, problem: event.target.value })} placeholder="ما المشكلة التي حدثت؟" className="min-h-24 w-full resize-y rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" /><textarea value={form.solution} onChange={(event) => setForm({ ...form, solution: event.target.value })} placeholder="كيف تم حلها؟" className="min-h-32 w-full resize-y rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" /><Button onClick={() => add.mutate()} disabled={add.isPending || !form.problem.trim() || !form.solution.trim()} className="w-full gap-2">{add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookOpen className="h-4 w-4" />}حفظ المعرفة</Button></div></Panel><Panel><SectionTitle icon={Search} title="ذاكرة الحلول" description="ابحث عن مشكلة سابقة قبل بدء التشخيص من الصفر." /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث في المشاكل والحلول..." className="mb-3 w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" />{query.isLoading ? <Skeleton className="h-64 rounded-lg" /> : !query.data?.data.length ? <Empty message="لم تُسجل حلول بعد" /> : <div className="space-y-2">{query.data.data.map((row) => <article key={row.id} className="rounded-lg border border-border/30 p-3"><div className="flex justify-between gap-3"><h3 className="text-sm font-semibold">{row.problem}</h3><span className="shrink-0 text-[10px] text-muted-foreground">استُخدم {row.timesReused}</span></div><p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-muted-foreground">{row.solution}</p></article>)}</div>}</Panel></div><div className="grid gap-4 xl:grid-cols-2"><DecisionMemoryPanel active={active} /><DesignLibraryPanel active={active} /></div></div>;
}

function DecisionMemoryPanel({ active }: { active: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState({ title: "", decision: "", reason: "" });
  const query = useQuery<{ data: Array<{ id: number; title: string; decision: string; reason: string; decidedByName: string; decidedAt: string }> }>({ queryKey: ["admin", "enterprise", "decisions"], queryFn: () => adminFetch("/admin/enterprise/decisions"), enabled: active, staleTime: 20_000 });
  const add = useMutation({ mutationFn: () => adminFetch("/admin/enterprise/decisions", { method: "POST", body: JSON.stringify(form) }), onSuccess: () => { setForm({ title: "", decision: "", reason: "" }); qc.invalidateQueries({ queryKey: ["admin", "enterprise", "decisions"] }); toast({ title: "تم تسجيل القرار في ذاكرة الشركة" }); }, onError: (error) => toast({ title: "تعذر حفظ القرار", description: apiErrorMessage(error), variant: "destructive" }) });
  return <Panel><SectionTitle icon={ShieldAlert} title="ذاكرة قرارات الشركة" description="من اتخذ القرار، ماذا قرر، ولماذا." /><div className="grid gap-2 sm:grid-cols-3"><input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="عنوان القرار" className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" /><input value={form.decision} onChange={(event) => setForm({ ...form, decision: event.target.value })} placeholder="القرار" className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" /><input value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="السبب" className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" /></div><Button className="mt-2 w-full" variant="outline" onClick={() => add.mutate()} disabled={add.isPending || !form.title.trim() || !form.decision.trim() || !form.reason.trim()}>حفظ القرار</Button><div className="mt-3 max-h-64 space-y-2 overflow-y-auto">{query.data?.data.slice(0, 12).map((row) => <article key={row.id} className="rounded-lg border border-border/30 p-3"><div className="flex justify-between gap-2"><p className="text-sm font-semibold">{row.title}</p><span className="text-[10px] text-muted-foreground">{formatDateTime(row.decidedAt)}</span></div><p className="mt-1 text-xs">{row.decision}</p><p className="mt-1 text-xs text-muted-foreground">السبب: {row.reason} · {row.decidedByName || "النظام"}</p></article>)}</div></Panel>;
}

function DesignLibraryPanel({ active }: { active: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState({ name: "", type: "kosha", executionCost: "", executionMinutes: "" });
  const query = useQuery<{ data: Array<{ id: number; name: string; type: string; executionCost: number; executionMinutes: number; orderCount: number }> }>({ queryKey: ["admin", "enterprise", "design-library"], queryFn: () => adminFetch("/admin/enterprise/design-library"), enabled: active, staleTime: 20_000 });
  const add = useMutation({ mutationFn: () => adminFetch("/admin/enterprise/design-library", { method: "POST", body: JSON.stringify(form) }), onSuccess: () => { setForm({ name: "", type: "kosha", executionCost: "", executionMinutes: "" }); qc.invalidateQueries({ queryKey: ["admin", "enterprise", "design-library"] }); toast({ title: "تمت إضافة التصميم إلى المكتبة" }); }, onError: (error) => toast({ title: "تعذر حفظ التصميم", description: apiErrorMessage(error), variant: "destructive" }) });
  return <Panel><SectionTitle icon={Sparkles} title="مكتبة التصاميم" description="الكوشات والديكور والبوكسات مع تكلفة ووقت التنفيذ." /><div className="grid gap-2 sm:grid-cols-2"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="اسم التصميم" className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" /><select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })} className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm"><option value="kosha">كوشة</option><option value="decor">ديكور</option><option value="box">بوكس</option><option value="distribution">توزيعات</option></select><input type="number" min="0" value={form.executionCost} onChange={(event) => setForm({ ...form, executionCost: event.target.value })} placeholder="تكلفة التنفيذ" className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" /><input type="number" min="0" value={form.executionMinutes} onChange={(event) => setForm({ ...form, executionMinutes: event.target.value })} placeholder="وقت التنفيذ بالدقائق" className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" /></div><Button className="mt-2 w-full" variant="outline" onClick={() => add.mutate()} disabled={add.isPending || !form.name.trim()}>إضافة للمكتبة</Button><div className="mt-3 grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">{query.data?.data.map((row) => <div key={row.id} className="rounded-lg border border-border/30 p-3"><p className="text-sm font-semibold">{row.name}</p><p className="mt-1 text-xs text-muted-foreground">{row.type} · {row.executionMinutes} دقيقة</p><p className="mt-1 text-xs text-primary">{formatCurrency(row.executionCost)}</p></div>)}</div></Panel>;
}

function ClosingTab({ active }: { active: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const today = useMemo(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()), []);
  const [date, setDate] = useState(today);
  const query = useQuery<any>({ queryKey: ["admin", "enterprise", "daily-closing", date], queryFn: () => adminFetch(`/admin/enterprise/daily-closing?date=${date}`), enabled: active, staleTime: 10_000 });
  const save = useMutation({ mutationFn: (close: boolean) => adminFetch(`/admin/enterprise/daily-closing?date=${date}`, { method: "POST", body: JSON.stringify({ close }) }), onSuccess: (_, close) => { qc.invalidateQueries({ queryKey: ["admin", "enterprise", "daily-closing"] }); toast({ title: close ? "تم إغلاق يوم العمل" : "تم تحديث قائمة الإغلاق" }); }, onError: (error) => toast({ title: "تعذر إغلاق اليوم", description: apiErrorMessage(error), variant: "destructive" }) });
  const checks = query.data?.checks ?? {};
  const items = [["equipmentReturned", "رجوع جميع المعدات", Boxes], ["paymentsApproved", "اعتماد جميع الدفعات", Wallet], ["bookingsClosed", "إغلاق الحجوزات المستحقة", CalendarClock], ["cashClosed", "إغلاق الصندوق", ClipboardCheck], ["backupCompleted", "إنشاء نسخة احتياطية", RefreshCw]] as const;
  const complete = items.every(([key]) => Boolean(checks[key]));
  return <div className="grid gap-4 xl:grid-cols-[340px_1fr]"><Panel><SectionTitle icon={Clock3} title="تاريخ الإغلاق" /><input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" /><p className="mt-3 text-xs leading-5 text-muted-foreground">يتم فحص المعدات والدفعات والحجوزات والصندوق والنسخة الاحتياطية من النظام مباشرة.</p></Panel><Panel><SectionTitle icon={ClipboardCheck} title="قائمة نهاية اليوم" />{query.isLoading ? <Skeleton className="h-64 rounded-lg" /> : <div className="space-y-2">{items.map(([key, label, Icon]) => <div key={key} className="flex items-center justify-between rounded-lg border border-border/30 p-3"><div className="flex items-center gap-3"><Icon className={`h-4 w-4 ${checks[key] ? "text-primary" : "text-destructive"}`} /><span className="text-sm">{label}</span></div>{checks[key] ? <CheckCircle2 className="h-5 w-5 text-primary" /> : <AlertTriangle className="h-5 w-5 text-destructive" />}</div>)}<div className="mt-4 flex flex-wrap gap-2"><Button variant="outline" onClick={() => save.mutate(false)} disabled={save.isPending}>تحديث الفحص</Button><Button onClick={() => save.mutate(true)} disabled={!complete || save.isPending} className="gap-2">{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}إغلاق اليوم</Button></div>{query.data?.data?.status === "closed" ? <p className="mt-3 rounded-lg bg-primary/10 p-3 text-sm text-primary">تم إغلاق هذا اليوم بنجاح.</p> : null}</div>}</Panel></div>;
}
