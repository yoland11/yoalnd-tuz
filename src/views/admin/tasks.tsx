import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CheckCircle2, Filter, Plus, Trash2, Send, Upload, ClipboardList, MapPin, Pencil, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TaskPhotoGallery, TaskPhotoPicker, type TaskPhoto } from "@/components/task-photo-gallery";
import { useToast } from "@/hooks/use-toast";
import { uploadImageWithVariants } from "@/lib/large-image-upload";
import { adminFetch } from "./_lib";
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
  location?: string | null;
  assignedStaffIds: number[];
  assignedStaff: Staff[];
  relatedType: string | null;
  relatedId: number | null;
  entityProgress?: { total: number; completed: number; percent: number } | null;
  notes: string;
  attachments?: string[];
  completionNotes?: string;
  completedBy?: number | null;
  managerPhotos?: TaskPhoto[];
  employeePhotos?: TaskPhoto[];
  comments?: Array<{ id: number; body: string; createdAt: string; staff?: Staff | null }>;
  timeline?: Array<{ id: number; title: string; body?: string | null; createdAt: string; actorName?: string | null }>;
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
  location: "",
  attachments: [] as string[],
  managerPhotos: [] as TaskPhoto[],
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
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);

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
          <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="الموقع" className="min-h-11 w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" />
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
          <TaskPhotoPicker photos={form.managerPhotos} onChange={(managerPhotos) => setForm({ ...form, managerPhotos })} label="صور وتوضيحات من المدير" description="اختيارية — ارفع صوراً من المعرض أو التقطها بالكاميرا." />
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
                      <Button type="button" size="sm" variant="outline" className="min-h-10 gap-1" onClick={() => setEditingTaskId(task.id)}><Pencil className="h-3.5 w-3.5" />تعديل المهمة</Button>
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
      <TaskEditDialog taskId={editingTaskId} staff={data?.staff ?? []} open={editingTaskId !== null} onOpenChange={(open) => { if (!open) setEditingTaskId(null); }} onSaved={() => { setEditingTaskId(null); qc.invalidateQueries({ queryKey: ["admin", "tasks"] }); }} />
    </div>
  );
}

function ChecklistComposer({ items, onChange }: { items: Array<{ title: string; requiredQuantity: number }>; onChange: (items: Array<{ title: string; requiredQuantity: number }>) => void }) {
  const [title, setTitle] = useState(""); const [quantity, setQuantity] = useState("1");
  return <div className="rounded-lg border border-border/30 bg-background/40 p-3"><div className="mb-2 flex items-center gap-2 text-sm font-medium"><ClipboardList className="h-4 w-4 text-primary" />قائمة التنفيذ</div><div className="flex gap-2"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="اسم البند" className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-sm" /><input type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="w-20 rounded-md border bg-background px-2 py-1.5 text-sm" /><Button type="button" size="sm" variant="outline" onClick={() => { const requiredQuantity = Number(quantity); if (title.trim() && requiredQuantity > 0) { onChange([...items, { title: title.trim(), requiredQuantity }]); setTitle(""); setQuantity("1"); } }}>إضافة</Button></div>{items.length > 0 && <div className="mt-2 space-y-1">{items.map((item, index) => <div key={`${item.title}-${index}`} className="flex items-center justify-between rounded bg-background px-2 py-1 text-xs"><span>{item.title} · {item.requiredQuantity}</span><button type="button" className="text-destructive" onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}>حذف</button></div>)}</div>}</div>;
}

