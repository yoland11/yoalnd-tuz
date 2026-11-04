import { sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, check, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { customersTable } from "./customers";
import { staffTable } from "./staff";

/** Followup interests only. Canonical customers, employees and bookings remain authoritative. */
export const customerFollowupsTable = pgTable("customer_followups", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id, { onDelete: "restrict" }),
  serviceKey: varchar("service_key", { length: 40 }).notNull(),
  assignedStaffId: integer("assigned_staff_id").notNull().references(() => staffTable.id, { onDelete: "restrict" }),
  followupAt: timestamp("followup_at", { withTimezone: true }).notNull(),
  note: text("note").notNull().default(""),
  status: varchar("status", { length: 20 }).notNull().default("interested"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  sourceBookingSource: varchar("source_booking_source", { length: 10 }),
  sourceBookingId: integer("source_booking_id"),
  bookingSource: varchar("booking_source", { length: 10 }),
  bookingId: integer("booking_id"),
  parentId: integer("parent_id").references((): AnyPgColumn => customerFollowupsTable.id, { onDelete: "restrict" }),
  version: integer("version").notNull().default(1),
  createdBy: integer("created_by").notNull().references(() => staffTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createToken: varchar("create_token", { length: 100 }).notNull(),
  payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
  suggestionKey: varchar("suggestion_key", { length: 160 }),
}, (table) => [
  uniqueIndex("customer_followups_create_token_uq").on(table.createToken),
  uniqueIndex("customer_followups_open_pair_uq").on(table.customerId, table.serviceKey).where(sql`${table.completedAt} IS NULL AND ${table.status} IN ('interested', 'waiting')`),
  uniqueIndex("customer_followups_suggestion_uq").on(table.suggestionKey).where(sql`${table.suggestionKey} IS NOT NULL`),
  index("customer_followups_assignee_due_idx").on(table.assignedStaffId, table.followupAt),
  index("customer_followups_customer_idx").on(table.customerId),
  check("customer_followups_service_ck", sql`${table.serviceKey} IN ('photography', 'kosha', 'sound', 'wedding', 'henna', 'engagement', 'graduation', 'album', 'printing', 'booking_confirmation', 'other')`),
  check("customer_followups_status_ck", sql`${table.status} IN ('interested', 'waiting', 'converted', 'uninterested')`),
  check("customer_followups_version_ck", sql`${table.version} > 0`),
  check("customer_followups_source_booking_ck", sql`(${table.sourceBookingSource} IS NULL AND ${table.sourceBookingId} IS NULL) OR (${table.sourceBookingSource} IS NOT NULL AND ${table.sourceBookingSource} IN ('service', 'kosha') AND ${table.sourceBookingId} IS NOT NULL AND ${table.sourceBookingId} > 0)`),
  check("customer_followups_booking_ck", sql`(${table.bookingSource} IS NULL AND ${table.bookingId} IS NULL) OR (${table.bookingSource} IS NOT NULL AND ${table.bookingSource} IN ('service', 'kosha') AND ${table.bookingId} IS NOT NULL AND ${table.bookingId} > 0)`),
  check("customer_followups_converted_ck", sql`${table.status} <> 'converted' OR (${table.bookingSource} IS NOT NULL AND ${table.bookingId} IS NOT NULL)`),
]);

/** Immutable action results permit recovery after a lost response before optimistic-version checks. */
export const customerFollowupEventsTable = pgTable("customer_followup_events", {
  id: serial("id").primaryKey(),
  followupId: integer("followup_id").notNull().references(() => customerFollowupsTable.id, { onDelete: "restrict" }),
  actorId: integer("actor_id").notNull().references(() => staffTable.id, { onDelete: "restrict" }),
  action: varchar("action", { length: 40 }).notNull(),
  requestToken: varchar("request_token", { length: 160 }).notNull(),
  payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
  result: jsonb("result").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("customer_followup_events_request_uq").on(table.requestToken),
  index("customer_followup_events_followup_idx").on(table.followupId, table.createdAt),
]);

/** Explicit customer-wide contact consent, distinct from declining one service inquiry. */
export const customerFollowupContactPreferencesTable = pgTable("customer_followup_contact_preferences", {
  customerId: integer("customer_id").primaryKey().references(() => customersTable.id, { onDelete: "restrict" }),
  contactBlocked: boolean("contact_blocked").notNull().default(false),
  actorId: integer("actor_id").notNull().references(() => staffTable.id, { onDelete: "restrict" }),
  version: integer("version").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [check("customer_followup_contact_version_ck", sql`${table.version} > 0`)]);

export type CustomerFollowup = typeof customerFollowupsTable.$inferSelect;
export type CustomerFollowupEvent = typeof customerFollowupEventsTable.$inferSelect;
export type CustomerFollowupContactPreference = typeof customerFollowupContactPreferencesTable.$inferSelect;
