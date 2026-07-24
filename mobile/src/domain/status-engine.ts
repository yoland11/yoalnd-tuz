/**
 * Task Status Engine — configurable per department.
 *
 * The Koshat workflow mirrors the server's `KOSHA_EXECUTION_STAGES`
 * (lib/db/src/schema/kosha-staff.ts) exactly, in the same order, so the mobile
 * stepper and the web/admin timeline never diverge. Photography mirrors the
 * order lifecycle (`PHOTOGRAPHY_ORDER_STAGES`). Adding a department = adding a
 * `StageWorkflow`; no UI changes required.
 */

/** Visual phase → drives the accent color of a stage chip/step. */
export type StagePhase =
  | "idle"
  | "prep"
  | "transit"
  | "active"
  | "done"
  | "problem";

export interface StageDef {
  key: string;
  label: string;
  phase: StagePhase;
}

export interface StageWorkflow {
  /** Ordered stages shown in the stepper. */
  stages: StageDef[];
  /** Terminal stage that must go through a dedicated flow (blocked in-app). */
  terminalKey?: string;
}

const KOSHA_STAGES: StageDef[] = [
  { key: "booked", label: "محجوزة", phase: "idle" },
  { key: "preparing", label: "قيد التجهيز", phase: "prep" },
  { key: "ready", label: "جاهزة", phase: "prep" },
  { key: "out_of_warehouse", label: "جاري التحميل", phase: "transit" },
  { key: "on_the_way", label: "في الطريق", phase: "transit" },
  { key: "executing", label: "جاري التنصيب", phase: "active" },
  { key: "executed", label: "تم التنصيب", phase: "active" },
  { key: "event_running", label: "المناسبة جارية", phase: "active" },
  { key: "dismantling", label: "جاري الفك", phase: "transit" },
  { key: "returned", label: "تم الإرجاع", phase: "done" },
  { key: "delivered", label: "مكتمل", phase: "done" },
];

const PHOTOGRAPHY_STAGES: StageDef[] = [
  { key: "registered", label: "مُسجّل", phase: "idle" },
  { key: "editing", label: "قيد التعديل", phase: "active" },
  { key: "ready_print", label: "جاهز للطباعة", phase: "prep" },
  { key: "ready_pickup", label: "جاهز للاستلام", phase: "done" },
  { key: "delivered", label: "تم التسليم", phase: "done" },
];

export const STAGE_WORKFLOWS = {
  koshat: { stages: KOSHA_STAGES, terminalKey: "delivered" },
  photography: { stages: PHOTOGRAPHY_STAGES, terminalKey: "delivered" },
} satisfies Record<string, StageWorkflow>;

export function stageIndex(workflow: StageWorkflow, key: string): number {
  return workflow.stages.findIndex((stage) => stage.key === key);
}

export function stageDef(workflow: StageWorkflow, key: string): StageDef | null {
  return workflow.stages.find((stage) => stage.key === key) ?? null;
}

/**
 * The next stage the crew can advance to, or null at/after the last
 * non-terminal stage. Advancing is strictly forward and one step at a time —
 * the same rule the Kosha portal enforces server-side.
 */
export function nextStage(workflow: StageWorkflow, current: string): StageDef | null {
  const index = stageIndex(workflow, current);
  if (index < 0) return workflow.stages[0] ?? null;
  const candidate = workflow.stages[index + 1];
  if (!candidate) return null;
  if (candidate.key === workflow.terminalKey) return null; // dedicated flow
  return candidate;
}

export function stageLabel(workflow: StageWorkflow, key: string): string {
  return stageDef(workflow, key)?.label ?? key;
}
