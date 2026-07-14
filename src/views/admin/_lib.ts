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
  "services",
  "products",
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
  "backup",
  "tasks",
  "koshas",
  "photography",
  "graduation",
  "hr",
  "payroll_view",
  "payroll_edit",
  "payroll_delete",
  "payroll_recalculate",
  "payroll_reopen",
  "payroll_cancel",
  "payroll_approve",
  "payroll_pay",
  "executive",
  "production_view",
  "production_create",
  "production_edit",
  "production_delete",
  "production_approve",
] as const;
export type Permission = (typeof ALL_PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  salary_settings_view: "عرض إعدادات الراتب",
  salary_settings_edit: "تعديل إعدادات الراتب",
  salary_settings_approve: "اعتماد تغييرات الراتب",
  hr: "الموارد البشرية والرواتب",
  payroll_view: "عرض الرواتب",
  payroll_edit: "تعديل الرواتب",
  payroll_delete: "حذف الرواتب",
  payroll_recalculate: "إعادة احتساب الرواتب",
  payroll_reopen: "إعادة فتح الرواتب",
  payroll_cancel: "إلغاء الرواتب",
  payroll_approve: "اعتماد الرواتب",
  payroll_pay: "دفع الرواتب",
  executive: "لوحة القيادة التنفيذية",
  dashboard: "مشاهدة لوحة التحكم",
  orders: "إدارة الطلبات",
  bookings: "إدارة الحجوزات",
  services: "إدارة الخدمات",
  products: "إدارة المتجر والمنتجات",
  gallery: "إدارة الصور والملفات",
  delivery: "إدارة التوصيل",
  customers: "إدارة العملاء",
  staff: "إدارة الموظفين",
  settings: "إدارة الإعدادات",
  invoices: "طباعة الفواتير",
  whatsapp: "إرسال واتساب",
  accounting: "الحسابات والقيود المالية",
  backup: "النسخ الاحتياطي والتصدير",
  tasks: "إدارة المهام",
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
