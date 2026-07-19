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
import { customersTable } from "./customers";
import { crewsTable } from "./crews";
import { productsTable } from "./products";
import { staffTable } from "./staff";
import { warehousesTable } from "./admin-extensions";

export const enterpriseBranchesTable = pgTable("enterprise_branches", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 30 }).notNull(),
  name: text("name").notNull(),
  city: text("city"),
  address: text("address"),
  mapUrl: text("map_url"),
  latitude: numeric("latitude", { precision: 10, scale: 7 }),
  longitude: numeric("longitude", { precision: 10, scale: 7 }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  codeIdx: uniqueIndex("enterprise_branches_code_idx").on(table.code),
  activeIdx: index("enterprise_branches_active_idx").on(table.isActive),
}));

export const branchEntityAssignmentsTable = pgTable("branch_entity_assignments", {
  id: serial("id").primaryKey(),
  branchId: integer("branch_id").notNull().references(() => enterpriseBranchesTable.id, { onDelete: "cascade" }),
  entityType: varchar("entity_type", { length: 40 }).notNull(),
  entityId: integer("entity_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  entityIdx: uniqueIndex("branch_entity_assignments_entity_idx").on(table.entityType, table.entityId),
  branchIdx: index("branch_entity_assignments_branch_idx").on(table.branchId, table.entityType),
}));

export const fleetVehiclesTable = pgTable("fleet_vehicles", {
  id: serial("id").primaryKey(),
  branchId: integer("branch_id").references(() => enterpriseBranchesTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  plateNumber: varchar("plate_number", { length: 40 }).notNull(),
  status: varchar("status", { length: 24 }).notNull().default("available"),
  capacity: integer("capacity").notNull().default(1),
  latitude: numeric("latitude", { precision: 10, scale: 7 }),
  longitude: numeric("longitude", { precision: 10, scale: 7 }),
  notes: text("notes"),
  lastLocationAt: timestamp("last_location_at"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  plateIdx: uniqueIndex("fleet_vehicles_plate_idx").on(table.plateNumber),
  statusIdx: index("fleet_vehicles_status_idx").on(table.status, table.isActive),
  branchIdx: index("fleet_vehicles_branch_idx").on(table.branchId),
}));

export const fieldLocationsTable = pgTable("field_locations", {
  id: serial("id").primaryKey(),
  resourceType: varchar("resource_type", { length: 24 }).notNull(),
  resourceId: integer("resource_id").notNull(),
  resourceName: text("resource_name").notNull().default(""),
  branchId: integer("branch_id").references(() => enterpriseBranchesTable.id, { onDelete: "set null" }),
  entityType: varchar("entity_type", { length: 40 }),
  entityId: integer("entity_id"),
  latitude: numeric("latitude", { precision: 10, scale: 7 }).notNull(),
  longitude: numeric("longitude", { precision: 10, scale: 7 }).notNull(),
  accuracyMeters: numeric("accuracy_meters", { precision: 10, scale: 2 }),
  status: varchar("status", { length: 30 }).notNull().default("available"),
  recordedBy: integer("recorded_by").references(() => staffTable.id, { onDelete: "set null" }),
  recordedAt: timestamp("recorded_at").notNull().defaultNow(),
}, (table) => ({
  resourceIdx: index("field_locations_resource_idx").on(table.resourceType, table.resourceId, table.recordedAt),
  entityIdx: index("field_locations_entity_idx").on(table.entityType, table.entityId),
}));

export const dispatchAssignmentsTable = pgTable("dispatch_assignments", {
  id: serial("id").primaryKey(),
  entityType: varchar("entity_type", { length: 40 }).notNull(),
  entityId: integer("entity_id").notNull(),
  branchId: integer("branch_id").references(() => enterpriseBranchesTable.id, { onDelete: "set null" }),
  crewId: integer("crew_id").references(() => crewsTable.id, { onDelete: "set null" }),
  vehicleId: integer("vehicle_id").references(() => fleetVehiclesTable.id, { onDelete: "set null" }),
  warehouseId: integer("warehouse_id").references(() => warehousesTable.id, { onDelete: "set null" }),
  score: numeric("score", { precision: 6, scale: 2 }).notNull().default("0"),
  status: varchar("status", { length: 24 }).notNull().default("assigned"),
  suggestions: jsonb("suggestions").$type<Record<string, unknown>>().notNull().default({}),
  notes: text("notes"),
  assignedBy: integer("assigned_by").references(() => staffTable.id, { onDelete: "set null" }),
  assignedByName: text("assigned_by_name").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  entityIdx: uniqueIndex("dispatch_assignments_entity_idx").on(table.entityType, table.entityId),
  statusIdx: index("dispatch_assignments_status_idx").on(table.status, table.createdAt),
}));

