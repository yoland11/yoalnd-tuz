import { fileToDataUrl, processImageFile, type ImageProcessOptions } from "@/lib/image-tools";

// ───── Cookie-based admin auth client ─────
export const ALL_PERMISSIONS = [
  "dashboard","orders","bookings","services","products","gallery",
  "delivery","customers","staff","settings","invoices","whatsapp","accounting","backup",
] as const;
export type Permission = (typeof ALL_PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
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

export async function adminFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const res = await fetch(apiPath(path), { ...init, headers, credentials: "include" });
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = j?.error ?? msg; } catch { /* ignore */ }
    const err = new Error(`HTTP ${res.status}: ${msg}`) as Error & { status?: number };
    (err as any).status = res.status;
    throw err;
  }
  if (res.status === 204) return null as T;
  const ct = res.headers.get("content-type") ?? "";
  return ct.includes("json") ? res.json() : (res.text() as any);
}

export async function loginAdmin(username: string, password: string): Promise<AdminMe> {
  const r = await adminFetch<{ user: AdminMe }>("/admin/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  adminMeCache = r.user;
  adminMePromise = null;
  return r.user;
}

export async function logoutAdmin(): Promise<void> {
  try { await adminFetch("/admin/auth/logout", { method: "POST" }); }
  catch { /* swallow */ }
  adminMeCache = null;
  adminMePromise = null;
}

export async function fetchAdminMe(options: { force?: boolean } = {}): Promise<AdminMe | null> {
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

export function hasPerm(user: AdminMe | null, perm: Permission | null): boolean {
  if (!user || !user.isActive) return false;
  if (user.role === "admin") return true;
  if (!perm) return true;
  return user.permissions.includes(perm);
}

export { fileToDataUrl };

export async function compressImageFile(file: File, maxSize = 1600, quality = 0.82, options: ImageProcessOptions = {}): Promise<string> {
  return processImageFile(file, { ...options, maxSize, quality });
}

export function formatCurrency(n: number | string | null | undefined): string {
  const v = typeof n === "string" ? parseFloat(n) : (n ?? 0);
  if (!Number.isFinite(v)) return "0 د.ع";
  return `${v.toLocaleString("ar-IQ")} د.ع`;
}
