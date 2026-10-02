import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Edit2, Archive, X, Building2, ChevronDown, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmployeeAvatar } from "@/components/employee-avatar";
import { ImageUploadEditor } from "@/components/image-upload-editor";
import { adminFetch, ALL_PERMISSIONS, hasPerm, PERMISSION_LABELS, type AdminMe } from "./_lib";
import { employeePhotoUrlFromUpload } from "@/lib/employee-identity";
import { EmptyState } from "./_layout";
import ScanDocumentButton from "./scan-document-button";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { EmployeeSessionsManager } from "@/components/session-devices";
import { SalarySettingsTab } from "./salary-settings-tab";

type Staff = {
  id: number;
  username: string;
  fullName: string;
  photoUrl?: string | null;
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

const SALES_AND_INVOICE_PERMISSION_IDS = new Set<string>([
  "orders",
  "invoices",
  "print.sales_invoice",
  "print.reprint",
  "sales_invoice.cancel",
  "sales_invoice.view_cancelled",
  "sales_invoice.print_cancelled",
  "sales_invoice.approve_cancellation",
  "sales_invoice.permanent_delete",
  "sales_invoice.customer.link",
  "sales_invoice.customer.relink",
  "sales_invoice.customer.repair",
]);
const startsWithAny = (id: string, prefixes: string[]) =>
  prefixes.some((prefix) => id.startsWith(prefix));

// Permission sections shown as collapsible groups in the staff editor. Each
// permission lands in the first section that matches; anything unmatched falls
// into "صلاحيات أخرى", so no permission is ever hidden from the editor.
const PERMISSION_CATEGORIES: Array<{
  key: string;
  title: string;
  match: (id: string) => boolean;
}> = [
  { key: "system", title: "لوحة التحكم والإعدادات العامة", match: (id) => ["dashboard", "settings", "backup", "system_health", "reconciliation_repair", "whatsapp", "gallery"].includes(id) || id.startsWith("recycle_bin_") },
  { key: "bookings", title: "الحجوزات والتجهيز", match: (id) => id === "bookings" || startsWithAny(id, ["booking_", "preparation_"]) || ["inventory_shortage_override", "warehouse_issue"].includes(id) },
  { key: "assets", title: "الأصول والعهدة والإهلاك", match: (id) => startsWithAny(id, ["asset_", "asset.", "custody_groups_", "depreciation_"]) },
  { key: "sales", title: "المبيعات والفواتير والطباعة", match: (id) => SALES_AND_INVOICE_PERMISSION_IDS.has(id) || id.startsWith("print.") },
  { key: "catalog", title: "العملاء والخدمات والمنتجات", match: (id) => ["customers", "services", "products"].includes(id) },
  { key: "accounting", title: "المحاسبة والسندات", match: (id) => id === "accounting" || id.startsWith("voucher_") || id.startsWith("expenses_") },
  { key: "approvals", title: "الموافقات", match: (id) => id.startsWith("approvals.") },
  { key: "hr", title: "الموظفون والرواتب", match: (id) => ["staff", "hr"].includes(id) || id.startsWith("staff.") || startsWithAny(id, ["payroll_", "employee_salaries_", "bonus_", "salary_settings_"]) },
  { key: "tasks", title: "المهام", match: (id) => id === "tasks" || id.startsWith("task_") },
  { key: "koshas", title: "الكوشات", match: (id) => id === "koshas" || id.startsWith("koshat_tasks.") },
  { key: "photography", title: "التصوير", match: (id) => id.startsWith("photography") },
  { key: "graduation", title: "التخرج", match: (id) => id.startsWith("graduation") },
  { key: "representative", title: "بوابة الممثلين", match: (id) => id.startsWith("representative.") },
  { key: "installments", title: "الأقساط", match: (id) => id.startsWith("installments") },
  { key: "tailoring", title: "الخياطة", match: (id) => id.startsWith("tailoring") },
  { key: "research", title: "البحوث", match: (id) => id.startsWith("research") },
  { key: "delivery", title: "التوصيل", match: (id) => id.startsWith("delivery") },
  { key: "catering", title: "الضيافة", match: (id) => id.startsWith("catering_") },
  { key: "bouquet", title: "الباقات والورد", match: (id) => id.startsWith("bouquet.") },
  { key: "production", title: "الإنتاج", match: (id) => id.startsWith("production_") },
  { key: "executive", title: "الإدارة التنفيذية والذكاء الاصطناعي", match: (id) => id === "executive" || id.startsWith("ai_") },
  { key: "documents", title: "ماسح المستندات", match: (id) => id.startsWith("doc_scanner_") },
];

const PERMISSION_SECTIONS = (() => {
  const seen = new Set<string>();
  const unique = PERMISSIONS.filter(({ id }) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const sections = PERMISSION_CATEGORIES.map((category) => ({
    key: category.key,
    title: category.title,
    permissions: [] as typeof PERMISSIONS,
  }));
  const other = { key: "other", title: "صلاحيات أخرى", permissions: [] as typeof PERMISSIONS };
  for (const permission of unique) {
    const index = PERMISSION_CATEGORIES.findIndex((category) => category.match(permission.id));
    (index === -1 ? other : sections[index]).permissions.push(permission);
  }
  return [...sections, other].filter((section) => section.permissions.length > 0);
})();

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
  photoUrl: string | null;
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
    "booking_staff_assign",
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
    "task_create", "task_edit", "task_delete", "task_assign", "task_approve",
    "photography",
    "graduation",
    "graduation_production",
    "graduation_printing",
    "graduation_embroidery",
    "graduation_cashier",
    "graduation_manager",
    "graduation_warehouse",
    "payroll_view",
    "payroll_edit",
    "payroll_delete",
    "payroll_recalculate",
    "payroll_reopen",
    "payroll_cancel",
    "payroll_approve",
    "payroll_pay",
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
    "payroll_view",
    "payroll_recalculate",
    "payroll_approve",
    "payroll_pay",
  ],
  employee: ["dashboard", "tasks"],
  staff: ["dashboard", "tasks"],
};

