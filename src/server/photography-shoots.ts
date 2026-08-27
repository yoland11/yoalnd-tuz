import {
  PHOTOGRAPHY_CHECKLIST_KEYS,
  PHOTOGRAPHY_SHOOT_STAGES,
  type PhotographyChecklistKey,
  type PhotographyShootStage,
} from "@workspace/db";

/** Shared lifecycle rules used by the staff portal and the admin operations view. */
export const SHOOT_STAGE_LABELS: Record<PhotographyShootStage, string> = {
  new_booking: "حجز جديد",
  crew_assigned: "توزيع الكادر",
  waiting_event: "بانتظار الموعد",
  on_the_way: "في الطريق",
  shooting: "جاري التصوير",
  processing_files: "معالجة الملفات",
  review_and_edit: "مراجعة وتعديل",
  printing: "الطباعة",
  ready_delivery: "جاهز للتسليم",
  completed: "مكتمل",
  cancelled: "ملغي",
};

export const CHECKLIST_LABELS: Record<PhotographyChecklistKey, string> = {
  camera_ready: "الكاميرا جاهزة",
  lens_cleaned: "العدسات نظيفة",
  batteries_charged: "البطاريات مشحونة",
  cards_empty: "بطاقات الذاكرة مهيأة",
  mic_working: "الصوت مجرّب",
  flash_working: "الفلاش يعمل",
  gimbal_calibrated: "الجيمبل معاير",
  drone_ready: "الدرون جاهز",
  tripod_packed: "الحامل مجهز",
};

const FORWARD: Record<PhotographyShootStage, PhotographyShootStage[]> = {
  new_booking: ["crew_assigned"],
  crew_assigned: ["waiting_event"],
  waiting_event: ["on_the_way"],
  on_the_way: ["shooting"],
  shooting: ["processing_files"],
  processing_files: ["review_and_edit"],
  review_and_edit: ["printing"],
  printing: ["ready_delivery"],
  ready_delivery: ["completed"],
  completed: [],
  cancelled: [],
};

/** Keeps every historical stage readable without rewriting its audit trail. */
const LEGACY_STAGE_MAP: Record<string, PhotographyShootStage> = {
  awaiting_assignment: "new_booking",
  assigned: "crew_assigned",
  accepted: "crew_assigned",
  preparing: "waiting_event",
  arrived: "shooting",
  shoot_ended: "processing_files",
  files_received: "processing_files",
  uploading: "processing_files",
  transferring: "processing_files",
  sorting: "processing_files",
  editing: "processing_files",
  customer_review: "review_and_edit",
  revising: "review_and_edit",
  ready_for_review: "review_and_edit",
  ready_print: "review_and_edit",
  delivered: "completed",
};

export function normalizeShootStage(value: unknown): PhotographyShootStage {
  const raw = String(value ?? "").trim();
  if (raw === "cancelled") return raw;
  if ((PHOTOGRAPHY_SHOOT_STAGES as readonly string[]).includes(raw)) {
    return raw as PhotographyShootStage;
  }
  return LEGACY_STAGE_MAP[raw] ?? "new_booking";
}

export function stageIndex(stage: string): number {
  const index = (PHOTOGRAPHY_SHOOT_STAGES as readonly string[]).indexOf(
    normalizeShootStage(stage),
  );
  return index < 0 ? 0 : index;
}

export function isShootStage(value: unknown): value is PhotographyShootStage {
  return (
    typeof value === "string" &&
    ((PHOTOGRAPHY_SHOOT_STAGES as readonly string[]).includes(value) ||
      value === "cancelled")
  );
}

export function normalizeChecklist(
  raw: unknown,
): Record<PhotographyChecklistKey, boolean> {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
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

export function evaluateTransition(input: {
  from: string;
  to: string;
  checklist: unknown;
  isManager: boolean;
}): TransitionApproval | TransitionRefusal {
  const from = normalizeShootStage(input.from);
  const { to, checklist, isManager } = input;
  if (!isShootStage(to)) {
    return { ok: false, reason: "مرحلة غير معروفة", status: 400 };
  }
  if (from === to) {
    return { ok: false, reason: "المهمة في هذه المرحلة بالفعل", status: 409 };
  }
  if (to === "cancelled") {
    return isManager
      ? { ok: true, backward: false }
      : { ok: false, reason: "إلغاء المهمة يحتاج صلاحية مدير", status: 403 };
  }

  const backward = stageIndex(to) < stageIndex(from);
  if (backward) {
    if (!isManager) {
      return {
        ok: false,
        reason: "إرجاع المهمة إلى مرحلة سابقة يحتاج صلاحية مدير",
        status: 403,
      };
    }
    return { ok: true, backward: true };
  }

  if (!(FORWARD[from] ?? []).includes(to)) {
    return {
      ok: false,
      reason: `لا يمكن الانتقال من «${SHOOT_STAGE_LABELS[from]}» إلى «${SHOOT_STAGE_LABELS[to]}» مباشرة`,
      status: 409,
    };
  }

  if (to === "on_the_way" && !checklistComplete(checklist)) {
    const missing = missingChecklistItems(checklist).map(
      (key) => CHECKLIST_LABELS[key],
    );
    return {
      ok: false,
      reason: `أكمل قائمة ما قبل التصوير أولاً — المتبقي: ${missing.join("، ")}`,
      status: 422,
    };
  }

  return { ok: true, backward: false };
}

export function stageTimestamps(
  to: PhotographyShootStage,
  now: Date,
): Record<string, Date> {
  switch (to) {
    case "on_the_way":
      return { departedAt: now };
    case "shooting":
      return { shootingStartedAt: now };
    case "processing_files":
      return { shootingEndedAt: now };
    case "ready_delivery":
      return { deliveredAt: now };
    case "completed":
      return { completedAt: now };
    case "cancelled":
      return { cancelledAt: now };
    default:
      return {};
  }
}

export function mapsLink(
  lat: unknown,
  lng: unknown,
  venue: unknown,
): string | null {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    (latitude !== 0 || longitude !== 0)
  ) {
    return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
  }
  const label = String(venue ?? "").trim();
  return label
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(label)}`
    : null;
}

export function parseCoordinate(
  value: unknown,
  kind: "lat" | "lng",
): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const limit = kind === "lat" ? 90 : 180;
  if (Math.abs(parsed) > limit) return null;
  return parsed;
}
