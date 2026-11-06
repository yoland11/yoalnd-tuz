import { addDays, baghdadDate, fixedShiftFor, haversineMeters, type GpsEvidence, type GpsLocation, type ScheduleInput } from "./attendance-rules";

const CONFIRM_OUTSIDE_MS = 5 * 60_000;
export const GEOFENCE_SAMPLE_GAP_MS = 90_000;
const MAX_SAMPLE_AGE_MS = 60_000;
const MAX_SAMPLE_FUTURE_MS = 10_000;

type Position = "inside" | "outside" | "unavailable";
type EvidenceStatus = Position | "returned";
export type GeofenceStatus = EvidenceStatus | "checked_out" | "exempt" | "inactive";
export type GeofenceState = {
  recordId: number | null;
  eligible: boolean;
  consented: boolean;
  status: GeofenceStatus;
  workplace: string | null;
  startsAt: number | null;
  endsAt: number | null;
};

export type GeofenceEvidence = {
  status: EvidenceStatus;
  observedAt: number | null;
  receivedAt: number | null;
  lastTrustedAt: number | null;
  outsideSince: number | null;
  outsideSinceReceivedAt: number | null;
};
export type GeofenceOpenVisit = { outsideMs: number; verification: "verified" | "interrupted" };

type VisitDecision =
  | { kind: "open"; exitAt: number; outsideMs: number }
  | ({ kind: "update" } & GeofenceOpenVisit)
  | ({ kind: "return"; returnAt: number } & GeofenceOpenVisit);

export function classifyGeofenceSample(sample: GpsEvidence, location: GpsLocation): Position {
  const { latitude, longitude, accuracy } = sample;
  if (location.latitude == null || location.longitude == null || !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || !Number.isFinite(accuracy) || accuracy <= 0 || accuracy > location.maxAccuracyMeters) {
    return "unavailable";
  }
  const distance = haversineMeters(sample, { latitude: location.latitude, longitude: location.longitude });
  if (distance + accuracy <= location.radiusMeters) return "inside";
  if (distance - accuracy > location.radiusMeters) return "outside";
  return "unavailable";
}

export function geofenceEvidenceStatus(evidence: GeofenceEvidence, now: number): EvidenceStatus {
  return evidence.receivedAt != null && evidence.observedAt != null &&
    now - evidence.receivedAt <= GEOFENCE_SAMPLE_GAP_MS && now - evidence.observedAt <= GEOFENCE_SAMPLE_GAP_MS
    ? evidence.status : "unavailable";
}

export function evaluateGeofenceSample(input: {
  evidence: GeofenceEvidence;
  visit: GeofenceOpenVisit | null;
  position: Position;
  observedAt: number;
  now: number;
  interrupted: boolean;
}): { evidence: GeofenceEvidence; visit: VisitDecision | null } {
  const { evidence, visit, observedAt, now, interrupted } = input;
  if ((evidence.observedAt != null && observedAt <= evidence.observedAt) ||
      (evidence.receivedAt != null && now < evidence.receivedAt)) return { evidence, visit: null };

  const fresh = Number.isSafeInteger(observedAt) && now - observedAt <= MAX_SAMPLE_AGE_MS && observedAt - now <= MAX_SAMPLE_FUTURE_MS;
  const position = fresh ? input.position : "unavailable";
  const lastTrustedAt = position === "unavailable" ? evidence.lastTrustedAt : Math.min(observedAt, now);
  const continuous = !interrupted && evidence.observedAt != null && evidence.receivedAt != null &&
    observedAt - evidence.observedAt <= GEOFENCE_SAMPLE_GAP_MS && now - evidence.receivedAt <= GEOFENCE_SAMPLE_GAP_MS;
  const outsideSince = position === "outside" ? (continuous ? evidence.outsideSince : null) ?? observedAt : null;
  const outsideSinceReceivedAt = position === "outside" ? (continuous ? evidence.outsideSinceReceivedAt : null) ?? now : null;
  const confirmed = outsideSince != null && outsideSinceReceivedAt != null &&
    observedAt - outsideSince >= CONFIRM_OUTSIDE_MS && now - outsideSinceReceivedAt >= CONFIRM_OUTSIDE_MS;
  let status: EvidenceStatus = "unavailable";
  let decision: VisitDecision | null = null;
  if (visit) {
    const interval = position !== "unavailable" && continuous && evidence.outsideSince != null &&
      evidence.observedAt != null && evidence.receivedAt != null
      ? Math.min(observedAt - evidence.observedAt, now - evidence.receivedAt) : null;
    const outsideMs = visit.outsideMs + (interval ?? 0);
    const verification = interval != null ? visit.verification : "interrupted";
    if (position === "inside") {
      status = "returned";
      decision = { kind: "return", returnAt: Math.min(observedAt, now), outsideMs, verification };
    } else {
      if (position === "outside") status = "outside";
      if (outsideMs !== visit.outsideMs || verification !== visit.verification)
        decision = { kind: "update", outsideMs, verification };
    }
  } else if (confirmed) {
    status = "outside";
    decision = { kind: "open", exitAt: outsideSince, outsideMs: Math.min(observedAt - outsideSince, now - outsideSinceReceivedAt) };
  } else if (position === "inside") {
    status = evidence.status === "returned" ? "returned" : "inside";
  }
  return {
    evidence: { status, observedAt: fresh ? observedAt : evidence.observedAt, receivedAt: now, lastTrustedAt, outsideSince, outsideSinceReceivedAt },
    visit: decision,
  };
}

export function geofenceWindow(input: {
  checkInAt: number;
  schedule: ScheduleInput;
  shift: { startMs: number; endMs: number; status: string } | null;
}) {
  const { checkInAt, schedule, shift } = input;
  if (!schedule.enabled || shift?.status === "cancelled") return null;
  const date = baghdadDate(checkInAt);
  const previous = shift == null ? fixedShiftFor(addDays(date, -1), schedule) : null;
  const window = shift ?? (previous && previous.endMs > checkInAt ? previous : fixedShiftFor(date, schedule));
  if (!window || !Number.isFinite(window.startMs) || !Number.isFinite(window.endMs) || window.endMs <= Math.max(checkInAt, window.startMs)) return null;
  return { startsAt: Math.max(checkInAt, window.startMs), endsAt: window.endMs };
}
