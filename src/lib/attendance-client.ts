import { QR_ROTATION_SECONDS, baghdadDate, baghdadTime, toMs } from "./attendance-rules";

export function attendanceTimestamp(value: unknown): string {
  const at = toMs(value);
  return at == null ? "—" : `${baghdadDate(at)} ${baghdadTime(at)}`;
}

/** Syntax only; authenticity, location and expiry are always checked by the server. */
export function readAttendanceCode(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 400) return null;
  let text = raw.trim();
  if (!text.startsWith("AJN1.")) {
    try { text = new URL(text, "https://ajn.invalid").searchParams.get("attendanceQr") ?? ""; }
    catch { return null; }
  }
  return /^AJN1\.[1-9]\d{0,9}\.\d{1,12}\.[A-Za-z0-9_-]{32}$/.test(text) ? text : null;
}

/** Preserve only intended portal state through login; never forward redirect destinations. */
export function attendanceReturnQuery(search: string): string {
  const params = new URLSearchParams(search);
  const qr = readAttendanceCode(params.get("attendanceQr"));
  if (qr) return `?${new URLSearchParams({ attendanceQr: qr })}`;
  const tab = params.get("tab") ?? "";
  return ["attendance", "followups", "tasks", "work", "bookings", "salary", "notifications", "account"].includes(tab) ? `?tab=${tab}` : "";
}

export type KioskDisplay = { name: string; locationName: string; rotatesAt: number; serverTime: number; rotationSeconds: number; qrDataUrl: string };

export function validateKioskDisplay(value: unknown): KioskDisplay {
  const data = value as Partial<KioskDisplay> | null;
  if (!data || typeof data.name !== "string" || !data.name.trim() || typeof data.locationName !== "string" || !data.locationName.trim()
    || !Number.isFinite(data.serverTime) || !Number.isFinite(data.rotatesAt) || data.rotationSeconds !== QR_ROTATION_SECONDS
    || data.rotatesAt! <= data.serverTime! || data.rotatesAt! - data.serverTime! > QR_ROTATION_SECONDS * 1000
    || typeof data.qrDataUrl !== "string" || data.qrDataUrl.length > 1_000_000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(data.qrDataUrl)) {
    throw new Error("بيانات شاشة الحضور غير مكتملة؛ أعد المحاولة");
  }
  return data as KioskDisplay;
}
