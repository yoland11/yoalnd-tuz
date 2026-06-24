import { boolean, integer, jsonb, numeric, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { koshaBookingsTable } from "./koshas";
import { staffTable } from "./staff";

/**
 * Kosha Staff Portal — field-crew execution layer.
 * All tables are additive; they extend kosha_bookings without altering existing flows.
 */

// Ordered execution stages handled by the field crew (separate from booking `status`).
export const KOSHA_EXECUTION_STAGES = [
  "preparing",        // قيد التجهيز
  "out_of_warehouse", // خرجت من المخزن
  "on_the_way",       // في الطريق
  "executing",        // قيد التنفيذ
  "executed",         // تم التنفيذ
  "delivered",        // تم التسليم
] as const;
export type KoshaExecutionStage = (typeof KOSHA_EXECUTION_STAGES)[number];

// Customer-facing kosha tracking — the 7 steps shown on the public tracking page and in admin.
export const KOSHA_TRACKING_STAGES = [
  { key: "booked", label: "تم الحجز" },
  { key: "preparing", label: "قيد التجهيز" },
  { key: "accessories", label: "تجهيز الإكسسوارات" },
  { key: "welcome_board", label: "تجهيز البورد الترحيبي" },
  { key: "ready", label: "جاهزة للتنفيذ" },
  { key: "executed", label: "تم التنفيذ" },
  { key: "completed", label: "مكتمل" },
] as const;
export const KOSHA_TRACKING_KEYS = KOSHA_TRACKING_STAGES.map((stage) => stage.key) as readonly string[];
export type KoshaTrackingStage = (typeof KOSHA_TRACKING_STAGES)[number]["key"];

// Timeline / audit log — one row per meaningful action on a booking.
export const koshaBookingEventsTable = pgTable("kosha_booking_events", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").notNull().references(() => koshaBookingsTable.id, { onDelete: "cascade" }),
  staffId: integer("staff_id").references(() => staffTable.id, { onDelete: "set null" }),
  staffName: text("staff_name").notNull().default(""),
  type: varchar("type", { length: 30 }).notNull(), // stage | media | delivery | payment_request | payment_approved | payment_rejected | note
  fromStage: varchar("from_stage", { length: 30 }),
  toStage: varchar("to_stage", { length: 30 }),
  note: text("note"),
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Photos / videos attached to a booking (execution proof, delivery proof, breakage, etc.).
export const koshaMediaTable = pgTable("kosha_media", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").notNull().references(() => koshaBookingsTable.id, { onDelete: "cascade" }),
  eventId: integer("event_id").references(() => koshaBookingEventsTable.id, { onDelete: "set null" }),
  staffId: integer("staff_id").references(() => staffTable.id, { onDelete: "set null" }),
  url: text("url").notNull(),
  kind: varchar("kind", { length: 10 }).notNull().default("image"), // image | video
  stage: varchar("stage", { length: 30 }), // execution stage the media belongs to
  purpose: varchar("purpose", { length: 20 }).notNull().default("execution"), // execution | delivery | breakage | loss | signature
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// One delivery report per booking (loss / breakage + mandatory note & proof).
export const koshaDeliveryReportsTable = pgTable("kosha_delivery_reports", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").notNull().references(() => koshaBookingsTable.id, { onDelete: "cascade" }),
  staffId: integer("staff_id").references(() => staffTable.id, { onDelete: "set null" }),
  staffName: text("staff_name").notNull().default(""),
  hasLoss: boolean("has_loss").notNull().default(false),
  hasBreakage: boolean("has_breakage").notNull().default(false),
  note: text("note"),
  compensationAmount: numeric("compensation_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  signatureUrl: text("signature_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Field collection of a remaining balance — pending until a manager approves.
export const koshaPaymentRequestsTable = pgTable("kosha_payment_requests", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").notNull().references(() => koshaBookingsTable.id, { onDelete: "cascade" }),
  staffId: integer("staff_id").references(() => staffTable.id, { onDelete: "set null" }),
  staffName: text("staff_name").notNull().default(""),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull().default("0"),
  note: text("note"),
  status: varchar("status", { length: 12 }).notNull().default("pending"), // pending | approved | rejected
  reviewedByStaffId: integer("reviewed_by_staff_id").references(() => staffTable.id, { onDelete: "set null" }),
  reviewedByName: text("reviewed_by_name"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Lightweight per-staff / manager in-app notifications for the portal.
export const koshaStaffNotificationsTable = pgTable("kosha_staff_notifications", {
  id: serial("id").primaryKey(),
  staffId: integer("staff_id").references(() => staffTable.id, { onDelete: "cascade" }), // null = broadcast to all managers
  audience: varchar("audience", { length: 12 }).notNull().default("staff"), // staff | manager
  type: varchar("type", { length: 30 }).notNull(),
  title: text("title").notNull(),
  body: text("body"),
  href: text("href"),
  bookingId: integer("booking_id").references(() => koshaBookingsTable.id, { onDelete: "cascade" }),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertKoshaBookingEventSchema = createInsertSchema(koshaBookingEventsTable).omit({ id: true, createdAt: true });
export const insertKoshaMediaSchema = createInsertSchema(koshaMediaTable).omit({ id: true, createdAt: true });
export const insertKoshaDeliveryReportSchema = createInsertSchema(koshaDeliveryReportsTable).omit({ id: true, createdAt: true });
export const insertKoshaPaymentRequestSchema = createInsertSchema(koshaPaymentRequestsTable).omit({ id: true, createdAt: true });
export const insertKoshaStaffNotificationSchema = createInsertSchema(koshaStaffNotificationsTable).omit({ id: true, createdAt: true });

export type KoshaBookingEvent = typeof koshaBookingEventsTable.$inferSelect;
export type KoshaMedia = typeof koshaMediaTable.$inferSelect;
export type KoshaDeliveryReport = typeof koshaDeliveryReportsTable.$inferSelect;
export type KoshaPaymentRequest = typeof koshaPaymentRequestsTable.$inferSelect;
export type KoshaStaffNotification = typeof koshaStaffNotificationsTable.$inferSelect;
export type InsertKoshaBookingEvent = z.infer<typeof insertKoshaBookingEventSchema>;
export type InsertKoshaMedia = z.infer<typeof insertKoshaMediaSchema>;
export type InsertKoshaDeliveryReport = z.infer<typeof insertKoshaDeliveryReportSchema>;
export type InsertKoshaPaymentRequest = z.infer<typeof insertKoshaPaymentRequestSchema>;
export type InsertKoshaStaffNotification = z.infer<typeof insertKoshaStaffNotificationSchema>;
