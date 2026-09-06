import { relations, sql } from "drizzle-orm";
import { check, index, integer, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { staffTable } from "./staff";

export const KOSHA_BOOKING_SOURCES = ["kosha", "service"] as const;
export type KoshaBookingSource = (typeof KOSHA_BOOKING_SOURCES)[number];

export const KOSHA_MANAGER_INSTRUCTION_KINDS = ["note", "image"] as const;
export type KoshaManagerInstructionKind = (typeof KOSHA_MANAGER_INSTRUCTION_KINDS)[number];

export const KOSHA_BOOKING_CHANNELS = ["manager_instruction", "staff_execution"] as const;
export type KoshaBookingChannel = (typeof KOSHA_BOOKING_CHANNELS)[number];

/**
 * Manager-authored booking instructions. Booking identity intentionally remains
 * polymorphic so native Kosha bookings and routed service bookings can coexist.
 */
export const koshaManagerInstructionsTable = pgTable("kosha_manager_instructions", {
  id: serial("id").primaryKey(),
  bookingSource: varchar("booking_source", { length: 12, enum: KOSHA_BOOKING_SOURCES }).notNull(),
  bookingId: integer("booking_id").notNull(),
  kind: varchar("kind", { length: 12, enum: KOSHA_MANAGER_INSTRUCTION_KINDS }).notNull(),
  mediaUrl: text("media_url"),
  caption: text("caption"),
  uploadedByStaffId: integer("uploaded_by_staff_id").references(() => staffTable.id, { onDelete: "set null" }),
  uploadedByName: text("uploaded_by_name"),
  revision: integer("revision").notNull().default(1),
  archivedAt: timestamp("archived_at"),
  archivedByStaffId: integer("archived_by_staff_id").references(() => staffTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("kosha_manager_instructions_active_booking_idx").on(table.bookingSource, table.bookingId, table.archivedAt, table.createdAt),
  check("kosha_manager_instructions_booking_source_check", sql`${table.bookingSource} in ('kosha', 'service')`),
  check("kosha_manager_instructions_kind_check", sql`${table.kind} in ('note', 'image')`),
  check("kosha_manager_instructions_media_check", sql`(${table.kind} = 'image' and ${table.mediaUrl} is not null and btrim(${table.mediaUrl}) <> '') or (${table.kind} = 'note' and ${table.mediaUrl} is null)`),
]);

/**
 * Last-seen state per staff member and booking channel. It intentionally has no
 * booking FK because bookingSource + bookingId is a cross-table identity.
 */
export const koshaBookingChannelReadsTable = pgTable("kosha_booking_channel_reads", {
  id: serial("id").primaryKey(),
  bookingSource: varchar("booking_source", { length: 12, enum: KOSHA_BOOKING_SOURCES }).notNull(),
  bookingId: integer("booking_id").notNull(),
  staffId: integer("staff_id").notNull().references(() => staffTable.id, { onDelete: "restrict" }),
  channel: varchar("channel", { length: 24, enum: KOSHA_BOOKING_CHANNELS }).notNull(),
  viewedAt: timestamp("viewed_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("kosha_booking_channel_reads_identity_idx").on(table.bookingSource, table.bookingId, table.staffId, table.channel),
  index("kosha_booking_channel_reads_booking_channel_idx").on(table.bookingSource, table.bookingId, table.channel),
  check("kosha_booking_channel_reads_booking_source_check", sql`${table.bookingSource} in ('kosha', 'service')`),
  check("kosha_booking_channel_reads_channel_check", sql`${table.channel} in ('manager_instruction', 'staff_execution')`),
]);

export const koshaManagerInstructionsRelations = relations(koshaManagerInstructionsTable, ({ one }) => ({
  uploadedBy: one(staffTable, {
    fields: [koshaManagerInstructionsTable.uploadedByStaffId],
    references: [staffTable.id],
    relationName: "koshaManagerInstructionUploadedBy",
  }),
  archivedBy: one(staffTable, {
    fields: [koshaManagerInstructionsTable.archivedByStaffId],
    references: [staffTable.id],
    relationName: "koshaManagerInstructionArchivedBy",
  }),
}));

export const koshaBookingChannelReadsRelations = relations(koshaBookingChannelReadsTable, ({ one }) => ({
  staff: one(staffTable, {
    fields: [koshaBookingChannelReadsTable.staffId],
    references: [staffTable.id],
    relationName: "koshaBookingChannelReadStaff",
  }),
}));

export type KoshaManagerInstruction = typeof koshaManagerInstructionsTable.$inferSelect;
export type NewKoshaManagerInstruction = typeof koshaManagerInstructionsTable.$inferInsert;
export type KoshaBookingChannelRead = typeof koshaBookingChannelReadsTable.$inferSelect;
export type NewKoshaBookingChannelRead = typeof koshaBookingChannelReadsTable.$inferInsert;
