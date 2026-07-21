import {
  MEMORY_CARD_STATUSES,
  PHOTOGRAPHY_EDIT_STATUSES,
  PHOTOGRAPHY_MEDIA_KINDS,
  type MemoryCardStatus,
  type PhotographyEditStatus,
  type PhotographyMediaKind,
} from "@workspace/db";
import type { PhotographyShootStage } from "@workspace/db";

/**
 * Post-production rules: the edit-room pipeline, the memory-card lifecycle and the
 * metadata-only media ledger. No database access — callers own persistence, which keeps
 * every rule here directly testable.
 */

export const EDIT_STATUS_LABELS: Record<PhotographyEditStatus, string> = {
  waiting: "بالانتظار",
  copying_files: "نسخ الملفات",
  editing: "قيد المونتاج",
  color_correction: "تصحيح الألوان",
  exporting: "التصدير",
  quality_check: "فحص الجودة",
  ready: "جاهز",
  delivered: "تم التسليم",
};

export const CARD_STATUS_LABELS: Record<MemoryCardStatus, string> = {
  available: "متاحة",
  assigned: "مع المصور",
  full: "ممتلئة",
  copying: "قيد النسخ",
  delivered: "سُلّمت للمونتاج",
  returned: "أُرجعت",
  damaged: "تالفة",
};

export const MEDIA_KIND_LABELS: Record<PhotographyMediaKind, string> = {
  raw: "صور RAW",
  edited: "صور معدّلة",
  video: "فيديو",
  drone: "لقطات درون",
  preview: "معاينات",
};

export function isEditStatus(value: unknown): value is PhotographyEditStatus {
  return typeof value === "string" && (PHOTOGRAPHY_EDIT_STATUSES as readonly string[]).includes(value);
}

export function isCardStatus(value: unknown): value is MemoryCardStatus {
  return typeof value === "string" && (MEMORY_CARD_STATUSES as readonly string[]).includes(value);
}

export function isMediaKind(value: unknown): value is PhotographyMediaKind {
  return typeof value === "string" && (PHOTOGRAPHY_MEDIA_KINDS as readonly string[]).includes(value);
}

export function editStatusIndex(status: string): number {
  const index = (PHOTOGRAPHY_EDIT_STATUSES as readonly string[]).indexOf(status);
  return index < 0 ? 0 : index;
}

export type PostRefusal = { ok: false; reason: string; status: number };
export type EditApproval = { ok: true; backward: boolean };

/**
 * Edit-room transitions run strictly in order, one step at a time.
 *
 * Two rules that are not obvious:
 *  - leaving `waiting` requires an assigned editor, otherwise work is untracked;
 *  - `quality_check → ready` is the sign-off and is reserved for managers, so an editor
 *    cannot pass their own QC.
 */
export function evaluateEditTransition(input: {
  from: string;
  to: string;
  hasEditor: boolean;
  isManager: boolean;
}): EditApproval | PostRefusal {
  const { from, to, hasEditor, isManager } = input;
  if (!isEditStatus(to)) return { ok: false, reason: "حالة مونتاج غير معروفة", status: 400 };
  if (from === to) return { ok: false, reason: "المشروع في هذه الحالة بالفعل", status: 409 };

  const fromIndex = editStatusIndex(from);
  const toIndex = editStatusIndex(to);

  if (toIndex < fromIndex) {
    if (!isManager) return { ok: false, reason: "إرجاع المشروع لحالة سابقة يحتاج صلاحية مدير", status: 403 };
    return { ok: true, backward: true };
  }

  if (toIndex !== fromIndex + 1) {
    return {
      ok: false,
      reason: `لا يمكن الانتقال من «${EDIT_STATUS_LABELS[from as PhotographyEditStatus] ?? from}» إلى «${EDIT_STATUS_LABELS[to]}» مباشرة`,
      status: 409,
    };
  }

  if (from === "waiting" && !hasEditor) {
    return { ok: false, reason: "عيّن مونتيراً قبل بدء العمل على المشروع", status: 422 };
  }

  if (to === "ready" && !isManager) {
    return { ok: false, reason: "اعتماد فحص الجودة يحتاج صلاحية مدير", status: 403 };
  }

  return { ok: true, backward: false };
}

/** Milestones an edit transition stamps when it lands. */
export function editTimestamps(to: PhotographyEditStatus, now: Date): Record<string, Date> {
  switch (to) {
    case "copying_files":
      return { startedAt: now };
    case "ready":
      return { readyAt: now };
    case "delivered":
      return { deliveredAt: now };
    default:
      return {};
  }
}

