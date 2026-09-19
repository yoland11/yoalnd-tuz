import { index, integer, jsonb, numeric, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

/**
 * Booking damage & penalty obligations. A penalty is money a customer owes for
 * damaged / lost / unreturned center equipment on a booking. It is NEVER folded
 * into the original booking total and is NEVER sales revenue — the collected
 * money is classified separately ("غرامات وتلفيات"). Actual payments reuse the
 * master cash-box `financial_transactions` engine (source_type='booking_penalty',
 * source_id=penalty.id), so only an EXECUTED payment moves the cash box, and
 * paid/remaining are DERIVED from those executed movements — never stored
 * mutably here. This table only records the obligation + evidence + lifecycle.
 */
export const bookingPenaltiesTable = pgTable(
  "booking_penalties",
  {
    id: serial("id").primaryKey(),
    penaltyNo: varchar("penalty_no", { length: 50 }).notNull().unique(),
    // The booking this penalty belongs to (never a new booking).
    sourceType: varchar("source_type", { length: 30 }).notNull(), // service_order | kosha_booking
    sourceId: integer("source_id").notNull(),
    customerId: integer("customer_id"),
    customerName: text("customer_name").notNull().default(""),
    // The damaged item — links to the store/equipment product when known; the
    // label is snapshotted so a later rename never rewrites history.
    productId: integer("product_id"),
    itemLabel: text("item_label").notNull().default(""),
    damageType: varchar("damage_type", { length: 30 }).notNull(), // break|loss|damage|shortage|not_returned|other
    itemCondition: varchar("item_condition", { length: 30 }), // broken|damaged|lost|shortage|unusable
    quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull().default("1"),
    unitValue: numeric("unit_value", { precision: 16, scale: 2 }).notNull().default("0"), // replacement value basis (suggestion only)
    penaltyAmount: numeric("penalty_amount", { precision: 16, scale: 2 }).notNull().default("0"), // final manager-confirmed obligation
    reason: text("reason").notNull().default(""),
    evidence: jsonb("evidence").$type<string[]>().notNull().default([]), // photo/document URLs
    notes: text("notes"),
    // Lifecycle only. Payment status (unpaid/partly/paid) is DERIVED from executed
    // transactions, never stored here, so it can never silently drift.
    status: varchar("status", { length: 24 }).notNull().default("pending_review"), // pending_review|approved|cancelled
    origin: varchar("origin", { length: 20 }).notNull().default("manager"), // manager|employee_report
    // When this row is a post-payment correction of an earlier penalty, this points
    // at the original (which is preserved, never edited in place).
    correctionOf: integer("correction_of"),
    employeeReport: jsonb("employee_report").$type<Record<string, unknown>>(), // raw employee submission for audit
    reviewedBy: integer("reviewed_by"),
    reviewedByName: text("reviewed_by_name"),
    reviewedAt: timestamp("reviewed_at"),
    rejectedReason: text("rejected_reason"),
    cancelledReason: text("cancelled_reason"),
    cancelledBy: integer("cancelled_by"),
    cancelledAt: timestamp("cancelled_at"),
    // Traceable inventory movement created for a broken/lost item (never silent).
    inventoryMovementId: integer("inventory_movement_id"),
    createdBy: integer("created_by"),
    createdByName: text("created_by_name").notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    sourceIdx: index("booking_penalties_source_idx").on(t.sourceType, t.sourceId),
    statusIdx: index("booking_penalties_status_idx").on(t.status),
    customerIdx: index("booking_penalties_customer_idx").on(t.customerId),
  }),
);

export type BookingPenalty = typeof bookingPenaltiesTable.$inferSelect;
