import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CheckCircle2, Filter, Plus, Trash2, Send, Upload, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, fileToDataUrl } from "./_lib";
import { EmptyState } from "./_layout";

type Staff = { id: number; username: string; fullName: string; role: string; isActive: boolean };
type Task = {
  id: number;
  title: string;
  description: string;
  status: string;
  priority: string;
  taskNo?: string | null;
  department?: string | null;
  taskType?: string;
  startAt?: string | null;
  estimatedMinutes?: number | null;
  submittedAt?: string | null;
  completedAt?: string | null;
  rejectionReason?: string | null;
  dueAt: string | null;
  assignedStaffIds: number[];
  assignedStaff: Staff[];
  relatedType: string | null;
  relatedId: number | null;
  entityProgress?: { total: number; completed: number; percent: number } | null;
  notes: string;
  createdAt: string | null;
  progress?: { required: number; completed: number; percent: number };
  checklistItems?: Array<{ id: number; title: string; requiredQuantity: number; completedQuantity: number }>;
};

const STATUS_LABELS: Record<string, string> = {
  new: "جديدة",
  in_progress: "قيد التنفيذ",
  review: "مراجعة",
  completed: "مكتملة",
  cancelled: "ملغية",
};

const PRIORITY_LABELS: Record<string, string> = {
  low: "منخفضة",
  medium: "متوسطة",
  high: "عالية",
  urgent: "عاجلة",
};

const initialForm = {
  title: "",
  description: "",
  priority: "medium",
  status: "new",
  dueAt: "",
  assignedStaffIds: [] as number[],
  relatedType: "",
  relatedId: "",
  notes: "",
  department: "",
  taskType: "other",
  startAt: new Date().toISOString().slice(0, 16),
  estimatedMinutes: "",
  checklistItems: [] as Array<{ title: string; requiredQuantity: number }> ,
};

