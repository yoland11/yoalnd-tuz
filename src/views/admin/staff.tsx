import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Edit2, Trash2, X, UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch, ALL_PERMISSIONS, PERMISSION_LABELS } from "./_lib";
import { EmptyState } from "./_layout";
import { useToast } from "@/hooks/use-toast";

type Staff = {
  id: number; username: string; fullName: string; role: string;
  permissions: string[]; isActive: boolean; createdAt: string; lastActivityAt?: string | null;
};

const PERMISSIONS = ALL_PERMISSIONS.map(id => ({ id, label: PERMISSION_LABELS[id] }));

const ROLES = [
  { value: "admin", label: "مدير رئيسي" },
  { value: "manager", label: "مدير" },
  { value: "booking_staff", label: "موظف حجوزات" },
  { value: "photographer", label: "موظف تصوير" },
  { value: "accountant", label: "محاسب" },
  { value: "employee", label: "موظف عام" },
];

type Editing = {
  id?: number; username: string; password: string; fullName: string;
  role: string; permissions: string[]; isActive: boolean;
};

const ROLE_PRESETS: Record<string, string[]> = {
  manager: ["dashboard", "orders", "bookings", "services", "products", "gallery", "delivery", "customers", "staff", "settings", "invoices", "whatsapp", "accounting", "tasks"],
  booking_staff: ["dashboard", "orders", "bookings", "customers", "invoices", "whatsapp", "tasks"],
  photographer: ["dashboard", "orders", "bookings", "gallery", "services", "whatsapp", "tasks"],
  accountant: ["dashboard", "orders", "bookings", "customers", "invoices", "accounting", "tasks"],
  employee: ["dashboard", "tasks"],
  staff: ["dashboard", "tasks"],
};

const blank: Editing = { username: "", password: "", fullName: "", role: "booking_staff", permissions: ROLE_PRESETS.booking_staff, isActive: true };

function roleLabel(role: string): string {
  if (role === "staff") return "موظف عام";
  return ROLES.find(r => r.value === role)?.label ?? role;
}

function cleanErrorMessage(err: any): string {
  return String(err?.message ?? "فشل الاتصال بالخادم").replace(/^HTTP\s+\d+:\s*/, "");
}

