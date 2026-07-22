/**
 * Kosha field-operations rules: the execution pipeline, the equipment checklist and the
 * damage report gate.
 *
 * Pure functions, no database access, so every rule is directly testable.
 *
 * The pipeline EXTENDS the six stages that are already stored in
 * `kosha_bookings.execution_stage`; it does not replace them. Every legacy key keeps its
 * meaning and its relative position, so existing bookings stay valid and the current
 * workflow is unchanged — the five new stages only add resolution where the crew
 * previously had none.
 */

export const KOSHA_STAGES = [
  "booked",             // new
  "preparing",          // legacy — قيد التجهيز
  "ready",              // new
  "out_of_warehouse",   // legacy — خرجت من المخزن (loaded)
  "on_the_way",         // legacy — في الطريق
  "executing",          // legacy — قيد التنفيذ (installation started)
  "executed",           // legacy — تم التنفيذ (installed)
  "event_running",      // new
  "dismantling",        // new
  "returned",           // new
  "delivered",          // legacy — تم التسليم (completed)
] as const;
export type KoshaStage = (typeof KOSHA_STAGES)[number];

/** Keys that predate this module. Never remove one — stored rows still carry them. */
export const LEGACY_KOSHA_STAGES: KoshaStage[] = [
  "preparing", "out_of_warehouse", "on_the_way", "executing", "executed", "delivered",
];

export const KOSHA_STAGE_LABELS: Record<KoshaStage, string> = {
  booked: "محجوزة",
  preparing: "قيد التجهيز",
  ready: "جاهزة",
  out_of_warehouse: "جاري التحميل",
  on_the_way: "في الطريق",
  executing: "جاري التنصيب",
  executed: "تم التنصيب",
  event_running: "المناسبة جارية",
  dismantling: "جاري الفك",
  returned: "تم الإرجاع",
  delivered: "مكتمل",
};

export function isKoshaStage(value: unknown): value is KoshaStage {
  return typeof value === "string" && (KOSHA_STAGES as readonly string[]).includes(value);
}

export function koshaStageRank(stage: string): number {
  const index = (KOSHA_STAGES as readonly string[]).indexOf(stage);
  return index < 0 ? 0 : index;
}

/** Equipment classes a kosha job is checked against before it leaves the warehouse. */
export const KOSHA_CHECKLIST_ITEMS = [
  "backdrop", "flowers", "lighting", "chairs", "tables",
  "carpet", "frames", "accessories", "audio", "screens", "other",
] as const;
export type KoshaChecklistItem = (typeof KOSHA_CHECKLIST_ITEMS)[number];

export const KOSHA_CHECKLIST_LABELS: Record<KoshaChecklistItem, string> = {
  backdrop: "الخلفية",
  flowers: "الورود",
  lighting: "الإضاءة",
  chairs: "الكراسي",
  tables: "الطاولات",
  carpet: "السجاد",
  frames: "الإطارات",
  accessories: "الإكسسوارات",
  audio: "الصوتيات",
  screens: "الشاشات",
  other: "أصول أخرى",
};

export const CHECKLIST_CONDITIONS = ["available", "missing", "damaged", "needs_maintenance"] as const;
export type ChecklistCondition = (typeof CHECKLIST_CONDITIONS)[number];

export const CHECKLIST_CONDITION_LABELS: Record<ChecklistCondition, string> = {
  available: "متوفر",
  missing: "مفقود",
  damaged: "تالف",
  needs_maintenance: "يحتاج صيانة",
};

export function isChecklistCondition(value: unknown): value is ChecklistCondition {
  return typeof value === "string" && (CHECKLIST_CONDITIONS as readonly string[]).includes(value);
}

/** The five scan points an item passes through on a job. */
export const KOSHA_SCAN_POINTS = [
  "warehouse_out", "vehicle_load", "installation", "return", "warehouse_in",
] as const;
export type KoshaScanPoint = (typeof KOSHA_SCAN_POINTS)[number];

export const SCAN_POINT_LABELS: Record<KoshaScanPoint, string> = {
  warehouse_out: "خروج من المخزن",
  vehicle_load: "تحميل بالمركبة",
  installation: "التنصيب",
  return: "الإرجاع",
  warehouse_in: "دخول المخزن",
};

export function isScanPoint(value: unknown): value is KoshaScanPoint {
  return typeof value === "string" && (KOSHA_SCAN_POINTS as readonly string[]).includes(value);
}

export type StageRefusal = { ok: false; reason: string; status: number };
export type StageApproval = { ok: true; backward: boolean };

export type ChecklistEntry = { item: string; condition: string };

/**
 * Checklist rows that block dispatch: anything not `available` must be resolved or
 * explicitly reported before the load leaves the warehouse.
 */
export function blockingChecklistIssues(entries: ChecklistEntry[]): ChecklistEntry[] {
  return entries.filter(
    (entry) => isChecklistCondition(entry.condition) && entry.condition !== "available",
  );
}

export function checklistCovered(entries: ChecklistEntry[]): boolean {
  const seen = new Set(entries.map((entry) => entry.item));
  return KOSHA_CHECKLIST_ITEMS.every((item) => seen.has(item));
}

/**
 * Decides whether a stage change is permitted.
 *
 * Gates, in the order they are evaluated:
 *  - backward moves are manager-only, so a crew cannot quietly rewind their own timeline;
 *  - `ready → out_of_warehouse` (loading) requires a complete checklist with no unresolved
 *    issues — this is the "cannot dispatch an incomplete kosha" rule;
 *  - closing the job (`returned → delivered`) requires the damage question to have been
 *    answered, so a job never closes with an open damage state.
 */
