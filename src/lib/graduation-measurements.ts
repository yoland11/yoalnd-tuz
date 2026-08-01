export const GRADUATION_CORE_MEASUREMENT_KEYS = [
  "height",
  "shoulder",
  "chest",
  "waist",
  "sleeveLength",
] as const;

export type GraduationMeasurementStatus =
  | "not_started"
  | "partial"
  | "complete";

export type GraduationMeasurementFilter = "none" | "partial" | "complete";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function hasValue(value: unknown) {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  return String(value).trim().length > 0;
}

/**
 * Returns the operational state of the optional graduation measurements.
 * Gender is deliberately excluded: its default value must not turn an empty
 * measurement form into a partially-completed one.
 */
export function getGraduationMeasurementStatus(
  value: unknown,
): GraduationMeasurementStatus {
  const measurements = record(value);
  if (["complete", "needs_review", "approved"].includes(String(measurements.status ?? "")))
    return "complete";
  if (
    measurements.method === "ready" &&
    hasValue(measurements.readySize ?? measurements.standardSize)
  )
    return "complete";

  const filled = GRADUATION_CORE_MEASUREMENT_KEYS.filter((key) =>
    hasValue(measurements[key]),
  ).length;
  if (filled === 0) return "not_started";
  if (filled === GRADUATION_CORE_MEASUREMENT_KEYS.length) return "complete";
  return "partial";
}

export function getGraduationMeasurementFilter(value: unknown): GraduationMeasurementFilter {
  const status = getGraduationMeasurementStatus(value);
  return status === "not_started" ? "none" : status;
}

export function graduationMeasurementLabel(value: unknown) {
  const status = getGraduationMeasurementStatus(value);
  if (status === "complete") return "القياسات مكتملة";
  if (status === "partial") return "قياسات جزئية";
  return "القياسات غير مدخلة";
}

export function withGraduationMeasurementStatus(value: unknown) {
  const measurements = record(value);
  return {
    ...measurements,
    status: getGraduationMeasurementStatus(measurements),
  };
}

const PRODUCTION_MEASUREMENT_GATE_STAGES = new Set([
  "fabric_cutting",
  "tailoring",
  "printing",
  "embroidery",
  "ironing",
  "quality_check",
  "awaiting_packaging",
  "packaging",
  "ready",
  "delivered",
  "completed",
  "cutting",
  "sewing",
  "fitting",
  "adjustment",
]);

export function stageRequiresCompletedMeasurements(stage: unknown) {
  return PRODUCTION_MEASUREMENT_GATE_STAGES.has(String(stage ?? ""));
}

const REQUIREMENT_KEYS = new Set([
  "requiresMeasurements",
  "requires_measurements",
  "measurementRequired",
  "measurementsRequired",
]);

/** Reads the flag from legacy and enterprise configuration snapshots. */
export function containsMeasurementRequirement(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsMeasurementRequirement);
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (REQUIREMENT_KEYS.has(key) && (nested === true || nested === 1 || nested === "true" || nested === "yes"))
      return true;
    if (nested && typeof nested === "object" && containsMeasurementRequirement(nested))
      return true;
  }
  return false;
}
