import {
  fileToDataUrl,
  processImageFile,
  type ImageProcessOptions,
} from "@/lib/image-tools";
export { formatCurrency, formatMoney } from "@/lib/money";

// ───── Cookie-based admin auth client ─────
export const ALL_PERMISSIONS = [
  "dashboard",
  "orders",
  "bookings",
  "booking_operations_view",
  "booking_edit",
  "booking_status_change",
  "booking_products_manage",
  "inventory_shortage_override",
  "booking_assets_manage",
  "asset_reserve",
  "asset_release",
  "warehouse_issue",
  "booking_return_confirm",
  "asset_damage_record",
  "asset_damage_approve",
  "custody_groups_view",
  "custody_groups_create",
  "custody_groups_edit",
  "custody_groups_assign_employee",
  "custody_groups_manage_assets",
  "custody_groups_reserve",
  "custody_groups_checkout",
  "custody_groups_return",
  "custody_groups_damage_report",
  "custody_groups_history_view",
  "depreciation_view",
  "depreciation_usage_edit",
  "depreciation_print_a4",
  "depreciation_print_80mm",
  "depreciation_export_pdf",
  "booking_finance_view",
  "booking_payment_receive",
  "booking_finance_approve",
  "booking_payment_reverse",
  "booking_tasks_manage",
  "booking_documents_manage",
  "booking_close",
  "booking_cancel",
  "services",
  "products",
  "asset_depreciation_remove",
  "depreciation_categories_view",
  "depreciation_categories_create",
  "depreciation_categories_edit",
  "depreciation_categories_archive",
  "depreciation_categories_apply",
  "depreciation_categories_audit_view",
  "gallery",
  "delivery",
  "customers",
  "staff",
  "salary_settings_view",
  "salary_settings_edit",
  "salary_settings_approve",
  "settings",
  "invoices",
  "whatsapp",
  "accounting",
  "voucher_view",
  "voucher_create",
  "voucher_edit",
  "voucher_delete",
  "voucher_approve",
  "voucher_reverse",
  "backup",
  "tasks",
  "task_create",
  "task_edit",
  "task_delete",
  "task_assign",
  "task_approve",
  "koshas",
  "photography",
  "graduation",
  "hr",
  "payroll_view",
  "payroll_edit",
  "payroll_delete",
  "payroll_recalculate",
  "payroll_submit",
  "payroll_reopen",
  "payroll_cancel",
  "payroll_approve",
  "payroll_reject",
  "payroll_pay",
  "employee_salaries_view",
  "employee_salaries_create",
  "employee_salaries_edit",
  "employee_salaries_delete_draft",
  "employee_salaries_view_historical",
  "employee_salaries_repair_historical",
  "employee_salaries_add_amount",
  "employee_salaries_reduce_amount",
  "employee_salaries_approve",
  "employee_salaries_pay",
  "employee_salaries_reverse",
  "employee_salaries_cancel",
  "employee_salaries_print",
  "employee_salaries_export",
  "employee_salaries_view_accounting",
  "employee_salaries_view_cashbox",
  "bonus_view",
  "bonus_create",
  "bonus_edit",
  "bonus_submit",
  "bonus_approve",
  "bonus_reject",
  "bonus_delete",
  "bonus_apply",
  "bonus_reverse",
  "executive",
  "ai_dashboard_view",
  "ai_recommendations_view",
  "ai_alerts_view",
  "ai_settings_manage",
  "production_view",
  "production_create",
  "production_edit",
  "production_delete",
  "production_approve",
  // Province delivery — granular. The legacy coarse "delivery" permission still
  // grants all of these server-side so existing staff keep their access.
  "delivery_view",
  "delivery_add",
  "delivery_edit",
  "delivery_fee_override",
  "delivery_status_update",
  "delivery_label_print",
  "delivery_provinces_manage",
  "delivery_pricing_manage",
  "delivery_cod_settle",
  "delivery_cancel",
  "delivery_return",
  "delivery_accounting_manage",
  // Cross-module oversight — health monitor, reconciliation center, recycle bin.
  "system_health",
  "reconciliation_repair",
  "recycle_bin_view",
  "recycle_bin_restore",
  "recycle_bin_purge",
  // ID document scanner.
  "doc_scanner_view",
  "doc_scanner_scan",
  "doc_scanner_edit",
  "doc_scanner_print",
  "doc_scanner_export",
  "doc_scanner_save",
  "doc_scanner_view_saved",
  "doc_scanner_delete",
  "doc_scanner_view_original",
] as const;
export type Permission = (typeof ALL_PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  custody_groups_view: "عرض مجموعات عهدة الموظفين",
  custody_groups_create: "إنشاء مجموعات العهدة",
  custody_groups_edit: "تعديل مجموعات العهدة",
  custody_groups_assign_employee: "تعيين موظف للعهدة",
  custody_groups_manage_assets: "إضافة وإزالة أصول العهدة",
  custody_groups_reserve: "حجز معدات العهدة",
  custody_groups_checkout: "تسليم معدات العهدة",
  custody_groups_return: "استلام معدات العهدة",
  custody_groups_damage_report: "تسجيل تلف معدات العهدة",
  custody_groups_history_view: "عرض سجل عهدة الموظف",
  ai_dashboard_view: "عرض لوحة عقل الفعاليات",
  ai_recommendations_view: "عرض توصيات عقل الفعاليات",
  ai_alerts_view: "عرض تنبيهات عقل الفعاليات",
  ai_settings_manage: "إدارة إعدادات عقل الفعاليات",
  voucher_view: "عرض السندات المالية",
  voucher_create: "إنشاء السندات المالية",
  voucher_edit: "تعديل السندات المالية",
  voucher_delete: "إلغاء السندات غير المرحلة",
  voucher_approve: "اعتماد السندات المالية",
  voucher_reverse: "عكس السندات المرحلة",
  salary_settings_view: "عرض إعدادات الراتب",
  salary_settings_edit: "تعديل إعدادات الراتب",
  salary_settings_approve: "اعتماد تغييرات الراتب",
  hr: "الموارد البشرية والرواتب",
  payroll_view: "عرض الرواتب",
  payroll_edit: "تعديل الرواتب",
  payroll_delete: "حذف الرواتب",
  payroll_recalculate: "إعادة احتساب الرواتب",
  payroll_submit: "إرسال الرواتب للاعتماد",
  payroll_reopen: "إعادة فتح الرواتب",
  payroll_cancel: "إلغاء الرواتب",
  payroll_approve: "اعتماد الرواتب",
  payroll_reject: "رفض الرواتب",
  payroll_pay: "دفع الرواتب",
  employee_salaries_view: "عرض رواتب الموظفين",
  employee_salaries_create: "إنشاء راتب موظف",
  employee_salaries_edit: "تعديل راتب موظف",
  employee_salaries_delete_draft: "حذف راتب مسودة",
  employee_salaries_view_historical: "عرض الرواتب القديمة",
  employee_salaries_repair_historical: "إصلاح روابط راتب قديم",
  employee_salaries_add_amount: "إضافة مبلغ إلى الراتب",
  employee_salaries_reduce_amount: "تقليل مبلغ من الراتب",
  employee_salaries_approve: "اعتماد راتب موظف",
  employee_salaries_pay: "صرف راتب موظف",
  employee_salaries_reverse: "عكس راتب مصروف",
  employee_salaries_cancel: "إلغاء راتب موظف",
  employee_salaries_print: "طباعة قسيمة راتب",
  employee_salaries_export: "تصدير الرواتب",
  employee_salaries_view_accounting: "عرض محاسبة الرواتب",
  employee_salaries_view_cashbox: "عرض روابط صندوق الرواتب",
  bonus_view: "عرض المكافآت",
  bonus_create: "إضافة مكافآت",
  bonus_edit: "تعديل المكافآت",
  bonus_submit: "إرسال المكافآت للاعتماد",
  bonus_approve: "اعتماد المكافآت",
  bonus_reject: "رفض المكافآت",
  bonus_delete: "إلغاء المكافآت",
  bonus_apply: "تطبيق المكافآت على الرواتب",
  bonus_reverse: "عكس المكافآت",
  executive: "لوحة القيادة التنفيذية",
  dashboard: "مشاهدة لوحة التحكم",
  orders: "إدارة الطلبات",
  bookings: "إدارة الحجوزات",
  booking_operations_view: "عرض مساحة عمليات الحجز",
  booking_edit: "تعديل الحجز",
  booking_status_change: "تغيير حالة الحجز",
  booking_products_manage: "إدارة منتجات الحجز",
  inventory_shortage_override: "تجاوز عجز المخزون",
  booking_assets_manage: "إدارة أصول الحجز",
  asset_reserve: "حجز الأصول",
  asset_release: "تحرير الأصول",
  warehouse_issue: "إخراج مواد المستودع",
  booking_return_confirm: "تأكيد إرجاع الحجز",
  asset_damage_record: "تسجيل تلف الأصل",
  asset_damage_approve: "اعتماد تلف أو نقص الأصل",
  depreciation_view: "عرض إهلاك الأصول",
  depreciation_usage_edit: "تحديث استخدام الأصل",
  depreciation_print_a4: "طباعة إهلاك الأصول A4",
  depreciation_print_80mm: "طباعة إهلاك الأصول 80mm",
  depreciation_export_pdf: "تصدير تقرير إهلاك الأصول PDF",
  booking_finance_view: "عرض مالية الحجز",
  booking_payment_receive: "استلام دفعة الحجز",
  booking_finance_approve: "اعتماد مالية الحجز",
  booking_payment_reverse: "عكس دفعة الحجز",
  booking_tasks_manage: "إدارة مهام الحجز",
  booking_documents_manage: "إدارة مستندات الحجز",
  booking_close: "إغلاق الحجز",
  booking_cancel: "إلغاء الحجز",
  services: "إدارة الخدمات",
  products: "إدارة المتجر والمنتجات",
  asset_depreciation_remove: "إزالة سجل إهلاك الأصل",
  depreciation_categories_view: "عرض فئات الإهلاك",
  depreciation_categories_create: "إضافة فئة إهلاك",
  depreciation_categories_edit: "تعديل فئة إهلاك",
  depreciation_categories_archive: "أرشفة فئة إهلاك",
  depreciation_categories_apply: "تطبيق تغييرات الفئة على الأصول",
  depreciation_categories_audit_view: "عرض تدقيق فئات الإهلاك",
  gallery: "إدارة الصور والملفات",
  delivery: "إدارة التوصيل",
  delivery_view: "عرض تفاصيل التوصيل",
  delivery_add: "إضافة تفاصيل التوصيل",
  delivery_edit: "تعديل تفاصيل التوصيل",
  delivery_fee_override: "تعديل أجور التوصيل يدوياً",
  delivery_status_update: "تحديث حالة التوصيل",
  delivery_label_print: "طباعة ملصق التوصيل",
  delivery_provinces_manage: "إدارة المحافظات",
  delivery_pricing_manage: "إدارة تسعير التوصيل",
  delivery_cod_settle: "تأكيد تحصيل الدفع عند الاستلام",
  delivery_cancel: "إلغاء طلب التوصيل",
  delivery_return: "تحديد التوصيل كمرتجع",
  delivery_accounting_manage: "إدارة محاسبة التوصيل",
  system_health: "مراقبة صحة النظام والتسويات",
  reconciliation_repair: "تنفيذ التسويات التصحيحية",
  recycle_bin_view: "عرض سلة المحذوفات",
  recycle_bin_restore: "استعادة السجلات المحذوفة",
  recycle_bin_purge: "الحذف النهائي",
  doc_scanner_view: "عرض ماسح المستمسكات",
  doc_scanner_scan: "مسح المستمسكات",
  doc_scanner_edit: "تعديل المسح",
  doc_scanner_print: "طباعة المستمسكات",
  doc_scanner_export: "تصدير PDF للمستمسكات",
  doc_scanner_save: "حفظ المستمسكات",
  doc_scanner_view_saved: "عرض المستمسكات المحفوظة",
  doc_scanner_delete: "حذف المستمسكات",
  doc_scanner_view_original: "عرض الصورة الأصلية",
  customers: "إدارة العملاء",
  staff: "إدارة الموظفين",
  settings: "إدارة الإعدادات",
  invoices: "طباعة الفواتير",
  whatsapp: "إرسال واتساب",
  accounting: "الحسابات والقيود المالية",
  backup: "النسخ الاحتياطي والتصدير",
  tasks: "إدارة المهام",
  task_create: "إنشاء مهام الموظفين",
  task_edit: "تعديل مهام الموظفين",
  task_delete: "حذف مهام الموظفين",
  task_assign: "إسناد مهام الموظفين",
  task_approve: "اعتماد مهام الموظفين",
  koshas: "بوابة كادر الكوشات",
  photography: "بوابة المصورين",
  graduation: "إدارة تجهيزات التخرج",
  production_view: "عرض الإنتاج",
  production_create: "إنشاء أوامر الإنتاج",
  production_edit: "تعديل أوامر الإنتاج",
  production_delete: "حذف أوامر الإنتاج",
  production_approve: "اعتماد أوامر الإنتاج",
};