export const internalChannelsTable = pgTable("internal_channels", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  department: varchar("department", { length: 40 }).notNull().default("general"),
  entityType: varchar("entity_type", { length: 40 }),
  entityId: integer("entity_id"),
  participantStaffIds: jsonb("participant_staff_ids").$type<number[]>().notNull().default([]),
  createdBy: integer("created_by").references(() => staffTable.id, { onDelete: "set null" }),
  archivedAt: timestamp("archived_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  entityIdx: index("internal_channels_entity_idx").on(table.entityType, table.entityId),
  departmentIdx: index("internal_channels_department_idx").on(table.department, table.updatedAt),
}));

export const internalMessagesTable = pgTable("internal_messages", {
  id: serial("id").primaryKey(),
  channelId: integer("channel_id").notNull().references(() => internalChannelsTable.id, { onDelete: "cascade" }),
  senderId: integer("sender_id").references(() => staffTable.id, { onDelete: "set null" }),
  senderName: text("sender_name").notNull().default(""),
  body: text("body"),
  voiceUrl: text("voice_url"),
  voiceDuration: integer("voice_duration"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  channelIdx: index("internal_messages_channel_idx").on(table.channelId, table.createdAt),
}));

export const customerQueueEntriesTable = pgTable("customer_queue_entries", {
  id: serial("id").primaryKey(),
  queueNo: varchar("queue_no", { length: 40 }).notNull(),
  customerId: integer("customer_id").references(() => customersTable.id, { onDelete: "set null" }),
  customerName: text("customer_name").notNull().default(""),
  phone: varchar("phone", { length: 30 }),
  serviceType: varchar("service_type", { length: 40 }).notNull().default("general"),
  branchId: integer("branch_id").references(() => enterpriseBranchesTable.id, { onDelete: "set null" }),
  status: varchar("status", { length: 24 }).notNull().default("waiting"),
  arrivedAt: timestamp("arrived_at").notNull().defaultNow(),
  serviceStartedAt: timestamp("service_started_at"),
  completedAt: timestamp("completed_at"),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => staffTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  queueNoIdx: uniqueIndex("customer_queue_entries_no_idx").on(table.queueNo),
  statusIdx: index("customer_queue_entries_status_idx").on(table.status, table.arrivedAt),
}));

export const lostTimeEntriesTable = pgTable("lost_time_entries", {
  id: serial("id").primaryKey(),
  entityType: varchar("entity_type", { length: 40 }),
  entityId: integer("entity_id"),
  reasonType: varchar("reason_type", { length: 30 }).notNull(),
  minutes: integer("minutes").notNull(),
  description: text("description"),
  staffId: integer("staff_id").references(() => staffTable.id, { onDelete: "set null" }),
  vehicleId: integer("vehicle_id").references(() => fleetVehiclesTable.id, { onDelete: "set null" }),
  productId: integer("product_id").references(() => productsTable.id, { onDelete: "set null" }),
  recordedBy: integer("recorded_by").references(() => staffTable.id, { onDelete: "set null" }),
  occurredAt: timestamp("occurred_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  reasonIdx: index("lost_time_entries_reason_idx").on(table.reasonType, table.occurredAt),
  entityIdx: index("lost_time_entries_entity_idx").on(table.entityType, table.entityId),
}));

