import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, Computer, Copy, Loader2, Printer, RefreshCw, RotateCcw, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, apiErrorMessage } from "./_lib";

type Agent = {
  id: number; agentId: string; name: string; branchId: number | null; hostname: string | null; appVersion: string | null;
  detectedPrinters: Array<{ name: string; displayName?: string; isDefault?: boolean }>;
  lastSeenAt: string | null; status: string; liveStatus: "online" | "offline" | "disabled";
};
type PrinterRow = {
  id: number; agentId: number; name: string; displayName: string | null; paperSize: "80mm" | "58mm";
  defaultCopies: number; horizontalOffsetMm: string; verticalOffsetMm: string; isDefault: boolean; isActive: boolean;
  agent: { id: number; name: string; agentId: string } | null;
};
type PrinterSaveResult = { printer: PrinterRow; operation: "created" | "updated" };
type Job = {
  id: number; jobNo: string; invoiceId: number | null; status: "queued" | "claimed" | "printing" | "printed" | "failed" | "cancelled";
  paperSize: string; copies: number; requestedByName: string; requestedAt: string; errorMessage: string | null; retryCount: number;
};

const statusLabel: Record<Job["status"], string> = {
  queued: "بانتظار الطباعة", claimed: "تم استلام المهمة", printing: "جاري الطباعة", printed: "تمت الطباعة", failed: "فشل الطباعة", cancelled: "ملغي",
};
const agentLabel: Record<Agent["liveStatus"], string> = { online: "متصل", offline: "غير متصل", disabled: "معطل" };

function time(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("ar-IQ-u-nu-latn") : "—";
}

