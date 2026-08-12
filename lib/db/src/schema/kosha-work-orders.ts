import { boolean, integer, jsonb, numeric, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { koshaBookingsTable } from "./koshas";
import { productsTable } from "./products";
import { staffTable } from "./staff";

/**
 * Operational work orders deliberately live beside, not inside, bookings.
 * A booking is a customer/commercial record; this is the immutable execution record.
 */
export const koshaWorkOrdersTable = pgTable("kosha_work_orders", {
  id: serial("id").primaryKey(),
  workOrderNo: varchar("work_order_no", { length: 40 }).notNull().unique(),
  bookingId: integer("booking_id").notNull().references(() => koshaBookingsTable.id, { onDelete: "restrict" }).unique(),
  leaderId: integer("leader_id").references(() => staffTable.id, { onDelete: "set null" }),
  status: varchar("status", { length: 40 }).notNull().default("UNASSIGNED"),
  priority: varchar("priority", { length: 20 }).notNull().default("normal"),
  requiredArrivalAt: timestamp("required_arrival_at"),
  eventStartAt: timestamp("event_start_at"),
  expectedDismantleAt: timestamp("expected_dismantle_at"),
  assignedAt: timestamp("assigned_at"),
  acceptedAt: timestamp("accepted_at"),
  startedAt: timestamp("started_at"),
  startedBy: integer("started_by").references(() => staffTable.id, { onDelete: "set null" }),
  startedLat: numeric("started_lat", { precision: 10, scale: 7 }),
  startedLng: numeric("started_lng", { precision: 10, scale: 7 }),
  arrivedAt: timestamp("arrived_at"),
  completedAt: timestamp("completed_at"),
  specialInstructions: text("special_instructions"),
  requireAcknowledgment: boolean("require_acknowledgment").notNull().default(false),
  instructionsAcknowledgedAt: timestamp("instructions_acknowledged_at"),
  instructionsAcknowledgedBy: integer("instructions_acknowledged_by").references(() => staffTable.id, { onDelete: "set null" }),
  cancelledAt: timestamp("cancelled_at"),
  createdBy: integer("created_by").references(() => staffTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const koshaWorkOrderMembersTable = pgTable("kosha_work_order_members", {
  id: serial("id").primaryKey(),
  workOrderId: integer("work_order_id").notNull().references(() => koshaWorkOrdersTable.id, { onDelete: "restrict" }),
  staffId: integer("staff_id").notNull().references(() => staffTable.id, { onDelete: "restrict" }),
  role: varchar("role", { length: 20 }).notNull().default("MEMBER"),
  status: varchar("status", { length: 30 }).notNull().default("ASSIGNED"),
  acceptedAt: timestamp("accepted_at"),
  declinedAt: timestamp("declined_at"),
  declineReason: varchar("decline_reason", { length: 40 }),
  declineNote: text("decline_note"),
  removedAt: timestamp("removed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [uniqueIndex("kosha_work_order_member_once_idx").on(table.workOrderId, table.staffId)]);

export const koshaWorkOrderEventsTable = pgTable("kosha_work_order_events", {
  id: serial("id").primaryKey(),
  workOrderId: integer("work_order_id").notNull().references(() => koshaWorkOrdersTable.id, { onDelete: "restrict" }),
  staffId: integer("staff_id").references(() => staffTable.id, { onDelete: "set null" }),
  staffName: text("staff_name").notNull().default(""),
  type: varchar("type", { length: 50 }).notNull(),
  title: text("title").notNull(),
  details: text("details"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const koshaWorkOrderChecklistTable = pgTable("kosha_work_order_checklist", {
  id: serial("id").primaryKey(),
  workOrderId: integer("work_order_id").notNull().references(() => koshaWorkOrdersTable.id, { onDelete: "restrict" }),
  label: text("label").notNull(),
  productId: integer("product_id").references(() => productsTable.id, { onDelete: "set null" }),
  sortOrder: integer("sort_order").notNull().default(0),
  isCompleted: boolean("is_completed").notNull().default(false),
  completedBy: integer("completed_by").references(() => staffTable.id, { onDelete: "set null" }),
  completedAt: timestamp("completed_at"),
  note: text("note"),
  photoUrl: text("photo_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const koshaWorkOrderAssetsTable = pgTable("kosha_work_order_assets", {
  id: serial("id").primaryKey(),
  workOrderId: integer("work_order_id").notNull().references(() => koshaWorkOrdersTable.id, { onDelete: "restrict" }),
  productId: integer("product_id").notNull().references(() => productsTable.id, { onDelete: "restrict" }),
  assetCode: varchar("asset_code", { length: 160 }),
  checkedOutBy: integer("checked_out_by").references(() => staffTable.id, { onDelete: "set null" }),
  checkedOutAt: timestamp("checked_out_at"),
  returnedBy: integer("returned_by").references(() => staffTable.id, { onDelete: "set null" }),
  returnedAt: timestamp("returned_at"),
  returnCondition: varchar("return_condition", { length: 30 }),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [uniqueIndex("kosha_work_order_asset_once_idx").on(table.workOrderId, table.productId)]);
