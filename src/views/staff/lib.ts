import { adminFetch, compressImageFile, fileToDataUrl } from "@/views/admin/_lib";
import { uploadImageWithVariants } from "@/lib/large-image-upload";
import { mutateOrQueue, type QueuedResult } from "./offline";
import { formatMoney } from "@/lib/money";

/**
 * Execution stages stored by the existing booking workflow. These keys must remain
 * available because old bookings and timeline rows already contain them.
 */
export type StageKey =
  | "booked" | "preparing" | "ready" | "out_of_warehouse" | "on_the_way"
  | "executing" | "executed" | "event_running" | "before_return" | "dismantling" | "returned" | "delivered";

export const STAGES: { key: StageKey; label: string }[] = [
  { key: "booked", label: "محجوزة" },
  { key: "preparing", label: "قيد التجهيز" },
  { key: "ready", label: "جاهزة" },
  { key: "out_of_warehouse", label: "جاري التحميل" },
  { key: "on_the_way", label: "في الطريق" },
  { key: "executing", label: "جاري التنصيب" },
  { key: "executed", label: "تم التنصيب" },
  { key: "event_running", label: "المناسبة جارية" },
  { key: "before_return", label: "قبل الإرجاع" },
  { key: "dismantling", label: "جاري الفك" },
  { key: "returned", label: "تم الإرجاع" },
  { key: "delivered", label: "مكتمل" },
];

/**
 * The staff portal deliberately presents four operational milestones. Detailed legacy
 * stages stay persisted internally and are folded into the nearest visible milestone.
 */
export const WORKFLOW_STAGES: { key: StageKey; label: string }[] = [
  { key: "preparing", label: "تم الاستلام" },
  { key: "ready", label: "تم تجهيز" },
  { key: "executed", label: "تم التنصيب" },
  { key: "delivered", label: "تم الاسترجاع" },
];

const PORTAL_STAGE_RANK: Record<StageKey, number> = {
  booked: 0,
  preparing: 0,
  ready: 1,
  out_of_warehouse: 1,
  on_the_way: 1,
  executing: 1,
  executed: 2,
  event_running: 2,
  before_return: 2,
  dismantling: 2,
  returned: 3,
  delivered: 3,
};

export const STAGE_LABEL: Record<string, string> = Object.fromEntries(
  STAGES.map((stage) => [stage.key, WORKFLOW_STAGES[PORTAL_STAGE_RANK[stage.key]].label]),
);
export function stageRank(key: string): number {
  const i = STAGES.findIndex((s) => s.key === key);
  return i < 0 ? 0 : i;
}

export function workflowStageRank(key: string): number {
  return PORTAL_STAGE_RANK[key as StageKey] ?? 0;
}

export function nextWorkflowStage(key: string): StageKey | undefined {
  return WORKFLOW_STAGES[workflowStageRank(key) + 1]?.key;
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
  /** Physical source of the canonical booking row. The numeric id is unchanged. */
  source?: "kosha" | "service";
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
  assignedEmployees?: string[];
  selectedAccessories?: string[];
  selectedAddons?: string[];
  welcomeBoards?: string[];
};

export type MediaRow = { id: number; url: string; kind: "image" | "video"; purpose: string; stage: string | null; createdAt: string };
export type TimelineRow = { id: number; type: string; staffName: string; fromStage: string | null; toStage: string | null; note: string | null; meta: Record<string, unknown>; createdAt: string };
export type DeliveryRow = { id: number; hasLoss: boolean; hasBreakage: boolean; note: string | null; compensationAmount: number; signatureUrl: string | null; createdAt: string } | null;
export type PaymentReq = {
  id: number;
  amount: number;
  remainingBefore?: number;
  note: string | null;
  paymentMethod?: "cash" | "transfer" | "card" | "pos" | "other";
  receiptImage?: string | null;
  rejectionReason?: string | null;
  status: "pending" | "pending_manager_approval" | "approved" | "rejected";
  staffName: string;
  reviewedByName: string | null;
  createdAt: string;
  reviewedAt: string | null;
};
export type SetupItem = { name: string; image: string | null; price: number | null; description?: string | null };
export type KoshaSetup = {
  kosha: { name: string; image: string | null; price: number; specs: string[] } | null;
  welcomeBoards: SetupItem[];
  addons: SetupItem[];
  accessories: SetupItem[];
  package: { name: string; image: string | null; price: number; contents: string[] } | null;
};
export type BookingDetail = { booking: CrewBooking; setup?: KoshaSetup; timeline: TimelineRow[]; media: MediaRow[]; delivery: DeliveryRow; paymentRequests: PaymentReq[] };

export type MediaInput = {
  url: string;
  kind: "image" | "video";
  /** Upload metadata is retained in the booking event, not trusted for status. */
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  width?: number;
  height?: number;
};

