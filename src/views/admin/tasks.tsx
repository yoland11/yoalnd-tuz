import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CheckCircle2, Filter, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { adminFetch } from "./_lib";
import { EmptyState } from "./_layout";

type Staff = { id: number; username: string; fullName: string; role: string; isActive: boolean };
type Task = {
  id: number;
  title: string;
  description: string;
  status: string;
  priority: string;
  dueAt: string | null;
  assignedStaffIds: number[];
  assignedStaff: Staff[];
  relatedType: string | null;
  relatedId: number | null;
  entityProgress?: { total: number; completed: number; percent: number } | null;
  notes: string;
  createdAt: string | null;
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

  const { data, isLoading } = useQuery<{ data: Task[]; staff: Staff[] }>({
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
                      <p className="font-semibold text-foreground">{task.title}</p>
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
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {task.status !== "completed" && (
                        <Button size="sm" variant="outline" onClick={() => update.mutate({ id: task.id, patch: { status: "completed" } })}>إكمال</Button>
                      )}
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
