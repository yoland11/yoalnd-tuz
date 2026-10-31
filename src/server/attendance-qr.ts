import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { QR_GRACE_SECONDS, QR_ROTATION_SECONDS } from "../lib/attendance-rules";

/**
 * Rotating kiosk codes. A code holds only the kiosk id, a time window and a signature: no employee
 * data and no credentials. The signature uses a secret stored per kiosk, so revoking a kiosk
 * invalidates its codes at once, and a screenshot stops working when its window ends.
 */
const PREFIX = "AJN1";

export const newKioskSecret = () => randomBytes(32).toString("base64url");
export const newKioskDeviceToken = () => randomBytes(24).toString("base64url");
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const signature = (secret: string, kioskId: number, window: number) =>
  createHmac("sha256", secret).update(`${kioskId}.${window}`).digest("base64url").slice(0, 32);

export const qrWindow = (nowMs: number) => Math.floor(nowMs / (QR_ROTATION_SECONDS * 1000));

export function issueKioskCode(kioskId: number, secret: string, nowMs: number) {
  const window = qrWindow(nowMs);
  return {
    code: `${PREFIX}.${kioskId}.${window}.${signature(secret, kioskId, window)}`,
    rotatesAt: (window + 1) * QR_ROTATION_SECONDS * 1000,
  };
}

/** Accepts a raw code or the portal link printed in the QR, and returns its parts without trusting them. */
export function parseKioskCode(raw: unknown): { kioskId: number; window: number; signature: string; text: string } | null {
  let text = typeof raw === "string" ? raw.trim() : "";
  if (!text || text.length > 400) return null;
  const inLink = text.match(/[?&]attendanceQr=([^&#\s]+)/);
  if (inLink) {
    try { text = decodeURIComponent(inLink[1]); } catch { return null; }
  }
  const match = text.match(/^AJN1\.([1-9]\d{0,9})\.(\d{1,12})\.([A-Za-z0-9_-]{32})$/);
  if (!match) return null;
  return { kioskId: Number(match[1]), window: Number(match[2]), signature: match[3], text };
}

export type KioskCodeCheck = { ok: true; tokenHash: string } | { ok: false; reason: string };

export function verifyKioskCode(parsed: NonNullable<ReturnType<typeof parseKioskCode>>, secret: string, nowMs: number): KioskCodeCheck {
  const expected = Buffer.from(signature(secret, parsed.kioskId, parsed.window));
  const given = Buffer.from(parsed.signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "رمز QR غير صالح" };
  const current = qrWindow(nowMs);
  if (parsed.window > current) return { ok: false, reason: "رمز QR غير صالح" };
  const endsAt = (parsed.window + 1) * QR_ROTATION_SECONDS * 1000 + QR_GRACE_SECONDS * 1000;
  if (nowMs >= endsAt) return { ok: false, reason: "انتهت صلاحية رمز QR. امسح الرمز الظاهر على الشاشة الآن" };
  return { ok: true, tokenHash: sha256(parsed.text) };
}
