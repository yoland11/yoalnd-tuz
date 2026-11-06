import { z } from "zod";
import { baghdadTime } from "./attendance-rules";

const recordId = z.number().int().positive().max(2_147_483_647);
const epochMs = z.number().int().positive().max(8_640_000_000_000_000);

export const geofenceConsentInput = z.object({ recordId, consent: z.boolean() }).strict();
export const geofenceUnavailableInput = z.object({ recordId }).strict();
export const geofenceSampleInput = z.object({
  recordId,
  observedAt: epochMs,
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracy: z.number().finite().positive().max(100_000),
}).strict();
export const geofenceExceptionInput = z.object({
  staffId: recordId,
  kind: z.enum(["temporary_exit", "delivery", "external_event"]),
  startsAt: epochMs,
  endsAt: epochMs,
  reason: z.string().trim().min(1).max(500),
}).strict();
export const geofenceReviewInput = z.object({
  approved: z.boolean(),
  note: z.string().trim().max(1000).optional(),
}).strict();

type RoleAccess = { role: string; permissions: readonly string[] };

export function attendanceGeofenceCapabilities({ role, permissions }: RoleAccess) {
  const manager = role === "admin" || role === "manager";
  const managesAttendance = permissions.includes("staff") || permissions.includes("attendance_manage");
  const reviewsAttendance = permissions.includes("attendance_approve");
  const viewsAttendance = managesAttendance || reviewsAttendance || permissions.includes("attendance_view") || permissions.includes("attendance_reports");
  const canViewGeofence = manager || (viewsAttendance && permissions.includes("attendance_location_view"));
  return {
    canViewGeofence,
    canManageGeofence: canViewGeofence && (manager || managesAttendance),
    canReviewGeofence: canViewGeofence && (manager || reviewsAttendance),
  };
}

export function isGeofencePushRecipient(person: { role: string; isActive: boolean }) {
  return person.isActive && (person.role === "admin" || person.role === "manager");
}

export function formatGeofenceExitAlert(name: string, atMs: number) {
  const [hours, minutes] = baghdadTime(atMs).split(":");
  const hour = Number(hours);
  const period = hour < 12 ? "صباحاً" : "مساءً";
  return `الموظف ${name} خرج من نطاق العمل الساعة ${hour % 12 || 12}:${minutes} ${period}`;
}