export const assetPassportsTable = pgTable("asset_passports", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
  serialNumber: varchar("serial_number", { length: 120 }),
  supplierName: text("supplier_name"),
  warrantyUntil: date("warranty_until"),
  warehouseId: integer("warehouse_id").references(() => warehousesTable.id, { onDelete: "set null" }),
  shelfCode: varchar("shelf_code", { length: 40 }),
  imageUrl: text("image_url"),
  qrToken: varchar("qr_token", { length: 80 }),
  lastStaffId: integer("last_staff_id").references(() => staffTable.id, { onDelete: "set null" }),
  lastLocation: text("last_location"),
  revenueTotal: numeric("revenue_total", { precision: 16, scale: 2 }).notNull().default("0"),
  maintenanceCost: numeric("maintenance_cost", { precision: 16, scale: 2 }).notNull().default("0"),
  nextMaintenanceDate: date("next_maintenance_date"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  productIdx: uniqueIndex("asset_passports_product_idx").on(table.productId),
  serialIdx: uniqueIndex("asset_passports_serial_idx").on(table.serialNumber),
  shelfIdx: index("asset_passports_shelf_idx").on(table.warehouseId, table.shelfCode),
}));

export const equipmentCustodyTable = pgTable("equipment_custody", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull().references(() => productsTable.id, { onDelete: "restrict" }),
  staffId: integer("staff_id").notNull().references(() => staffTable.id, { onDelete: "restrict" }),
  quantity: integer("quantity").notNull().default(1),
  status: varchar("status", { length: 24 }).notNull().default("issued"),
  signatureUrl: text("signature_url"),
  issuedAt: timestamp("issued_at").notNull().defaultNow(),
  returnedAt: timestamp("returned_at"),
  notes: text("notes"),
  issuedBy: integer("issued_by").references(() => staffTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  staffStatusIdx: index("equipment_custody_staff_status_idx").on(table.staffId, table.status),
  productStatusIdx: index("equipment_custody_product_status_idx").on(table.productId, table.status),
}));

/**
 * Permanent employee equipment custody. These rows only link existing fixed
 * assets; they never create a product, stock item, or depreciation profile.
 */
export const employeeCustodyGroupsTable = pgTable("employee_custody_groups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  staffId: integer("staff_id").notNull().references(() => staffTable.id, { onDelete: "restrict" }),
  department: text("department"),
  groupType: varchar("group_type", { length: 40 }).notNull().default("general"),
  description: text("description"),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  lastInspectionDate: date("last_inspection_date"),
  nextInspectionDate: date("next_inspection_date"),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => staffTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  staffStatusIdx: index("employee_custody_groups_staff_status_idx").on(table.staffId, table.status),
}));

export const employeeCustodyGroupAssetsTable = pgTable("employee_custody_group_assets", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull().references(() => employeeCustodyGroupsTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").notNull().references(() => productsTable.id, { onDelete: "restrict" }),
  isActive: boolean("is_active").notNull().default(true),
  addedBy: integer("added_by").references(() => staffTable.id, { onDelete: "set null" }),
  addedAt: timestamp("added_at").notNull().defaultNow(),
  removedAt: timestamp("removed_at"),
  notes: text("notes"),
}, (table) => ({
  groupAssetIdx: uniqueIndex("employee_custody_group_assets_group_asset_idx").on(table.groupId, table.productId),
  productActiveIdx: index("employee_custody_group_assets_product_active_idx").on(table.productId, table.isActive),
}));

