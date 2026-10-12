/**
 * Photography Production Center — pure rules shared by the server and the UI.
 *
 * A production order creates one work item per requested deliverable of a
 * photography booking. Each item has its own status, owner and deadline.
 * Production progress is operational only: it never closes the booking and
 * never touches invoices, payments, Cash Box, inventory or salaries.
 */

export const PRODUCTION_KINDS = ["video", "photos", "album", "printing"] as const;
export type ProductionKind = (typeof PRODUCTION_KINDS)[number];

export const PRODUCTION_STATUSES = ["remaining", "in_progress", "waiting_files", "completed"] as const;
export type ProductionStatus = (typeof PRODUCTION_STATUSES)[number];

export const PRODUCTION_KIND_LABELS: Record<ProductionKind, string> = {
  video: "فيديو",
  photos: "صور",
  album: "ألبوم",
  printing: "طباعة",
};

export const PRODUCTION_STATUS_LABELS: Record<ProductionStatus, string> = {
  remaining: "متبقي",
  in_progress: "قيد العمل",
  waiting_files: "بانتظار الملفات",
  completed: "مكتمل",
};

export const OVERDUE_LABEL = "متأخر";

/** Center tabs. Albums and printing share a tab but stay independent items. */
export const PRODUCTION_TABS = [
  { key: "all", label: "الكل", kinds: [...PRODUCTION_KINDS] },
  { key: "video", label: "الفيديوهات", kinds: ["video"] },
  { key: "photos", label: "الصور", kinds: ["photos"] },
  { key: "album", label: "الألبومات والطباعة", kinds: ["album", "printing"] },
] as const satisfies ReadonlyArray<{ key: string; label: string; kinds: readonly ProductionKind[] }>;
export type ProductionTab = (typeof PRODUCTION_TABS)[number]["key"];

export function isProductionKind(value: unknown): value is ProductionKind {
  return PRODUCTION_KINDS.includes(value as ProductionKind);
}

export function isProductionStatus(value: unknown): value is ProductionStatus {
  return PRODUCTION_STATUSES.includes(value as ProductionStatus);
}

export function tabKinds(tab: unknown): ProductionKind[] {
  return [...(PRODUCTION_TABS.find((entry) => entry.key === tab) ?? PRODUCTION_TABS[0]).kinds];
}

/** Unique, valid kinds in canonical order; unknown values are dropped. */
export function normalizeKinds(input: unknown): ProductionKind[] {
  const values = new Set(Array.isArray(input) ? input.map(String) : []);
  return PRODUCTION_KINDS.filter((kind) => values.has(kind));
}

/**
 * Allowed status moves. Completed work is never silently overwritten: leaving
 * "completed" is a reopen that needs a manager and a written reason.
 */
const TRANSITIONS: Record<ProductionStatus, readonly ProductionStatus[]> = {
  remaining: ["in_progress", "waiting_files", "completed"],
  waiting_files: ["remaining", "in_progress"],
  in_progress: ["remaining", "waiting_files", "completed"],
  completed: ["in_progress"],
};

export function allowedTransitions(from: ProductionStatus): readonly ProductionStatus[] {
  return TRANSITIONS[from] ?? [];
}

export type TransitionDecision = { ok: true; reopen: boolean } | { ok: false; status: number; reason: string };

