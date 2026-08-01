import { eq } from "drizzle-orm";
import {
  db,
  graduationOrderItemsTable,
  graduationTemplatesTable,
  settingsTable,
} from "@workspace/db";
import {
  containsMeasurementRequirement,
  getGraduationMeasurementStatus,
  stageRequiresCompletedMeasurements,
} from "@/lib/graduation-measurements";

type GraduationOrderForMeasurementGate = {
  id: number;
  styleKey?: string | null;
  measurements?: unknown;
  garmentDetails?: unknown;
  templateSnapshot?: unknown;
  productionEstimate?: unknown;
};

export async function graduationOrderRequiresMeasurements(
  order: GraduationOrderForMeasurementGate,
) {
  const templateSnapshot =
    order.templateSnapshot &&
    typeof order.templateSnapshot === "object" &&
    !Array.isArray(order.templateSnapshot)
      ? (order.templateSnapshot as Record<string, unknown>)
      : {};
  if (
    containsMeasurementRequirement(order.garmentDetails) ||
    containsMeasurementRequirement(templateSnapshot) ||
    containsMeasurementRequirement(order.productionEstimate)
  )
    return true;

  // Once an order has an immutable template snapshot, absence of the flag in
  // that snapshot means "not required" for this historical order. A later
  // product edit must not retroactively change its production rules.
  if (Object.keys(templateSnapshot).length > 0) return false;

  const items = await db
    .select({
      itemType: graduationOrderItemsTable.itemType,
      snapshot: graduationOrderItemsTable.snapshot,
      templateType: graduationTemplatesTable.templateType,
      configuration: graduationTemplatesTable.configuration,
    })
    .from(graduationOrderItemsTable)
    .leftJoin(
      graduationTemplatesTable,
      eq(graduationOrderItemsTable.templateId, graduationTemplatesTable.id),
    )
    .where(eq(graduationOrderItemsTable.graduationOrderId, order.id));
  if (
    items.some(
      (item) =>
        (item.itemType === "robe" || item.templateType === "robe") &&
        (containsMeasurementRequirement(item.snapshot) ||
          containsMeasurementRequirement(item.configuration)),
    )
  )
    return true;

  const configRow = await db.query.settingsTable.findFirst({
    where: eq(settingsTable.key, "graduationConfig"),
    columns: { value: true },
  });
  const config =
    configRow?.value && typeof configRow.value === "object"
      ? (configRow.value as Record<string, unknown>)
      : {};
  const styles = Array.isArray(config.styles) ? config.styles : [];
  const selectedStyle = styles.find(
    (style) =>
      style &&
      typeof style === "object" &&
      String((style as Record<string, unknown>).key ?? "") === String(order.styleKey ?? ""),
  );
  return containsMeasurementRequirement(selectedStyle);
}

export async function getGraduationProductionMeasurementBlock(
  order: GraduationOrderForMeasurementGate,
  nextStage: unknown,
) {
  if (!stageRequiresCompletedMeasurements(nextStage)) return null;
  const requiresMeasurements = await graduationOrderRequiresMeasurements(order);
  if (!requiresMeasurements) return null;
  const measurementStatus = getGraduationMeasurementStatus(order.measurements);
  if (measurementStatus === "complete") return null;
  return { requiresMeasurements, measurementStatus };
}
