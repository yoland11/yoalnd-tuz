import {
  PHOTOGRAPHY_CHECKLIST_KEYS,
  PHOTOGRAPHY_SHOOT_STAGES,
  type PhotographyChecklistKey,
  type PhotographyShootStage,
} from "@workspace/db";

/**
 * Field-shoot lifecycle rules.
 *
 * Kept in one module so the portal, the admin dashboard and the API all agree on which
 * transitions exist and when the pre-shoot checklist blocks work. Nothing here touches the
 * database — callers own persistence.
 */

export const SHOOT_STAGE_LABELS: Record<PhotographyShootStage, string> = {
  assigned: "مُسند",
  preparing: "قيد التحضير",
  on_the_way: "في الطريق",
  arrived: "وصل الموقع",
  shooting: "قيد التصوير",
  uploading: "رفع الملفات",
  editing: "قيد المونتاج",
  ready_for_review: "جاهز للمراجعة",
  delivered: "تم التسليم",
  completed: "مكتمل",
};

export const CHECKLIST_LABELS: Record<PhotographyChecklistKey, string> = {
  camera_ready: "الكاميرا جاهزة",
  lens_cleaned: "العدسات نظيفة",
  batteries_charged: "البطاريات مشحونة",
  cards_empty: "بطاقات الذاكرة فارغة",
  mic_working: "المايكروفونات تعمل",
  flash_working: "الفلاش يعمل",
  gimbal_calibrated: "الجيمبل مُعاير",
  drone_ready: "الدرون جاهز",
  tripod_packed: "الحامل مُجهّز",
};

/**
 * Allowed forward transitions. Backward moves are handled separately and are
 * manager-only, so a photographer can never quietly rewind their own timeline.
 */
const FORWARD: Record<PhotographyShootStage, PhotographyShootStage[]> = {
  assigned: ["preparing"],
  preparing: ["on_the_way"],
  on_the_way: ["arrived"],
  arrived: ["shooting"],
  shooting: ["uploading"],
  uploading: ["editing"],
  editing: ["ready_for_review"],
  ready_for_review: ["delivered"],
  delivered: ["completed"],
  completed: [],
};

/** Stage index, used for ordering and for detecting a backward move. */
export function stageIndex(stage: string): number {
  const index = (PHOTOGRAPHY_SHOOT_STAGES as readonly string[]).indexOf(stage);
  return index < 0 ? 0 : index;
}

export function isShootStage(value: unknown): value is PhotographyShootStage {
  return typeof value === "string" && (PHOTOGRAPHY_SHOOT_STAGES as readonly string[]).includes(value);
}

/** Normalizes a stored checklist blob into a complete, boolean-valued map. */
export function normalizeChecklist(raw: unknown): Record<PhotographyChecklistKey, boolean> {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(
    PHOTOGRAPHY_CHECKLIST_KEYS.map((key) => [key, source[key] === true]),
  ) as Record<PhotographyChecklistKey, boolean>;
}

export function checklistComplete(raw: unknown): boolean {
  const checklist = normalizeChecklist(raw);
  return PHOTOGRAPHY_CHECKLIST_KEYS.every((key) => checklist[key]);
}

export function missingChecklistItems(raw: unknown): PhotographyChecklistKey[] {
  const checklist = normalizeChecklist(raw);
  return PHOTOGRAPHY_CHECKLIST_KEYS.filter((key) => !checklist[key]);
}

export type TransitionRefusal = { ok: false; reason: string; status: number };
export type TransitionApproval = { ok: true; backward: boolean };

/**
 * Decides whether `from → to` is permitted.
 *
 * The checklist gate sits on `preparing → on_the_way`: that is the first stage where the
 * photographer physically commits to the job, which is what "cannot start until the
 * checklist is completed" means in practice.
 */
export function evaluateTransition(input: {
  from: string;
  to: string;
  checklist: unknown;
  isManager: boolean;
}): TransitionApproval | TransitionRefusal {
  const { from, to, checklist, isManager } = input;
  if (!isShootStage(to)) return { ok: false, reason: "مرحلة غير معروفة", status: 400 };
  if (from === to) return { ok: false, reason: "المهمة في هذه المرحلة بالفعل", status: 409 };

  const backward = stageIndex(to) < stageIndex(from);
  if (backward) {
    // Rewinding rewrites history, so it stays with managers regardless of assignment.
    if (!isManager) return { ok: false, reason: "إرجاع المهمة إلى مرحلة سابقة يحتاج صلاحية مدير", status: 403 };
    return { ok: true, backward: true };
  }

  const allowed = FORWARD[from as PhotographyShootStage] ?? [];
  if (!allowed.includes(to)) {
    return {
      ok: false,
      reason: `لا يمكن الانتقال من «${SHOOT_STAGE_LABELS[from as PhotographyShootStage] ?? from}» إلى «${SHOOT_STAGE_LABELS[to]}» مباشرة`,
      status: 409,
    };
  }

  if (to === "on_the_way" && !checklistComplete(checklist)) {
    const missing = missingChecklistItems(checklist).map((key) => CHECKLIST_LABELS[key]);
    return {
      ok: false,
      reason: `أكمل قائمة ما قبل التصوير أولاً — المتبقي: ${missing.join("، ")}`,
      status: 422,
    };
  }

  return { ok: true, backward: false };
}

/** Milestone timestamps a transition should stamp when it lands on a stage. */
export function stageTimestamps(to: PhotographyShootStage, now: Date): Record<string, Date> {
  switch (to) {
    case "on_the_way":
      return { departedAt: now };
    case "arrived":
      return { arrivedAt: now };
    case "shooting":
      return { shootingStartedAt: now };
    case "uploading":
      return { shootingEndedAt: now };
    case "delivered":
      return { deliveredAt: now };
    case "completed":
      return { completedAt: now };
    default:
      return {};
  }
}

/** Google Maps deep link. Falls back to a text search when coordinates are absent. */
export function mapsLink(lat: unknown, lng: unknown, venue: unknown): string | null {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (Number.isFinite(latitude) && Number.isFinite(longitude) && (latitude !== 0 || longitude !== 0)) {
    return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
  }
  const label = String(venue ?? "").trim();
  return label ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(label)}` : null;
}

/** Parses a client-supplied coordinate, rejecting out-of-range and non-finite values. */
export function parseCoordinate(value: unknown, kind: "lat" | "lng"): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const limit = kind === "lat" ? 90 : 180;
  if (Math.abs(parsed) > limit) return null;
  return parsed;
}
