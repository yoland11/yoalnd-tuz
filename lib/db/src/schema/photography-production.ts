import { date, index, integer, pgTable, serial, text, timestamp, unique, varchar } from "drizzle-orm/pg-core";
import { serviceOrdersTable } from "./services";
import { staffTable } from "./staff";

/**
 * Photography Production Center: one work item per booking deliverable
 * (video / photos / album / printing). Bookings stay in `service_orders`,
 * employees in `staff`, and status history in `entity_timeline` — this table
 * only adds the per-deliverable status, owner and deadline. Created by the
 * reviewed additive migration 0123_photography_production_items.sql.
 */
export const PHOTOGRAPHY_PRODUCTION_KINDS = ["video", "photos", "album", "printing"] as const;
export const PHOTOGRAPHY_PRODUCTION_STATUSES = ["remaining", "in_progress", "waiting_files", "completed"] as const;

export const photographyProductionItemsTable = pgTable(
  "photography_production_items",
  {
    id: serial("id").primaryKey(),
    bookingId: integer("booking_id")
      .notNull()
      .references(() => serviceOrdersTable.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 20 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("remaining"),
    assigneeStaffId: integer("assignee_staff_id").references(() => staffTable.id, { onDelete: "set null" }),
    assigneeName: text("assignee_name"),
    dueDate: date("due_date", { mode: "string" }),
    notes: text("notes"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    statusChangedAt: timestamp("status_changed_at").notNull().defaultNow(),
    statusChangedBy: integer("status_changed_by"),
    statusChangedByName: text("status_changed_by_name"),
    createdBy: integer("created_by"),
    createdByName: text("created_by_name"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    bookingKindUnique: unique("photography_production_items_booking_kind_unique").on(table.bookingId, table.kind),
    statusIdx: index("photography_production_items_status_idx").on(table.status),
    assigneeIdx: index("photography_production_items_assignee_idx").on(table.assigneeStaffId),
    dueDateIdx: index("photography_production_items_due_date_idx").on(table.dueDate),
  }),
);

export type PhotographyProductionItem = typeof photographyProductionItemsTable.$inferSelect;
