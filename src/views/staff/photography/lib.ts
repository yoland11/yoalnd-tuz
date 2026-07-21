import { adminFetch } from "@/views/admin/_lib";
import { mutateOrQueue, type QueuedResult } from "../offline";
import { formatMoney } from "@/lib/money";

export type PhotographyStage = "registered" | "editing" | "ready_print" | "ready_pickup" | "delivered";

export const PHOTO_STAGES: Array<{ key: PhotographyStage; label: string }> = [
  { key: "registered", label: "تم التسجيل" },
  { key: "editing", label: "قيد المونتاج" },
  { key: "ready_print", label: "جاهز للطباعة" },
  { key: "ready_pickup", label: "جاهز للاستلام" },
  { key: "delivered", label: "تم التسليم" },
];

export const PHOTO_STAGE_LABEL: Record<string, string> = Object.fromEntries(PHOTO_STAGES.map((item) => [item.key, item.label]));

export type PhotographyEvent = {
  id: number;
  clientToken: string;
  groomName: string;
  eventName: string | null;
  eventDate: string;
  location: string | null;
  assignedStaffId: number | null;
  assignedStaffName: string;
  status: string;
  orderCount: number;
  createdAt: string;
};

export type PhotographyOrder = {
  id: number;
  orderNo: string;
  eventId: number;
  assignedStaffId: number | null;
  customerName: string;
  phone: string;
  copies: number;
  printType: string;
  unitPrice: number;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  pendingAmount: number;
  paymentStatus: string;
  paymentLabel: string;
  photoNumber: string | null;
  notes: string | null;
  referenceImage: string | null;
  status: PhotographyStage;
  cancelledAt: string | null;
  event: Pick<PhotographyEvent, "id" | "clientToken" | "groomName" | "eventName" | "eventDate" | "location" | "assignedStaffName"> | null;
  qr?: { token: string; scanUrl: string; dataUrl: string; targetUrl: string } | null;
  timeline?: Array<{ id: number; type: string; staffName: string; fromStatus: string | null; toStatus: string | null; note: string | null; createdAt: string }>;
  paymentRequests?: Array<{ id: number; amount: number; status: "pending" | "approved" | "rejected"; note: string | null; createdAt: string; reviewedAt: string | null }>;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PhotographyEventSummary = {
  orders: number;
  copies: number;
  total: number;
  paid: number;
  remaining: number;
  paidCount: number;
  unpaidCount: number;
};

export type PhotographyEventDetail = PhotographyEvent & {
  orders: PhotographyOrder[];
  summary: PhotographyEventSummary;
};

export type PhotographyPrice = { id: string; amount: number };

export type PhotographyReport = {
  events: number;
  orders: number;
  delivered: number;
  inProgress: number;
  paidCount: number;
  unpaidCount: number;
  received: number;
  remaining: number;
};

const base = "/staff/photography";

function reportQuery(opts: { scope?: "all"; photographerId?: number | null; from?: string; to?: string } = {}) {
  const params = new URLSearchParams();
  if (opts.scope) params.set("scope", opts.scope);
  if (opts.photographerId) params.set("photographerId", String(opts.photographerId));
  if (opts.from) params.set("from", opts.from);
  if (opts.to) params.set("to", opts.to);
  const q = params.toString();
  return q ? `?${q}` : "";
}

export const photographyApi = {
  dashboard: () => adminFetch<{ today: string; counts: { events: number; orders: number; ready: number; delivered: number }; recentEvents: PhotographyEvent[]; recentOrders: PhotographyOrder[] }>(`${base}/dashboard`),
  photographers: () => adminFetch<Array<{ id: number; name: string }>>(`${base}/photographers`),
  prices: () => adminFetch<PhotographyPrice[]>(`${base}/prices`),
  events: (search = "", opts: { photographerId?: number | null; from?: string; to?: string; archived?: boolean } = {}) => {
    const params = new URLSearchParams({ search });
    if (opts.photographerId) params.set("photographerId", String(opts.photographerId));
    if (opts.from) params.set("from", opts.from);
    if (opts.to) params.set("to", opts.to);
    if (opts.archived) params.set("archived", "1");
    return adminFetch<PhotographyEvent[]>(`${base}/events?${params.toString()}`);
  },
  event: (ref: string) => adminFetch<PhotographyEventDetail>(`${base}/events/${encodeURIComponent(ref)}`),
  createEvent: (payload: Record<string, unknown>): Promise<PhotographyEvent | QueuedResult> => mutateOrQueue<PhotographyEvent>(`${base}/events`, { method: "POST", body: JSON.stringify(payload) }),
  updateEvent: (ref: string, payload: Record<string, unknown>) => adminFetch<PhotographyEvent>(`${base}/events/${encodeURIComponent(ref)}`, { method: "PATCH", body: JSON.stringify(payload) }),
  archiveEvent: (ref: string) => adminFetch<PhotographyEvent>(`${base}/events/${encodeURIComponent(ref)}/archive`, { method: "POST", body: "{}" }),
  deleteEvent: (ref: string) => adminFetch<{ ok: boolean }>(`${base}/events/${encodeURIComponent(ref)}`, { method: "DELETE" }),
  orders: (search = "", status = "", opts: { photographerId?: number | null; eventRef?: string } = {}) => {
    const params = new URLSearchParams({ search, status });
    if (opts.photographerId) params.set("photographerId", String(opts.photographerId));
    if (opts.eventRef) params.set("eventRef", opts.eventRef);
    return adminFetch<PhotographyOrder[]>(`${base}/orders?${params.toString()}`);
  },
  order: (id: number) => adminFetch<PhotographyOrder>(`${base}/orders/${id}`),
  createOrder: (eventRef: string, payload: Record<string, unknown>): Promise<PhotographyOrder | QueuedResult> => mutateOrQueue<PhotographyOrder>(`${base}/events/${encodeURIComponent(eventRef)}/orders`, { method: "POST", body: JSON.stringify(payload) }),
  updateOrder: (id: number, payload: Record<string, unknown>) => adminFetch<PhotographyOrder>(`${base}/orders/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  cancelOrder: (id: number, note = "") => adminFetch<PhotographyOrder>(`${base}/orders/${id}/cancel`, { method: "POST", body: JSON.stringify({ note }) }),
  setStatus: (id: number, status: PhotographyStage, note = ""): Promise<PhotographyOrder | QueuedResult> => mutateOrQueue<PhotographyOrder>(`${base}/orders/${id}/status`, { method: "POST", body: JSON.stringify({ status, note }) }),
  collect: (id: number, amount: number, note = ""): Promise<{ ok: boolean; requestId: number } | QueuedResult> => mutateOrQueue(`${base}/orders/${id}/collect`, { method: "POST", body: JSON.stringify({ amount, note }) }),
  markPrinted: (id: number) => adminFetch(`${base}/orders/${id}/printed`, { method: "POST", body: "{}" }),
  reports: (opts: { scope?: "all"; photographerId?: number | null; from?: string; to?: string } = {}) => adminFetch<PhotographyReport>(`${base}/reports${reportQuery(opts)}`),
  notifications: () => adminFetch<Array<{ id: number; type: string; title: string; body: string; href: string | null; readAt: string | null; createdAt: string }>>(`${base}/notifications`),
  markAllRead: () => adminFetch(`${base}/notifications/read-all`, { method: "POST", body: "{}" }),
  // ── Asset linking + checkout/return for a photography order (unified asset_links) ──
  assets: (orderId: number) => adminFetch<{ assets: PhotographyAsset[] }>(`${base}/orders/${orderId}/assets`),
  searchAssets: (q: string) => adminFetch<{ products: Array<{ productId: number; name: string; barcode: string | null; assetCode: string; imageUrl: string | null }> }>(`${base}/products?search=${encodeURIComponent(q)}`),
  assetOp: (orderId: number, payload: Record<string, unknown>) => adminFetch<{ ok: boolean; productId: number; name?: string }>(`${base}/orders/${orderId}/assets`, { method: "POST", body: JSON.stringify(payload) }),
};

// ── Field-shoot operations ───────────────────────────────────────────────────

export type ShootStage =
  | "assigned" | "preparing" | "on_the_way" | "arrived" | "shooting"
  | "uploading" | "editing" | "ready_for_review" | "delivered" | "completed";

export const SHOOT_STAGES: Array<{ key: ShootStage; label: string; icon: string }> = [
  { key: "assigned", label: "مُسند", icon: "📋" },
  { key: "preparing", label: "قيد التحضير", icon: "🎒" },
  { key: "on_the_way", label: "في الطريق", icon: "🚗" },
  { key: "arrived", label: "وصل الموقع", icon: "📍" },
  { key: "shooting", label: "قيد التصوير", icon: "📸" },
  { key: "uploading", label: "رفع الملفات", icon: "⬆️" },
  { key: "editing", label: "قيد المونتاج", icon: "🎬" },
  { key: "ready_for_review", label: "جاهز للمراجعة", icon: "👁️" },
  { key: "delivered", label: "تم التسليم", icon: "📦" },
  { key: "completed", label: "مكتمل", icon: "✅" },
];

export const SHOOT_STAGE_LABEL: Record<string, string> = Object.fromEntries(
  SHOOT_STAGES.map((item) => [item.key, item.label]),
);

export const CHECKLIST_ITEMS: Array<{ key: string; label: string }> = [
  { key: "camera_ready", label: "الكاميرا جاهزة" },
  { key: "lens_cleaned", label: "العدسات نظيفة" },
  { key: "batteries_charged", label: "البطاريات مشحونة" },
  { key: "cards_empty", label: "بطاقات الذاكرة فارغة" },
  { key: "mic_working", label: "المايكروفونات تعمل" },
  { key: "flash_working", label: "الفلاش يعمل" },
  { key: "gimbal_calibrated", label: "الجيمبل مُعاير" },
  { key: "drone_ready", label: "الدرون جاهز" },
  { key: "tripod_packed", label: "الحامل مُجهّز" },
];

/** The next stage a photographer can move to, or null at the end of the pipeline. */
export function nextStage(stage: ShootStage): ShootStage | null {
  const index = SHOOT_STAGES.findIndex((item) => item.key === stage);
  return index < 0 || index >= SHOOT_STAGES.length - 1 ? null : SHOOT_STAGES[index + 1].key;
}

export type ShootCard = {
  eventId: number;
  clientToken: string;
  shootId: number | null;
  stage: ShootStage;
  stageLabel: string;
  customerName: string;
  eventName: string | null;
  eventDate: string;
  eventTime: string | null;
  venue: string | null;
  gpsLat: number | null;
  gpsLng: number | null;
  mapsUrl: string | null;
  assignedStaffId: number | null;
  assignedStaffName: string;
  checklistComplete: boolean;
  arrivedAt: string | null;
  updatedAt: string;
};

export type ShootDetail = ShootCard & {
  checklist: Record<string, boolean>;
  checklistCompletedAt: string | null;
  notes: string | null;
  milestones: Record<string, string | null>;
  remainingPayment: number;
  orderCount: number;
  crew: Array<{ id: number; staffId: number; staffName: string; role: string; isLead: boolean }>;
  equipment: PhotographyAsset[];
  timeline: Array<{
    id: number; type: string; staffName: string;
    fromStage: string | null; toStage: string | null;
    note: string | null; createdAt: string;
  }>;
};

export type ShootBoard = {
  today: string;
  stageCounts: Record<string, number>;
  todayAssignments: ShootCard[];
  upcoming: ShootCard[];
  active: ShootCard[];
  pendingUploads: number;
  pendingEditing: number;
  completed: number;
  total: number;
};

export const shootApi = {
  board: () => adminFetch<ShootBoard>(`${base}/board`),
  list: (opts: { stage?: string; search?: string; from?: string; to?: string } = {}) => {
    const params = new URLSearchParams();
    if (opts.stage) params.set("stage", opts.stage);
    if (opts.search) params.set("search", opts.search);
    if (opts.from) params.set("from", opts.from);
    if (opts.to) params.set("to", opts.to);
    const q = params.toString();
    return adminFetch<{ data: ShootCard[] }>(`${base}/shoots${q ? `?${q}` : ""}`);
  },
  detail: (ref: string | number) => adminFetch<ShootDetail>(`${base}/shoots/${encodeURIComponent(String(ref))}`),
  update: (ref: string | number, payload: Record<string, unknown>) =>
    adminFetch<ShootCard>(`${base}/shoots/${encodeURIComponent(String(ref))}`, { method: "PATCH", body: JSON.stringify(payload) }),
  setChecklist: (ref: string | number, checklist: Record<string, boolean>) =>
    adminFetch<{ ok: boolean; checklist: Record<string, boolean>; checklistComplete: boolean; checklistCompletedAt: string | null }>(
      `${base}/shoots/${encodeURIComponent(String(ref))}/checklist`,
      { method: "POST", body: JSON.stringify({ checklist }) },
    ),
  setStage: (ref: string | number, stage: ShootStage, extra: { note?: string; lat?: number; lng?: number } = {}) =>
    adminFetch<ShootCard>(`${base}/shoots/${encodeURIComponent(String(ref))}/stage`, {
      method: "POST",
      body: JSON.stringify({ stage, ...extra }),
    }),
  crew: (ref: string | number, payload: Record<string, unknown>) =>
    adminFetch<{ ok: boolean; staffId: number }>(`${base}/shoots/${encodeURIComponent(String(ref))}/crew`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  equipment: (ref: string | number) =>
    adminFetch<{ assets: PhotographyAsset[] }>(`${base}/shoots/${encodeURIComponent(String(ref))}/assets`),
  equipmentOp: (ref: string | number, payload: Record<string, unknown>) =>
    adminFetch<{ ok: boolean; productId: number; name?: string }>(`${base}/shoots/${encodeURIComponent(String(ref))}/assets`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};

/** Reads the device position once, for the arrival check-in. Never throws. */
export function readPositionOnce(timeoutMs = 8000): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

export type PhotographyAsset = {
  productId: number;
  name: string;
  assetCode: string;
  barcode: string | null;
  imageUrl: string | null;
  status: string;
  warehouse: string | null;
  health: number;
  checkedOut: boolean;
};

export function photoMoney(value: number | string | null | undefined) {
  return formatMoney(value);
}

export function printTypeLabel(value: string) {
  if (value === "album") return "ألبوم";
  return value.replace("x", "×");
}

export function newClientToken() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID().replaceAll("-", "");
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`.slice(0, 32);
}

export function saveLocalEvent(event: Partial<PhotographyEvent> & { clientToken: string }) {
  try { localStorage.setItem(`ajn-photo-event-${event.clientToken}`, JSON.stringify(event)); } catch { /* storage is best effort */ }
}

export function readLocalEvent(clientToken: string): PhotographyEvent | null {
  try {
    const value = localStorage.getItem(`ajn-photo-event-${clientToken}`);
    return value ? JSON.parse(value) : null;
  } catch { return null; }
}
