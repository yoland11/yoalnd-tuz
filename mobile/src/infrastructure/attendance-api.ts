import type { AttendanceMethod, GpsEvidence } from "@/domain/attendance-evidence";
import { http } from "@/application/container";

type AttendanceShift = {
  shiftId: number | null;
  startMs: number;
  endMs: number;
  kind: string;
  title: string | null;
  locationName: string | null;
  method: AttendanceMethod;
  allowedMethods: string[];
};

export type AttendanceToday = {
  enabled: boolean;
  employeeName: string;
  date: string;
  statusLabel: string;
  current: AttendanceShift | null;
  open: { id: number; startMs: number } | null;
  canCheckIn: boolean;
  canCheckOut: boolean;
};

export type AttendanceAction = "check_in" | "check_out";

type AttendancePunch = {
  action: AttendanceAction;
  shiftId?: number;
  qrCode?: string;
  gps?: GpsEvidence;
};

export type GeofenceState = {
  recordId: number | null;
  eligible: boolean;
  consented: boolean;
  status: "inside" | "outside" | "returned" | "checked_out" | "unavailable" | "exempt" | "inactive";
  workplace: string | null;
  startsAt: number | null;
  endsAt: number | null;
};

export const attendanceKeys = {
  today: ["staff", "attendance", "today"] as const,
  geofence: ["staff", "attendance", "geofence"] as const,
  locationControl: (staffId: number | undefined) => ["staff", "attendance", "location-device", staffId] as const,
};

export const GEOFENCE_PATH = "/admin/attendance/geofence";

export const attendanceApi = {
  today: () => http.get<AttendanceToday>("/admin/attendance/me"),
  punch: (input: AttendancePunch) => http.post<{
    action: AttendanceAction;
    atMs: number;
    locationName: string | null;
    today: AttendanceToday;
  }>("/admin/attendance/punch", input),
  geofence: () => http.get<GeofenceState>(GEOFENCE_PATH),
  consent: (recordId: number, consent: boolean, signal?: AbortSignal) => http.post<GeofenceState>(GEOFENCE_PATH + "/consent", { recordId, consent }, signal),
};