export const employeeCustodyReservationsTable = pgTable("employee_custody_reservations", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull().references(() => employeeCustodyGroupsTable.id, { onDelete: "restrict" }),
  productId: integer("product_id").notNull().references(() => productsTable.id, { onDelete: "restrict" }),
  staffId: integer("staff_id").notNull().references(() => staffTable.id, { onDelete: "restrict" }),
  bookingType: varchar("booking_type", { length: 20 }).notNull(),
  bookingId: integer("booking_id").notNull(),
  startAt: timestamp("start_at").notNull(),
  endAt: timestamp("end_at").notNull(),
  status: varchar("status", { length: 24 }).notNull().default("reserved"),
  checkoutAt: timestamp("checkout_at"),
  returnedAt: timestamp("returned_at"),
  depreciationAppliedAt: timestamp("depreciation_applied_at"),
  conditionOut: varchar("condition_out", { length: 20 }),
  conditionIn: varchar("condition_in", { length: 20 }),
  damageReason: text("damage_reason"),
  damagePhotoUrl: text("damage_photo_url"),
  signatureUrl: text("signature_url"),
  createdBy: integer("created_by").references(() => staffTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  bookingIdx: index("employee_custody_reservations_booking_idx").on(table.bookingType, table.bookingId, table.status),
  productTimeIdx: index("employee_custody_reservations_product_time_idx").on(table.productId, table.startAt, table.endAt),
}));

export const eventCostEstimatesTable = pgTable("event_cost_estimates", {
  id: serial("id").primaryKey(),
  entityType: varchar("entity_type", { length: 40 }).notNull(),
  entityId: integer("entity_id").notNull(),
  materialsCost: numeric("materials_cost", { precision: 16, scale: 2 }).notNull().default("0"),
  transportCost: numeric("transport_cost", { precision: 16, scale: 2 }).notNull().default("0"),
  fuelCost: numeric("fuel_cost", { precision: 16, scale: 2 }).notNull().default("0"),
  laborCost: numeric("labor_cost", { precision: 16, scale: 2 }).notNull().default("0"),
  depreciationCost: numeric("depreciation_cost", { precision: 16, scale: 2 }).notNull().default("0"),
  expectedRevenue: numeric("expected_revenue", { precision: 16, scale: 2 }).notNull().default("0"),
  expectedProfit: numeric("expected_profit", { precision: 16, scale: 2 }).notNull().default("0"),
  profitMargin: numeric("profit_margin", { precision: 7, scale: 2 }).notNull().default("0"),
  warning: text("warning"),
  createdBy: integer("created_by").references(() => staffTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  entityIdx: uniqueIndex("event_cost_estimates_entity_idx").on(table.entityType, table.entityId),
}));

export const warehouseCameraSnapshotsTable = pgTable("warehouse_camera_snapshots", {
  id: serial("id").primaryKey(),
  warehouseId: integer("warehouse_id").references(() => warehousesTable.id, { onDelete: "set null" }),
  entityType: varchar("entity_type", { length: 40 }),
  entityId: integer("entity_id"),
  movementType: varchar("movement_type", { length: 24 }).notNull().default("checkout"),
  imageUrl: text("image_url").notNull(),
  capturedBy: integer("captured_by").references(() => staffTable.id, { onDelete: "set null" }),
  capturedAt: timestamp("captured_at").notNull().defaultNow(),
}, (table) => ({
  entityIdx: index("warehouse_camera_snapshots_entity_idx").on(table.entityType, table.entityId, table.capturedAt),
}));

export const designLibraryItemsTable = pgTable("design_library_items", {
  id: serial("id").primaryKey(),
  type: varchar("type", { length: 30 }).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  images: jsonb("images").$type<string[]>().notNull().default([]),
  materialProductIds: jsonb("material_product_ids").$type<number[]>().notNull().default([]),
  executionCost: numeric("execution_cost", { precision: 16, scale: 2 }).notNull().default("0"),
  executionMinutes: integer("execution_minutes").notNull().default(0),
  orderCount: integer("order_count").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: integer("created_by").references(() => staffTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  typeIdx: index("design_library_items_type_idx").on(table.type, table.isActive),
}));