export function evaluateProductionTransition(input: {
  from: string;
  to: unknown;
  canManage: boolean;
  isAssignee: boolean;
  reason?: string | null;
}): TransitionDecision {
  if (!isProductionStatus(input.to)) return { ok: false, status: 422, reason: "حالة العمل غير صحيحة" };
  if (!isProductionStatus(input.from)) return { ok: false, status: 409, reason: "حالة العمل الحالية غير معروفة" };
  if (!input.canManage && !input.isAssignee)
    return { ok: false, status: 403, reason: "لا يمكنك تغيير حالة عمل غير مسند إليك" };
  if (input.from === input.to) return { ok: false, status: 409, reason: "العمل بهذه الحالة مسبقاً" };
  if (!allowedTransitions(input.from).includes(input.to))
    return {
      ok: false,
      status: 422,
      reason: `لا يمكن نقل العمل من «${PRODUCTION_STATUS_LABELS[input.from]}» إلى «${PRODUCTION_STATUS_LABELS[input.to]}»`,
    };
  const reopen = input.from === "completed";
  if (reopen && !input.canManage) return { ok: false, status: 403, reason: "إعادة فتح عمل مكتمل تتطلب صلاحية مدير" };
  if (reopen && !String(input.reason ?? "").trim()) return { ok: false, status: 422, reason: "اكتب سبب إعادة فتح العمل المكتمل" };
  return { ok: true, reopen };
}

/** Milestone timestamps to write for a status move (null clears a stale completion). */
export function transitionTimestamps(
  to: ProductionStatus,
  now: Date,
  current: { startedAt?: Date | string | null },
): { startedAt?: Date; completedAt: Date | null } {
  return {
    ...(to !== "remaining" && to !== "waiting_files" && !current.startedAt ? { startedAt: now } : {}),
    completedAt: to === "completed" ? now : null,
  };
}

/** Today's calendar date in Iraq (YYYY-MM-DD), the business day for deadlines. */
export function baghdadToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Baghdad",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** A real calendar date or null; undefined means "not provided". */
export function parseDueDate(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text ? undefined : text;
}

export function isOverdue(item: { status: string; dueDate?: string | null }, today: string): boolean {
  return item.status !== "completed" && Boolean(item.dueDate) && String(item.dueDate).slice(0, 10) < today;
}

/** Status shown to people: "overdue" is derived, never stored. */
export function displayStatus(item: { status: string; dueDate?: string | null }, today: string): ProductionStatus | "overdue" {
  if (isOverdue(item, today)) return "overdue";
  return isProductionStatus(item.status) ? item.status : "remaining";
}

export type ProductionProgress = {
  required: number;
  completed: number;
  percent: number;
  complete: boolean;
  remainingKinds: ProductionKind[];
  label: string;
};

/** Booking progress counts only the deliverables that were actually requested. */
export function bookingProgress(items: ReadonlyArray<{ kind: string; status: string }>): ProductionProgress {
  const required = items.filter((item) => isProductionKind(item.kind));
  const completed = required.filter((item) => item.status === "completed").length;
  const complete = required.length > 0 && completed === required.length;
  return {
    required: required.length,
    completed,
    percent: required.length ? Math.round((completed / required.length) * 100) : 0,
    complete,
    remainingKinds: PRODUCTION_KINDS.filter((kind) =>
      required.some((item) => item.kind === kind && item.status !== "completed"),
    ),
    label: !required.length ? "لا يوجد أمر إنتاج" : complete ? "الإنتاج مكتمل" : "الإنتاج غير مكتمل",
  };
}

/**
 * Deliverables suggested by what was already booked (pre-ticks the order
 * dialog only — the person sending to production makes the final choice).
 */
export function suggestedKinds(fields: Record<string, unknown> | null | undefined): ProductionKind[] {
  const data = fields ?? {};
  const kinds = new Set((Array.isArray(data.photographyKinds) ? data.photographyKinds : []).map(String));
  const serviceKind = String(data.photographyServiceKind ?? "");
  if (serviceKind === "both") ["video", "photo_session"].forEach((kind) => kinds.add(kind));
  else if (serviceKind) kinds.add(serviceKind);
  const delivery = String(data.photoSessionDelivery ?? data.photographyDelivery ?? "");
  return PRODUCTION_KINDS.filter((kind) =>
    kind === "video"
      ? kinds.has("video")
      : kind === "photos"
        ? kinds.has("photo_session")
        : kind === "album"
          ? kinds.has("photo_session") && delivery === "album"
          : false,
  );
}