function localDateTime(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function TaskEditDialog({ taskId, staff, open, onOpenChange, onSaved }: { taskId: number | null; staff: Staff[]; open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
  const { toast } = useToast();
  const detail = useQuery<Task>({
    queryKey: ["admin", "tasks", "detail", taskId],
    queryFn: () => adminFetch(`/admin/tasks/${taskId}`),
    enabled: open && Boolean(taskId),
  });
  const [edit, setEdit] = useState({
    title: "", description: "", assignedStaffIds: [] as number[], relatedType: "", relatedId: "", department: "", priority: "medium",
    taskType: "other", startAt: "", dueAt: "", location: "", notes: "", attachmentsText: "", status: "new", managerPhotos: [] as TaskPhoto[],
  });
  useEffect(() => {
    if (!detail.data) return;
    const task = detail.data;
    setEdit({
      title: task.title ?? "", description: task.description ?? "", assignedStaffIds: task.assignedStaffIds ?? [], relatedType: task.relatedType ?? "",
      relatedId: task.relatedId ? String(task.relatedId) : "", department: task.department ?? "", priority: task.priority ?? "medium", taskType: task.taskType ?? "other",
      startAt: localDateTime(task.startAt), dueAt: localDateTime(task.dueAt), location: task.location ?? "", notes: task.notes ?? "",
      attachmentsText: (task.attachments ?? []).join("\n"), status: task.status ?? "new", managerPhotos: task.managerPhotos ?? [],
    });
  }, [detail.data]);
  const save = useMutation({
    mutationFn: () => adminFetch(`/admin/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({
        title: edit.title, description: edit.description, assignedStaffIds: edit.assignedStaffIds, relatedType: edit.relatedType || null,
        relatedId: edit.relatedId ? Number(edit.relatedId) : null, department: edit.department || null, priority: edit.priority, taskType: edit.taskType,
        startAt: edit.startAt || null, dueAt: edit.dueAt || null, location: edit.location || null, notes: edit.notes || null,
        attachments: edit.attachmentsText.split("\n").map((value) => value.trim()).filter(Boolean), status: protectedStatus ? undefined : edit.status, managerPhotos: edit.managerPhotos,
      }),
    }),
    onSuccess: () => { toast({ title: "تم تعديل المهمة مع الحفاظ على رقمها وسجلها" }); onSaved(); },
    onError: (error: any) => toast({ title: "تعذر تعديل المهمة", description: error?.message, variant: "destructive" }),
  });
  const toggleStaff = (staffId: number) => setEdit((current) => ({ ...current, assignedStaffIds: current.assignedStaffIds.includes(staffId) ? current.assignedStaffIds.filter((id) => id !== staffId) : [...current.assignedStaffIds, staffId] }));
  const protectedStatus = detail.data && ["review", "completed"].includes(detail.data.status);

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent dir="rtl" className="max-w-4xl gap-0 p-0">
      <DialogHeader className="border-b border-border px-5 py-4 text-right">
        <DialogTitle>تعديل المهمة {detail.data?.taskNo || (taskId ? `#${taskId}` : "")}</DialogTitle>
        <DialogDescription>يتم تحديث نفس المهمة مع الاحتفاظ بالتقدم والصور والتعليقات والسجل.</DialogDescription>
      </DialogHeader>
      {detail.isLoading ? <div className="space-y-3 p-5"><Skeleton className="h-11" /><Skeleton className="h-32" /><Skeleton className="h-40" /></div> : detail.isError ? <div className="p-5 text-sm text-destructive">تعذر تحميل تفاصيل المهمة: {(detail.error as Error)?.message}</div> : detail.data ? <form onSubmit={(event) => { event.preventDefault(); save.mutate(); }} className="space-y-5 p-4 sm:p-5">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 md:col-span-2"><span className="text-xs font-bold">العنوان</span><input required value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} className="min-h-11 w-full rounded-lg border bg-background px-3 text-sm" /></label>
          <label className="space-y-1 md:col-span-2"><span className="text-xs font-bold">الوصف</span><textarea value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} rows={3} className="w-full rounded-lg border bg-background p-3 text-sm" /></label>
          <label className="space-y-1"><span className="text-xs font-bold">القسم</span><input value={edit.department} onChange={(e) => setEdit({ ...edit, department: e.target.value })} className="min-h-11 w-full rounded-lg border bg-background px-3 text-sm" /></label>
          <label className="space-y-1"><span className="text-xs font-bold">الموقع</span><input value={edit.location} onChange={(e) => setEdit({ ...edit, location: e.target.value })} className="min-h-11 w-full rounded-lg border bg-background px-3 text-sm" /></label>
          <label className="space-y-1"><span className="text-xs font-bold">الأولوية</span><select value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: e.target.value })} className="min-h-11 w-full rounded-lg border bg-background px-3 text-sm">{Object.entries(PRIORITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="space-y-1"><span className="text-xs font-bold">الحالة</span><select value={edit.status} disabled={Boolean(protectedStatus)} onChange={(e) => setEdit({ ...edit, status: e.target.value })} className="min-h-11 w-full rounded-lg border bg-background px-3 text-sm disabled:opacity-60">{protectedStatus ? <option value={edit.status}>{STATUS_LABELS[edit.status] ?? edit.status}</option> : [["new", "جديدة"], ["in_progress", "قيد التنفيذ"], ["cancelled", "ملغية"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="space-y-1"><span className="text-xs font-bold">تاريخ ووقت البدء</span><input type="datetime-local" value={edit.startAt} onChange={(e) => setEdit({ ...edit, startAt: e.target.value })} className="min-h-11 w-full rounded-lg border bg-background px-3 text-sm" /></label>
          <label className="space-y-1"><span className="text-xs font-bold">الموعد النهائي</span><input type="datetime-local" value={edit.dueAt} onChange={(e) => setEdit({ ...edit, dueAt: e.target.value })} className="min-h-11 w-full rounded-lg border bg-background px-3 text-sm" /></label>
          <label className="space-y-1"><span className="text-xs font-bold">نوع الربط</span><input value={edit.relatedType} onChange={(e) => setEdit({ ...edit, relatedType: e.target.value })} className="min-h-11 w-full rounded-lg border bg-background px-3 text-sm" placeholder="booking" /></label>
          <label className="space-y-1"><span className="text-xs font-bold">رقم الحجز / الربط</span><input inputMode="numeric" value={edit.relatedId} onChange={(e) => setEdit({ ...edit, relatedId: e.target.value.replace(/\D/g, "") })} className="min-h-11 w-full rounded-lg border bg-background px-3 text-sm" /></label>
        </div>
        <section className="rounded-xl border border-border p-3"><h3 className="text-sm font-extrabold">الموظفون المعيّنون</h3><div className="mt-3 flex flex-wrap gap-2">{staff.map((employee) => <button key={employee.id} type="button" onClick={() => toggleStaff(employee.id)} className={`min-h-11 rounded-full border px-4 text-sm ${edit.assignedStaffIds.includes(employee.id) ? "border-primary bg-primary/10 font-bold text-primary" : "border-border text-muted-foreground"}`}>{employee.fullName || employee.username}</button>)}</div></section>
        <TaskPhotoPicker photos={edit.managerPhotos} onChange={(managerPhotos) => setEdit({ ...edit, managerPhotos })} label="صور وتوضيحات من المدير" description="يمكن إضافة الصور أو حذفها أو استبدالها وإضافة ملاحظة لكل صورة." />
        <section className="space-y-3 rounded-xl border border-border p-3"><h3 className="text-sm font-extrabold">صور إنجاز الموظف</h3><TaskPhotoGallery photos={detail.data.employeePhotos ?? []} emptyText="لم يضف الموظف صور إنجاز بعد" /></section>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1"><span className="text-xs font-bold">ملاحظات المدير</span><textarea value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} rows={3} className="w-full rounded-lg border bg-background p-3 text-sm" /></label>
          <label className="space-y-1"><span className="flex items-center gap-1 text-xs font-bold"><Paperclip className="h-3.5 w-3.5" />المرفقات (رابط في كل سطر)</span><textarea value={edit.attachmentsText} onChange={(e) => setEdit({ ...edit, attachmentsText: e.target.value })} rows={3} className="w-full rounded-lg border bg-background p-3 text-sm" /></label>
        </div>
        {(detail.data.submittedAt || detail.data.completedAt || detail.data.completionNotes) ? <div className="rounded-lg bg-primary/5 p-3 text-sm"><div className="flex flex-wrap gap-x-5 gap-y-1">{detail.data.completedBy ? <span><strong>الموظف:</strong> {staff.find((employee) => employee.id === detail.data?.completedBy)?.fullName || `#${detail.data.completedBy}`}</span> : null}{detail.data.submittedAt ? <span><strong>وقت إرسال الإنجاز:</strong> {formatDate(detail.data.submittedAt)}</span> : null}{detail.data.completedAt ? <span><strong>وقت الاعتماد:</strong> {formatDate(detail.data.completedAt)}</span> : null}</div>{detail.data.completionNotes ? <p className="mt-2"><strong>ملاحظات الإنجاز:</strong> {detail.data.completionNotes}</p> : null}</div> : null}
        {(detail.data.comments?.length || detail.data.timeline?.length) ? <div className="grid gap-4 border-t border-border pt-4 md:grid-cols-2"><section><h3 className="mb-2 text-sm font-extrabold">الملاحظات والتقدم</h3><div className="max-h-40 space-y-2 overflow-y-auto">{detail.data.comments?.map((comment) => <div key={comment.id} className="rounded-lg bg-muted/45 p-2 text-xs"><b>{comment.staff?.fullName || comment.staff?.username || "المستخدم"}</b><p className="mt-1 leading-5">{comment.body}</p></div>)}</div></section><section><h3 className="mb-2 text-sm font-extrabold">سجل المهمة</h3><div className="max-h-40 space-y-2 overflow-y-auto">{detail.data.timeline?.map((entry) => <div key={entry.id} className="border-r-2 border-primary/30 pr-2 text-xs"><b>{entry.title}</b><p className="mt-1 text-muted-foreground">{formatDate(entry.createdAt)}</p></div>)}</div></section></div> : null}
        <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t border-border bg-background px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:-mx-5 sm:px-5"><Button type="button" variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>إلغاء</Button><Button type="submit" className="min-h-11" disabled={save.isPending || !edit.title.trim() || !edit.assignedStaffIds.length}>{save.isPending ? "جاري الحفظ..." : "حفظ التعديلات"}</Button></div>
      </form> : null}
    </DialogContent>
  </Dialog>;
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
  async function attach(itemId: number, files: FileList | null) {
    let uploadedCount = 0; let failedCount = 0;
    for (const file of Array.from(files ?? [])) {
      try {
        const image = await uploadImageWithVariants(file, { folder: "uploads/tasks" });
        await adminFetch(`/admin/tasks/${task.id}/items/${itemId}/attachments`, { method: "POST", body: JSON.stringify({ url: image.originalUrl, name: file.name, mediaType: file.type || "image" }) });
        uploadedCount += 1;
      } catch { failedCount += 1; }
    }
    if (uploadedCount) toast({ title: `تم رفع ${uploadedCount.toLocaleString("ar-IQ")} مرفق` });
    if (failedCount) toast({ title: "تعذر رفع بعض الصور", description: "بقيت الصور التي رُفعت بنجاح محفوظة.", variant: "destructive" });
    qc.invalidateQueries({ queryKey: ["admin", "tasks"] });
  }
  const locked = ["review", "completed", "cancelled"].includes(task.status);
  return <article className="rounded-xl border border-border/30 bg-card p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs text-primary">{task.taskNo ?? `#${task.id}`}</p><h2 className="font-semibold">{task.title}</h2><p className="mt-1 text-sm text-muted-foreground">{task.description}</p></div><span className="rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">{STATUS_LABELS[task.status] ?? task.status}</span></div>{task.rejectionReason && <p className="mt-3 rounded-lg bg-destructive/10 p-2 text-sm text-destructive">ملاحظة المدير: {task.rejectionReason}</p>}<div className="mt-4 space-y-2">{items.map((item, index) => <div key={item.id} className="rounded-lg border border-border/20 p-3"><div className="flex items-center justify-between gap-2"><b className="text-sm">{item.title}</b><span className="text-xs text-muted-foreground">{item.completedQuantity} / {item.requiredQuantity}</span></div><div className="mt-2 flex flex-wrap items-center gap-2"><input disabled={locked} type="number" min="0" max={item.requiredQuantity} value={item.completedQuantity} onChange={(event) => setItems(items.map((current, currentIndex) => currentIndex === index ? { ...current, completedQuantity: Math.min(item.requiredQuantity, Math.max(0, Number(event.target.value))) } : current))} className="w-24 rounded-md border bg-background px-2 py-1.5 text-sm" /><label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1.5 text-xs text-primary"><Upload className="h-3.5 w-3.5" />رفع إثبات<input disabled={locked} type="file" multiple accept="image/*,video/*,application/pdf" className="hidden" onChange={(event) => void attach(item.id, event.target.files)} /></label></div></div>)}</div>{!locked && <div className="mt-3 space-y-2"><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="أضف ملاحظة للمدير" className="w-full rounded-lg border bg-background p-2 text-sm" /><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={saving} onClick={() => onProgress(task.id, items.map((item) => ({ id: item.id, completedQuantity: Number(item.completedQuantity) })))}>حفظ التقدم</Button><Button size="sm" disabled={saving} onClick={() => onSubmit(task.id)}><Send className="ml-1 h-4 w-4" />إرسال للمراجعة</Button>{note.trim() && <Button size="sm" variant="ghost" onClick={() => noteMutation.mutate()}>حفظ الملاحظة</Button>}</div></div>}</article>;
}

function ReviewActions({ taskId, onDone }: { taskId: number; onDone: () => void }) {
  const [reason, setReason] = useState(""); const [open, setOpen] = useState(false); const { toast } = useToast(); const review = useMutation({ mutationFn: (action: "approve" | "reject" | "return") => adminFetch(`/admin/tasks/${taskId}/review`, { method: "POST", body: JSON.stringify({ action, reason }) }), onSuccess: () => { setOpen(false); setReason(""); onDone(); toast({ title: "تمت مراجعة المهمة" }); }, onError: (err: any) => toast({ title: "تعذرت مراجعة المهمة", description: err?.message, variant: "destructive" }) }); return <div className="flex flex-wrap gap-1"><Button size="sm" onClick={() => review.mutate("approve")}>اعتماد</Button><Button size="sm" variant="outline" onClick={() => setOpen(!open)}>إرجاع / رفض</Button>{open && <div className="absolute z-20 mt-9 w-64 rounded-lg border bg-card p-2 shadow-lg"><textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="سبب الإرجاع أو الرفض" className="w-full rounded border bg-background p-2 text-xs" /><div className="mt-2 flex gap-1"><Button size="sm" variant="outline" disabled={reason.trim().length < 3} onClick={() => review.mutate("return")}>إرجاع</Button><Button size="sm" variant="destructive" disabled={reason.trim().length < 3} onClick={() => review.mutate("reject")}>رفض</Button></div></div>}</div>;
}