export type AdminMe = {
  id: number;
  username: string;
  fullName: string;
  role: string;
  permissions: string[];
  isActive: boolean;
};

let adminMeCache: AdminMe | null | undefined;
let adminMePromise: Promise<AdminMe | null> | null = null;

function apiPath(path: string): string {
  return `/api${path.startsWith("/") ? path : `/${path}`}`;
}

export async function adminFetch<T = any>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type"))
    headers.set("content-type", "application/json");
  const res = await fetch(apiPath(path), {
    ...init,
    headers,
    credentials: "include",
  });
  if (!res.ok) {
    let msg = res.statusText;
    let payload: any = null;
    try {
      const j = await res.json();
      payload = j;
      const details = Array.isArray(j?.details)
        ? j.details
            .slice(0, 4)
            .map(
              (item: any) =>
                `${item?.field ?? "body"}: ${item?.message ?? "قيمة غير صحيحة"}`,
            )
            .join("، ")
        : "";
      msg = j?.error ?? (details || msg);
    } catch {
      /* ignore */
    }
    const err = new Error(`HTTP ${res.status}: ${msg}`) as Error & {
      status?: number;
    };
    (err as any).status = res.status;
    (err as any).data = payload;
    throw err;
  }
  if (res.status === 204) return null as T;
  const ct = res.headers.get("content-type") ?? "";
  return ct.includes("json") ? res.json() : (res.text() as any);
}

