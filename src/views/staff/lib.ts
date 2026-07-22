import { adminFetch, compressImageFile, fileToDataUrl } from "@/views/admin/_lib";
import { mutateOrQueue, type QueuedResult } from "./offline";
import { formatMoney } from "@/lib/money";

/**
 * Execution stages. The six original keys are unchanged — stored bookings carry them —
 * and the five new ones are interleaved. Legacy adjacencies stay valid transitions, so a
 * crew used to the shorter flow is never blocked by the added detail.
 */
export type StageKey =
  | "booked" | "preparing" | "ready" | "out_of_warehouse" | "on_the_way"
  | "executing" | "executed" | "event_running" | "dismantling" | "returned" | "delivered";

export const STAGES: { key: StageKey; label: string }[] = [
  { key: "booked", label: "محجوزة" },
  { key: "preparing", label: "قيد التجهيز" },
  { key: "ready", label: "جاهزة" },
  { key: "out_of_warehouse", label: "جاري التحميل" },
  { key: "on_the_way", label: "في الطريق" },
  { key: "executing", label: "جاري التنصيب" },
  { key: "executed", label: "تم التنصيب" },
  { key: "event_running", label: "المناسبة جارية" },
  { key: "dismantling", label: "جاري الفك" },
  { key: "returned", label: "تم الإرجاع" },
  { key: "delivered", label: "مكتمل" },
];
export const STAGE_LABEL: Record<string, string> = Object.fromEntries(STAGES.map((s) => [s.key, s.label]));
export function stageRank(key: string): number {
  const i = STAGES.findIndex((s) => s.key === key);
  return i < 0 ? 0 : i;
}

export function isKoshaPendingPricing(booking: { paymentStatus?: string; totalAmount?: number }) {
  return booking.paymentStatus === "pending_pricing" || Number(booking.totalAmount ?? 0) <= 0;
}

export type Bucket = "today" | "tomorrow" | "upcoming" | "late" | "completed";
export const BUCKET_LABEL: Record<Bucket, string> = {
  today: "حجوزات اليوم",
  tomorrow: "حجوزات الغد",
  upcoming: "القادمة",
  late: "المتأخرة",
  completed: "المكتملة",
};

export type CrewBooking = {
  id: number;
  koshaName: string | null;
  /** Departments this booking serves. Absent on native kosha rows. */
  departments?: string[];
  /** كوشات / صوتيات / كوشات + صوتيات */
  departmentBadge?: string;
  customerName: string;
  phone: string;
  eventDate: string;
  eventTime: string;
  eventType: string;
  province: string;
  area: string;
  cityArea: string;
  hallLocation: string;
  addressNotes: string;
  status: string;
  executionStage: StageKey;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  paymentStatus: string;
  bucket: Bucket;
  notes: string;
  selectedAccessories?: string[];
  selectedAddons?: string[];
  welcomeBoards?: string[];
};

export type MediaRow = { id: number; url: string; kind: "image" | "video"; purpose: string; stage: string | null; createdAt: string };
export type TimelineRow = { id: number; type: string; staffName: string; fromStage: string | null; toStage: string | null; note: string | null; meta: Record<string, unknown>; createdAt: string };
export type DeliveryRow = { id: number; hasLoss: boolean; hasBreakage: boolean; note: string | null; compensationAmount: number; signatureUrl: string | null; createdAt: string } | null;
export type PaymentReq = { id: number; amount: number; note: string | null; status: "pending" | "approved" | "rejected"; staffName: string; reviewedByName: string | null; createdAt: string; reviewedAt: string | null };
export type SetupItem = { name: string; image: string | null; price: number | null; description?: string | null };
export type KoshaSetup = {
  kosha: { name: string; image: string | null; price: number; specs: string[] } | null;
  welcomeBoards: SetupItem[];
  addons: SetupItem[];
  accessories: SetupItem[];
  package: { name: string; image: string | null; price: number; contents: string[] } | null;
};
export type BookingDetail = { booking: CrewBooking; setup?: KoshaSetup; timeline: TimelineRow[]; media: MediaRow[]; delivery: DeliveryRow; paymentRequests: PaymentReq[] };

export type MediaInput = { url: string; kind: "image" | "video" };

export async function filesToMedia(files: FileList | File[]): Promise<MediaInput[]> {
  const out: MediaInput[] = [];
  for (const file of Array.from(files)) {
    if (file.type.startsWith("video/")) {
      out.push({ url: await fileToDataUrl(file), kind: "video" });
    } else {
      out.push({ url: await compressImageFile(file, 1600, 0.82), kind: "image" });
    }
  }
  return out;
}

