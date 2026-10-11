/**
 * Academic graduation batches (وجبات التخرج) for the representatives portal.
 *
 * A batch is the group's existing `graduation_year` value, used exactly as it is
 * stored (only digit/space normalisation). It is never inferred from a group
 * title or any other free text: groups without a stored year stay in the
 * explicit "unassigned" bucket until an administrator assigns them.
 *
 * Pure helpers only — shared by the server workspace module and the portal UI.
 */
import { getGraduationMeasurementFilter, type GraduationMeasurementFilter } from "@/lib/graduation-measurements";

export const UNASSIGNED_BATCH = "unassigned";
export const GRADUATION_BATCH_SETTING_KEY = "graduationBatches";

/** Arabic-Indic / Persian digits → Latin, collapse whitespace. Never guesses. */
export function normalizeBatchKey(value: unknown): string {
  return String(value ?? "")
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .trim()
    .replace(/\s+/g, " ");
}

/** Batch key of a group: its stored graduation year, or the unassigned bucket. */
export function groupBatchKey(graduationYear: unknown): string {
  return normalizeBatchKey(graduationYear) || UNASSIGNED_BATCH;
}

/** A new or assigned batch must be a year ("2027") or an academic span ("2026-2027"). */
export function isValidBatchKey(value: string): boolean {
  const match = /^(\d{4})(?:-(\d{4}))?$/.exec(value);
  if (!match) return false;
  const start = Number(match[1]);
  if (start < 2000 || start > 2100) return false;
  return !match[2] || Number(match[2]) === start + 1;
}

export function batchLabel(key: string): string {
  return key === UNASSIGNED_BATCH ? "بدون وجبة محددة" : `وجبة ${key}`;
}

/** Newest years first; non-year keys after them; the unassigned bucket last. */
export function compareBatchKeys(a: string, b: string): number {
  if (a === b) return 0;
  if (a === UNASSIGNED_BATCH) return 1;
  if (b === UNASSIGNED_BATCH) return -1;
  const ya = Number(/^\d{4}/.exec(a)?.[0] ?? NaN);
  const yb = Number(/^\d{4}/.exec(b)?.[0] ?? NaN);
  if (Number.isFinite(ya) && Number.isFinite(yb) && ya !== yb) return yb - ya;
  if (Number.isFinite(ya) !== Number.isFinite(yb)) return Number.isFinite(ya) ? -1 : 1;
  return a.localeCompare(b, "ar");
}

// ------------------------------------------------------------------ students

export const PRODUCTION_DONE_STAGES = ["ready", "delivered", "completed"];
export const GRADUATION_STAGE_ORDER = [
  "incomplete_data", "new", "awaiting_measurements", "measurements", "awaiting_design",
  "awaiting_approval", "approved", "fabric_cutting", "tailoring", "printing", "embroidery",
  "ironing", "quality_check", "awaiting_packaging", "packaging", "ready", "delivered", "completed",
];

export type ProductionPhase = "not_started" | "in_production" | "ready" | "delivered" | "cancelled";
export type DeliveryPhase = "pending" | "assigned" | "out_for_delivery" | "delivered";
export type PaymentPhase = "unpaid" | "partial" | "paid";
export type StepState = "done" | "active" | "pending" | "na";

