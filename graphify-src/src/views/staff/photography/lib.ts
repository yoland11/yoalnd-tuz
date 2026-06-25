import { adminFetch } from "@/views/admin/_lib";
import { mutateOrQueue, type QueuedResult } from "../offline";

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
};

export function photoMoney(value: number | string | null | undefined) {
  return Number(value || 0).toLocaleString("en-US");
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
