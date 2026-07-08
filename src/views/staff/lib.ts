import { adminFetch, compressImageFile, fileToDataUrl } from "@/views/admin/_lib";
import { mutateOrQueue, type QueuedResult } from "./offline";
import { formatMoney } from "@/lib/money";

export type StageKey =
  | "preparing" | "out_of_warehouse" | "on_the_way" | "executing" | "executed" | "delivered";

export const STAGES: { key: StageKey; label: string }[] = [
  { key: "preparing", label: "قيد التجهيز" },
  { key: "out_of_warehouse", label: "خرجت من المخزن" },
  { key: "on_the_way", label: "في الطريق" },
  { key: "executing", label: "قيد التنفيذ" },
  { key: "executed", label: "تم التنفيذ" },
  { key: "delivered", label: "تم التسليم" },
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
  assets: (id: number) => adminFetch<{ assets: Array<{ productId: number; name: string; assetCode: string; imageUrl?: string | null; checkedOut: boolean }> }>(`${base}/bookings/${id}/assets`),
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

export function money(n: number | string | null | undefined) {
  return formatMoney(n);
}

export function mapsUrl(b: CrewBooking): string {
  const q = [b.hallLocation, b.cityArea, b.area, b.province, "العراق"].filter(Boolean).join("، ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}
