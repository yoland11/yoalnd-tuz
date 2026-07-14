import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Edit2, Trash2, X, UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch, ALL_PERMISSIONS, PERMISSION_LABELS } from "./_lib";
import { EmptyState } from "./_layout";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

type Staff = {
  id: number;
  username: string;
  fullName: string;
  role: string;
  permissions: string[];
  isActive: boolean;
  createdAt: string;
  lastActivityAt?: string | null;
  department?: string;
  baseSalary?: number;
  hiredAt?: string | null;
  jobTitle?: string | null; salaryType?: string; currency?: string; workingDaysPerWeek?: number; dailyWorkingHours?: number; hourlyRate?: number; overtimeRate?: number; attendanceAllowance?: number; transportationAllowance?: number; foodAllowance?: number; phoneAllowance?: number; housingAllowance?: number; otherFixedAllowances?: number; fixedDeduction?: number; salesCommissionPercentage?: number; profitCommissionPercentage?: number; paymentMethod?: string; paymentReference?: string | null; salaryStatus?: string; salaryNotes?: string | null;
  advanceSummary?: {
    totalAdvances: number;
    outstandingBalance: number;
    paidAmount: number;
    lastAdvanceDate: string | null;
  };
};

const PERMISSIONS = ALL_PERMISSIONS.map((id) => ({
  id,
  label: PERMISSION_LABELS[id],
}));

const ROLES = [
  { value: "admin", label: "مدير رئيسي" },
  { value: "manager", label: "مدير" },
  { value: "booking_staff", label: "موظف حجوزات" },
  { value: "photographer", label: "موظف تصوير" },
  { value: "accountant", label: "محاسب" },
  { value: "employee", label: "موظف عام" },
];

type Editing = {
  id?: number;
  username: string;
  password: string;
  fullName: string;
  role: string;
  department: string;
  baseSalary: string;
  hiredAt: string;
  permissions: string[];
  isActive: boolean;
  jobTitle: string; salaryType: string; currency: string; workingDaysPerWeek: string; dailyWorkingHours: string; hourlyRate: string; overtimeRate: string; attendanceAllowance: string; transportationAllowance: string; foodAllowance: string; phoneAllowance: string; housingAllowance: string; otherFixedAllowances: string; fixedDeduction: string; salesCommissionPercentage: string; profitCommissionPercentage: string; paymentMethod: string; paymentReference: string; salaryStatus: string; salaryNotes: string;
};

const ROLE_PRESETS: Record<string, string[]> = {
  manager: [
    "dashboard",
    "orders",
    "bookings",
    "services",
    "products",
    "gallery",
    "delivery",
    "customers",
    "staff",
    "settings",
    "invoices",
    "whatsapp",
    "accounting",
    "tasks",
    "photography",
    "graduation",
  ],
  booking_staff: [
    "dashboard",
    "orders",
    "bookings",
    "customers",
    "invoices",
    "whatsapp",
    "tasks",
  ],
  photographer: ["photography"],
  accountant: [
    "dashboard",
    "orders",
    "bookings",
    "customers",
    "invoices",
    "accounting",
    "tasks",
  ],
  employee: ["dashboard", "tasks"],
  staff: ["dashboard", "tasks"],
};

const blank: Editing = {
  username: "",
  password: "",
  fullName: "",
  role: "booking_staff",
  department: "general",
  baseSalary: "0",
  hiredAt: new Date().toISOString().slice(0, 10),
  permissions: ROLE_PRESETS.booking_staff,
  isActive: true,
  jobTitle: "", salaryType: "monthly", currency: "IQD", workingDaysPerWeek: "6", dailyWorkingHours: "8", hourlyRate: "0", overtimeRate: "0", attendanceAllowance: "0", transportationAllowance: "0", foodAllowance: "0", phoneAllowance: "0", housingAllowance: "0", otherFixedAllowances: "0", fixedDeduction: "0", salesCommissionPercentage: "0", profitCommissionPercentage: "0", paymentMethod: "cash", paymentReference: "", salaryStatus: "active", salaryNotes: "",
};

function roleLabel(role: string): string {
  if (role === "staff") return "موظف عام";
  return ROLES.find((r) => r.value === role)?.label ?? role;
}

