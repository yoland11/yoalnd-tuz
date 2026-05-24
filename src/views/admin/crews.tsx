import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Edit2, Plus, Trash2, UserCog, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch } from "./_lib";
import { EmptyState } from "./_layout";

type Crew = {
  id: number;
  name: string;
  isActive: boolean;
  status: string;
  internalNotes: string;
  createdAt: string | null;
  updatedAt: string | null;
};

type Editing = {
  id?: number;
  name: string;
  isActive: boolean;
  status: string;
  internalNotes: string;
};

const blank: Editing = { name: "", isActive: true, status: "available", internalNotes: "" };

const STATUS_LABELS: Record<string, string> = {
  available: "متاح",
  busy: "مشغول",
  vacation: "إجازة",
  inactive: "غير مفعل",
};

const STATUS_TONES: Record<string, string> = {
  available: "bg-green-500/10 text-green-400 border-green-500/30",
  busy: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  vacation: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  inactive: "bg-red-500/10 text-red-400 border-red-500/30",
};

export default function CrewsPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "crews"],
    queryFn: () => adminFetch<Crew[]>("/admin/crews"),
  });
  const rows = statusFilter ? (data ?? []).filter((crew) => (crew.status ?? (crew.isActive ? "available" : "inactive")) === statusFilter) : (data ?? []);

  const save = useMutation({
    mutationFn: (crew: Editing) => {
      const body = { name: crew.name, isActive: crew.isActive, status: crew.status, internalNotes: crew.internalNotes };
      if (crew.id) return adminFetch(`/admin/crews/${crew.id}`, { method: "PATCH", body: JSON.stringify(body) });
      return adminFetch("/admin/crews", { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "crews"] });
      qc.invalidateQueries({ queryKey: ["crews"] });
      setEditing(null);
    },
  });

  const del = useMutation({
    mutationFn: (id: number) => adminFetch(`/admin/crews/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "crews"] });
      qc.invalidateQueries({ queryKey: ["crews"] });
    },
  });

  const toggle = useMutation({
    mutationFn: (crew: Crew) =>
      adminFetch(`/admin/crews/${crew.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !crew.isActive }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "crews"] });
      qc.invalidateQueries({ queryKey: ["crews"] });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">إدارة الكادر</h1>
        <Button onClick={() => setEditing({ ...blank })} size="sm" className="gap-2">
          <Plus className="w-4 h-4" /> إضافة كادر
        </Button>
      </div>

      <select
        value={statusFilter}
        onChange={(e) => setStatusFilter(e.target.value)}
        className="bg-card border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
      >
        <option value="">كل الحالات</option>
        <option value="available">متاح</option>
        <option value="busy">مشغول</option>
        <option value="vacation">إجازة</option>
        <option value="inactive">غير مفعل</option>
      </select>

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState message="لا يوجد كادر — أضف أول اسم" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {rows.map(crew => {
            const status = crew.status ?? (crew.isActive ? "available" : "inactive");
            return (
            <div key={crew.id} className="bg-card rounded-xl border border-border/30 p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
                    <UserCog className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">{crew.name}</p>
                    <p className="text-xs text-muted-foreground">يظهر في التصوير والألبومات عند التفعيل</p>
                    <span className={`inline-flex mt-2 text-[11px] px-2 py-0.5 rounded-full border ${STATUS_TONES[status] ?? STATUS_TONES.available}`}>
                      {STATUS_LABELS[status] ?? "متاح"}
                    </span>
                  </div>
                </div>
                <label className="inline-flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" checked={crew.isActive} onChange={() => toggle.mutate(crew)} className="accent-primary" />
                  <span className={`text-xs ${crew.isActive ? "text-green-400" : "text-red-400"}`}>{crew.isActive ? "مفعّل" : "معطّل"}</span>
                </label>
              </div>
              {crew.internalNotes && <p className="text-xs text-muted-foreground mb-3 rounded-lg bg-background/50 border border-border/20 p-2">{crew.internalNotes}</p>}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setEditing({ id: crew.id, name: crew.name, isActive: crew.isActive, status, internalNotes: crew.internalNotes ?? "" })}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20"
                >
                  <Edit2 className="w-3.5 h-3.5" /> تعديل
                </button>
                <button
                  onClick={() => confirm("حذف الكادر؟") && del.mutate(crew.id)}
                  className="inline-flex items-center justify-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );})}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" dir="rtl" onClick={() => setEditing(null)}>
          <form
            onSubmit={(e) => { e.preventDefault(); save.mutate(editing); }}
            onClick={(e) => e.stopPropagation()}
            className="bg-card border border-border/40 rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-foreground">{editing.id ? "تعديل كادر" : "كادر جديد"}</h3>
              <button type="button" onClick={() => setEditing(null)}><X className="w-5 h-5 text-muted-foreground" /></button>
            </div>
            <Field label="اسم الكادر *" value={editing.name} onChange={v => setEditing(current => ({ ...current!, name: v }))} required />
            <div>
              <label className="block text-xs text-muted-foreground mb-1">حالة الكادر</label>
              <select value={editing.status} onChange={e => setEditing(current => ({ ...current!, status: e.target.value, isActive: e.target.value !== "inactive" }))}
                className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50">
                <option value="available">متاح</option>
                <option value="busy">مشغول</option>
                <option value="vacation">إجازة</option>
                <option value="inactive">غير مفعل</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">ملاحظات داخلية</label>
              <textarea value={editing.internalNotes} onChange={e => setEditing(current => ({ ...current!, internalNotes: e.target.value }))}
                rows={3}
                className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={editing.isActive} onChange={e => setEditing(current => ({ ...current!, isActive: e.target.checked }))} className="accent-primary" />
              مفعّل
            </label>
            <Button type="submit" disabled={save.isPending} className="w-full">{save.isPending ? "جاري الحفظ..." : "حفظ"}</Button>
          </form>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, required = false }: { label: string; value: string; onChange: (v: string) => void; required?: boolean }) {
  return (
    <div>
      <label className="block text-xs text-muted-foreground mb-1">{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} required={required}
        className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50" />
    </div>
  );
}
