import type { TaskBucket } from "@/domain/entities";
import type { StagePhase } from "@/domain/status-engine";

/**
 * Shared color tokens (kept in sync with tailwind.config.js) for cases where we
 * need a raw color value in JS rather than a class — stage accents, status bars,
 * chart-style bits. NativeWind classes remain the primary styling path.
 */
export const colors = {
  brand: "#0f766e",
  brandDark: "#134e4a",
  stage: {
    idle: "#64748b",
    prep: "#0ea5e9",
    transit: "#f59e0b",
    active: "#8b5cf6",
    done: "#16a34a",
    problem: "#dc2626",
  } satisfies Record<StagePhase, string>,
};

export function stagePhaseColor(phase: StagePhase): string {
  return colors.stage[phase];
}

/** Bucket → Arabic label + accent, used by the home widgets and list filter. */
export const BUCKET_META: Record<
  TaskBucket,
  { label: string; phase: StagePhase }
> = {
  today: { label: "اليوم", phase: "active" },
  tomorrow: { label: "غداً", phase: "prep" },
  upcoming: { label: "قادمة", phase: "idle" },
  late: { label: "متأخرة", phase: "problem" },
  completed: { label: "مكتملة", phase: "done" },
};
