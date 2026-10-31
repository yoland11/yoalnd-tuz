import { boolean, date, integer, jsonb, numeric, pgTable, serial, text, time, timestamp, varchar } from "drizzle-orm/pg-core";
import { attendanceRecordsTable, warehousesTable } from "./admin-extensions";
import { staffTable } from "./staff";

/** Where people work: reused warehouses link through warehouseId instead of copying their record. */
export const attendanceLocationsTable = pgTable("attendance_locations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  kind: varchar("kind", { length: 20 }).notNull().default("office"),
  address: text("address"),
  latitude: numeric("latitude", { precision: 9, scale: 6 }),
  longitude: numeric("longitude", { precision: 9, scale: 6 }),
  radiusMeters: integer("radius_meters").notNull().default(100),
  maxAccuracyMeters: integer("max_accuracy_meters").notNull().default(100),
  requiredMethod: varchar("required_method", { length: 20 }).notNull().default("qr_gps"),
  warehouseId: integer("warehouse_id").references(() => warehousesTable.id, { onDelete: "set null" }),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: integer("created_by").references(() => staffTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** Per-employee rules. A null schedule field falls back to salary settings, then the company policy. */
export const attendanceEmployeeSettingsTable = pgTable("attendance_employee_settings", {
  staffId: integer("staff_id").primaryKey().references(() => staffTable.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  primaryLocationId: integer("primary_location_id").references(() => attendanceLocationsTable.id, { onDelete: "set null" }),
  requiredMethod: varchar("required_method", { length: 20 }).notNull().default("qr_gps"),
  eventMethod: varchar("event_method", { length: 20 }),
  allowedMethods: jsonb("allowed_methods").$type<string[]>().notNull().default(["qr", "gps", "qr_gps"]),
  scheduleType: varchar("schedule_type", { length: 20 }).notNull().default("fixed"),
  shiftStart: time("shift_start"),
  shiftEnd: time("shift_end"),
  weeklyDaysOff: jsonb("weekly_days_off").$type<string[]>(),
  graceMinutes: integer("grace_minutes"),
  overtimeEligible: boolean("overtime_eligible"),
  payrollIntegration: boolean("payroll_integration"),
  eventAttendance: boolean("event_attendance").notNull().default(true),
  updatedBy: integer("updated_by").references(() => staffTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const attendanceShiftsTable = pgTable("attendance_shifts", {
  id: serial("id").primaryKey(),
  staffId: integer("staff_id").notNull().references(() => staffTable.id, { onDelete: "restrict" }),
  shiftDate: date("shift_date").notNull(),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true }).notNull(),
  kind: varchar("kind", { length: 20 }).notNull().default("fixed"),
  locationId: integer("location_id").references(() => attendanceLocationsTable.id, { onDelete: "set null" }),
  requiredMethod: varchar("required_method", { length: 20 }),
  graceMinutes: integer("grace_minutes"),
  title: text("title"),
  bookingSource: varchar("booking_source", { length: 10 }),
  bookingId: integer("booking_id"),
  payAmount: numeric("pay_amount", { precision: 16, scale: 2 }),
  status: varchar("status", { length: 20 }).notNull().default("scheduled"),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => staffTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const attendanceKiosksTable = pgTable("attendance_kiosks", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  locationId: integer("location_id").notNull().references(() => attendanceLocationsTable.id, { onDelete: "restrict" }),
  deviceTokenHash: varchar("device_token_hash", { length: 64 }).notNull(),
  qrSecret: varchar("qr_secret", { length: 128 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  lastSeenAt: timestamp("last_seen_at"),
  createdBy: integer("created_by").references(() => staffTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  revokedAt: timestamp("revoked_at"),
});

export const attendanceQrUsesTable = pgTable("attendance_qr_uses", {
  id: serial("id").primaryKey(),
  kioskId: integer("kiosk_id").notNull().references(() => attendanceKiosksTable.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  staffId: integer("staff_id").notNull().references(() => staffTable.id, { onDelete: "cascade" }),
  event: varchar("event", { length: 10 }).notNull(),
  usedAt: timestamp("used_at").notNull().defaultNow(),
});

/** Evidence for one accepted event. Coordinates exist only at the moment of check-in or check-out. */
export const attendanceVerificationsTable = pgTable("attendance_verifications", {
  id: serial("id").primaryKey(),
  recordId: integer("record_id").notNull().references(() => attendanceRecordsTable.id, { onDelete: "cascade" }),
  staffId: integer("staff_id").notNull().references(() => staffTable.id, { onDelete: "cascade" }),
  event: varchar("event", { length: 10 }).notNull(),
  method: varchar("method", { length: 20 }).notNull(),
  locationId: integer("location_id").references(() => attendanceLocationsTable.id, { onDelete: "set null" }),
  kioskId: integer("kiosk_id").references(() => attendanceKiosksTable.id, { onDelete: "set null" }),
  latitude: numeric("latitude", { precision: 9, scale: 6 }),
  longitude: numeric("longitude", { precision: 9, scale: 6 }),
  accuracyMeters: numeric("accuracy_meters", { precision: 8, scale: 2 }),
  distanceMeters: numeric("distance_meters", { precision: 10, scale: 2 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const attendanceCorrectionsTable = pgTable("attendance_corrections", {
  id: serial("id").primaryKey(),
  staffId: integer("staff_id").notNull().references(() => staffTable.id, { onDelete: "restrict" }),
  workDate: date("work_date").notNull(),
  requestType: varchar("request_type", { length: 30 }).notNull(),
  requestedCheckIn: timestamp("requested_check_in", { withTimezone: true }),
  requestedCheckOut: timestamp("requested_check_out", { withTimezone: true }),
  recordId: integer("record_id").references(() => attendanceRecordsTable.id, { onDelete: "set null" }),
  reason: text("reason").notNull(),
  attachment: text("attachment"),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  reviewedBy: integer("reviewed_by").references(() => staffTable.id, { onDelete: "set null" }),
  reviewedByName: text("reviewed_by_name").notNull().default(""),
  reviewedAt: timestamp("reviewed_at"),
  reviewNote: text("review_note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
