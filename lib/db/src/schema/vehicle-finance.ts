import { index, integer, jsonb, numeric, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { fleetVehiclesTable } from "./enterprise";
import { koshaBookingsTable } from "./koshas";
import { financialTransactionsTable } from "./master-cash-box";
import { staffTable } from "./staff";

/**
 * Analytical vehicle costs only. Cash and journal posting continue through
 * financial_transactions / master_cash_box; this table never acts as a cashbox.
 */
export const vehicleExpensesTable = pgTable("vehicle_expenses", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").notNull().references(() => fleetVehiclesTable.id, { onDelete: "restrict" }),
  bookingId: integer("booking_id").references(() => koshaBookingsTable.id, { onDelete: "restrict" }),
  driverId: integer("driver_id").references(() => staffTable.id, { onDelete: "set null" }),
  odometerKm: integer("odometer_km"),
  expenseType: varchar("expense_type", { length: 40 }).notNull(),
  amount: numeric("amount", { precision: 16, scale: 2 }).notNull(),
  expenseDate: timestamp("expense_date").notNull().defaultNow(),
  cashAccountCode: varchar("cash_account_code", { length: 30 }).notNull().default("MASTER"),
  paymentMethod: varchar("payment_method", { length: 20 }).notNull().default("cash"),
  description: text("description"),
  attachments: jsonb("attachments").$type<string[]>().notNull().default([]),
  status: varchar("status", { length: 24 }).notNull().default("pending"),
  idempotencyKey: varchar("idempotency_key", { length: 180 }).notNull(),
  financialTransactionId: integer("financial_transaction_id").references(() => financialTransactionsTable.id, { onDelete: "restrict" }),
  createdBy: integer("created_by").references(() => staffTable.id, { onDelete: "set null" }),
  createdByName: text("created_by_name").notNull().default(""),
  reversedAt: timestamp("reversed_at"),
  reversalReason: text("reversal_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  idempotencyIdx: uniqueIndex("vehicle_expenses_idempotency_idx").on(table.idempotencyKey),
  financialTransactionIdx: uniqueIndex("vehicle_expenses_financial_transaction_idx").on(table.financialTransactionId),
  vehicleDateIdx: index("vehicle_expenses_vehicle_date_idx").on(table.vehicleId, table.expenseDate),
  bookingIdx: index("vehicle_expenses_booking_idx").on(table.bookingId),
  statusIdx: index("vehicle_expenses_status_idx").on(table.status, table.expenseDate),
}));

export type VehicleExpense = typeof vehicleExpensesTable.$inferSelect;