const blank: Editing = {
  username: "",
  password: "",
  fullName: "",
  photoUrl: null,
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

const DEPARTMENT_LABELS: Record<string, string> = {
  general: "عام",
  management: "الإدارة",
  sales: "المبيعات",
  accounting: "المحاسبة",
  hr: "الموارد البشرية",
  warehouse: "المستودع",
  inventory: "المخزون",
  delivery: "التوصيل",
  photography: "التصوير",
  kosha: "الكوشات",
  design: "التصميم",
  production: "الإنتاج",
  graduation: "التخرج",
  support: "الدعم",
};
function departmentLabel(department?: string): string {
  const key = String(department || "general").trim().toLowerCase();
  return DEPARTMENT_LABELS[key] || department || "عام";
}

function cleanErrorMessage(err: any): string {
  return String(err?.message ?? "فشل الاتصال بالخادم").replace(
    /^HTTP\s+\d+:\s*/,
    "",
  );
}

// Each permission section is a collapsible button showing how many of its
// permissions are granted; expanding it lists the checkboxes. Toggling only
// adds/removes the given ids, so legacy permissions outside ALL_PERMISSIONS
// that a staff member already holds are preserved.
function PermissionSections({
  selected,
  disabled,
  onChange,
}: {
  selected: string[];
  disabled: boolean;
  onChange: (next: string[]) => void;
}) {
  const granted = new Set(selected);
  const toggle = (ids: string[], enabled: boolean) => {
    const next = new Set(selected);
    for (const id of ids) {
      if (enabled) next.add(id);
      else next.delete(id);
    }
    onChange([...next]);
  };
  return (
    <div className="space-y-2">
      {PERMISSION_SECTIONS.map((section) => {
        const ids = section.permissions.map((permission) => permission.id);
        const count = ids.filter((id) => granted.has(id)).length;
        return (
          <details
            key={section.key}
            className="group rounded-xl border border-border/50 bg-muted/20"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-3 py-2.5 hover:bg-muted/40">
              <span className="text-sm font-semibold text-foreground">
                {section.title}
              </span>
              <span className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${count ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
                >
                  {count} / {ids.length}
                </span>
                <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
              </span>
            </summary>
            <div className="border-t border-border/40 p-3">
              <div className="mb-2 flex gap-3">
                <button
                  type="button"
                  disabled={disabled || count === ids.length}
                  onClick={() => toggle(ids, true)}
                  className="text-xs text-primary underline disabled:no-underline disabled:opacity-50"
                >
                  تحديد الكل
                </button>
                <button
                  type="button"
                  disabled={disabled || count === 0}
                  onClick={() => toggle(ids, false)}
                  className="text-xs text-muted-foreground underline disabled:no-underline disabled:opacity-50"
                >
                  إلغاء الكل
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {section.permissions.map((permission) => (
                  <label
                    key={permission.id}
                    className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={granted.has(permission.id)}
                      disabled={disabled}
                      onChange={(event) =>
                        toggle([permission.id], event.target.checked)
                      }
                      className="mt-1 accent-primary disabled:opacity-70"
                    />
                    <span>{permission.label ?? permission.id}</span>
                  </label>
                ))}
              </div>
            </div>
          </details>
        );
      })}
    </div>
  );
}

export default function StaffPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const currentUserQuery = useQuery({
    queryKey: ["admin", "staff-page-current-user"],
    queryFn: () => adminFetch<{ user: AdminMe }>("/admin/auth/me").then((response) => response.user),
  });
  const currentUser = currentUserQuery.data ?? null;
  const canCreateStaff = hasPerm(currentUser, "staff.create");
  const canEditStaff = hasPerm(currentUser, "staff.edit");
  const canDeleteStaff = hasPerm(currentUser, "staff.delete");
  const canManageStaffRoles = currentUser?.role === "admin" || Boolean(currentUser?.permissions.includes("staff"));
  const canViewStaffPay = Boolean(currentUser?.role === "admin" || currentUser?.permissions.includes("staff") || hasPerm(currentUser, "salary_settings_view") || hasPerm(currentUser, "salary_settings_edit") || hasPerm(currentUser, "employee_salaries_view") || hasPerm(currentUser, "payroll_view"));
  const canEditStaffPay = Boolean(currentUser?.role === "admin" || currentUser?.permissions.includes("staff") || hasPerm(currentUser, "salary_settings_edit"));
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "staff"],
    queryFn: () => adminFetch<Staff[]>("/admin/staff"),
  });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [editorTab, setEditorTab] = useState<"profile" | "salary" | "devices">("profile");
  // Group staff by department so each department renders as its own
  // collapsible section (largest teams first, then alphabetical by label).
  const groupedByDepartment = useMemo(() => {
    const map = new Map<string, Staff[]>();
    for (const member of data ?? []) {
      const key = String(member.department || "general");
      const bucket = map.get(key);
      if (bucket) bucket.push(member);
      else map.set(key, [member]);
    }
    return [...map.entries()]
      .map(([department, members]) => ({
        department,
        label: departmentLabel(department),
        members,
      }))
      .sort(
        (a, b) =>
          b.members.length - a.members.length ||
          a.label.localeCompare(b.label, "ar"),
      );
  }, [data]);

  const save = useMutation({
    mutationFn: (e: Editing) => {
      const body: any = {
        fullName: e.fullName ?? "",
        photoUrl: e.photoUrl ?? null,
        department: e.department ?? "general",
        hiredAt: e.hiredAt || undefined,
        jobTitle: e.jobTitle,
        isActive: e.isActive,
      };
      if (canEditStaffPay) {
        body.baseSalary = Number(e.baseSalary ?? 0);
        Object.assign(body, {
          salaryType: e.salaryType,
          currency: e.currency,
          workingDaysPerWeek: Number(e.workingDaysPerWeek),
          dailyWorkingHours: Number(e.dailyWorkingHours),
          hourlyRate: Number(e.hourlyRate),
          overtimeRate: Number(e.overtimeRate),
          attendanceAllowance: Number(e.attendanceAllowance),
          transportationAllowance: Number(e.transportationAllowance),
          foodAllowance: Number(e.foodAllowance),
          phoneAllowance: Number(e.phoneAllowance),
          housingAllowance: Number(e.housingAllowance),
          otherFixedAllowances: Number(e.otherFixedAllowances),
          fixedDeduction: Number(e.fixedDeduction),
          salesCommissionPercentage: Number(e.salesCommissionPercentage),
          profitCommissionPercentage: Number(e.profitCommissionPercentage),
          paymentMethod: e.paymentMethod,
          paymentReference: e.paymentReference,
          salaryStatus: e.salaryStatus,
          salaryNotes: e.salaryNotes,
        });
      }
      if (canManageStaffRoles) {
        body.role = e.role;
        body.permissions = e.permissions ?? [];
      }
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

  const archiveEmployee = useMutation({
    mutationFn: (id: number) =>
      adminFetch(`/admin/staff/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "staff"] });
      toast({
        title: "تم إيقاف الموظف",
        description:
          "تم حفظ الرواتب والحجوزات والسجل التاريخي. يمكنك إعادة تفعيل الحساب عند الحاجة.",
      });
    },
    onError: (err: any) =>
      toast({
        title: "تعذر إيقاف الموظف",
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
        {canCreateStaff ? <Button
          onClick={() => { setShowPassword(false); setEditorTab("profile"); setEditing({ ...blank, role: canManageStaffRoles ? blank.role : "employee", permissions: canManageStaffRoles ? blank.permissions : ROLE_PRESETS.employee }); }}
          size="sm"
          className="gap-2"
        >
          <Plus className="w-4 h-4" /> إضافة موظف
        </Button> : null}
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
        <div className="space-y-3">
          {groupedByDepartment.map((group) => (
            <details
              key={group.department}
              open={groupedByDepartment.length === 1}
              className="group rounded-xl border border-border/30 bg-card/40 overflow-hidden"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40">
                <span className="flex items-center gap-2 font-semibold text-foreground">
                  <Building2 className="h-4 w-4 text-primary" />
                  {group.label}
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                    {group.members.length}
                  </span>
                </span>
                <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className="grid grid-cols-1 gap-3 p-3 pt-0 md:grid-cols-2">
                {group.members.map((s) => (
            <div
              key={s.id}
              className="bg-card rounded-xl border border-border/30 p-4"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <EmployeeAvatar name={s.fullName || s.username} photoUrl={s.photoUrl} size={40} />
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
                        ? new Date(s.lastActivityAt).toLocaleString("ar-IQ-u-nu-latn")
                        : "لا يوجد"}
                    </p>
                  </div>
                </div>
                <label
                  className={`inline-flex items-center gap-1 ${s.role === "admin" || !canEditStaff ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}
                >
                  <input
                    type="checkbox"
                    checked={s.isActive}
                    onChange={() => s.role !== "admin" && canEditStaff && toggle.mutate(s)}
                    disabled={s.role === "admin" || !canEditStaff}
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
              {canViewStaffPay ? <div className="mb-3 rounded-lg border border-primary/15 bg-primary/5 p-2 text-xs">
                <div className="mb-1 flex items-center justify-between font-medium text-primary">
                  <span>سلف الموظف</span>
                  <div className="flex items-center gap-2">
                    <ScanDocumentButton
                      ownerType="staff"
                      ownerId={s.id}
                      ownerName={s.fullName || s.username}
                      docType="employee_id"
                      label="مستمسك"
                      className="underline text-primary"
                    />
                    <Link href={`/admin/employee-advances?employeeId=${s.id}`} className="underline">التفاصيل</Link>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-1 text-muted-foreground">
                  <span>إجمالي: {Number(s.advanceSummary?.totalAdvances ?? 0).toLocaleString("ar-IQ-u-nu-latn")}</span>
                  <span>مسدد: {Number(s.advanceSummary?.paidAmount ?? 0).toLocaleString("ar-IQ-u-nu-latn")}</span>
                  <span>متبقي: {Number(s.advanceSummary?.outstandingBalance ?? 0).toLocaleString("ar-IQ-u-nu-latn")}</span>
                </div>
              </div> : null}
              {canViewStaffPay ? <div className="mb-3 rounded-lg border border-border/40 bg-muted/40 p-2 text-xs">
                <div className="mb-1 flex items-center justify-between font-medium"><span>ملخص الراتب</span><span className={s.salaryStatus === "active" ? "text-status-success" : "text-status-warning"}>{s.salaryStatus === "active" ? "نشط" : "غير نشط"}</span></div>
                <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-muted-foreground"><span>الأساسي: {Number(s.baseSalary ?? 0).toLocaleString("ar-IQ-u-nu-latn")}</span><span>الدفع: {s.paymentMethod ?? "—"}</span><span>البدلات: {(Number(s.transportationAllowance ?? 0) + Number(s.foodAllowance ?? 0) + Number(s.housingAllowance ?? 0) + Number(s.phoneAllowance ?? 0) + Number(s.otherFixedAllowances ?? 0)).toLocaleString("ar-IQ-u-nu-latn")}</span><span>الخصم الثابت: {Number(s.fixedDeduction ?? 0).toLocaleString("ar-IQ-u-nu-latn")}</span><span className="col-span-2 font-medium text-foreground">الصافي التقديري: {Math.max(0, Number(s.baseSalary ?? 0) + Number(s.transportationAllowance ?? 0) + Number(s.foodAllowance ?? 0) + Number(s.housingAllowance ?? 0) + Number(s.phoneAllowance ?? 0) + Number(s.otherFixedAllowances ?? 0) - Number(s.fixedDeduction ?? 0)).toLocaleString("ar-IQ-u-nu-latn")} د.ع</span></div>
              </div> : null}
              {(canEditStaff || canDeleteStaff) ? <div className="flex items-center gap-2">
                {canEditStaff ? <>
                <button
                  onClick={() => {
                    setShowPassword(false);
                    setEditorTab("profile"); setEditing({
                      id: s.id,
                      username: s.username,
                      password: "",
                      fullName: s.fullName,
                      photoUrl: s.photoUrl ?? null,
                      role: s.role === "staff" ? "employee" : s.role,
                      department: s.department ?? "general",
                      baseSalary: String(s.baseSalary ?? 0),
                      hiredAt: s.hiredAt ? String(s.hiredAt).slice(0, 10) : new Date().toISOString().slice(0, 10),
                      jobTitle: s.jobTitle ?? "", salaryType: s.salaryType ?? "monthly", currency: s.currency ?? "IQD", workingDaysPerWeek: String(s.workingDaysPerWeek ?? 6), dailyWorkingHours: String(s.dailyWorkingHours ?? 8), hourlyRate: String(s.hourlyRate ?? 0), overtimeRate: String(s.overtimeRate ?? 0), attendanceAllowance: String(s.attendanceAllowance ?? 0), transportationAllowance: String(s.transportationAllowance ?? 0), foodAllowance: String(s.foodAllowance ?? 0), phoneAllowance: String(s.phoneAllowance ?? 0), housingAllowance: String(s.housingAllowance ?? 0), otherFixedAllowances: String(s.otherFixedAllowances ?? 0), fixedDeduction: String(s.fixedDeduction ?? 0), salesCommissionPercentage: String(s.salesCommissionPercentage ?? 0), profitCommissionPercentage: String(s.profitCommissionPercentage ?? 0), paymentMethod: s.paymentMethod ?? "cash", paymentReference: s.paymentReference ?? "", salaryStatus: s.salaryStatus ?? "active", salaryNotes: s.salaryNotes ?? "",
                      permissions: s.permissions,
                      isActive: s.isActive,
                    });
                  }}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20"
                >
                  <Edit2 className="w-3.5 h-3.5" /> تعديل
                </button>
                </> : null}
                {canDeleteStaff && s.role !== "admin" && (
                  <button
                    onClick={() =>
                      confirm(
                        "إيقاف حساب الموظف؟ سيُمنع من الدخول مع الاحتفاظ بالرواتب والحجوزات والسجل التاريخي. يمكنك إعادة تفعيله لاحقاً.",
                      ) && archiveEmployee.mutate(s.id)
                    }
                    className="inline-flex items-center justify-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-status-danger/10 text-status-danger border border-status-danger/30 hover:bg-status-danger/20"
                    title="إيقاف الموظف مع حفظ سجله"
                    aria-label="إيقاف الموظف مع حفظ سجله"
                  >
                    <Archive className="w-3.5 h-3.5" />
                  </button>
                )}
              </div> : null}
            </div>
                ))}
              </div>
            </details>
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
            {editing.id && <div className={`grid ${canEditStaffPay ? "grid-cols-3" : "grid-cols-2"} rounded-lg bg-muted p-1 text-sm`}><button type="button" onClick={() => setEditorTab("profile")} className={`rounded-md px-3 py-2 ${editorTab === "profile" ? "bg-background font-semibold shadow-sm" : "text-muted-foreground"}`}>بيانات الموظف</button>{canEditStaffPay ? <button type="button" onClick={() => setEditorTab("salary")} className={`rounded-md px-3 py-2 ${editorTab === "salary" ? "bg-background font-semibold text-primary shadow-sm" : "text-muted-foreground"}`}>💰 إعدادات الراتب</button> : null}<button type="button" onClick={() => setEditorTab("devices")} className={`rounded-md px-3 py-2 ${editorTab === "devices" ? "bg-background font-semibold text-primary shadow-sm" : "text-muted-foreground"}`}>الأجهزة</button></div>}
            {editorTab === "devices" && editing.id ? <EmployeeSessionsManager staffId={editing.id} employeeName={editing.fullName} /> : editorTab === "salary" && editing.id ? <SalarySettingsTab employee={{ ...editing, id: editing.id }} onSaved={() => qc.invalidateQueries({ queryKey: ["admin", "staff"] })} /> : <>
            <section className="rounded-xl border border-border/40 bg-muted/20 p-4">
              <div className="mb-3 flex items-center gap-3">
                <EmployeeAvatar name={editing.fullName || editing.username} photoUrl={editing.photoUrl} size={96} />
                <div className="min-w-0">
                  <h4 className="font-semibold">صورة الموظف</h4>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">اختيارية. قصّ مربع تلقائي مع معاينة؛ تظهر الصورة في البوابات وقوائم إسناد الموظفين.</p>
                </div>
              </div>
              <ImageUploadEditor
                kind="avatar"
                label={editing.photoUrl ? "استبدال صورة الموظف" : "رفع صورة الموظف"}
                accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                currentImage={editing.photoUrl}
                onComplete={(results) => {
                  const photoUrl = employeePhotoUrlFromUpload(results[0]?.metadata ?? {});
                  if (!photoUrl) throw new Error("تعذر حفظ رابط الصورة المرفوعة");
                  setEditing((current) => current ? { ...current, photoUrl } : current);
                }}
                onRemove={editing.photoUrl ? () => setEditing((current) => current ? { ...current, photoUrl: null } : current) : undefined}
              />
            </section>
            <Field
              label="الاسم الكامل"
              value={editing.fullName}
              onChange={(v) => setEditing((s) => ({ ...s!, fullName: v }))}
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="القسم" value={editing.department} onChange={(v) => setEditing((s) => ({ ...s!, department: v }))} />
              {canEditStaffPay ? <Field label="الراتب الأساسي (IQD)" type="number" value={editing.baseSalary} onChange={(v) => setEditing((s) => ({ ...s!, baseSalary: v }))} /> : null}
            </div>
            <Field label="تاريخ التعيين" type="date" value={editing.hiredAt} onChange={(v) => setEditing((s) => ({ ...s!, hiredAt: v }))} />
            {canEditStaffPay ? <section className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-3">
              <h4 className="font-semibold text-primary">Salary Settings · إعدادات الراتب</h4>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Field label="المسمى الوظيفي" value={editing.jobTitle} onChange={(v) => setEditing((s) => ({ ...s!, jobTitle: v }))} /><Field label="العملة" value={editing.currency} onChange={(v) => setEditing((s) => ({ ...s!, currency: v }))} /><Field label="أيام العمل أسبوعياً" type="number" value={editing.workingDaysPerWeek} onChange={(v) => setEditing((s) => ({ ...s!, workingDaysPerWeek: v }))} /><Field label="ساعات العمل اليومية" type="number" value={editing.dailyWorkingHours} onChange={(v) => setEditing((s) => ({ ...s!, dailyWorkingHours: v }))} /><Field label="الأجر بالساعة" type="number" value={editing.hourlyRate} onChange={(v) => setEditing((s) => ({ ...s!, hourlyRate: v }))} /><Field label="سعر الساعة الإضافية" type="number" value={editing.overtimeRate} onChange={(v) => setEditing((s) => ({ ...s!, overtimeRate: v }))} /></div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div><label className="mb-1 block text-xs text-muted-foreground">نوع الراتب</label><select value={editing.salaryType} onChange={(e) => setEditing((s) => ({ ...s!, salaryType: e.target.value }))} className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm"><option value="monthly">شهري</option><option value="weekly">أسبوعي</option><option value="daily">يومي</option><option value="hourly">بالساعة</option></select></div><div><label className="mb-1 block text-xs text-muted-foreground">حالة الراتب</label><select value={editing.salaryStatus} onChange={(e) => setEditing((s) => ({ ...s!, salaryStatus: e.target.value }))} className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm"><option value="active">نشط</option><option value="suspended">معلّق</option></select></div></div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Field label="بدل الحضور" type="number" value={editing.attendanceAllowance} onChange={(v) => setEditing((s) => ({ ...s!, attendanceAllowance: v }))} /><Field label="بدل النقل" type="number" value={editing.transportationAllowance} onChange={(v) => setEditing((s) => ({ ...s!, transportationAllowance: v }))} /><Field label="بدل الطعام" type="number" value={editing.foodAllowance} onChange={(v) => setEditing((s) => ({ ...s!, foodAllowance: v }))} /><Field label="بدل الهاتف" type="number" value={editing.phoneAllowance} onChange={(v) => setEditing((s) => ({ ...s!, phoneAllowance: v }))} /><Field label="بدل السكن" type="number" value={editing.housingAllowance} onChange={(v) => setEditing((s) => ({ ...s!, housingAllowance: v }))} /><Field label="بدلات ثابتة أخرى" type="number" value={editing.otherFixedAllowances} onChange={(v) => setEditing((s) => ({ ...s!, otherFixedAllowances: v }))} /><Field label="خصم ثابت" type="number" value={editing.fixedDeduction} onChange={(v) => setEditing((s) => ({ ...s!, fixedDeduction: v }))} /><Field label="عمولة المبيعات %" type="number" value={editing.salesCommissionPercentage} onChange={(v) => setEditing((s) => ({ ...s!, salesCommissionPercentage: v }))} /><Field label="عمولة الأرباح %" type="number" value={editing.profitCommissionPercentage} onChange={(v) => setEditing((s) => ({ ...s!, profitCommissionPercentage: v }))} /><Field label="طريقة الدفع المفضلة" value={editing.paymentMethod} onChange={(v) => setEditing((s) => ({ ...s!, paymentMethod: v }))} /><Field label="الحساب البنكي / المرجع" value={editing.paymentReference} onChange={(v) => setEditing((s) => ({ ...s!, paymentReference: v }))} /><Field label="ملاحظات الراتب" value={editing.salaryNotes} onChange={(v) => setEditing((s) => ({ ...s!, salaryNotes: v }))} /></div>
            </section> : null}
            {!editing.id && (
              <Field
                label="اسم المستخدم"
                value={editing.username}
                onChange={(v) => setEditing((s) => ({ ...s!, username: v }))}
              />
            )}
            <div>
              <label htmlFor="staff-password" className="mb-1 block text-xs text-muted-foreground">
                {editing.id
                  ? "كلمة مرور جديدة (اتركه فارغ للإبقاء)"
                  : "كلمة المرور"}
              </label>
              <div className="relative">
                <input
                  id="staff-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={editing.password}
                  onChange={(event) => setEditing((current) => ({ ...current!, password: event.target.value }))}
                  className="w-full rounded-lg border border-border/40 bg-background py-2 pe-3 ps-11 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <button
                  type="button"
                  aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((visible) => !visible)}
                  className="absolute left-1 top-1/2 -translate-y-1/2 rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {editing.id ? <p className="mt-1 text-xs text-muted-foreground">كلمة المرور الحالية لا يمكن استرجاعها؛ اكتب كلمة جديدة أو اترك الحقل فارغاً.</p> : null}
            </div>
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
                disabled={editing.role === "admin" || !canManageStaffRoles}
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
              <p className="mb-2 text-xs text-muted-foreground">
                اضغط على القسم لعرض صلاحياته واختيارها · المحدد:{" "}
                <b className="text-foreground">{editing.permissions.length}</b>
              </p>
              <PermissionSections
                selected={editing.permissions}
                disabled={editing.role === "admin" || !canManageStaffRoles}
                onChange={(permissions) =>
                  setEditing((current) => ({ ...current!, permissions }))
                }
              />
            </div>
            {editing.id && canManageStaffRoles && <ApprovalPermissionsPanel staff={editing} />}
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
            </>}
          </form>
        </div>
      )}
    </div>
  );
}

