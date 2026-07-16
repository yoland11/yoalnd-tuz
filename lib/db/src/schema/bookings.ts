import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { customersTable } from "./customers";
import { staffTable } from "./staff";

/**
 * Unified Booking Center.
 *
 * One booking = one customer, one booking number, one contract, one payment
 * schedule, one remaining balance — with many services enabled underneath it.
 *
 * Money is deliberately NOT owned by this table. `paidAmount` / `refundedAmount`
 * are caches derived from executed receipt/payment vouchers linked via
 * `receipt_vouchers.booking_ref_id`, recomputed by `recalcBookingFinancials()`.
 * The cashbox stays the single source of truth, so a booking can never drift
 * into claiming money the ledger does not have.
 */
export const bookingsTable = pgTable(
  "bookings",
  {
    id: serial("id").primaryKey(),
    bookingNo: varchar("booking_no", { length: 40 }).notNull(),
    customerId: integer("customer_id").references(() => customersTable.id, {
      onDelete: "restrict",
    }),
    customerName: text("customer_name").notNull().default(""),
    customerPhone: varchar("customer_phone", { length: 30 }).notNull().default(""),

    // Event
    eventDate: date("event_date"),
    eventTime: varchar("event_time", { length: 20 }),
    eventType: varchar("event_type", { length: 40 }),
    hallName: text("hall_name"),
    hallAddress: text("hall_address"),
    mapUrl: text("map_url"),

    status: varchar("status", { length: 30 }).notNull().default("draft"),

    // Financials — see note above: paid/refunded are derived caches.
    servicesTotal: numeric("services_total", { precision: 16, scale: 2 }).notNull().default("0"),
    productsTotal: numeric("products_total", { precision: 16, scale: 2 }).notNull().default("0"),
    additionalCharges: numeric("additional_charges", { precision: 16, scale: 2 }).notNull().default("0"),
    discount: numeric("discount", { precision: 16, scale: 2 }).notNull().default("0"),
    grandTotal: numeric("grand_total", { precision: 16, scale: 2 }).notNull().default("0"),
    paidAmount: numeric("paid_amount", { precision: 16, scale: 2 }).notNull().default("0"),
    pendingReceiptAmount: numeric("pending_receipt_amount", { precision: 16, scale: 2 }).notNull().default("0"),
    refundedAmount: numeric("refunded_amount", { precision: 16, scale: 2 }).notNull().default("0"),
    remainingAmount: numeric("remaining_amount", { precision: 16, scale: 2 }).notNull().default("0"),
    paymentStatus: varchar("payment_status", { length: 20 }).notNull().default("unpaid"),

    contractSignedAt: timestamp("contract_signed_at"),
    notes: text("notes"),
    internalNotes: text("internal_notes"),

    cancelledAt: timestamp("cancelled_at"),
    cancelReason: text("cancel_reason"),
    cancelledBy: integer("cancelled_by").references(() => staffTable.id, { onDelete: "set null" }),

    createdBy: integer("created_by").references(() => staffTable.id, { onDelete: "set null" }),
    createdByName: text("created_by_name").notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    bookingNoIdx: uniqueIndex("bookings_booking_no_idx").on(table.bookingNo),
    customerIdx: index("bookings_customer_idx").on(table.customerId),
    eventDateIdx: index("bookings_event_date_idx").on(table.eventDate),
    statusIdx: index("bookings_status_idx").on(table.status),
    paymentStatusIdx: index("bookings_payment_status_idx").on(table.paymentStatus),
  }),
);

/**
 * One row per service enabled inside a booking (kosha, photography, sound, …).
 * `serviceKey` is free-form so managers can add services without a migration,
 * mirroring how kosha_categories works.
 */
export const bookingServicesTable = pgTable(
  "booking_services",
  {
    id: serial("id").primaryKey(),
    bookingId: integer("booking_id")
      .notNull()
      .references(() => bookingsTable.id, { onDelete: "cascade" }),
    serviceKey: varchar("service_key", { length: 40 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("waiting"),
    amount: numeric("amount", { precision: 16, scale: 2 }).notNull().default("0"),
    notes: text("notes"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    bookingServiceIdx: uniqueIndex("booking_services_booking_service_idx").on(
      table.bookingId,
      table.serviceKey,
    ),
    bookingIdx: index("booking_services_booking_idx").on(table.bookingId),
    statusIdx: index("booking_services_status_idx").on(table.status),
  }),
);

/**
 * Additive bridge to the pre-existing booking systems (kosha_bookings,
 * graduation_orders, photography orders, service_orders). Legacy modules keep
 * owning their own rows and keep working untouched; this table only records
 * that a unified booking represents them.
 */
export const bookingLinksTable = pgTable(
  "booking_links",
  {
    id: serial("id").primaryKey(),
    bookingId: integer("booking_id")
      .notNull()
      .references(() => bookingsTable.id, { onDelete: "cascade" }),
    sourceType: varchar("source_type", { length: 40 }).notNull(),
    sourceId: integer("source_id").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    uniqueLinkIdx: uniqueIndex("booking_links_unique_idx").on(
      table.sourceType,
      table.sourceId,
    ),
    bookingIdx: index("booking_links_booking_idx").on(table.bookingId),
  }),
);

/** Append-only booking timeline. Never updated, never deleted. */
export const bookingTimelineTable = pgTable(
  "booking_timeline",
  {
    id: serial("id").primaryKey(),
    bookingId: integer("booking_id")
      .notNull()
      .references(() => bookingsTable.id, { onDelete: "cascade" }),
    eventKey: varchar("event_key", { length: 60 }).notNull(),
    serviceKey: varchar("service_key", { length: 40 }),
    title: text("title").notNull(),
    description: text("description"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    actorId: integer("actor_id").references(() => staffTable.id, { onDelete: "set null" }),
    actorName: text("actor_name").notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    bookingIdx: index("booking_timeline_booking_idx").on(table.bookingId),
    createdAtIdx: index("booking_timeline_created_idx").on(table.createdAt),
  }),
);

export const bookingsRelations = relations(bookingsTable, ({ one, many }) => ({
  customer: one(customersTable, {
    fields: [bookingsTable.customerId],
    references: [customersTable.id],
  }),
  services: many(bookingServicesTable),
  links: many(bookingLinksTable),
  timeline: many(bookingTimelineTable),
}));

export const bookingServicesRelations = relations(bookingServicesTable, ({ one }) => ({
  booking: one(bookingsTable, {
    fields: [bookingServicesTable.bookingId],
    references: [bookingsTable.id],
  }),
}));

export const bookingLinksRelations = relations(bookingLinksTable, ({ one }) => ({
  booking: one(bookingsTable, {
    fields: [bookingLinksTable.bookingId],
    references: [bookingsTable.id],
  }),
}));

export const bookingTimelineRelations = relations(bookingTimelineTable, ({ one }) => ({
  booking: one(bookingsTable, {
    fields: [bookingTimelineTable.bookingId],
    references: [bookingsTable.id],
  }),
}));

export const insertBookingSchema = createInsertSchema(bookingsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type Booking = typeof bookingsTable.$inferSelect;
export type BookingService = typeof bookingServicesTable.$inferSelect;
export type BookingLink = typeof bookingLinksTable.$inferSelect;
export type BookingTimelineEntry = typeof bookingTimelineTable.$inferSelect;