export default function PrintQueuePage() {
  const { toast } = useToast();
  const client = useQueryClient();
  const [agentName, setAgentName] = useState("");
  const [agentCode, setAgentCode] = useState("");
  const [registrationToken, setRegistrationToken] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [selectedDetectedPrinter, setSelectedDetectedPrinter] = useState("");
  const [paperSize, setPaperSize] = useState<"80mm" | "58mm">("80mm");
  const [defaultCopies, setDefaultCopies] = useState(1);
  const [horizontalOffsetMm, setHorizontalOffsetMm] = useState(0);
  const [verticalOffsetMm, setVerticalOffsetMm] = useState(0);
  const [isDefault, setIsDefault] = useState(false);
  const [status, setStatus] = useState<Job["status"] | "all">("all");
  const [agentToRemove, setAgentToRemove] = useState<Agent | null>(null);

  const agents = useQuery<{ agents: Agent[] }>({ queryKey: ["admin", "print-agents"], queryFn: () => adminFetch("/admin/print-agents"), refetchInterval: 30_000 });
  const printers = useQuery<{ printers: PrinterRow[] }>({ queryKey: ["admin", "remote-printers"], queryFn: () => adminFetch("/admin/printers"), refetchInterval: 30_000 });
  const jobs = useQuery<{ jobs: Job[] }>({ queryKey: ["admin", "print-jobs", status], queryFn: () => adminFetch(`/admin/print-jobs${status === "all" ? "" : `?status=${status}`}`), refetchInterval: 10_000 });
  const selectedAgent = useMemo(() => (agents.data?.agents ?? []).find((agent) => String(agent.id) === selectedAgentId), [agents.data?.agents, selectedAgentId]);
  const selectedExistingPrinter = useMemo(() => (printers.data?.printers ?? []).find((printer) => printer.agentId === Number(selectedAgentId) && printer.name === selectedDetectedPrinter), [printers.data?.printers, selectedAgentId, selectedDetectedPrinter]);

  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["admin", "print-agents"] }),
      client.invalidateQueries({ queryKey: ["admin", "remote-printers"] }),
      client.invalidateQueries({ queryKey: ["admin", "print-jobs"] }),
    ]);
  };

  const createAgent = useMutation({
    mutationFn: () => adminFetch<{ registrationToken: string }>("/admin/print-agents", { method: "POST", body: JSON.stringify({ name: agentName, agentId: agentCode || undefined }) }),
    onSuccess: (result) => {
      setRegistrationToken(result.registrationToken); setAgentName(""); setAgentCode(""); void refresh();
      toast({ title: "تم إنشاء جهاز الطباعة", description: "انسخ رمز التسجيل الآن؛ سيظهر مرة واحدة فقط." });
    },
    onError: (error) => toast({ title: "تعذر إضافة جهاز الطباعة", description: apiErrorMessage(error), variant: "destructive" }),
  });
  const savePrinter = useMutation({
    mutationFn: () => adminFetch<PrinterSaveResult>("/admin/printers", {
      method: "POST",
      body: JSON.stringify({ agentId: Number(selectedAgentId), name: selectedDetectedPrinter, paperSize, defaultCopies, isDefault, horizontalOffsetMm, verticalOffsetMm }),
    }),
    onSuccess: async (result) => {
      await refresh();
      toast({ title: result.operation === "updated" ? "تم تحديث إعدادات الطابعة" : "تمت إضافة الطابعة بنجاح" });
    },
    onError: (error) => toast({ title: "تعذر حفظ الطابعة", description: apiErrorMessage(error), variant: "destructive" }),
  });
  const action = useMutation({
    mutationFn: ({ job, action }: { job: Job; action: "retry" | "cancel" }) => adminFetch(`/admin/print-jobs/${job.id}/${action}`, { method: "POST", body: "{}" }),
    onSuccess: () => { void refresh(); toast({ title: "تم تحديث مهمة الطباعة" }); },
    onError: (error) => toast({ title: "تعذر تحديث المهمة", description: apiErrorMessage(error), variant: "destructive" }),
  });
  const removeAgent = useMutation({
    mutationFn: (agentId: number) => adminFetch(`/admin/print-agents/${agentId}`, { method: "PATCH", body: JSON.stringify({ disabled: true }) }),
    onSuccess: async () => {
      if (selectedAgentId === String(agentToRemove?.id)) selectAgent("");
      setAgentToRemove(null);
      await refresh();
      toast({ title: "تم إلغاء تسجيل جهاز Windows", description: "لن يتمكن الجهاز من استقبال مهام طباعة جديدة." });
    },
    onError: (error) => toast({ title: "تعذر حذف الجهاز", description: apiErrorMessage(error), variant: "destructive" }),
  });

  const selectAgent = (agentId: string) => {
    setSelectedAgentId(agentId); setSelectedDetectedPrinter(""); setPaperSize("80mm"); setDefaultCopies(1); setHorizontalOffsetMm(0); setVerticalOffsetMm(0); setIsDefault(false);
  };
  const selectPrinter = (name: string) => {
    const existing = (printers.data?.printers ?? []).find((printer) => printer.agentId === Number(selectedAgentId) && printer.name === name);
    const agentHasDefault = (printers.data?.printers ?? []).some((printer) => printer.agentId === Number(selectedAgentId) && printer.isDefault);
    setSelectedDetectedPrinter(name);
    setPaperSize(existing?.paperSize ?? "80mm");
    setDefaultCopies(existing?.defaultCopies ?? 1);
    setHorizontalOffsetMm(Number(existing?.horizontalOffsetMm ?? 0));
    setVerticalOffsetMm(Number(existing?.verticalOffsetMm ?? 0));
    setIsDefault(existing?.isDefault ?? !agentHasDefault);
  };

  return <main className="space-y-5" dir="rtl">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-2xl font-bold text-foreground">طابور الطباعة</h1><p className="mt-1 text-sm text-muted-foreground">تُرسل الفاتورة من الهاتف إلى جهاز Windows المخصص ثم إلى الطابعة الحرارية.</p></div>
      <Button variant="outline" onClick={() => void refresh()} className="gap-2"><RefreshCw className="h-4 w-4" />تحديث الحالة</Button>
    </header>

    {registrationToken ? <section className="rounded-xl border border-status-warning/50 bg-status-warning/10 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold text-foreground">رمز تسجيل جهاز الطباعة — يظهر مرة واحدة</h2><p className="mt-1 text-xs text-muted-foreground">أدخله في AJN Print Agent على جهاز Windows. لا تحفظه في محادثة أو ملف عام.</p><code className="mt-3 block max-w-full overflow-x-auto rounded-md bg-background px-3 py-2 text-xs text-foreground" dir="ltr">{registrationToken}</code></div><Button variant="outline" size="sm" onClick={() => navigator.clipboard?.writeText(registrationToken)} className="gap-1"><Copy className="h-4 w-4" />نسخ</Button></div><Button variant="ghost" size="sm" className="mt-2" onClick={() => setRegistrationToken(null)}>أغلقت الرمز بعد نسخه</Button></section> : null}

    <section className="grid gap-4 xl:grid-cols-[1fr_1.3fr]">
      <div className="rounded-xl border border-border/40 bg-card p-4"><div className="mb-3 flex items-center gap-2 font-semibold"><Computer className="h-4 w-4 text-primary" />إضافة جهاز طباعة</div><div className="grid gap-2"><input value={agentName} onChange={(event) => setAgentName(event.target.value)} placeholder="اسم الجهاز: حاسبة المحل الرئيسية" className="rounded-md border border-input bg-background px-3 py-2 text-sm" /><input value={agentCode} onChange={(event) => setAgentCode(event.target.value)} placeholder="Agent ID اختياري: AJN-PRINT-001" className="rounded-md border border-input bg-background px-3 py-2 text-sm" dir="ltr" /><Button onClick={() => createAgent.mutate()} disabled={createAgent.isPending || !agentName.trim()}>{createAgent.isPending ? "جاري الإنشاء..." : "إنشاء رمز التسجيل"}</Button></div></div>
      <div className="rounded-xl border border-border/40 bg-card p-4"><div className="mb-3 flex items-center gap-2 font-semibold"><Printer className="h-4 w-4 text-primary" />إعداد طابعة Windows المكتشفة</div><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4"><select value={selectedAgentId} onChange={(event) => selectAgent(event.target.value)} className="rounded-md border border-input bg-background px-3 py-2 text-sm"><option value="">اختر جهاز Windows</option>{(agents.data?.agents ?? []).filter((agent) => agent.liveStatus !== "disabled").map((agent) => <option key={agent.id} value={agent.id}>{agent.name} — {agentLabel[agent.liveStatus]}</option>)}</select><select value={selectedDetectedPrinter} onChange={(event) => selectPrinter(event.target.value)} disabled={!selectedAgent} className="rounded-md border border-input bg-background px-3 py-2 text-sm"><option value="">اختر طابعة Windows</option>{selectedAgent?.detectedPrinters.map((printer) => <option key={printer.name} value={printer.name}>{printer.displayName || printer.name}</option>)}</select><div className="flex gap-2"><select aria-label="عرض الورق" value={paperSize} onChange={(event) => setPaperSize(event.target.value as "80mm" | "58mm")} className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-2 text-sm"><option value="80mm">80mm</option><option value="58mm">58mm</option></select><input aria-label="عدد النسخ الافتراضي" type="number" min={1} max={10} value={defaultCopies} onChange={(event) => setDefaultCopies(Math.max(1, Math.min(10, Number(event.target.value) || 1)))} className="w-16 rounded-md border border-input bg-background px-2 py-2 text-sm" /></div><div className="flex items-center justify-between gap-2"><label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={isDefault} onChange={(event) => setIsDefault(event.target.checked)} />الطابعة الافتراضية</label><Button onClick={() => savePrinter.mutate()} disabled={savePrinter.isPending || !selectedAgentId || !selectedDetectedPrinter}>{savePrinter.isPending ? "جاري الحفظ..." : selectedExistingPrinter ? "تحديث الطابعة" : "حفظ الطابعة"}</Button></div></div></div>
    </section>

    {selectedExistingPrinter ? <section className="rounded-xl border border-border/40 bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">معايرة الطابعة الحرارية</h2><p className="mt-1 text-xs text-muted-foreground">للتصحيح الفيزيائي لطابعة XP-80C فقط. اترك القيم 0mm عندما يكون القالب مضبوطاً.</p></div><Button variant="outline" onClick={() => savePrinter.mutate()} disabled={savePrinter.isPending}>{savePrinter.isPending ? "جاري الحفظ..." : "حفظ المعايرة"}</Button></div>
      <div className="mt-3 grid max-w-lg gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm"><span>الإزاحة الأفقية (mm)</span><input type="number" min={-5} max={5} step={0.1} value={horizontalOffsetMm} onChange={(event) => setHorizontalOffsetMm(Math.max(-5, Math.min(5, Number(event.target.value) || 0)))} className="rounded-md border border-input bg-background px-3 py-2" /></label><label className="grid gap-1 text-sm"><span>الإزاحة العمودية (mm)</span><input type="number" min={-5} max={5} step={0.1} value={verticalOffsetMm} onChange={(event) => setVerticalOffsetMm(Math.max(-5, Math.min(5, Number(event.target.value) || 0)))} className="rounded-md border border-input bg-background px-3 py-2" /></label></div>
    </section> : null}

    <section className="rounded-xl border border-border/40 bg-card"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/30 p-4"><div className="font-semibold">مهام فواتير المبيعات</div><select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className="rounded-md border border-input bg-background px-3 py-2 text-sm"><option value="all">كل الحالات</option>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="overflow-x-auto"><table className="min-w-[760px] w-full text-right text-sm"><thead className="bg-muted/30 text-xs text-muted-foreground"><tr><th className="p-3">المهمة</th><th className="p-3">الفاتورة</th><th className="p-3">الحالة</th><th className="p-3">النسخ</th><th className="p-3">الطالب</th><th className="p-3">الوقت</th><th className="p-3">إجراء</th></tr></thead><tbody>{jobs.isLoading ? <tr><td colSpan={7} className="p-8 text-center text-muted-foreground"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr> : !(jobs.data?.jobs ?? []).length ? <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">لا توجد مهام مطابقة.</td></tr> : jobs.data!.jobs.map((job) => <tr key={job.id} className="border-t border-border/20"><td className="p-3 font-mono text-xs" dir="ltr">{job.jobNo}</td><td className="p-3">#{job.invoiceId ?? "—"}</td><td className="p-3"><span className="inline-flex items-center gap-1 font-medium">{job.status === "printed" ? <CheckCircle2 className="h-3.5 w-3.5 text-status-success" /> : job.status === "failed" ? <CircleAlert className="h-3.5 w-3.5 text-status-danger" /> : <Printer className="h-3.5 w-3.5 text-primary" />}{statusLabel[job.status]}</span>{job.errorMessage ? <p className="mt-1 max-w-48 truncate text-[11px] text-status-danger" title={job.errorMessage}>{job.errorMessage}</p> : null}</td><td className="p-3">{job.copies} · {job.paperSize}</td><td className="p-3">{job.requestedByName || "النظام"}</td><td className="p-3 text-xs text-muted-foreground">{time(job.requestedAt)}</td><td className="p-3">{job.status === "failed" ? <Button size="sm" variant="outline" onClick={() => action.mutate({ job, action: "retry" })} disabled={action.isPending} className="gap-1"><RotateCcw className="h-3.5 w-3.5" />إعادة</Button> : job.status === "queued" ? <Button size="sm" variant="ghost" onClick={() => action.mutate({ job, action: "cancel" })} disabled={action.isPending} className="gap-1 text-status-danger"><XCircle className="h-3.5 w-3.5" />إلغاء</Button> : "—"}</td></tr>)}</tbody></table></div></section>

    <section className="rounded-xl border border-border/40 bg-card p-4"><div className="mb-3 flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">أجهزة Windows</h2><p className="mt-1 text-xs text-muted-foreground">حذف الجهاز يلغي تسجيله ويمنع اتصاله، مع الاحتفاظ بسجل مهام الطباعة.</p></div></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{(agents.data?.agents ?? []).filter((agent) => agent.liveStatus !== "disabled").map((agent) => <article key={agent.id} className="rounded-lg border border-border/35 bg-background/40 p-3"><div className="flex items-center justify-between gap-2"><strong>{agent.name}</strong><span className="text-xs font-semibold">{agentLabel[agent.liveStatus]}</span></div><p className="mt-1 font-mono text-xs text-muted-foreground" dir="ltr">{agent.agentId}</p><p className="mt-2 text-xs text-muted-foreground">{agent.hostname || "بانتظار التسجيل"} · آخر اتصال {time(agent.lastSeenAt)}</p><div className="mt-3 flex items-center justify-between gap-2"><p className="text-xs text-muted-foreground">{agent.detectedPrinters.length} طابعة مكتشفة</p><Button type="button" variant="ghost" size="sm" className="gap-1 text-destructive hover:text-destructive" onClick={() => setAgentToRemove(agent)}><Trash2 className="h-3.5 w-3.5" />حذف الجهاز</Button></div></article>)}{!agents.isLoading && !(agents.data?.agents ?? []).filter((agent) => agent.liveStatus !== "disabled").length ? <p className="text-sm text-muted-foreground">أضف جهازاً ثم ثبّت AJN Print Agent عليه.</p> : null}</div></section>

    <AlertDialog open={Boolean(agentToRemove)} onOpenChange={(open) => !open && !removeAgent.isPending && setAgentToRemove(null)}>
      <AlertDialogContent dir="rtl">
        <AlertDialogHeader className="text-right">
          <AlertDialogTitle>حذف جهاز Windows؟</AlertDialogTitle>
          <AlertDialogDescription>
            سيتم إلغاء تسجيل «{agentToRemove?.name}» فوراً ولن يستطيع استقبال مهام جديدة. تبقى مهام الطباعة السابقة محفوظة في السجل.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:space-x-0">
          <AlertDialogCancel disabled={removeAgent.isPending}>إلغاء</AlertDialogCancel>
          <AlertDialogAction onClick={() => agentToRemove && removeAgent.mutate(agentToRemove.id)} disabled={removeAgent.isPending} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            {removeAgent.isPending ? "جارٍ الحذف..." : "حذف الجهاز"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </main>;
}