// adminFetch throws Error("HTTP <status>: <arabic message>"). Never show that raw string to a
// user — strip the technical prefix so toasts read as a clean Arabic sentence.
export function apiErrorMessage(
  err: unknown,
  fallback = "حدث خطأ غير متوقع، حاول مرة أخرى",
): string {
  const raw =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const cleaned = raw.replace(/^HTTP\s+\d+:\s*/i, "").trim();
  return cleaned || fallback;
}

// The HTTP status code (409, 404, …) so callers can branch on it (e.g. show a recovery action).
export function apiErrorStatus(err: unknown): number | undefined {
  const status = (err as { status?: unknown })?.status;
  return typeof status === "number" ? status : undefined;
}

export async function loginAdmin(
  username: string,
  password: string,
): Promise<AdminMe> {
  const r = await adminFetch<{ user: AdminMe }>("/admin/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  adminMeCache = r.user;
  adminMePromise = null;
  return r.user;
}

export async function logoutAdmin(): Promise<void> {
  try {
    await adminFetch("/admin/auth/logout", { method: "POST" });
  } catch {
    /* swallow */
  }
  adminMeCache = null;
  adminMePromise = null;
}

export async function fetchAdminMe(
  options: { force?: boolean } = {},
): Promise<AdminMe | null> {
  if (!options.force && adminMeCache !== undefined) return adminMeCache;
  if (!options.force && adminMePromise) return adminMePromise;
  adminMePromise = adminFetch<{ user: AdminMe }>("/admin/auth/me")
    .then((r) => {
      adminMeCache = r.user;
      return r.user;
    })
    .catch((e: any) => {
      if (e?.status === 401 || e?.status === 403) {
        adminMeCache = null;
        return null;
      }
      adminMeCache = null;
      return null;
    })
    .finally(() => {
      adminMePromise = null;
    });
  return adminMePromise;
}

export function getCachedAdminMe(): AdminMe | null | undefined {
  return adminMeCache;
}

export function hasPerm(
  user: AdminMe | null,
  perm: Permission | null,
): boolean {
  if (!user || !user.isActive) return false;
  if (user.role === "admin") return true;
  if (!perm) return true;
  return user.permissions.includes(perm);
}

export { fileToDataUrl };

export async function compressImageFile(
  file: File,
  maxSize = 1600,
  quality = 0.82,
  options: ImageProcessOptions = {},
): Promise<string> {
  return processImageFile(file, { ...options, maxSize, quality });
}