export async function filesToMedia(files: FileList | File[]): Promise<MediaInput[]> {
  const out: MediaInput[] = [];
  for (const file of Array.from(files)) {
    if (file.type.startsWith("video/")) {
      out.push({ url: await fileToDataUrl(file), kind: "video" });
    } else {
      // Field photos use the shared resumable uploader. Offline work keeps the
      // established queue path for small, compressed proofs until connectivity returns.
      if (navigator.onLine) {
        const stored = await uploadImageWithVariants(file, { folder: "kosha/operations" });
        out.push({ url: stored.largeUrl, kind: "image" });
      } else {
        out.push({ url: await compressImageFile(file, 1600, 0.82), kind: "image" });
      }
    }
  }
  return out;
}

const base = "/staff/koshas";
function sourceQuery(source: "kosha" | "service" = "kosha") {
  // `kosha_bookings` and `service_orders` use independent numeric sequences.
  // Keep the physical source on every detail and mutation request so a native
  // kosha booking can never become ambiguous after its stage changes.
  return `?source=${source}`;
}
export const staffApi = {
  dashboard: () => adminFetch<{ today: string; counts: Record<Bucket, number>; todayBookings: CrewBooking[]; tomorrowBookings: CrewBooking[] }>(`${base}/dashboard`),
  bookings: (bucket: Bucket | "all", search = "") =>
    adminFetch<CrewBooking[]>(`${base}/bookings?bucket=${bucket}&search=${encodeURIComponent(search)}`),
  booking: (id: number, source: "kosha" | "service" = "kosha") => adminFetch<BookingDetail>(`${base}/bookings/${id}${sourceQuery(source)}`),
  setStage: (id: number, toStage: StageKey, note?: string, media?: MediaInput[], source: "kosha" | "service" = "kosha"): Promise<BookingDetail | QueuedResult> =>
    mutateOrQueue<BookingDetail>(`${base}/bookings/${id}/stage${sourceQuery(source)}`, { method: "POST", body: JSON.stringify({ toStage, note, media }) }),
  uploadMedia: (id: number, media: MediaInput[], purpose = "execution", note?: string, source: "kosha" | "service" = "kosha"): Promise<BookingDetail | QueuedResult> =>
    mutateOrQueue<BookingDetail>(`${base}/bookings/${id}/media${sourceQuery(source)}`, { method: "POST", body: JSON.stringify({ media, purpose, note }) }),
  delivery: (id: number, payload: { hasLoss: boolean; hasBreakage: boolean; note?: string; media?: MediaInput[]; signature?: string; compensationAmount?: number }, source: "kosha" | "service" = "kosha"): Promise<BookingDetail | QueuedResult> =>
    mutateOrQueue<BookingDetail>(`${base}/bookings/${id}/delivery${sourceQuery(source)}`, { method: "POST", body: JSON.stringify(payload) }),
  collect: (id: number, input: { amount: number; paymentMethod: "cash" | "transfer" | "card" | "pos" | "other"; note?: string; receiptImage?: string | null }, source: "kosha" | "service" = "kosha"): Promise<{ ok: boolean } | QueuedResult> =>
    mutateOrQueue<{ ok: boolean }>(`${base}/bookings/${id}/collect${sourceQuery(source)}`, { method: "POST", body: JSON.stringify(input) }),
  assets: (id: number, source: "kosha" | "service" = "kosha") => adminFetch<{
    assets: Array<{ productId: number; name: string; assetCode: string; imageUrl?: string | null; quantity?: number; warehouse?: string | null; status?: string; checkedOut: boolean }>;
    products?: Array<{ productId?: number | null; name: string; quantity: number; barcode?: string | null }>;
  }>(`${base}/bookings/${id}/assets${sourceQuery(source)}`),
  searchProducts: (q: string) => adminFetch<{ products: Array<{ productId: number; name: string; barcode: string | null; assetCode: string; isRental: boolean; imageUrl: string | null }> }>(`${base}/products?search=${encodeURIComponent(q)}`),
  linkAsset: (id: number, payload: { mode: "link" | "setqty" | "unlink"; productId?: number; code?: string; quantity?: number }, source: "kosha" | "service" = "kosha") =>
    adminFetch<{ ok: boolean; productId: number; name?: string }>(`${base}/bookings/${id}/assets${sourceQuery(source)}`, { method: "POST", body: JSON.stringify(payload) }),
  scanAsset: (id: number, payload: { mode: "resolve" | "checkout" | "return"; code: string; problem?: "none" | "broken" | "lost"; note?: string; cost?: number; managerApproval?: boolean }, source: "kosha" | "service" = "kosha") =>
    adminFetch<{ ok: boolean; productId: number; name?: string; assetCode?: string; status?: string; imageUrl?: string | null; checkedOut?: boolean }>(`${base}/bookings/${id}/assets${sourceQuery(source)}`, { method: "POST", body: JSON.stringify(payload) }),
  notifications: () => adminFetch<Array<{ id: number; type: string; title: string; body: string | null; href: string | null; isRead: boolean; createdAt: string }>>(`${base}/notifications`),
  markAllRead: () => adminFetch(`${base}/notifications/read-all`, { method: "POST", body: "{}" }),
  reportMe: () => adminFetch<{ executed: number; delivered: number; breakage: number; loss: number; collected: number; collectedCount: number }>(`${base}/reports/me`),
  // manager
  paymentRequests: (status = "pending") => adminFetch<Array<PaymentReq & { booking: { id: number; bookingNo?: string; customerName: string; customerPhone?: string; customerId?: number | null; totalAmount: number; paidAmount?: number; remainingAmount: number } | null }>>(`${base}/payment-requests?status=${status}`),
  approve: (id: number) => adminFetch(`${base}/payment-requests/${id}/approve`, { method: "POST", body: "{}" }),
  reject: (id: number, reason: string) => adminFetch(`${base}/payment-requests/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }),
  workOrders: () => adminFetch<KoshatWorkOrder[]>(`${base}/work-orders`),
  workOrder: (id: number) => adminFetch<KoshatWorkOrder>(`${base}/work-orders/${id}`),
  acceptWorkOrder: (id: number) => adminFetch<KoshatWorkOrder>(`${base}/work-orders/${id}/accept`, { method: "POST", body: "{}" }),
  declineWorkOrder: (id: number, reason: string, note?: string) => adminFetch<KoshatWorkOrder>(`${base}/work-orders/${id}/decline`, { method: "POST", body: JSON.stringify({ reason, note }) }),
  acknowledgeWorkOrder: (id: number) => adminFetch<KoshatWorkOrder>(`${base}/work-orders/${id}/acknowledge`, { method: "POST", body: "{}" }),
  startWorkOrder: (id: number, coords?: { lat?: number; lng?: number }) => adminFetch<KoshatWorkOrder>(`${base}/work-orders/${id}/start`, { method: "POST", body: JSON.stringify(coords ?? {}) }),
  updateWorkOrderStatus: (id: number, status: string) => adminFetch<KoshatWorkOrder>(`${base}/work-orders/${id}/status`, { method: "POST", body: JSON.stringify({ status }) }),
};

export type KoshatWorkOrder = { id:number; workOrderNo:string; bookingId:number; status:string; customerName:string; phone:string; koshaName:string; eventDate:string|null; eventTime:string|null; location:string|null; leaderId:number|null; leaderName:string|null; members:Array<{staffId:number;name:string;role:string;status:string}>; requiredArrivalAt:string|null; eventStartAt:string|null; expectedDismantleAt:string|null; specialInstructions:string|null; requireAcknowledgment:boolean; instructionsAcknowledgedAt:string|null; startedAt:string|null; isLate:boolean; minutesToArrival:number|null; assets?:Array<{id:number;name:string;name_ar:string;asset_code:string|null;checked_out_at:string|null;returned_at:string|null}> };

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
    completed: number; delayed: number; availableStaff: number;
    availableVehicles: number; pendingTasks: number; unreadNotifications: number;
  };
  currentJobs: Array<{ bookingId: number; source?: "kosha" | "service"; customerName: string; eventTime: string | null; stage: string; hall: string | null }>;
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

const opsSourceQuery = (source: string) =>
  `?source=${encodeURIComponent(source || "kosha")}`;
const opsBase = (id: number, source: string) =>
  `${base}/operations/${id}${opsSourceQuery(source)}`;

export const koshaOpsApi = {
  get: (id: number, source = "kosha") => adminFetch<OperationsPayload>(opsBase(id, source)),
  saveChecklist: (id: number, entries: Array<Record<string, unknown>>, source = "kosha") =>
    adminFetch<{ ok: boolean; checklist: ChecklistRow[]; checklistCovered: boolean; checklistIssues: Array<{ item: string; condition: string }> }>(
      `${base}/operations/${id}/checklist${opsSourceQuery(source)}`,
      { method: "POST", body: JSON.stringify({ entries }) },
    ),
  reportDamage: (id: number, payload: Record<string, unknown>, source = "kosha") =>
    adminFetch<{ ok: boolean; id: number | null; status: string }>(
      `${base}/operations/${id}/damage${opsSourceQuery(source)}`,
      { method: "POST", body: JSON.stringify(payload) },
    ),
  scanItem: (id: number, payload: Record<string, unknown>, source = "kosha") =>
    adminFetch<{ ok: boolean; productId: number; name: string; scanPoint: string; scanPointLabel: string }>(
      `${base}/operations/${id}/scan${opsSourceQuery(source)}`,
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
