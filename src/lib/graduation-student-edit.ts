import { z } from "zod/v4";
import {
  MEASUREMENTS,
  SASH_FONTS,
  STUDENT_REFERENCE_PLACEMENTS,
} from "@/lib/graduation-student-flow";

/**
 * Student self-edit from the tracking link: which orders may still change,
 * and what the student may send. Shared by the tracking page and the server.
 */

/**
 * From fabric cutting on, production has started: the student can no longer
 * edit. Includes the legacy stage names still found on older orders.
 */
export const STUDENT_EDIT_LOCKED_STAGES = [
  "fabric_cutting", "tailoring", "printing", "embroidery", "ironing", "quality_check",
  "awaiting_packaging", "packaging", "ready", "delivered", "completed", "cancelled",
  "cutting", "sewing", "fitting", "adjustment",
] as const;

export type StudentEditPolicy = { enabled: boolean; until: string | null };

/** Group setting kept in `default_configuration.studentEdit`; open by default. */
export function studentEditPolicy(configuration: unknown): StudentEditPolicy {
  const config = configuration && typeof configuration === "object" ? configuration as Record<string, unknown> : {};
  const value = config.studentEdit && typeof config.studentEdit === "object" ? config.studentEdit as Record<string, unknown> : {};
  const until = typeof value.until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.until) ? value.until : null;
  return { enabled: value.enabled !== false, until };
}

/** Calendar day in Iraq (UTC+3), YYYY-MM-DD. */
export function iraqDay(now: Date) {
  return new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export type StudentEditLock =
  | { editable: true; until: string | null }
  | { editable: false; reason: string };

export function studentEditLock(
  order: { status?: unknown; productionStage?: unknown; archivedAt?: unknown },
  policy: StudentEditPolicy,
  now = new Date(),
): StudentEditLock {
  if (order.archivedAt || order.status === "cancelled")
    return { editable: false, reason: "هذا الطلب ملغى؛ تواصل مع ممثل المجموعة" };
  if ((STUDENT_EDIT_LOCKED_STAGES as readonly string[]).includes(String(order.productionStage ?? "")))
    return { editable: false, reason: "بدأ تجهيز طلبك، فلا يمكن تعديله من الرابط؛ تواصل مع ممثل المجموعة" };
  if (!policy.enabled)
    return { editable: false, reason: "التعديل مغلق لهذه المجموعة؛ تواصل مع ممثل المجموعة" };
  if (policy.until && iraqDay(now) > policy.until)
    return { editable: false, reason: `انتهت مهلة التعديل (${policy.until})؛ تواصل مع ممثل المجموعة` };
  return { editable: true, until: policy.until };
}

const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i);

export const studentEditInputSchema = z.object({
  customerName: z.string().trim().min(2, "اكتب الاسم الكامل").max(160).optional(),
  gender: z.enum(["male", "female"]).optional(),
  size: z.string().trim().max(20).optional(),
  measurements: z.record(z.string(), z.union([z.number(), z.string(), z.null()])).optional(),
  sashName: z.string().trim().max(120).optional(),
  font: z.enum(SASH_FONTS.map((font) => font.key) as [string, ...string[]]).optional(),
  sashColor: hexColor.optional(),
  embroideryColor: hexColor.optional(),
  references: z.array(z.object({
    placement: z.enum(STUDENT_REFERENCE_PLACEMENTS.map((item) => item.key) as [string, ...string[]]),
    note: z.string().trim().max(500).default(""),
    /** A new photo as a data URL; omitted keeps the saved photo. */
    imageData: z.string().max(4_000_000).optional(),
    fileName: z.string().trim().max(180).optional(),
    removeImage: z.boolean().optional(),
  })).max(STUDENT_REFERENCE_PLACEMENTS.length).optional(),
});
export type StudentEditInput = z.infer<typeof studentEditInputSchema>;

/**
 * Validated measurement values: "" or null clears a value, anything else must
 * be a number inside the registration form's range.
 */
export function studentEditMeasurements(
  current: Record<string, unknown>,
  incoming: Record<string, unknown> | undefined,
): { values: Record<string, unknown> } | { error: string } {
  const values: Record<string, unknown> = { ...current };
  for (const [key, label, min, max] of MEASUREMENTS) {
    if (!incoming || !(key in incoming)) continue;
    const raw = incoming[key];
    if (raw === null || raw === "") {
      delete values[key];
      continue;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < min || value > max)
      return { error: `${label.replace(/\s*\(.*\)$/, "")} يجب أن يكون بين ${min} و${max} سم` };
    values[key] = value;
  }
  return { values };
}

export const STUDENT_EDIT_FIELD_LABELS: Record<string, string> = {
  customerName: "الاسم",
  gender: "النوع",
  size: "المقاس",
  sashName: "الاسم على الوشاح",
  font: "خط الوشاح",
  sashColor: "لون الوشاح",
  embroideryColor: "لون التطريز",
  references: "الصور والملاحظات",
  ...Object.fromEntries(MEASUREMENTS.map(([key, label]) => [key, label.replace(/\s*\(.*\)$/, "")])),
};