export default function StaffPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "staff"],
    queryFn: () => adminFetch<Staff[]>("/admin/staff"),
  });
  const [editing, setEditing] = useState<Editing | null>(null);

  const save = useMutation({
    mutationFn: (e: Editing) => {
      const body: any = { fullName: e.fullName ?? "", role: e.role, permissions: e.permissions ?? [], isActive: e.isActive };
      if (e.password) body.password = e.password;
      if (e.id) return adminFetch(`/admin/staff/${e.id}`, { method: "PATCH", body: JSON.stringify(body) });
      if (!e.username.trim()) throw new Error("اسم المستخدم مطلوب");
      if (!e.password.trim()) throw new Error("كلمة المرور مطلوبة");
      body.username = e.username.trim();
      return adminFetch("/admin/staff", { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "staff"] }); setEditing(null); toast({ title: "تم حفظ الموظف" }); },
    onError: (err: any) => toast({ title: "تعذر حفظ الموظف", description: cleanErrorMessage(err), variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: (id: number) => adminFetch(`/admin/staff/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "staff"] }),
    onError: (err: any) => toast({ title: "تعذر حذف الموظف", description: cleanErrorMessage(err), variant: "destructive" }),
  });

  const toggle = useMutation({
    mutationFn: (s: Staff) => adminFetch(`/admin/staff/${s.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !s.isActive }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "staff"] }),
    onError: (err: any) => toast({ title: "تعذر تحديث الموظف", description: cleanErrorMessage(err), variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">الموظفون والصلاحيات</h1>
        <Button onClick={() => setEditing({ ...blank })} size="sm" className="gap-2">
          <Plus className="w-4 h-4" /> إضافة موظف
        </Button>
      </div>

      {isLoading ? <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      : !data || data.length === 0 ? <EmptyState message="لا يوجد موظفون — أضف أول موظف" /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {data.map(s => (
            <div key={s.id} className="bg-card rounded-xl border border-border/30 p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
                    <UserCog className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">{s.fullName || s.username}</p>
                    <p className="text-xs text-muted-foreground">@{s.username} • {roleLabel(s.role)}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      آخر نشاط: {s.lastActivityAt ? new Date(s.lastActivityAt).toLocaleString("ar-IQ") : "لا يوجد"}
                    </p>
                  </div>
                </div>
                <label className={`inline-flex items-center gap-1 ${s.role === "admin" ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}>
                  <input
                    type="checkbox"
                    checked={s.isActive}
                    onChange={() => s.role !== "admin" && toggle.mutate(s)}
                    disabled={s.role === "admin"}
                    className="accent-primary"
                  />
                  <span className={`text-xs ${s.isActive ? "text-status-success" : "text-status-danger"}`}>{s.isActive ? "مفعّل" : "معطّل"}</span>
                </label>
              </div>
              {s.permissions.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {s.permissions.map(p => (
                    <span key={p} className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                      {PERMISSIONS.find(perm => perm.id === p)?.label ?? p}
                    </span>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2">
                <button onClick={() => setEditing({ id: s.id, username: s.username, password: "", fullName: s.fullName, role: s.role === "staff" ? "employee" : s.role, permissions: s.permissions, isActive: s.isActive })}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20">
                  <Edit2 className="w-3.5 h-3.5" /> تعديل
                </button>
                {s.role !== "admin" && (
                  <button onClick={() => confirm("حذف الموظف؟") && del.mutate(s.id)}
                    className="inline-flex items-center justify-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-status-danger/10 text-status-danger border border-status-danger/30 hover:bg-status-danger/20">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" dir="rtl" onClick={() => setEditing(null)}>
          <form onSubmit={e => { e.preventDefault(); save.mutate(editing); }} onClick={e => e.stopPropagation()}
            className="bg-card border border-border/40 rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-foreground">{editing.id ? "تعديل موظف" : "موظف جديد"}</h3>
              <button type="button" onClick={() => setEditing(null)}><X className="w-5 h-5 text-muted-foreground" /></button>
            </div>
            <Field label="الاسم الكامل" value={editing.fullName} onChange={v => setEditing(s => ({ ...s!, fullName: v }))} />
            {!editing.id && <Field label="اسم المستخدم" value={editing.username} onChange={v => setEditing(s => ({ ...s!, username: v }))} />}
            <Field label={editing.id ? "كلمة مرور جديدة (اتركه فارغ للإبقاء)" : "كلمة المرور"} type="password"
              value={editing.password} onChange={v => setEditing(s => ({ ...s!, password: v }))} />
            <div>
              <label className="block text-xs text-muted-foreground mb-1">الدور</label>
              <select
                value={editing.role}
                onChange={e => {
                  const role = e.target.value;
                  setEditing(s => ({ ...s!, role, permissions: ROLE_PRESETS[role] ?? s!.permissions }));
                }}
                disabled={editing.role === "admin"}
                className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-70"
              >
                {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-2">الصلاحيات</label>
              <div className="grid grid-cols-2 gap-2">
                {PERMISSIONS.map(p => (
                  <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={editing.permissions.includes(p.id)}
                      disabled={editing.role === "admin"}
                      onChange={e => setEditing(s => ({ ...s!, permissions: e.target.checked ? [...s!.permissions, p.id] : s!.permissions.filter(x => x !== p.id) }))}
                      className="accent-primary disabled:opacity-70" />
                    {p.label}
                  </label>
                ))}
              </div>
            </div>
            <label className={`flex items-center gap-2 text-sm ${editing.role === "admin" ? "opacity-70" : ""}`}>
              <input
                type="checkbox"
                checked={editing.isActive}
                disabled={editing.role === "admin"}
                onChange={e => setEditing(s => ({ ...s!, isActive: e.target.checked }))}
                className="accent-primary disabled:opacity-70"
              />
              مفعّل
            </label>
            <Button type="submit" disabled={save.isPending} className="w-full">{save.isPending ? "جاري الحفظ..." : "حفظ"}</Button>
          </form>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label className="block text-xs text-muted-foreground mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
    </div>
  );
}