const base = "/staff/koshas";
export const staffApi = {
  dashboard: () => adminFetch<{ today: string; counts: Record<Bucket, number>; todayBookings: CrewBooking[]; tomorrowBookings: CrewBooking[] }>(`${base}/dashboard`),
  bookings: (bucket: Bucket | "all", search = "") =>
    adminFetch<CrewBooking[]>(`${base}/bookings?bucket=${bucket}&search=${encodeURIComponent(search)}`),
  booking: (id: number) => adminFetch<BookingDetail>(`${base}/bookings/${id}`),
  setStage: (id: number, toStage: StageKey, note?: string, media?: MediaInput[]): Promise<BookingDetail | QueuedResult> =>
    mutateOrQueue<BookingDetail>(`${base}/bookings/${id}/stage`, { method: "POST", body: JSON.stringify({ toStage, note, media }) }),
  uploadMedia: (id: number, media: MediaInput[], purpose = "execution", note?: string): Promise<BookingDetail | QueuedResult> =>
    mutateOrQueue<BookingDetail>(`${base}/bookings/${id}/media`, { method: "POST", body: JSON.stringify({ media, purpose, note }) }),
  delivery: (id: number, payload: { hasLoss: boolean; hasBreakage: boolean; note?: string; media?: MediaInput[]; signature?: string; compensationAmount?: number }): Promise<BookingDetail | QueuedResult> =>
    mutateOrQueue<BookingDetail>(`${base}/bookings/${id}/delivery`, { method: "POST", body: JSON.stringify(payload) }),
  collect: (id: number, amount: number, note?: string): Promise<{ ok: boolean } | QueuedResult> =>
    mutateOrQueue<{ ok: boolean }>(`${base}/bookings/${id}/collect`, { method: "POST", body: JSON.stringify({ amount, note }) }),
  assets: (id: number) => adminFetch<{ assets: Array<{ productId: number; name: string; assetCode: string; imageUrl?: string | null; quantity?: number; warehouse?: string | null; status?: string; checkedOut: boolean }> }>(`${base}/bookings/${id}/assets`),
  searchProducts: (q: string) => adminFetch<{ products: Array<{ productId: number; name: string; barcode: string | null; assetCode: string; isRental: boolean; imageUrl: string | null }> }>(`${base}/products?search=${encodeURIComponent(q)}`),
  linkAsset: (id: number, payload: { mode: "link" | "setqty" | "unlink"; productId?: number; code?: string; quantity?: number }) =>
    adminFetch<{ ok: boolean; productId: number; name?: string }>(`${base}/bookings/${id}/assets`, { method: "POST", body: JSON.stringify(payload) }),
  scanAsset: (id: number, payload: { mode: "resolve" | "checkout" | "return"; code: string; problem?: "none" | "broken" | "lost"; note?: string; cost?: number; managerApproval?: boolean }) =>
    adminFetch<{ ok: boolean; productId: number; name?: string; assetCode?: string; status?: string; imageUrl?: string | null; checkedOut?: boolean }>(`${base}/bookings/${id}/assets`, { method: "POST", body: JSON.stringify(payload) }),
  notifications: () => adminFetch<Array<{ id: number; type: string; title: string; body: string | null; href: string | null; isRead: boolean; createdAt: string }>>(`${base}/notifications`),
  markAllRead: () => adminFetch(`${base}/notifications/read-all`, { method: "POST", body: "{}" }),
  reportMe: () => adminFetch<{ executed: number; delivered: number; breakage: number; loss: number; collected: number; collectedCount: number }>(`${base}/reports/me`),
  // manager
  paymentRequests: (status = "pending") => adminFetch<Array<PaymentReq & { booking: { id: number; customerName: string; totalAmount: number; remainingAmount: number } | null }>>(`${base}/payment-requests?status=${status}`),
  approve: (id: number) => adminFetch(`${base}/payment-requests/${id}/approve`, { method: "POST", body: "{}" }),
  reject: (id: number) => adminFetch(`${base}/payment-requests/${id}/reject`, { method: "POST", body: "{}" }),
};

// ── Field operations (checklist, damage, item scans, board, reports) ──────────

export const CHECKLIST_ITEMS: Array<{ key: string; label: string }> = [
  { key: "backdrop", label: "الخلفية" },
  { key: "flowers", label: "الورود" },
  { key: "lighting", label: "الإضاءة" },
  { key: "chairs", label: "الكراسي" },
  { key: "tables", label: "الطاولات" },
  { key: "carpet", label: "السجاد" },
  { key: "frames", label: "الإطارات" },
  { key: "accessories", label: "الإكسسوارات" },
  { key: "audio", label: "الصوتيات" },
  { key: "screens", label: "الشاشات" },
  { key: "other", label: "أصول أخرى" },
];

export const CHECKLIST_CONDITIONS: Array<{ key: string; label: string }> = [
  { key: "available", label: "متوفر" },
  { key: "missing", label: "مفقود" },
  { key: "damaged", label: "تالف" },
  { key: "needs_maintenance", label: "يحتاج صيانة" },
];

