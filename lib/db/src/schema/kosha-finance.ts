import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, numeric, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { koshasTable } from "./koshas";
import { productsTable } from "./products";
import { staffTable } from "./staff";
import { suppliersTable } from "./suppliers";

export const koshaConstructionProjectsTable = pgTable("kosha_construction_projects", {
  id: serial("id").primaryKey(),
  koshaId: integer("kosha_id").notNull().references(() => koshasTable.id, { onDelete: "cascade" }),
  plannedBudget: numeric("planned_budget", { precision: 14, scale: 2 }).notNull().default("0"),
  stage: varchar("stage", { length: 32 }).notNull().default("draft"),
  createdOn: date("created_on").notNull().defaultNow(),
  expectedCompletionDate: date("expected_completion_date"),
  responsibleEmployeeId: integer("responsible_employee_id").references(() => staffTable.id, { onDelete: "set null" }),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => staffTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  koshaIdx: index("kosha_construction_projects_kosha_idx").on(table.koshaId),
  stageCheck: check("kosha_construction_projects_stage_check", sql`${table.stage} IN ('draft','materials_required','purchasing','materials_received','assembly','inspection','ready')`),
}));

/** One physical AJN product can be assigned to more than one Koshah without cloning its passport. */
export const koshaAssetAssignmentsTable = pgTable("kosha_asset_assignments", {
  id: serial("id").primaryKey(),
  koshaId: integer("kosha_id").notNull().references(() => koshasTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").notNull().references(() => productsTable.id, { onDelete: "restrict" }),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull().default("1"),
  shared: boolean("shared").notNull().default(false),
  storageLocation: text("storage_location"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  assignedAt: timestamp("assigned_at").notNull().defaultNow(),
  assignedBy: integer("assigned_by").references(() => staffTable.id, { onDelete: "set null" }),
}, (table) => ({
  activeAssetIdx: uniqueIndex("kosha_asset_assignments_active_product_idx").on(table.koshaId, table.productId).where(sql`${table.isActive} = true`),
  productIdx: index("kosha_asset_assignments_product_idx").on(table.productId),
}));

export const koshaMaintenanceRecordsTable = pgTable("kosha_maintenance_records", {
  id: serial("id").primaryKey(),
  koshaId: integer("kosha_id").notNull().references(() => koshasTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").references(() => productsTable.id, { onDelete: "set null" }),
  maintenanceType: varchar("maintenance_type", { length: 40 }).notNull(),
  maintenanceDate: date("maintenance_date").notNull().defaultNow(),
  description: text("description").notNull(),
  parts: jsonb("parts").$type<string[]>().notNull().default([]),
  supplierId: integer("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  technicianName: text("technician_name"),
  employeeId: integer("employee_id").references(() => staffTable.id, { onDelete: "set null" }),
  attachments: jsonb("attachments").$type<string[]>().notNull().default([]),
  nextMaintenanceDate: date("next_maintenance_date"),
  /** Optional pointer to the canonical approved expense; never stores a second amount. */
  expenseId: integer("expense_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  koshaDateIdx: index("kosha_maintenance_kosha_date_idx").on(table.koshaId, table.maintenanceDate),
  nextDateIdx: index("kosha_maintenance_next_date_idx").on(table.nextMaintenanceDate),
  expenseIdx: uniqueIndex("kosha_maintenance_expense_idx").on(table.expenseId),
}));

export const koshaDamageReportsTable = pgTable("kosha_damage_reports", {
  id: serial("id").primaryKey(),
  // Legacy booking reports predate Koshah finance and remain valid with a null koshaId.
  koshaId: integer("kosha_id").references(() => koshasTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").references(() => productsTable.id, { onDelete: "set null" }),
  bookingId: integer("booking_id").notNull(),
  bookingSource: varchar("booking_source", { length: 20 }).notNull().default("kosha"),
  reportedBy: integer("reported_by").references(() => staffTable.id, { onDelete: "set null" }),
  reportedByName: text("reported_by_name").notNull().default(""),
  responsibleStaffId: integer("responsible_staff_id").references(() => staffTable.id, { onDelete: "set null" }),
  approvedBy: integer("approved_by").references(() => staffTable.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at"),
  incidentType: varchar("incident_type", { length: 30 }),
  reason: text("reason"),
  description: text("description").notNull(),
  photoUrl: text("photo_url"),
  priority: varchar("priority", { length: 20 }).notNull().default("medium"),
  costEstimate: numeric("cost_estimate", { precision: 14, scale: 2 }).notNull().default("0"),
  estimatedRepairCost: numeric("estimated_repair_cost", { precision: 14, scale: 2 }),
  estimatedReplacementCost: numeric("estimated_replacement_cost", { precision: 14, scale: 2 }),
  status: varchar("status", { length: 24 }).notNull().default("open"),
  /** Optional pointer to the canonical approved expense; never stores a second amount. */
  expenseId: integer("expense_id"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  koshaDateIdx: index("kosha_damage_kosha_date_idx").on(table.koshaId, table.createdAt),
  bookingIdx: index("kosha_damage_booking_idx").on(table.bookingId),
  expenseIdx: uniqueIndex("kosha_damage_expense_idx").on(table.expenseId).where(sql`${table.expenseId} IS NOT NULL`),
  incidentCheck: check("kosha_damage_incident_type_check", sql`${table.incidentType} IS NULL OR ${table.incidentType} IN ('damage','missing','loss')`),
}));