/**
 * The shoot stage an edit status implies, or null to leave the shoot alone.
 * This is what makes the shoot timeline update itself as the edit room progresses.
 */
export function shootStageForEditStatus(status: PhotographyEditStatus): PhotographyShootStage | null {
  if (status === "ready") return "ready_for_review";
  if (status === "delivered") return "delivered";
  return null;
}

/**
 * Memory-card lifecycle. `available → assigned → full → copying → delivered → returned`,
 * with `damaged` reachable from anywhere and terminal until a manager resets the card.
 */
const CARD_FORWARD: Record<MemoryCardStatus, MemoryCardStatus[]> = {
  available: ["assigned", "damaged"],
  assigned: ["full", "copying", "returned", "damaged"],
  full: ["copying", "damaged"],
  copying: ["delivered", "damaged"],
  delivered: ["returned", "damaged"],
  returned: ["available", "assigned", "damaged"],
  damaged: [],
};

export function evaluateCardTransition(input: {
  from: string;
  to: string;
  isManager: boolean;
}): { ok: true } | PostRefusal {
  const { from, to, isManager } = input;
  if (!isCardStatus(to)) return { ok: false, reason: "حالة بطاقة غير معروفة", status: 400 };
  if (!isCardStatus(from)) return { ok: false, reason: "حالة البطاقة الحالية غير صالحة", status: 409 };
  if (from === to) return { ok: false, reason: "البطاقة في هذه الحالة بالفعل", status: 409 };

  // Writing off damage is a manager call, and so is bringing a damaged card back.
  if (from === "damaged") {
    if (!isManager) return { ok: false, reason: "إعادة تفعيل بطاقة تالفة تحتاج صلاحية مدير", status: 403 };
    return { ok: true };
  }

  if (!CARD_FORWARD[from].includes(to)) {
    return {
      ok: false,
      reason: `لا يمكن نقل البطاقة من «${CARD_STATUS_LABELS[from]}» إلى «${CARD_STATUS_LABELS[to]}»`,
      status: 409,
    };
  }
  return { ok: true };
}

export function cardTimestamps(to: MemoryCardStatus, now: Date): Record<string, Date> {
  switch (to) {
    case "copying":
      return { copiedAt: now };
    case "delivered":
      return { deliveredAt: now };
    case "returned":
      return { returnedAt: now };
    default:
      return {};
  }
}

/** Human-readable size. Bytes are stored exactly; only the display is rounded. */
export function formatBytes(bytes: number): string {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  const scaled = value / 1024 ** exponent;
  return `${scaled.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

/** Clamps a client-supplied count/size to a sane non-negative integer. */
export function parseCount(value: unknown, max = 1_000_000): number {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(parsed, max);
}

export function parseBytes(value: unknown): number {
  const parsed = Math.floor(Number(value));
  // Postgres bigint tops out well above any real batch; cap at 1 PB to reject junk.
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(parsed, 1_125_899_906_842_624);
}

export type MediaTotals = {
  byKind: Record<PhotographyMediaKind, { files: number; bytes: number }>;
  files: number;
  bytes: number;
};

/** Aggregates a shoot's media batches into per-kind and overall totals. */
export function summarizeMedia(
  batches: Array<{ kind: string; fileCount: number; totalBytes: number }>,
): MediaTotals {
  const byKind = Object.fromEntries(
    PHOTOGRAPHY_MEDIA_KINDS.map((kind) => [kind, { files: 0, bytes: 0 }]),
  ) as MediaTotals["byKind"];
  let files = 0;
  let bytes = 0;
  for (const batch of batches) {
    if (!isMediaKind(batch.kind)) continue;
    const count = parseCount(batch.fileCount);
    const size = parseBytes(batch.totalBytes);
    byKind[batch.kind].files += count;
    byKind[batch.kind].bytes += size;
    files += count;
    bytes += size;
  }
  return { byKind, files, bytes };
}

/**
 * Turnaround in hours between two milestones, or null when either is missing.
 * Negative spans (clock skew, manual back-dating) collapse to 0 rather than
 * poisoning the averages in reports.
 */
export function turnaroundHours(from: Date | string | null, to: Date | string | null): number | null {
  if (!from || !to) return null;
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.round(((end - start) / 3_600_000) * 10) / 10);
}

/** Mean of the defined values only; null when nothing qualifies. */
export function averageOf(values: Array<number | null>): number | null {
  const defined = values.filter((value): value is number => value !== null);
  if (!defined.length) return null;
  return Math.round((defined.reduce((sum, value) => sum + value, 0) / defined.length) * 10) / 10;
}