export const SCAN_POINTS: Array<{ key: string; label: string }> = [
  { key: "warehouse_out", label: "خروج من المخزن" },
  { key: "vehicle_load", label: "تحميل بالمركبة" },
  { key: "installation", label: "التنصيب" },
  { key: "return", label: "الإرجاع" },
  { key: "warehouse_in", label: "دخول المخزن" },
];

export const DAMAGE_PRIORITIES: Array<{ key: string; label: string }> = [
  { key: "low", label: "منخفضة" },
  { key: "medium", label: "متوسطة" },
  { key: "high", label: "عالية" },
  { key: "critical", label: "حرجة" },
];

export type ChecklistRow = {
  item: string; condition: string; productId: number | null;
  quantity: number; note: string | null; checkedByName: string; updatedAt: string;
};

export type DamageRow = {
  id: number; productId: number | null; description: string; priority: string;
  costEstimate: number; photoUrl: string | null; responsibleStaffId: number | null;
  reportedByName: string; status: string; approvedAt: string | null; createdAt: string;
};

export type OperationsPayload = {
  bookingId: number;
  bookingSource: string;
  checklist: ChecklistRow[];
  checklistCovered: boolean;
  checklistIssues: Array<{ item: string; condition: string }>;
  stageEvents: Array<{
    id: number; fromStage: string | null; toStage: string;
    staffName: string; note: string | null; photoUrl: string | null;
    lat: number | null; lng: number | null; createdAt: string;
  }>;
  damages: DamageRow[];
  damageAnswered: boolean;
  scanCounts: Record<string, number>;
};

export type KoshaOpsBoard = {
  today: string;
  counts: {
    today: number; preparing: number; inProgress: number;
    completed: number; delayed: number;
  };
  missingAssets: Array<{ bookingId: number; customerName: string; item: string }>;
  damagedAssets: Array<{ bookingId: number; customerName: string; description: string; priority: string }>;
  employeeWorkload: Array<{ staffId: number; name: string; bookings: number }>;
};

export type KoshaOpsReport = {
  range: { from: string; to: string };
  daily: Array<{ date: string; bookings: number; completed: number }>;
  employees: Array<{ staffId: number; name: string; stageEvents: number; scans: number }>;
  equipment: Array<{ productId: number; name: string; scans: number }>;
  damages: Array<{ priority: string; count: number; cost: number }>;
  missing: Array<{ bookingId: number; item: string; customerName: string }>;
  lateReturns: Array<{ bookingId: number; customerName: string; eventDate: string; stage: string }>;
  maintenance: Array<{ bookingId: number; item: string; customerName: string }>;
};

const opsBase = (id: number, source: string) =>
  `${base}/operations/${id}${source && source !== "kosha" ? `?source=${encodeURIComponent(source)}` : ""}`;

export const koshaOpsApi = {
  get: (id: number, source = "kosha") => adminFetch<OperationsPayload>(opsBase(id, source)),
  saveChecklist: (id: number, entries: Array<Record<string, unknown>>, source = "kosha") =>
    adminFetch<{ ok: boolean; checklist: ChecklistRow[]; checklistCovered: boolean; checklistIssues: Array<{ item: string; condition: string }> }>(
      `${base}/operations/${id}/checklist${source !== "kosha" ? `?source=${encodeURIComponent(source)}` : ""}`,
      { method: "POST", body: JSON.stringify({ entries }) },
    ),
  reportDamage: (id: number, payload: Record<string, unknown>, source = "kosha") =>
    adminFetch<{ ok: boolean; id: number | null; status: string }>(
      `${base}/operations/${id}/damage${source !== "kosha" ? `?source=${encodeURIComponent(source)}` : ""}`,
      { method: "POST", body: JSON.stringify(payload) },
    ),
  scanItem: (id: number, payload: Record<string, unknown>, source = "kosha") =>
    adminFetch<{ ok: boolean; productId: number; name: string; scanPoint: string; scanPointLabel: string }>(
      `${base}/operations/${id}/scan${source !== "kosha" ? `?source=${encodeURIComponent(source)}` : ""}`,
      { method: "POST", body: JSON.stringify(payload) },
    ),
  board: () => adminFetch<KoshaOpsBoard>(`${base}/ops-board`),
  reports: (opts: { from?: string; to?: string } = {}) => {
    const params = new URLSearchParams();
    if (opts.from) params.set("from", opts.from);
    if (opts.to) params.set("to", opts.to);
    const query = params.toString();
    return adminFetch<KoshaOpsReport>(`${base}/ops-reports${query ? `?${query}` : ""}`);
  },
};

export function money(n: number | string | null | undefined) {
  return formatMoney(n);
}

export function mapsUrl(b: CrewBooking): string {
  const q = [b.hallLocation, b.cityArea, b.area, b.province, "العراق"].filter(Boolean).join("، ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}