export function evaluateKoshaStage(input: {
  from: string;
  to: string;
  isManager: boolean;
  checklist?: ChecklistEntry[];
  damageAnswered?: boolean;
}): StageApproval | StageRefusal {
  const { from, to, isManager } = input;
  if (!isKoshaStage(to)) return { ok: false, reason: "مرحلة غير معروفة", status: 400 };
  if (from === to) return { ok: false, reason: "الحجز في هذه المرحلة بالفعل", status: 409 };

  const fromRank = koshaStageRank(from);
  const toRank = koshaStageRank(to);

  if (toRank < fromRank) {
    if (!isManager) return { ok: false, reason: "إرجاع الحجز لمرحلة سابقة يحتاج صلاحية مدير", status: 403 };
    return { ok: true, backward: true };
  }

  // Forward moves advance one step — but the new stages were INSERTED between existing
  // ones, so a crew following the old six-stage flow (preparing → out_of_warehouse) would
  // suddenly be making an illegal two-step jump. Adjacency in the legacy pipeline is
  // therefore just as valid as adjacency in the new one; the extra stages are optional
  // resolution, not a mandatory longer route.
  const adjacentNew = toRank === fromRank + 1;
  const legacyFrom = LEGACY_KOSHA_STAGES.indexOf(from as KoshaStage);
  const legacyTo = LEGACY_KOSHA_STAGES.indexOf(to as KoshaStage);
  const adjacentLegacy = legacyFrom >= 0 && legacyTo === legacyFrom + 1;
  if (!adjacentNew && !adjacentLegacy) {
    return {
      ok: false,
      reason: `لا يمكن الانتقال من «${KOSHA_STAGE_LABELS[from as KoshaStage] ?? from}» إلى «${KOSHA_STAGE_LABELS[to]}» مباشرة`,
      status: 409,
    };
  }

  if (to === "out_of_warehouse") {
    const entries = input.checklist ?? [];
    if (!checklistCovered(entries)) {
      return { ok: false, reason: "أكمل قائمة المعدات قبل تحميل الحجز", status: 422 };
    }
    const issues = blockingChecklistIssues(entries);
    if (issues.length) {
      const names = issues.map(
        (issue) => KOSHA_CHECKLIST_LABELS[issue.item as KoshaChecklistItem] ?? issue.item,
      );
      return {
        ok: false,
        reason: `عناصر غير متوفرة تمنع التحميل: ${names.join("، ")}`,
        status: 422,
      };
    }
  }

  if (to === "delivered" && input.damageAnswered === false) {
    return { ok: false, reason: "أجب عن سؤال الأضرار قبل إغلاق الحجز", status: 422 };
  }

  return { ok: true, backward: false };
}

/** The scan point a stage implies, or null when the stage involves no scanning. */
export function scanPointForStage(stage: KoshaStage): KoshaScanPoint | null {
  switch (stage) {
    case "out_of_warehouse":
      return "warehouse_out";
    case "on_the_way":
      return "vehicle_load";
    case "executing":
      return "installation";
    case "dismantling":
      return "return";
    case "returned":
      return "warehouse_in";
    default:
      return null;
  }
}

export const DAMAGE_PRIORITIES = ["low", "medium", "high", "critical"] as const;
export type DamagePriority = (typeof DAMAGE_PRIORITIES)[number];

export const DAMAGE_PRIORITY_LABELS: Record<DamagePriority, string> = {
  low: "منخفضة",
  medium: "متوسطة",
  high: "عالية",
  critical: "حرجة",
};

export function isDamagePriority(value: unknown): value is DamagePriority {
  return typeof value === "string" && (DAMAGE_PRIORITIES as readonly string[]).includes(value);
}

export type DamageDraft = {
  productId?: unknown;
  description?: unknown;
  priority?: unknown;
  costEstimate?: unknown;
  responsibleStaffId?: unknown;
  photoUrl?: unknown;
};

/**
 * Validates a damage report. High and critical reports additionally require a named
 * responsible person, because those are the ones that lead to a deduction or a claim.
 */
export function validateDamageReport(draft: DamageDraft):
  | { ok: true; value: { productId: number; description: string; priority: DamagePriority; costEstimate: number; responsibleStaffId: number | null; photoUrl: string | null } }
  | { ok: false; reason: string } {
  const productId = Number(draft.productId);
  if (!Number.isInteger(productId) || productId <= 0) {
    return { ok: false, reason: "اختر الأصل المتضرر" };
  }
  const description = String(draft.description ?? "").trim();
  if (description.length < 5) {
    return { ok: false, reason: "وصف الضرر مطلوب (5 أحرف على الأقل)" };
  }
  const priority = isDamagePriority(draft.priority) ? draft.priority : "medium";
  const rawCost = Number(draft.costEstimate ?? 0);
  const costEstimate = Number.isFinite(rawCost) && rawCost > 0 ? Math.round(rawCost) : 0;
  const rawStaff = Number(draft.responsibleStaffId);
  const responsibleStaffId = Number.isInteger(rawStaff) && rawStaff > 0 ? rawStaff : null;
  if ((priority === "high" || priority === "critical") && !responsibleStaffId) {
    return { ok: false, reason: "حدّد الموظف المسؤول للأضرار عالية الخطورة" };
  }
  const photo = String(draft.photoUrl ?? "").trim();
  return {
    ok: true,
    value: {
      productId,
      description,
      priority,
      costEstimate,
      responsibleStaffId,
      photoUrl: photo || null,
    },
  };
}

/** Damage reports above this bar cannot be closed without a manager sign-off. */
export function damageNeedsManagerApproval(priority: DamagePriority, costEstimate: number): boolean {
  return priority === "high" || priority === "critical" || costEstimate > 0;
}
