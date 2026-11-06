export type AttendanceMethod = "qr" | "gps" | "qr_gps" | "any" | "manual";

export type GpsEvidence = { latitude: number; longitude: number; accuracy: number };
type Fix = {
  timestamp: number;
  coords: { latitude: number; longitude: number; accuracy: number | null };
  mocked?: boolean;
};

export const SAMPLE_INTERVAL_MS = 30_000;

export function punchEvidence(shift: { method: AttendanceMethod; allowedMethods: string[] }): {
  qr: "only" | "gps" | null;
  directGps: boolean;
} {
  if (shift.method === "qr") return { qr: "only", directGps: false };
  if (shift.method === "qr_gps") return { qr: "gps", directGps: false };
  if (shift.method === "gps") return { qr: null, directGps: true };
  if (shift.method === "manual") return { qr: null, directGps: false };
  return {
    qr: shift.allowedMethods.includes("qr") ? "only" : shift.allowedMethods.includes("qr_gps") ? "gps" : null,
    directGps: shift.allowedMethods.includes("gps"),
  };
}

export function attendanceCode(raw: string): string | null {
  let code = raw.trim();
  if (code.length > 400) return null;
  const encoded = code.match(/[?&]attendanceQr=([^&#\s]+)/)?.[1];
  if (encoded) {
    try { code = decodeURIComponent(encoded); } catch { return null; }
  }
  return /^AJN1\.[1-9]\d{0,9}\.\d{1,12}\.[A-Za-z0-9_-]{32}$/.test(code) ? code : null;
}

export function gpsEvidence(fix: Fix, now = Date.now()): GpsEvidence | null {
  const { accuracy, latitude, longitude } = fix.coords;
  if (fix.mocked || !Number.isFinite(fix.timestamp) || fix.timestamp > now
    || now - fix.timestamp > SAMPLE_INTERVAL_MS || accuracy == null || accuracy <= 0
    || !Number.isFinite(accuracy) || !Number.isFinite(latitude) || Math.abs(latitude) > 90
    || !Number.isFinite(longitude) || Math.abs(longitude) > 180) return null;
  return { accuracy, latitude, longitude };
}

type EvidenceWindow = {
  startsAt: number;
  endsAt: number;
  lastAttemptAt: number;
  lastObservedAt: number;
};

export function locationSample(fixes: Fix[], session: EvidenceWindow, now = Date.now()): (GpsEvidence & { observedAt: number }) | null {
  if (now < session.startsAt || now >= session.endsAt || now - session.lastAttemptAt < SAMPLE_INTERVAL_MS) return null;
  let sample: (GpsEvidence & { observedAt: number }) | null = null;
  for (const fix of fixes) {
    if (fix.timestamp < session.startsAt || fix.timestamp <= (sample?.observedAt ?? session.lastObservedAt)) continue;
    const gps = gpsEvidence(fix, now);
    if (gps) sample = { ...gps, observedAt: fix.timestamp };
  }
  return sample;
}

export function locationTaskAction(fixes: Fix[], session: EvidenceWindow & {
  exempt?: boolean;
  reportedUnavailable?: boolean;
}, now: number, taskError = false) {
  if (now < session.startsAt || now >= session.endsAt || now - session.lastAttemptAt < SAMPLE_INTERVAL_MS) return null;
  if (session.exempt) return { kind: "refresh" as const };
  if (taskError) return session.reportedUnavailable ? null : { kind: "unavailable" as const };
  const sample = locationSample(fixes, session, now);
  return sample ? { kind: "sample" as const, sample } : null;
}