const APPROVAL_CODES = [
  ["approvals.view", "مشاهدة طلبات الموافقة"], ["approvals.approve", "اعتماد الطلبات"], ["approvals.reject", "رفض الطلبات"],
  ["approvals.return_for_edit", "إعادة للتعديل"], ["approvals.forward_to_main_manager", "تحويل للمدير الرئيسي"], ["approvals.comment", "كتابة ملاحظات"], ["approvals.audit.view", "مشاهدة السجل"],
] as const;
const APPROVAL_CATEGORIES = ["الرواتب", "المكافآت", "السلف", "المصروفات", "المشتريات", "الخصومات", "الإلغاءات", "تعديل الفواتير", "طلبات الموظفين", "تجهيزات التخرج", "الكوشات", "التصوير", "المخزون", "الأصول", "الصيانة", "طلبات أخرى"];

function ApprovalPermissionsPanel({ staff }: { staff: Editing }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<any>({ permissionCodes: [], allowedCategories: [], allowedDepartments: [], allowedBranchIds: [], categoryModes: {}, maxAmount: "0", unlimitedAmount: false, isActive: false, isTemporary: false, validFrom: "", validUntil: "", delegationReason: "" });
  const { data, isLoading } = useQuery<{ profile: any; actions: any[] }>({ queryKey: ["admin", "staff", staff.id, "approval-permissions"], queryFn: () => adminFetch(`/admin/staff/${staff.id}/approval-permissions`) });
  useEffect(() => { if (data?.profile) setDraft({ ...draft, ...data.profile, validFrom: data.profile.validFrom?.slice(0, 10) ?? "", validUntil: data.profile.validUntil?.slice(0, 10) ?? "" }); }, [data?.profile]);
  const saveApproval = useMutation({ mutationFn: (next?: any) => adminFetch(`/admin/staff/${staff.id}/approval-permissions`, { method: "PATCH", body: JSON.stringify(next ?? draft) }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "staff", staff.id, "approval-permissions"] }); toast({ title: "تم تحديث صلاحيات الموافقات" }); }, onError: (error) => toast({ title: "تعذر حفظ صلاحيات الموافقات", description: cleanErrorMessage(error), variant: "destructive" }) });
  const toggle = (key: "permissionCodes" | "allowedCategories", value: string) => setDraft((current: any) => ({ ...current, [key]: current[key].includes(value) ? current[key].filter((entry: string) => entry !== value) : [...current[key], value] }));
  return <section className="space-y-3 rounded-xl border border-primary/25 bg-primary/5 p-4" dir="rtl">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h4 className="font-semibold text-primary">صلاحيات الموافقات</h4><p className="mt-1 text-xs text-muted-foreground">تفويض فردي فقط؛ لا يمنح صلاحيات مدير رئيسي.</p></div><span className={`rounded-full px-2.5 py-1 text-xs ${draft.isActive ? "bg-status-success/15 text-status-success" : "bg-muted text-muted-foreground"}`}>{draft.isActive ? (draft.isTemporary ? "تفويض مؤقت" : "مخول") : "غير مخول"}</span></div>
    {isLoading ? <Skeleton className="h-24" /> : <>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft((current: any) => ({ ...current, isActive: event.target.checked }))} className="accent-primary" />تفعيل صلاحيات الموافقات</label>
      <div className="grid gap-2 sm:grid-cols-2">{APPROVAL_CODES.map(([code, label]) => <label key={code} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.permissionCodes.includes(code)} onChange={() => toggle("permissionCodes", code)} className="accent-primary" />{label}</label>)}</div>
      <div><p className="mb-2 text-xs font-medium text-foreground">فئات الموافقات المسموحة</p><div className="flex flex-wrap gap-2">{APPROVAL_CATEGORIES.map((category) => <label key={category} className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs ${draft.allowedCategories.includes(category) ? "border-primary bg-primary/10 text-primary" : "border-border/40 text-muted-foreground"}`}><input type="checkbox" className="sr-only" checked={draft.allowedCategories.includes(category)} onChange={() => toggle("allowedCategories", category)} />{category}</label>)}</div></div>
      <div className="grid gap-3 sm:grid-cols-2"><Field label="أقصى مبلغ اعتماد (د.ع)" type="number" value={String(draft.maxAmount ?? "0")} onChange={(value) => setDraft((current: any) => ({ ...current, maxAmount: value }))} /><div className="space-y-2 pt-5"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.unlimitedAmount} onChange={(event) => setDraft((current: any) => ({ ...current, unlimitedAmount: event.target.checked }))} />حد غير محدود</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.isTemporary} onChange={(event) => setDraft((current: any) => ({ ...current, isTemporary: event.target.checked }))} />تفويض مؤقت</label></div></div>
      {draft.isTemporary && <div className="grid gap-3 sm:grid-cols-2"><Field label="صالح من" type="date" value={draft.validFrom} onChange={(value) => setDraft((current: any) => ({ ...current, validFrom: value }))} /><Field label="صالح لغاية" type="date" value={draft.validUntil} onChange={(value) => setDraft((current: any) => ({ ...current, validUntil: value }))} /></div>}
      <Field label="سبب التفويض" value={draft.delegationReason ?? ""} onChange={(value) => setDraft((current: any) => ({ ...current, delegationReason: value }))} />
      <div className="flex flex-wrap gap-2"><Button type="button" size="sm" onClick={() => saveApproval.mutate(draft)} disabled={saveApproval.isPending}>{saveApproval.isPending ? "جاري الحفظ..." : "حفظ صلاحيات الموافقات"}</Button><Button type="button" size="sm" variant="outline" onClick={() => saveApproval.mutate({ ...draft, isActive: false, permissionCodes: [] })} disabled={saveApproval.isPending}>إيقاف جميع الصلاحيات</Button></div>
      {data?.actions?.length ? <p className="text-xs text-muted-foreground">آخر إجراء: {data.actions[0].action} · {new Date(data.actions[0].createdAt).toLocaleString("ar-IQ-u-nu-latn")}</p> : null}
    </>}
  </section>;
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
