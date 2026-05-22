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
  return r.user;
}

export async function logoutAdmin(): Promise<void> {
  try { await adminFetch("/admin/auth/logout", { method: "POST" }); }
  catch { /* swallow */ }
}

export async function fetchAdminMe(): Promise<AdminMe | null> {
  try {
    const r = await adminFetch<{ user: AdminMe }>("/admin/auth/me");
    return r.user;
  } catch (e: any) {
    if (e?.status === 401 || e?.status === 403) return null;
    return null;
  }
}

export function hasPerm(user: AdminMe | null, perm: Permission | null): boolean {
  if (!user || !user.isActive) return false;
  if (user.role === "admin") return true;
  if (!perm) return true;
  return user.permissions.includes(perm);
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function formatCurrency(n: number | string | null | undefined): string {
  const v = typeof n === "string" ? parseFloat(n) : (n ?? 0);
  if (!Number.isFinite(v)) return "0 د.ع";
  return `${v.toLocaleString("ar-IQ")} د.ع`;
}
