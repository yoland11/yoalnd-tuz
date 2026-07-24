import { z } from "zod";

/**
 * Domain entities + resilient parsers for the AJN staff-portal payloads.
 *
 * The server returns large, evolving objects (see `formatKoshaBookingForCrew`
 * and `formatPhotographyEvents` in src/server/api.ts). We validate only the
 * fields the app actually uses and `.passthrough()` the rest, so a backend
 * addition never crashes the client.
 */

export type DepartmentId = "koshat" | "photography";

/** Home dashboard buckets — mirror the server's CrewBucket. */
export const TASK_BUCKETS = [
  "today",
  "tomorrow",
  "upcoming",
  "late",
  "completed",
] as const;
export type TaskBucket = (typeof TASK_BUCKETS)[number];

/** Normalized task row rendered by the shared list/card UI. */
export interface TaskSummary {
  id: string;
  department: DepartmentId;
  title: string;
  subtitle: string;
  date: string | null;
  time: string | null;
  stageKey: string;
  bucket: TaskBucket | null;
  phone: string | null;
}

/** Normalized dashboard counts. */
export interface DashboardCounts {
  today: number;
  tomorrow: number;
  upcoming: number;
  late: number;
  completed: number;
}

// ── Auth ──
export const AuthUserSchema = z
  .object({
    id: z.number(),
    username: z.string(),
    fullName: z.string().default(""),
    role: z.string().default("employee"),
    permissions: z.array(z.string()).default([]),
    isActive: z.boolean().default(true),
  })
  .passthrough();
export type AuthUser = z.infer<typeof AuthUserSchema>;

export const LoginResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.string().optional(),
  user: AuthUserSchema,
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

// ── Kosha crew row (list item) ──
export const KoshaCrewRowSchema = z
  .object({
    id: z.number(),
    source: z.string().optional(),
    customerName: z.string().default(""),
    phone: z.string().nullish(),
    eventDate: z.string().nullish(),
    eventTime: z.string().nullish(),
    eventType: z.string().nullish(),
    hallLocation: z.string().nullish(),
    cityArea: z.string().nullish(),
    province: z.string().nullish(),
    area: z.string().nullish(),
    executionStage: z.string().default("preparing"),
    bucket: z.string().nullish(),
  })
  .passthrough();
export type KoshaCrewRow = z.infer<typeof KoshaCrewRowSchema>;

// ── Photography event (list item) ──
export const PhotographyEventRowSchema = z
  .object({
    id: z.number(),
    clientToken: z.string().nullish(),
    groomName: z.string().default(""),
    eventName: z.string().nullish(),
    eventDate: z.string().nullish(),
    location: z.string().nullish(),
    status: z.string().default("registered"),
  })
  .passthrough();
export type PhotographyEventRow = z.infer<typeof PhotographyEventRowSchema>;

/** A timeline entry, common shape used by both portals' detail responses. */
export const TimelineEventSchema = z
  .object({
    id: z.union([z.number(), z.string()]).optional(),
    type: z.string().optional(),
    fromStage: z.string().nullish(),
    toStage: z.string().nullish(),
    staffName: z.string().nullish(),
    note: z.string().nullish(),
    createdAt: z.string().nullish(),
  })
  .passthrough();
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;