export type WorkspaceStudentSource = {
  status?: string | null;
  productionStage?: string | null;
  measurements?: unknown;
  accessories?: unknown;
  customText?: unknown;
  styleKey?: string | null;
  total: number;
  paid: number;
  remaining: number;
  delivery?: unknown;
  deliveredAt?: string | Date | null;
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export function isCancelledStudent(student: Pick<WorkspaceStudentSource, "status" | "productionStage">): boolean {
  return student.status === "cancelled" || student.productionStage === "cancelled";
}

export function paymentPhase(student: Pick<WorkspaceStudentSource, "total" | "paid" | "remaining">): PaymentPhase {
  if (student.paid <= 0) return student.total <= 0 ? "paid" : "unpaid";
  return student.remaining > 0 ? "partial" : "paid";
}

export function deliveryPhase(student: Pick<WorkspaceStudentSource, "delivery" | "deliveredAt" | "productionStage">): DeliveryPhase {
  const status = String(record(student.delivery).status ?? "");
  if (status === "delivered" || student.deliveredAt || ["delivered", "completed"].includes(String(student.productionStage)))
    return "delivered";
  if (status === "out_for_delivery") return "out_for_delivery";
  if (status === "assigned") return "assigned";
  return "pending";
}

export function productionPhase(student: Pick<WorkspaceStudentSource, "status" | "productionStage" | "delivery" | "deliveredAt">): ProductionPhase {
  if (isCancelledStudent(student)) return "cancelled";
  if (deliveryPhase(student) === "delivered") return "delivered";
  const stage = String(student.productionStage ?? "new");
  if (PRODUCTION_DONE_STAGES.includes(stage)) return "ready";
  return GRADUATION_STAGE_ORDER.indexOf(stage) > GRADUATION_STAGE_ORDER.indexOf("approved") ? "in_production" : "not_started";
}

function stageState(stage: string, step: string): StepState {
  const at = GRADUATION_STAGE_ORDER.indexOf(stage);
  const target = GRADUATION_STAGE_ORDER.indexOf(step);
  if (at < 0 || target < 0) return "pending";
  return at > target ? "done" : at === target ? "active" : "pending";
}

/** Read-only equipment checklist derived from the existing order + production stage. */
export function studentEquipment(student: WorkspaceStudentSource) {
  const stage = String(student.productionStage ?? "new");
  const accessories = Array.isArray(student.accessories) ? student.accessories.map(String) : [];
  const text = record(student.customText);
  const hasSash = accessories.includes("sash") || Boolean(text.sashType || text.text);
  const hasCap = accessories.includes("cap");
  const finished = PRODUCTION_DONE_STAGES.includes(stage) || deliveryPhase(student) === "delivered";
  const measurement: GraduationMeasurementFilter = getGraduationMeasurementFilter(student.measurements);
  const tailoring = stageState(stage, "tailoring");
  return {
    measurements: measurement === "complete" ? "done" : measurement === "partial" ? "active" : "pending",
    gown: student.styleKey ? (finished ? "done" : tailoring === "done" ? "done" : stageState(stage, "fabric_cutting") !== "pending" ? "active" : "pending") : "na",
    sash: hasSash ? (finished || stageState(stage, "embroidery") === "done" ? "done" : stageState(stage, "printing") !== "pending" ? "active" : "pending") : "na",
    cap: hasCap ? (finished ? "done" : stageState(stage, "packaging") !== "pending" ? "active" : "pending") : "na",
    printing: hasSash ? (finished ? "done" : stageState(stage, "printing")) : "na",
    embroidery: hasSash ? (finished ? "done" : stageState(stage, "embroidery")) : "na",
    delivery: deliveryPhase(student) === "delivered" ? "done" : finished ? "active" : "pending",
  } satisfies Record<string, StepState>;
}

export type StudentStatsSource = Pick<WorkspaceStudentSource, "status" | "productionStage" | "total" | "paid" | "remaining" | "delivery" | "deliveredAt">;

/** Financial and progress statistics of one group's students (cancelled excluded). */
export function summarizeStudents(students: readonly StudentStatsSource[]) {
  const active = students.filter((student) => !isCancelledStudent(student));
  const round = (value: number) => Math.round(value * 100) / 100;
  const total = round(active.reduce((sum, student) => sum + student.total, 0));
  const paid = round(active.reduce((sum, student) => sum + student.paid, 0));
  const remaining = round(active.reduce((sum, student) => sum + student.remaining, 0));
  const phases = active.map(productionPhase);
  const produced = phases.filter((phase) => phase === "ready" || phase === "delivered").length;
  const delivered = active.filter((student) => deliveryPhase(student) === "delivered").length;
  const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
  return {
    students: active.length,
    cancelled: students.length - active.length,
    total,
    paid,
    remaining,
    paidFull: active.filter((student) => paymentPhase(student) === "paid").length,
    partial: active.filter((student) => paymentPhase(student) === "partial").length,
    unpaid: active.filter((student) => paymentPhase(student) === "unpaid").length,
    inProduction: phases.filter((phase) => phase === "in_production").length,
    produced,
    delivered,
    collectionProgress: percent(paid, total),
    productionProgress: percent(produced, active.length),
    deliveryProgress: percent(delivered, active.length),
  };
}

export type StudentStats = ReturnType<typeof summarizeStudents>;

/** Adds group statistics into batch/global totals without re-reading students. */
export function combineStats(items: readonly StudentStats[]): StudentStats {
  const sum = (key: keyof StudentStats) => items.reduce((total, item) => total + Number(item[key] || 0), 0);
  const students = sum("students");
  const total = Math.round(sum("total") * 100) / 100;
  const paid = Math.round(sum("paid") * 100) / 100;
  const produced = sum("produced");
  const delivered = sum("delivered");
  const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
  return {
    students,
    cancelled: sum("cancelled"),
    total,
    paid,
    remaining: Math.round(sum("remaining") * 100) / 100,
    paidFull: sum("paidFull"),
    partial: sum("partial"),
    unpaid: sum("unpaid"),
    inProduction: sum("inProduction"),
    produced,
    delivered,
    collectionProgress: percent(paid, total),
    productionProgress: percent(produced, students),
    deliveryProgress: percent(delivered, students),
  };
}

// ------------------------------------------------------------------ labels

export const PAYMENT_PHASE_LABELS: Record<PaymentPhase, string> = {
  unpaid: "غير مدفوع",
  partial: "مدفوع جزئياً",
  paid: "مدفوع بالكامل",
};
export const PRODUCTION_PHASE_LABELS: Record<ProductionPhase, string> = {
  not_started: "لم يبدأ التجهيز",
  in_production: "قيد التجهيز",
  ready: "جاهز للتسليم",
  delivered: "تم التسليم",
  cancelled: "ملغي",
};
export const DELIVERY_PHASE_LABELS: Record<DeliveryPhase, string> = {
  pending: "بانتظار التسليم",
  assigned: "تم تعيين موظف التسليم",
  out_for_delivery: "في الطريق",
  delivered: "تم التسليم",
};
export const STEP_STATE_LABELS: Record<StepState, string> = {
  done: "منجز",
  active: "قيد التنفيذ",
  pending: "بالانتظار",
  na: "غير مطلوب",
};