function formatDate(value: string | null) {
  if (!value) return "بدون موعد";
  return new Date(value).toLocaleString("ar-IQ", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function TasksPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState(initialForm);
  const [filters, setFilters] = useState({ status: "", priority: "", staffId: "", date: "" });

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    return params.toString();
  }, [filters]);

  const { data, isLoading } = useQuery<{ data: Task[]; staff: Staff[]; canManageAll: boolean; summary: any }>({
    queryKey: ["admin", "tasks", queryString],
    queryFn: () => adminFetch(`/admin/tasks${queryString ? `?${queryString}` : ""}`),
    staleTime: 30_000,
  });

  const save = useMutation({
    mutationFn: () => adminFetch<Task>("/admin/tasks", {
      method: "POST",
      body: JSON.stringify({
        ...form,
        dueAt: form.dueAt || null,
        relatedId: form.relatedId ? Number(form.relatedId) : null,
      }),
    }),
    onSuccess: () => {
      toast({ title: "تم حفظ المهمة" });
      setForm(initialForm);
      qc.invalidateQueries({ queryKey: ["admin", "tasks"] });
      qc.invalidateQueries({ queryKey: ["admin", "dashboard"] });
    },
    onError: (err: any) => toast({ title: "تعذر حفظ المهمة", description: err?.message, variant: "destructive" }),
  });

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<Task> }) => adminFetch<Task>(`/admin/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "tasks"] });
      qc.invalidateQueries({ queryKey: ["admin", "dashboard"] });
    },
    onError: (err: any) => toast({ title: "تعذر تعديل المهمة", description: err?.message, variant: "destructive" }),
  });

  const archive = useMutation({
    mutationFn: (id: number) => adminFetch(`/admin/tasks/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "تم أرشفة المهمة" });
      qc.invalidateQueries({ queryKey: ["admin", "tasks"] });
    },
    onError: (err: any) => toast({ title: "تعذر أرشفة المهمة", description: err?.message, variant: "destructive" }),
  });

  const progress = useMutation({
    mutationFn: ({ id, items }: { id: number; items: Array<{ id: number; completedQuantity: number }> }) => adminFetch(`/admin/tasks/${id}/progress`, { method: "POST", body: JSON.stringify({ items }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "tasks"] }),
    onError: (err: any) => toast({ title: "تعذر حفظ التقدم", description: err?.message, variant: "destructive" }),
  });
  const submit = useMutation({
    mutationFn: (id: number) => adminFetch(`/admin/tasks/${id}/submit`, { method: "POST" }),
    onSuccess: () => { toast({ title: "تم إرسال المهمة للمراجعة" }); qc.invalidateQueries({ queryKey: ["admin", "tasks"] }); },
    onError: (err: any) => toast({ title: "تعذر إرسال المهمة", description: err?.message, variant: "destructive" }),
  });

  if (data && !data.canManageAll) return <EmployeeTasksPage tasks={data.data} saving={progress.isPending || submit.isPending} onProgress={(id, items) => progress.mutate({ id, items })} onSubmit={(id) => submit.mutate(id)} />;

  function toggleStaff(id: number) {
    setForm((current) => ({
      ...current,
      assignedStaffIds: current.assignedStaffIds.includes(id)
        ? current.assignedStaffIds.filter((item) => item !== id)
        : [...current.assignedStaffIds, id],
    }));
  }

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">المهام الداخلية</h1>
          <p className="text-sm text-muted-foreground mt-1">تنظيم مهام الموظفين وربطها بالطلبات أو الحجوزات عند الحاجة.</p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-lg border border-border/40 bg-card px-3 py-2 text-xs text-muted-foreground">
          <CheckCircle2 className="w-4 h-4 text-primary" />
          {(data?.data.length ?? 0).toLocaleString("ar-IQ")} مهمة
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <form
          className="bg-card rounded-xl border border-border/30 p-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Plus className="w-4 h-4 text-primary" /> مهمة جديدة
          </h2>
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="عنوان المهمة"
            className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="وصف مختصر"
            rows={3}
            className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
          />
          <div className="grid grid-cols-2 gap-2">
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm">
              {Object.entries(PRIORITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm">
              {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="القسم" className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm" />
            <select value={form.taskType} onChange={(e) => setForm({ ...form, taskType: e.target.value })} className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm">
              {[['photography','تصوير'],['printing','طباعة'],['flower_bouquet','بوكيهات'],['henna_distribution','توزيع حنّة'],['koshas','كوشات'],['warehouse','مخزن'],['delivery','توصيل'],['editing','مونتاج'],['design','تصميم'],['sales','مبيعات'],['maintenance','صيانة'],['other','أخرى']].map(([value,label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input type="datetime-local" value={form.startAt} onChange={(e) => setForm({ ...form, startAt: e.target.value })} className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm" />
            <input type="number" min="1" value={form.estimatedMinutes} onChange={(e) => setForm({ ...form, estimatedMinutes: e.target.value })} placeholder="الوقت المقدر بالدقائق" className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm" />
          </div>
          <input
            type="datetime-local"
            value={form.dueAt}
            onChange={(e) => setForm({ ...form, dueAt: e.target.value })}
            className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm"
          />
          <div className="grid grid-cols-2 gap-2">
            <input value={form.relatedType} onChange={(e) => setForm({ ...form, relatedType: e.target.value })} placeholder="نوع الربط" className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm" />
            <input value={form.relatedId} onChange={(e) => setForm({ ...form, relatedId: e.target.value.replace(/\D/g, "") })} placeholder="رقم الربط" className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="rounded-lg border border-border/30 bg-background/40 p-3">
            <p className="text-xs text-muted-foreground mb-2">الموظفون</p>
            <div className="flex flex-wrap gap-2">
              {(data?.staff ?? []).map((staff) => (
                <button
                  key={staff.id}
                  type="button"
                  onClick={() => toggleStaff(staff.id)}
                  className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                    form.assignedStaffIds.includes(staff.id)
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border/30 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {staff.fullName || staff.username}
                </button>
              ))}
            </div>
          </div>
          <ChecklistComposer items={form.checklistItems} onChange={(checklistItems) => setForm({ ...form, checklistItems })} />
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="ملاحظات داخلية"
            rows={2}
            className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
          />
          <Button type="submit" className="w-full gap-2" disabled={save.isPending}>
            <Plus className="w-4 h-4" /> حفظ المهمة
          </Button>
        </form>

        <div className="space-y-3">
          <div className="bg-card rounded-xl border border-border/30 p-4">
            <div className="grid gap-2 md:grid-cols-5">
              <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm">
                <option value="">كل الحالات</option>
                {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <select value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })} className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm">
                <option value="">كل الأولويات</option>
                {Object.entries(PRIORITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <select value={filters.staffId} onChange={(e) => setFilters({ ...filters, staffId: e.target.value })} className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm">
                <option value="">كل الموظفين</option>
                {(data?.staff ?? []).map((staff) => <option key={staff.id} value={staff.id}>{staff.fullName || staff.username}</option>)}
              </select>
              <input type="date" value={filters.date} onChange={(e) => setFilters({ ...filters, date: e.target.value })} className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm" />
              <Button type="button" variant="outline" onClick={() => setFilters({ status: "", priority: "", staffId: "", date: "" })} className="gap-2">
                <Filter className="w-4 h-4" /> تصفية
              </Button>
            </div>
          </div>

          {isLoading ? (
            <div className="space-y-2">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-24 rounded-xl" />)}</div>
          ) : !data?.data.length ? (
            <EmptyState message="لا توجد مهام" />
          ) : (
            <div className="space-y-2">
              {data.data.map((task) => (
                <div key={task.id} className="bg-card rounded-xl border border-border/30 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground">{task.taskNo ? <span className="ml-2 text-xs text-primary">{task.taskNo}</span> : null}{task.title}</p>
                      {task.description && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{task.description}</p>}
                      <div className="flex items-center gap-2 flex-wrap mt-3 text-xs text-muted-foreground">
                        <span className="rounded-full bg-primary/10 text-primary px-2.5 py-1">{STATUS_LABELS[task.status] ?? task.status}</span>
                        <span className="rounded-full bg-background border border-border/30 px-2.5 py-1">{PRIORITY_LABELS[task.priority] ?? task.priority}</span>
                        <span className="inline-flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5" /> {formatDate(task.dueAt)}</span>
                        {task.assignedStaff.map((staff) => <span key={staff.id}>{staff.fullName || staff.username}</span>)}
                      </div>
                      {task.entityProgress && task.entityProgress.total > 0 && (
                        <div className="mt-3 max-w-xs">
                          <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                            <span>إنجاز الحجز المرتبط</span>
                            <span>{task.entityProgress.percent}%</span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-background">
                            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${task.entityProgress.percent}%` }} />
                          </div>
                        </div>
                      )}
                      {task.progress && <div className="mt-3 max-w-xs"><div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground"><span>تقدم قائمة التنفيذ</span><span>{task.progress.percent}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-background"><div className="h-full rounded-full bg-primary" style={{ width: `${task.progress.percent}%` }} /></div></div>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {task.status === "review" && <ReviewActions taskId={task.id} onDone={() => qc.invalidateQueries({ queryKey: ["admin", "tasks"] })} />}
                      <button type="button" onClick={() => archive.mutate(task.id)} className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ChecklistComposer({ items, onChange }: { items: Array<{ title: string; requiredQuantity: number }>; onChange: (items: Array<{ title: string; requiredQuantity: number }>) => void }) {
  const [title, setTitle] = useState(""); const [quantity, setQuantity] = useState("1");
  return <div className="rounded-lg border border-border/30 bg-background/40 p-3"><div className="mb-2 flex items-center gap-2 text-sm font-medium"><ClipboardList className="h-4 w-4 text-primary" />قائمة التنفيذ</div><div className="flex gap-2"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="اسم البند" className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-sm" /><input type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="w-20 rounded-md border bg-background px-2 py-1.5 text-sm" /><Button type="button" size="sm" variant="outline" onClick={() => { const requiredQuantity = Number(quantity); if (title.trim() && requiredQuantity > 0) { onChange([...items, { title: title.trim(), requiredQuantity }]); setTitle(""); setQuantity("1"); } }}>إضافة</Button></div>{items.length > 0 && <div className="mt-2 space-y-1">{items.map((item, index) => <div key={`${item.title}-${index}`} className="flex items-center justify-between rounded bg-background px-2 py-1 text-xs"><span>{item.title} · {item.requiredQuantity}</span><button type="button" className="text-destructive" onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}>حذف</button></div>)}</div>}</div>;
}

function EmployeeTasksPage({ tasks, saving, onProgress, onSubmit }: { tasks: Task[]; saving: boolean; onProgress: (id: number, items: Array<{ id: number; completedQuantity: number }>) => void; onSubmit: (id: number) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const open = tasks.filter((task) => !["completed", "cancelled"].includes(task.status));
  const cards = [["مهام اليوم", tasks.filter((task) => task.dueAt?.slice(0, 10) === today).length], ["مكتملة اليوم", tasks.filter((task) => task.status === "completed" && task.completedAt?.slice(0, 10) === today).length], ["بانتظار الاعتماد", tasks.filter((task) => task.status === "review").length], ["متأخرة", tasks.filter((task) => task.dueAt && task.dueAt < new Date().toISOString() && ["new", "in_progress"].includes(task.status)).length], ["نسبة الإنجاز", open.length ? Math.round(open.reduce((sum, task) => sum + (task.progress?.percent ?? 0), 0) / open.length) : 0]];
  return <div dir="rtl" className="space-y-4"><div><h1 className="text-2xl font-bold">مهامي</h1><p className="mt-1 text-sm text-muted-foreground">حدّث الكميات وارفع إثبات التنفيذ ثم أرسل المهمة للمراجعة.</p></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{cards.map(([label, value]) => <div key={String(label)} className="rounded-xl border border-border/30 bg-card p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-bold text-primary">{Number(value).toLocaleString("ar-IQ")}{label === "نسبة الإنجاز" ? "%" : ""}</p></div>)}</div><div className="space-y-3">{tasks.map((task) => <EmployeeTaskCard key={task.id} task={task} saving={saving} onProgress={onProgress} onSubmit={onSubmit} />)}{!tasks.length && <EmptyState message="لا توجد مهام مسندة إليك" />}</div></div>;
}

function EmployeeTaskCard({ task, saving, onProgress, onSubmit }: { task: Task; saving: boolean; onProgress: (id: number, items: Array<{ id: number; completedQuantity: number }>) => void; onSubmit: (id: number) => void }) {
  const [items, setItems] = useState(task.checklistItems ?? []); const [note, setNote] = useState(""); const qc = useQueryClient(); const { toast } = useToast();
  const noteMutation = useMutation({ mutationFn: () => adminFetch(`/admin/tasks/${task.id}/comments`, { method: "POST", body: JSON.stringify({ body: note }) }), onSuccess: () => { setNote(""); toast({ title: "تم حفظ الملاحظة" }); } });
  async function attach(itemId: number, files: FileList | null) { for (const file of Array.from(files ?? [])) { const url = await fileToDataUrl(file); await adminFetch(`/admin/tasks/${task.id}/items/${itemId}/attachments`, { method: "POST", body: JSON.stringify({ url, name: file.name, mediaType: file.type || "file" }) }); } toast({ title: "تم رفع المرفقات" }); qc.invalidateQueries({ queryKey: ["admin", "tasks"] }); }
  const locked = ["review", "completed", "cancelled"].includes(task.status);
  return <article className="rounded-xl border border-border/30 bg-card p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs text-primary">{task.taskNo ?? `#${task.id}`}</p><h2 className="font-semibold">{task.title}</h2><p className="mt-1 text-sm text-muted-foreground">{task.description}</p></div><span className="rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">{STATUS_LABELS[task.status] ?? task.status}</span></div>{task.rejectionReason && <p className="mt-3 rounded-lg bg-destructive/10 p-2 text-sm text-destructive">ملاحظة المدير: {task.rejectionReason}</p>}<div className="mt-4 space-y-2">{items.map((item, index) => <div key={item.id} className="rounded-lg border border-border/20 p-3"><div className="flex items-center justify-between gap-2"><b className="text-sm">{item.title}</b><span className="text-xs text-muted-foreground">{item.completedQuantity} / {item.requiredQuantity}</span></div><div className="mt-2 flex flex-wrap items-center gap-2"><input disabled={locked} type="number" min="0" max={item.requiredQuantity} value={item.completedQuantity} onChange={(event) => setItems(items.map((current, currentIndex) => currentIndex === index ? { ...current, completedQuantity: Math.min(item.requiredQuantity, Math.max(0, Number(event.target.value))) } : current))} className="w-24 rounded-md border bg-background px-2 py-1.5 text-sm" /><label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1.5 text-xs text-primary"><Upload className="h-3.5 w-3.5" />رفع إثبات<input disabled={locked} type="file" multiple accept="image/*,video/*,application/pdf" className="hidden" onChange={(event) => void attach(item.id, event.target.files)} /></label></div></div>)}</div>{!locked && <div className="mt-3 space-y-2"><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="أضف ملاحظة للمدير" className="w-full rounded-lg border bg-background p-2 text-sm" /><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={saving} onClick={() => onProgress(task.id, items.map((item) => ({ id: item.id, completedQuantity: Number(item.completedQuantity) })))}>حفظ التقدم</Button><Button size="sm" disabled={saving} onClick={() => onSubmit(task.id)}><Send className="ml-1 h-4 w-4" />إرسال للمراجعة</Button>{note.trim() && <Button size="sm" variant="ghost" onClick={() => noteMutation.mutate()}>حفظ الملاحظة</Button>}</div></div>}</article>;
}

function ReviewActions({ taskId, onDone }: { taskId: number; onDone: () => void }) {
  const [reason, setReason] = useState(""); const [open, setOpen] = useState(false); const { toast } = useToast(); const review = useMutation({ mutationFn: (action: "approve" | "reject" | "return") => adminFetch(`/admin/tasks/${taskId}/review`, { method: "POST", body: JSON.stringify({ action, reason }) }), onSuccess: () => { setOpen(false); setReason(""); onDone(); toast({ title: "تمت مراجعة المهمة" }); }, onError: (err: any) => toast({ title: "تعذرت مراجعة المهمة", description: err?.message, variant: "destructive" }) }); return <div className="flex flex-wrap gap-1"><Button size="sm" onClick={() => review.mutate("approve")}>اعتماد</Button><Button size="sm" variant="outline" onClick={() => setOpen(!open)}>إرجاع / رفض</Button>{open && <div className="absolute z-20 mt-9 w-64 rounded-lg border bg-card p-2 shadow-lg"><textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="سبب الإرجاع أو الرفض" className="w-full rounded border bg-background p-2 text-xs" /><div className="mt-2 flex gap-1"><Button size="sm" variant="outline" disabled={reason.trim().length < 3} onClick={() => review.mutate("return")}>إرجاع</Button><Button size="sm" variant="destructive" disabled={reason.trim().length < 3} onClick={() => review.mutate("reject")}>رفض</Button></div></div>}</div>;
}
