import type { HttpClient } from "@/infrastructure/http-client";
import {
  type DashboardCounts,
  type DepartmentId,
  KoshaCrewRowSchema,
  PhotographyEventRowSchema,
  type TaskBucket,
  type TaskSummary,
  TimelineEventSchema,
  type TimelineEvent,
} from "./entities";
import { STAGE_WORKFLOWS, type StageWorkflow } from "./status-engine";

/** Normalized task detail rendered by the shared detail screen. */
export interface TaskDetailField {
  label: string;
  value: string;
}
export interface TaskDetail {
  id: string;
  department: DepartmentId;
  title: string;
  stageKey: string;
  fields: TaskDetailField[];
  timeline: TimelineEvent[];
  phone: string | null;
  mapsQuery: string | null;
  raw: unknown;
}

export interface FetchTasksOptions {
  bucket?: TaskBucket | "all";
  search?: string;
}

/**
 * A department is a strategy over the shared task UI. Each one knows its own
 * endpoints, response shapes, and workflow; the presentation layer stays
 * department-agnostic. New departments plug in here.
 */
export interface DepartmentStrategy {
  id: DepartmentId;
  label: string;
  workflow: StageWorkflow;
  capabilities: { advanceStage: boolean };
  fetchDashboardCounts(http: HttpClient): Promise<DashboardCounts>;
  fetchTasks(http: HttpClient, options: FetchTasksOptions): Promise<TaskSummary[]>;
  fetchTaskDetail(http: HttpClient, id: string): Promise<TaskDetail>;
  advanceStage(
    http: HttpClient,
    id: string,
    toStage: string,
    note?: string,
  ): Promise<void>;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function tomorrowIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Derive a bucket from an event date when the server doesn't provide one. */
function deriveBucket(date: string | null | undefined, stageDone: boolean): TaskBucket {
  if (stageDone) return "completed";
  if (!date) return "upcoming";
  const day = date.slice(0, 10);
  const today = todayIso();
  if (day < today) return "late";
  if (day === today) return "today";
  if (day === tomorrowIso()) return "tomorrow";
  return "upcoming";
}

function asBucket(value: string | null | undefined): TaskBucket | null {
  const buckets = ["today", "tomorrow", "upcoming", "late", "completed"];
  return value && buckets.includes(value) ? (value as TaskBucket) : null;
}

// ── Koshat ──
const koshat: DepartmentStrategy = {
  id: "koshat",
  label: "الكوشات",
  workflow: STAGE_WORKFLOWS.koshat,
  capabilities: { advanceStage: true },

  async fetchDashboardCounts(http) {
    const data = await http.get<{ counts?: Partial<DashboardCounts> }>(
      "/staff/koshas/dashboard",
    );
    const counts = data.counts ?? {};
    return {
      today: counts.today ?? 0,
      tomorrow: counts.tomorrow ?? 0,
      upcoming: counts.upcoming ?? 0,
      late: counts.late ?? 0,
      completed: counts.completed ?? 0,
    };
  },

  async fetchTasks(http, options) {
    const rows = await http.get<unknown[]>("/staff/koshas/bookings", {
      bucket: options.bucket && options.bucket !== "all" ? options.bucket : undefined,
      search: options.search,
    });
    return (Array.isArray(rows) ? rows : []).map((raw) => {
      const row = KoshaCrewRowSchema.parse(raw);
      const location = row.hallLocation || row.cityArea || row.area || row.province || "";
      const subtitleParts = [row.eventType || "", location].filter(Boolean);
      return {
        id: String(row.id),
        department: "koshat" as const,
        title: row.customerName || `#${row.id}`,
        subtitle: subtitleParts.join(" · "),
        date: row.eventDate ?? null,
        time: row.eventTime ?? null,
        stageKey: row.executionStage,
        bucket: asBucket(row.bucket),
        phone: row.phone ?? null,
      } satisfies TaskSummary;
    });
  },

  async fetchTaskDetail(http, id) {
    const data = await http.get<any>(`/staff/koshas/bookings/${id}`);
    const booking = data?.booking ?? data ?? {};
    const events = Array.isArray(data?.events)
      ? data.events
      : Array.isArray(data?.timeline)
        ? data.timeline
        : [];
    const location =
      booking.hallLocation || booking.cityArea || booking.area || booking.province || "";
    const fields: TaskDetailField[] = [
      { label: "الزبون", value: booking.customerName ?? "—" },
      { label: "الهاتف", value: booking.phone ?? "—" },
      { label: "هاتف إضافي", value: booking.alternatePhone || booking.groomPhone || "—" },
      { label: "التاريخ", value: booking.eventDate ?? "—" },
      { label: "الوقت", value: booking.eventTime ?? "—" },
      { label: "نوع المناسبة", value: booking.eventType ?? "—" },
      { label: "القاعة / الموقع", value: location || "—" },
      { label: "أقرب نقطة", value: booking.nearestPoint || "—" },
    ];
    return {
      id: String(id),
      department: "koshat",
      title: booking.customerName || `#${id}`,
      stageKey: booking.executionStage ?? "preparing",
      fields,
      timeline: events.map((e: unknown) => TimelineEventSchema.parse(e)),
      phone: booking.phone ?? null,
      mapsQuery: [location, booking.nearestPoint].filter(Boolean).join("، ") || null,
      raw: data,
    };
  },

  async advanceStage(http, id, toStage, note) {
    await http.post(`/staff/koshas/bookings/${id}/stage`, { toStage, note });
  },
};

// ── Photography ──
// Read-first in this iteration: dashboard + events + detail are wired to the
// real endpoints; order-level stage transitions (PHOTOGRAPHY_ORDER_STAGES live
// under events/:ref/orders/:orderRef/stage) are a follow-up, so advanceStage is
// disabled via capabilities rather than calling an unverified contract.
const photography: DepartmentStrategy = {
  id: "photography",
  label: "التصوير",
  workflow: STAGE_WORKFLOWS.photography,
  capabilities: { advanceStage: false },

  async fetchDashboardCounts(http) {
    // The photography portal doesn't expose the same counts object, so derive
    // them from the events list for a consistent home screen.
    const rows = await http.get<unknown[]>("/staff/photography/events");
    const events = (Array.isArray(rows) ? rows : []).map((r) =>
      PhotographyEventRowSchema.parse(r),
    );
    const counts: DashboardCounts = { today: 0, tomorrow: 0, upcoming: 0, late: 0, completed: 0 };
    for (const event of events) {
      const done = event.status === "delivered" || event.status === "archived";
      counts[deriveBucket(event.eventDate, done)] += 1;
    }
    return counts;
  },

  async fetchTasks(http, options) {
    const rows = await http.get<unknown[]>("/staff/photography/events", {
      search: options.search,
    });
    const events = (Array.isArray(rows) ? rows : []).map((r) =>
      PhotographyEventRowSchema.parse(r),
    );
    return events
      .map((event) => {
        const done = event.status === "delivered" || event.status === "archived";
        const bucket = deriveBucket(event.eventDate, done);
        return {
          id: String(event.clientToken ?? event.id),
          department: "photography" as const,
          title: event.groomName || `#${event.id}`,
          subtitle: [event.eventName || "", event.location || ""].filter(Boolean).join(" · "),
          date: event.eventDate ?? null,
          time: null,
          stageKey: event.status,
          bucket,
          phone: null,
        } satisfies TaskSummary;
      })
      .filter((task) =>
        !options.bucket || options.bucket === "all" ? true : task.bucket === options.bucket,
      );
  },

  async fetchTaskDetail(http, id) {
    const data = await http.get<any>(`/staff/photography/events/${encodeURIComponent(id)}`);
    const event = data?.event ?? data ?? {};
    const fields: TaskDetailField[] = [
      { label: "العريس / الزبون", value: event.groomName ?? "—" },
      { label: "المناسبة", value: event.eventName || "—" },
      { label: "التاريخ", value: event.eventDate ?? "—" },
      { label: "الموقع", value: event.location || "—" },
      { label: "المصوّر", value: event.assignedStaffName || "—" },
    ];
    const timelineSource = Array.isArray(data?.timeline)
      ? data.timeline
      : Array.isArray(event?.timeline)
        ? event.timeline
        : [];
    return {
      id: String(id),
      department: "photography",
      title: event.groomName || `#${id}`,
      stageKey: event.status ?? "registered",
      fields,
      timeline: timelineSource.map((e: unknown) => TimelineEventSchema.parse(e)),
      phone: null,
      mapsQuery: event.location || null,
      raw: data,
    };
  },

  async advanceStage() {
    throw new Error("تغيير مرحلة التصوير غير مُفعّل بعد في التطبيق");
  },
};

export const DEPARTMENTS: Record<DepartmentId, DepartmentStrategy> = {
  koshat,
  photography,
};

export const DEPARTMENT_LIST: DepartmentStrategy[] = [koshat, photography];

export function getDepartment(id: DepartmentId): DepartmentStrategy {
  return DEPARTMENTS[id];
}