function cleanErrorMessage(err: any): string {
  return String(err?.message ?? "فشل الاتصال بالخادم").replace(
    /^HTTP\s+\d+:\s*/,
    "",
  );
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
      const body: any = {
        fullName: e.fullName ?? "",
        department: e.department ?? "general",
        baseSalary: Number(e.baseSalary ?? 0),
        hiredAt: e.hiredAt || undefined,
        jobTitle: e.jobTitle, salaryType: e.salaryType, currency: e.currency, workingDaysPerWeek: Number(e.workingDaysPerWeek), dailyWorkingHours: Number(e.dailyWorkingHours), hourlyRate: Number(e.hourlyRate), overtimeRate: Number(e.overtimeRate), attendanceAllowance: Number(e.attendanceAllowance), transportationAllowance: Number(e.transportationAllowance), foodAllowance: Number(e.foodAllowance), phoneAllowance: Number(e.phoneAllowance), housingAllowance: Number(e.housingAllowance), otherFixedAllowances: Number(e.otherFixedAllowances), fixedDeduction: Number(e.fixedDeduction), salesCommissionPercentage: Number(e.salesCommissionPercentage), profitCommissionPercentage: Number(e.profitCommissionPercentage), paymentMethod: e.paymentMethod, paymentReference: e.paymentReference, salaryStatus: e.salaryStatus, salaryNotes: e.salaryNotes,
        role: e.role,
        permissions: e.permissions ?? [],
        isActive: e.isActive,
      };
      if (e.password) body.password = e.password;
      if (e.id)
        return adminFetch(`/admin/staff/${e.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      if (!e.username.trim()) throw new Error("اسم المستخدم مطلوب");
      if (!e.password.trim()) throw new Error("كلمة المرور مطلوبة");
      body.username = e.username.trim();
      return adminFetch("/admin/staff", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "staff"] });
      setEditing(null);
      toast({ title: "تم حفظ الموظف" });
    },
    onError: (err: any) =>
      toast({
        title: "تعذر حفظ الموظف",
        description: cleanErrorMessage(err),
        variant: "destructive",
      }),
  });

  const del = useMutation({
    mutationFn: (id: number) =>
      adminFetch(`/admin/staff/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "staff"] }),
    onError: (err: any) =>
      toast({
        title: "تعذر حذف الموظف",
        description: cleanErrorMessage(err),
        variant: "destructive",
      }),
  });

  const toggle = useMutation({
    mutationFn: (s: Staff) =>
      adminFetch(`/admin/staff/${s.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !s.isActive }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "staff"] }),
    onError: (err: any) =>
      toast({
        title: "تعذر تحديث الموظف",
        description: cleanErrorMessage(err),
        variant: "destructive",
      }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">
          الموظفون والصلاحيات
        </h1>
        <Button
          onClick={() => setEditing({ ...blank })}
          size="sm"
          className="gap-2"
        >
          <Plus className="w-4 h-4" /> إضافة موظف
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <EmptyState message="لا يوجد موظفون — أضف أول موظف" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {data.map((s) => (
            <div
              key={s.id}
              className="bg-card rounded-xl border border-border/30 p-4"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
                    <UserCog className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">
                      {s.fullName || s.username}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      @{s.username} • {roleLabel(s.role)}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      آخر نشاط:{" "}
                      {s.lastActivityAt
                        ? new Date(s.lastActivityAt).toLocaleString("ar-IQ")
                        : "لا يوجد"}
                    </p>
                  </div>
                </div>
                <label
                  className={`inline-flex items-center gap-1 ${s.role === "admin" ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}
                >
                  <input
                    type="checkbox"
                    checked={s.isActive}
                    onChange={() => s.role !== "admin" && toggle.mutate(s)}
                    disabled={s.role === "admin"}
                    className="accent-primary"
                  />
                  <span
                    className={`text-xs ${s.isActive ? "text-status-success" : "text-status-danger"}`}
                  >
                    {s.isActive ? "مفعّل" : "معطّل"}
                  </span>
                </label>
              </div>
              {s.permissions.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {s.permissions.map((p) => (
                    <span
                      key={p}
                      className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary"
                    >
                      {PERMISSIONS.find((perm) => perm.id === p)?.label ?? p}
                    </span>
                  ))}
                </div>
              )}
              <div className="mb-3 rounded-lg border border-primary/15 bg-primary/5 p-2 text-xs">
                <div className="mb-1 flex items-center justify-between font-medium text-primary">
                  <span>سلف الموظف</span>
                  <Link href={`/admin/employee-advances?employeeId=${s.id}`} className="underline">التفاصيل</Link>
                </div>
                <div className="grid grid-cols-3 gap-1 text-muted-foreground">
                  <span>إجمالي: {Number(s.advanceSummary?.totalAdvances ?? 0).toLocaleString("ar-IQ")}</span>
                  <span>مسدد: {Number(s.advanceSummary?.paidAmount ?? 0).toLocaleString("ar-IQ")}</span>
                  <span>متبقي: {Number(s.advanceSummary?.outstandingBalance ?? 0).toLocaleString("ar-IQ")}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() =>
                    setEditing({
                      id: s.id,
                      username: s.username,
                      password: "",
                      fullName: s.fullName,
                      role: s.role === "staff" ? "employee" : s.role,
                      department: s.department ?? "general",
                      baseSalary: String(s.baseSalary ?? 0),
                      hiredAt: s.hiredAt ? String(s.hiredAt).slice(0, 10) : new Date().toISOString().slice(0, 10),
                      jobTitle: s.jobTitle ?? "", salaryType: s.salaryType ?? "monthly", currency: s.currency ?? "IQD", workingDaysPerWeek: String(s.workingDaysPerWeek ?? 6), dailyWorkingHours: String(s.dailyWorkingHours ?? 8), hourlyRate: String(s.hourlyRate ?? 0), overtimeRate: String(s.overtimeRate ?? 0), attendanceAllowance: String(s.attendanceAllowance ?? 0), transportationAllowance: String(s.transportationAllowance ?? 0), foodAllowance: String(s.foodAllowance ?? 0), phoneAllowance: String(s.phoneAllowance ?? 0), housingAllowance: String(s.housingAllowance ?? 0), otherFixedAllowances: String(s.otherFixedAllowances ?? 0), fixedDeduction: String(s.fixedDeduction ?? 0), salesCommissionPercentage: String(s.salesCommissionPercentage ?? 0), profitCommissionPercentage: String(s.profitCommissionPercentage ?? 0), paymentMethod: s.paymentMethod ?? "cash", paymentReference: s.paymentReference ?? "", salaryStatus: s.salaryStatus ?? "active", salaryNotes: s.salaryNotes ?? "",
                      permissions: s.permissions,
                      isActive: s.isActive,
                    })
                  }
                  className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20"
                >
                  <Edit2 className="w-3.5 h-3.5" /> تعديل
                </button>
                {s.role !== "admin" && (
                  <button
                    onClick={() => confirm("حذف الموظف؟") && del.mutate(s.id)}
                    className="inline-flex items-center justify-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-status-danger/10 text-status-danger border border-status-danger/30 hover:bg-status-danger/20"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          dir="rtl"
          onClick={() => setEditing(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(editing);
            }}
            onClick={(e) => e.stopPropagation()}
            className="bg-card border border-border/40 rounded-2xl max-w-lg w-full max-h-[90dvh] overflow-y-auto p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-foreground">
                {editing.id ? "تعديل موظف" : "موظف جديد"}
              </h3>
              <button type="button" onClick={() => setEditing(null)}>
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>
            <Field
              label="الاسم الكامل"
              value={editing.fullName}
              onChange={(v) => setEditing((s) => ({ ...s!, fullName: v }))}
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="القسم" value={editing.department} onChange={(v) => setEditing((s) => ({ ...s!, department: v }))} />
              <Field label="الراتب الأساسي (IQD)" type="number" value={editing.baseSalary} onChange={(v) => setEditing((s) => ({ ...s!, baseSalary: v }))} />
            </div>
            <Field label="تاريخ التعيين" type="date" value={editing.hiredAt} onChange={(v) => setEditing((s) => ({ ...s!, hiredAt: v }))} />
            <section className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-3">
              <h4 className="font-semibold text-primary">Salary Settings · إعدادات الراتب</h4>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Field label="المسمى الوظيفي" value={editing.jobTitle} onChange={(v) => setEditing((s) => ({ ...s!, jobTitle: v }))} /><Field label="العملة" value={editing.currency} onChange={(v) => setEditing((s) => ({ ...s!, currency: v }))} /><Field label="أيام العمل أسبوعياً" type="number" value={editing.workingDaysPerWeek} onChange={(v) => setEditing((s) => ({ ...s!, workingDaysPerWeek: v }))} /><Field label="ساعات العمل اليومية" type="number" value={editing.dailyWorkingHours} onChange={(v) => setEditing((s) => ({ ...s!, dailyWorkingHours: v }))} /><Field label="الأجر بالساعة" type="number" value={editing.hourlyRate} onChange={(v) => setEditing((s) => ({ ...s!, hourlyRate: v }))} /><Field label="سعر الساعة الإضافية" type="number" value={editing.overtimeRate} onChange={(v) => setEditing((s) => ({ ...s!, overtimeRate: v }))} /></div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div><label className="mb-1 block text-xs text-muted-foreground">نوع الراتب</label><select value={editing.salaryType} onChange={(e) => setEditing((s) => ({ ...s!, salaryType: e.target.value }))} className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm"><option value="monthly">شهري</option><option value="weekly">أسبوعي</option><option value="daily">يومي</option><option value="hourly">بالساعة</option></select></div><div><label className="mb-1 block text-xs text-muted-foreground">حالة الراتب</label><select value={editing.salaryStatus} onChange={(e) => setEditing((s) => ({ ...s!, salaryStatus: e.target.value }))} className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm"><option value="active">نشط</option><option value="suspended">معلّق</option></select></div></div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Field label="بدل الحضور" type="number" value={editing.attendanceAllowance} onChange={(v) => setEditing((s) => ({ ...s!, attendanceAllowance: v }))} /><Field label="بدل النقل" type="number" value={editing.transportationAllowance} onChange={(v) => setEditing((s) => ({ ...s!, transportationAllowance: v }))} /><Field label="بدل الطعام" type="number" value={editing.foodAllowance} onChange={(v) => setEditing((s) => ({ ...s!, foodAllowance: v }))} /><Field label="بدل الهاتف" type="number" value={editing.phoneAllowance} onChange={(v) => setEditing((s) => ({ ...s!, phoneAllowance: v }))} /><Field label="بدل السكن" type="number" value={editing.housingAllowance} onChange={(v) => setEditing((s) => ({ ...s!, housingAllowance: v }))} /><Field label="بدلات ثابتة أخرى" type="number" value={editing.otherFixedAllowances} onChange={(v) => setEditing((s) => ({ ...s!, otherFixedAllowances: v }))} /><Field label="خصم ثابت" type="number" value={editing.fixedDeduction} onChange={(v) => setEditing((s) => ({ ...s!, fixedDeduction: v }))} /><Field label="عمولة المبيعات %" type="number" value={editing.salesCommissionPercentage} onChange={(v) => setEditing((s) => ({ ...s!, salesCommissionPercentage: v }))} /><Field label="عمولة الأرباح %" type="number" value={editing.profitCommissionPercentage} onChange={(v) => setEditing((s) => ({ ...s!, profitCommissionPercentage: v }))} /><Field label="طريقة الدفع المفضلة" value={editing.paymentMethod} onChange={(v) => setEditing((s) => ({ ...s!, paymentMethod: v }))} /><Field label="الحساب البنكي / المرجع" value={editing.paymentReference} onChange={(v) => setEditing((s) => ({ ...s!, paymentReference: v }))} /><Field label="ملاحظات الراتب" value={editing.salaryNotes} onChange={(v) => setEditing((s) => ({ ...s!, salaryNotes: v }))} /></div>
            </section>
            {!editing.id && (
              <Field
                label="اسم المستخدم"
                value={editing.username}
                onChange={(v) => setEditing((s) => ({ ...s!, username: v }))}
              />
            )}
            <Field
              label={
                editing.id
                  ? "كلمة مرور جديدة (اتركه فارغ للإبقاء)"
                  : "كلمة المرور"
              }
              type="password"
              value={editing.password}
              onChange={(v) => setEditing((s) => ({ ...s!, password: v }))}
            />
            <div>
              <label className="block text-xs text-muted-foreground mb-1">
                الدور
              </label>
              <select
                value={editing.role}
                onChange={(e) => {
                  const role = e.target.value;
                  setEditing((s) => ({
                    ...s!,
                    role,
                    permissions: ROLE_PRESETS[role] ?? s!.permissions,
                  }));
                }}
                disabled={editing.role === "admin"}
                className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-70"
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-2">
                الصلاحيات
              </label>
              <div className="grid grid-cols-2 gap-2">
                {PERMISSIONS.map((p) => (
                  <label
                    key={p.id}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={editing.permissions.includes(p.id)}
                      disabled={editing.role === "admin"}
                      onChange={(e) =>
                        setEditing((s) => ({
                          ...s!,
                          permissions: e.target.checked
                            ? [...s!.permissions, p.id]
                            : s!.permissions.filter((x) => x !== p.id),
                        }))
                      }
                      className="accent-primary disabled:opacity-70"
                    />
                    {p.label}
                  </label>
                ))}
              </div>
            </div>
            <label
              className={`flex items-center gap-2 text-sm ${editing.role === "admin" ? "opacity-70" : ""}`}
            >
              <input
                type="checkbox"
                checked={editing.isActive}
                disabled={editing.role === "admin"}
                onChange={(e) =>
                  setEditing((s) => ({ ...s!, isActive: e.target.checked }))
                }
                className="accent-primary disabled:opacity-70"
              />
              مفعّل
            </label>
            <Button type="submit" disabled={save.isPending} className="w-full">
              {save.isPending ? "جاري الحفظ..." : "حفظ"}
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-muted-foreground mb-1">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
    </div>
  );
}