export const dailyClosingChecklistsTable = pgTable("daily_closing_checklists", {
  id: serial("id").primaryKey(),
  closingDate: date("closing_date").notNull(),
  branchCode: varchar("branch_code", { length: 30 }).notNull().default("MAIN"),
  equipmentReturned: boolean("equipment_returned").notNull().default(false),
  paymentsApproved: boolean("payments_approved").notNull().default(false),
  bookingsClosed: boolean("bookings_closed").notNull().default(false),
  cashClosed: boolean("cash_closed").notNull().default(false),
  backupCompleted: boolean("backup_completed").notNull().default(false),
  notes: text("notes"),
  status: varchar("status", { length: 20 }).notNull().default("open"),
  closedBy: integer("closed_by").references(() => staffTable.id, { onDelete: "set null" }),
  closedByName: text("closed_by_name").notNull().default(""),
  closedAt: timestamp("closed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  dateBranchIdx: uniqueIndex("daily_closing_checklists_date_branch_idx").on(table.closingDate, table.branchCode),
}));

export const knowledgeArticlesTable = pgTable("knowledge_articles", {
  id: serial("id").primaryKey(),
  category: varchar("category", { length: 40 }).notNull().default("general"),
  title: text("title").notNull(),
  content: text("content").notNull(),
  videoUrl: text("video_url"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: integer("created_by").references(() => staffTable.id, { onDelete: "set null" }),
  createdByName: text("created_by_name").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  searchIdx: index("knowledge_articles_category_idx").on(table.category, table.isActive),
}));

export const knowledgeCasesTable = pgTable("knowledge_cases", {
  id: serial("id").primaryKey(),
  problem: text("problem").notNull(),
  solution: text("solution").notNull(),
  entityType: varchar("entity_type", { length: 40 }),
  entityId: integer("entity_id"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  timesReused: integer("times_reused").notNull().default(0),
  createdBy: integer("created_by").references(() => staffTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  entityIdx: index("knowledge_cases_entity_idx").on(table.entityType, table.entityId),
}));

export const managementDecisionsTable = pgTable("management_decisions", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  decision: text("decision").notNull(),
  reason: text("reason").notNull(),
  entityType: varchar("entity_type", { length: 40 }),
  entityId: integer("entity_id"),
  decidedBy: integer("decided_by").references(() => staffTable.id, { onDelete: "set null" }),
  decidedByName: text("decided_by_name").notNull().default(""),
  decidedAt: timestamp("decided_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  decidedAtIdx: index("management_decisions_date_idx").on(table.decidedAt),
  entityIdx: index("management_decisions_entity_idx").on(table.entityType, table.entityId),
}));

export const customerAttributionsTable = pgTable("customer_attributions", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").references(() => customersTable.id, { onDelete: "cascade" }),
  phone: varchar("phone", { length: 30 }),
  source: varchar("source", { length: 30 }).notNull(),
  campaign: text("campaign"),
  entityType: varchar("entity_type", { length: 40 }),
  entityId: integer("entity_id"),
  createdBy: integer("created_by").references(() => staffTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  sourceIdx: index("customer_attributions_source_idx").on(table.source, table.createdAt),
  customerIdx: index("customer_attributions_customer_idx").on(table.customerId, table.createdAt),
}));

export type EnterpriseBranch = typeof enterpriseBranchesTable.$inferSelect;
export type FleetVehicle = typeof fleetVehiclesTable.$inferSelect;
export type DispatchAssignment = typeof dispatchAssignmentsTable.$inferSelect;
export type AssetPassport = typeof assetPassportsTable.$inferSelect;
export type EmployeeCustodyGroup = typeof employeeCustodyGroupsTable.$inferSelect;
