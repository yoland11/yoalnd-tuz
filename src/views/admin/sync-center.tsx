"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, CheckCircle2, Cloud, CloudOff, DatabaseBackup, Download,
  HardDrive, Loader2, MonitorCog, Printer, RefreshCw, RotateCcw, Upload, XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import type {
  DesktopBackup, DesktopPrinter, DesktopSettings, DesktopSyncOperation, DesktopSyncState,
} from "@/lib/desktop";

const EMPTY_STATE: DesktopSyncState = {
  online: false, total: 0, pending: 0, failed: 0, conflicts: 0, synced: 0,
  lastSyncAt: null, syncing: false,
};

function dateTime(value: string | null) {
  return value ? new Intl.DateTimeFormat("ar-IQ", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "لم تتم بعد";
}

function sizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function statusLabel(status: DesktopSyncOperation["status"]) {
  return ({ pending_sync: "بانتظار المزامنة", syncing: "جارٍ الإرسال", synced: "تمت المزامنة", failed: "فشلت", conflict: "تعارض" })[status];
}

function Metric({ icon: Icon, label, value, tone = "normal" }: { icon: typeof Cloud; label: string; value: string | number; tone?: "normal" | "success" | "danger" }) {
  return (
    <div className="rounded-lg border border-border/50 bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-bold tabular-nums">{value}</p></div>
        <Icon className={`h-5 w-5 shrink-0 ${tone === "success" ? "text-primary" : tone === "danger" ? "text-destructive" : "text-muted-foreground"}`} />
      </div>
    </div>
  );
}

export default function SyncCenterPage() {
  const desktop = typeof window !== "undefined" ? window.ajnDesktop : undefined;
  const { toast } = useToast();
  const [state, setState] = useState(EMPTY_STATE);
  const [operations, setOperations] = useState<DesktopSyncOperation[]>([]);
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [backups, setBackups] = useState<DesktopBackup[]>([]);
  const [printers, setPrinters] = useState<DesktopPrinter[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("attention");

  const refresh = useCallback(async () => {
    if (!desktop) return;
    const [nextState, nextOperations, nextSettings, nextBackups, nextPrinters] = await Promise.all([
      desktop.getSyncState(), desktop.listOperations(), desktop.getSettings(), desktop.listBackups(), desktop.listPrinters(),
    ]);
    setState(nextState); setOperations(nextOperations); setSettings(nextSettings); setBackups(nextBackups); setPrinters(nextPrinters);
  }, [desktop]);

  useEffect(() => {
    if (!desktop) return;
    void refresh();
    const removeListener = desktop.onSyncState((next) => { setState(next); void desktop.listOperations().then(setOperations); });
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => { removeListener(); window.clearInterval(timer); };
  }, [desktop, refresh]);

  const visibleOperations = useMemo(() => operations.filter((row) => {
    if (filter === "attention" && !["pending_sync", "syncing", "failed", "conflict"].includes(row.status)) return false;
    if (filter !== "all" && filter !== "attention" && row.status !== filter) return false;
    const query = search.trim().toLowerCase();
    return !query || `${row.entityType} ${row.url} ${row.error}`.toLowerCase().includes(query);
  }), [filter, operations, search]);

  async function act(key: string, action: () => Promise<unknown>, success: string) {
    setBusy(key);
    try { await action(); await refresh(); toast({ title: success }); }
    catch (error) { toast({ variant: "destructive", title: "تعذر إكمال العملية", description: error instanceof Error ? error.message : "حدث خطأ غير متوقع" }); }
    finally { setBusy(null); }
  }

  if (!desktop) {
    return (
      <div className="mx-auto max-w-3xl py-12 text-center" dir="rtl">
        <MonitorCog className="mx-auto h-10 w-10 text-muted-foreground" />
        <h1 className="mt-4 text-xl font-bold">مركز المزامنة متاح داخل تطبيق Windows</h1>
        <p className="mt-2 text-sm text-muted-foreground">الموقع يعمل بصورة طبيعية. افتح لوحة الإدارة من تطبيق AJN لإدارة العمليات المحلية والنسخ والطابعات.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold">مركز المزامنة</h1><p className="mt-1 text-sm text-muted-foreground">متابعة العمليات المحلية، التعارضات، النسخ والطباعة في تطبيق Windows.</p></div>
        <div className="flex items-center gap-2">
          <Badge variant={state.online ? "default" : "destructive"} className="gap-1.5">{state.online ? <Cloud className="h-3.5 w-3.5" /> : <CloudOff className="h-3.5 w-3.5" />}{state.online ? "متصل" : "غير متصل"}</Badge>
          <Button onClick={() => void act("sync", () => desktop.syncNow(), "اكتملت محاولة المزامنة")} disabled={!state.online || state.syncing || busy !== null}>
            {state.syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />} مزامنة الآن
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Metric icon={HardDrive} label="العمليات المحلية" value={state.total} />
        <Metric icon={RefreshCw} label="بانتظار المزامنة" value={state.pending} />
        <Metric icon={XCircle} label="عمليات فاشلة" value={state.failed} tone={state.failed ? "danger" : "normal"} />
        <Metric icon={AlertTriangle} label="تعارضات" value={state.conflicts} tone={state.conflicts ? "danger" : "normal"} />
        <Metric icon={CheckCircle2} label="تمت مزامنتها" value={state.synced} tone="success" />
      </div>

      <section className="rounded-lg border border-border/50 bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h2 className="font-semibold">سجل العمليات</h2><p className="mt-1 text-xs text-muted-foreground">آخر مزامنة: {dateTime(state.lastSyncAt)}</p></div>
          <div className="flex w-full gap-2 sm:w-auto">
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث بالعملية أو المسار" className="min-w-0 sm:w-64" />
            <Select value={filter} onValueChange={setFilter}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="attention">تحتاج متابعة</SelectItem><SelectItem value="all">الكل</SelectItem><SelectItem value="pending_sync">بانتظار المزامنة</SelectItem><SelectItem value="failed">فاشلة</SelectItem><SelectItem value="conflict">تعارض</SelectItem><SelectItem value="synced">تمت</SelectItem></SelectContent></Select>
          </div>
        </div>
        {!visibleOperations.length ? <p className="py-10 text-center text-sm text-muted-foreground">لا توجد عمليات مطابقة.</p> : (
          <div className="mt-4 divide-y divide-border/40">
            {visibleOperations.map((row) => (
              <div key={row.id} className="flex flex-col gap-3 py-3 lg:flex-row lg:items-center">
                <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong className="text-sm">{row.entityType}</strong><Badge variant={row.status === "failed" || row.status === "conflict" ? "destructive" : row.status === "synced" ? "default" : "secondary"}>{statusLabel(row.status)}</Badge></div><p className="mt-1 truncate text-xs text-muted-foreground" dir="ltr">{new URL(row.url).pathname}</p><p className="mt-1 text-xs text-muted-foreground">{dateTime(row.createdAt)}{row.error ? ` · ${row.error}` : ""}</p></div>
                {["failed", "conflict", "pending_sync"].includes(row.status) ? <div className="flex shrink-0 gap-2"><Button size="sm" variant="outline" onClick={() => void act(`retry-${row.id}`, () => desktop.retry(row.id), "تمت إعادة المحاولة")} disabled={busy !== null}><RotateCcw />إعادة محاولة</Button>{row.status === "conflict" ? <Button size="sm" variant="destructive" onClick={() => { if (window.confirm("اعتماد نسخة الخادم وإزالة العملية المحلية المتعارضة؟")) void act(`discard-${row.id}`, () => desktop.discard(row.id), "تم اعتماد نسخة الخادم"); }} disabled={busy !== null}>اعتماد الخادم</Button> : null}</div> : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="rounded-lg border border-border/50 bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">النسخ المحلية</h2><p className="mt-1 text-xs text-muted-foreground">نسخة يومية تلقائية مع الاحتفاظ بآخر 7 نسخ.</p></div><DatabaseBackup className="h-5 w-5 text-muted-foreground" /></div>
          <div className="mt-4 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => void act("backup", () => desktop.createBackup(), "تم إنشاء النسخة المحلية")} disabled={busy !== null}><DatabaseBackup />إنشاء نسخة</Button><Button size="sm" variant="outline" onClick={() => void act("export", () => desktop.exportBackup(), "تم تصدير النسخة")} disabled={busy !== null}><Download />تصدير</Button><Button size="sm" variant="outline" onClick={() => { if (window.confirm("سيتم استبدال البيانات المحلية الحالية بعد أخذ نسخة أمان. متابعة؟")) void act("import", () => desktop.importBackup(), "تم استيراد النسخة المحلية"); }} disabled={busy !== null}><Upload />استيراد</Button></div>
          <div className="mt-4 divide-y divide-border/40">{backups.slice(0, 7).map((backup) => <div key={backup.path} className="flex items-center justify-between gap-3 py-2 text-xs"><span className="min-w-0 truncate">{backup.name}</span><span className="shrink-0 text-muted-foreground">{sizeLabel(backup.size)} · {dateTime(backup.createdAt)}</span></div>)}{!backups.length ? <p className="py-5 text-center text-xs text-muted-foreground">لا توجد نسخ محلية بعد.</p> : null}</div>
        </section>

        {settings ? <section className="rounded-lg border border-border/50 bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2"><div><h2 className="font-semibold">إعدادات التطبيق والطابعة</h2><p className="mt-1 text-xs text-muted-foreground">هذه الخيارات محفوظة على هذا الجهاز فقط.</p></div><Printer className="h-5 w-5 text-muted-foreground" /></div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label>الطابعة الافتراضية</Label><Select value={settings.defaultPrinter || "__default__"} onValueChange={(value) => void desktop.updateSettings({ defaultPrinter: value === "__default__" ? "" : value }).then(setSettings)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__default__">طابعة Windows الافتراضية</SelectItem>{printers.map((printer) => <SelectItem key={printer.name} value={printer.name}>{printer.displayName || printer.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>حجم الورق</Label><Select value={settings.paperSize} onValueChange={(value: DesktopSettings["paperSize"]) => void desktop.updateSettings({ paperSize: value }).then(setSettings)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="A4">A4</SelectItem><SelectItem value="80mm">حراري 80mm</SelectItem><SelectItem value="58mm">حراري 58mm</SelectItem></SelectContent></Select></div>
          </div>
          <div className="mt-4 divide-y divide-border/40">
            {([
              ["silentPrint", "الطباعة الصامتة", "تطبع مباشرة باستخدام الطابعة الافتراضية."],
              ["launchAtStartup", "التشغيل مع Windows", "فتح AJN تلقائياً عند تسجيل الدخول."],
              ["fullscreen", "ملء الشاشة", "فتح التطبيق في وضع ملء الشاشة."],
              ["kiosk", "وضع Kiosk", "تثبيت التطبيق بملء الشاشة حتى إلغاء الخيار."],
            ] as const).map(([key, title, description]) => <div key={key} className="flex items-center justify-between gap-4 py-3"><div><p className="text-sm font-medium">{title}</p><p className="text-xs text-muted-foreground">{description}</p></div><Switch checked={settings[key]} onCheckedChange={(checked) => void desktop.updateSettings({ [key]: checked }).then(setSettings)} aria-label={title} /></div>)}
          </div>
          <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => void desktop.reload()}><RefreshCw />إعادة تحميل</Button><Button size="sm" variant="outline" onClick={() => void act("updates", async () => { const result = await desktop.checkUpdates(); if (!result.enabled && result.message) throw new Error(result.message); }, "تم فحص التحديثات")} disabled={busy !== null}><MonitorCog />فحص التحديث</Button></div>
        </section> : null}
      </div>
    </div>
  );
}

