import { boolean, date, integer, jsonb, numeric, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { customersTable } from "./customers";
import { productsTable } from "./products";
import { salesInvoicesTable } from "./sales-invoices";
import { serviceOrdersTable } from "./services";
import { staffTable } from "./staff";

/**
 * Album Management (إدارة الألبومات). Created by the reviewed additive
 * migration 0141_album_management.sql. Payments live on the linked sales
 * invoice (canonical payment state); these rows keep the order, its stages,
 * copies, consumed materials and manufacturing costs.
 */
export const albumCatalogOptionsTable = pgTable("album_catalog_options", {
  id: serial("id").primaryKey(),
  kind: varchar("kind", { length: 20 }).notNull(),
  label: text("label").notNull(),
  defaultPrice: numeric("default_price", { precision: 14, scale: 2 }).notNull().default("0"),
  manufacturingCost: numeric("manufacturing_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  productId: integer("product_id").references(() => productsTable.id, { onDelete: "set null" }),
  materialQuantity: numeric("material_quantity", { precision: 12, scale: 3 }).notNull().default("1"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: integer("created_by").references(() => staffTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const albumOrdersTable = pgTable("album_orders", {
  id: serial("id").primaryKey(),
  albumNo: varchar("album_no", { length: 30 }).notNull(),
  qrToken: varchar("qr_token", { length: 64 }).notNull(),
  barcodeValue: varchar("barcode_value", { length: 40 }).notNull(),
  creationKey: varchar("creation_key", { length: 180 }),
  customerId: integer("customer_id").references(() => customersTable.id, { onDelete: "restrict" }),
  customerName: text("customer_name").notNull(),
  phone: varchar("phone", { length: 30 }).notNull().default(""),
  bookingId: integer("booking_id").references(() => serviceOrdersTable.id, { onDelete: "set null" }),
  occasionType: text("occasion_type"),
  albumType: text("album_type").notNull(),
  albumSize: text("album_size").notNull(),
  pageCount: integer("page_count"),
  photoCount: integer("photo_count"),
  copies: integer("copies").notNull().default(1),
  coverType: text("cover_type"),
  coverColor: text("cover_color"),
  paperType: text("paper_type"),
  boxType: text("box_type"),
  coverNames: text("cover_names"),
  occasionDate: date("occasion_date", { mode: "string" }),
  orderDate: date("order_date", { mode: "string" }).notNull(),
  dueDate: date("due_date", { mode: "string" }),
  designerStaffId: integer("designer_staff_id").references(() => staffTable.id, { onDelete: "set null" }),
  printerStaffId: integer("printer_staff_id").references(() => staffTable.id, { onDelete: "set null" }),
  binderStaffId: integer("binder_staff_id").references(() => staffTable.id, { onDelete: "set null" }),
  qualityStaffId: integer("quality_staff_id").references(() => staffTable.id, { onDelete: "set null" }),
  customerNotes: text("customer_notes"),
  internalNotes: text("internal_notes"),
  attachments: jsonb("attachments").$type<Array<{ url: string; fileName?: string; mediaType?: string }>>().notNull().default([]),
  stage: varchar("stage", { length: 30 }).notNull().default("received"),
  stageChangedAt: timestamp("stage_changed_at").notNull().defaultNow(),
  financeMode: varchar("finance_mode", { length: 20 }).notNull().default("invoice"),
  invoiceId: integer("invoice_id").references(() => salesInvoicesTable.id, { onDelete: "set null" }),
  salePrice: numeric("sale_price", { precision: 14, scale: 2 }).notNull().default("0"),
  designCost: numeric("design_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  printingCost: numeric("printing_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  coverCost: numeric("cover_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  bindingCost: numeric("binding_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  extraCosts: numeric("extra_costs", { precision: 14, scale: 2 }).notNull().default("0"),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  deliveredAt: timestamp("delivered_at"),
  deliveredToName: text("delivered_to_name"),
  deliveryPhotoUrl: text("delivery_photo_url"),
  deliverySignatureUrl: text("delivery_signature_url"),
  deliveredBy: integer("delivered_by").references(() => staffTable.id, { onDelete: "set null" }),
  deliveredByName: text("delivered_by_name"),
  cancelledAt: timestamp("cancelled_at"),
  cancelledBy: integer("cancelled_by").references(() => staffTable.id, { onDelete: "set null" }),
  cancelReason: text("cancel_reason"),
  createdBy: integer("created_by").references(() => staffTable.id, { onDelete: "set null" }),
  createdByName: text("created_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const albumOrderEventsTable = pgTable("album_order_events", {
  id: serial("id").primaryKey(),
  albumId: integer("album_id").notNull().references(() => albumOrdersTable.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 30 }).notNull(),
  fromStage: varchar("from_stage", { length: 30 }),
  toStage: varchar("to_stage", { length: 30 }),
  note: text("note"),
  attachments: jsonb("attachments").$type<Array<{ url: string; fileName?: string; mediaType?: string }>>().notNull().default([]),
  staffId: integer("staff_id").references(() => staffTable.id, { onDelete: "set null" }),
  staffName: text("staff_name").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const albumCopiesTable = pgTable("album_copies", {
  id: serial("id").primaryKey(),
  albumId: integer("album_id").notNull().references(() => albumOrdersTable.id, { onDelete: "cascade" }),
  copyNo: integer("copy_no").notNull(),
  code: varchar("code", { length: 40 }).notNull(),
  qrToken: varchar("qr_token", { length: 64 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const albumMaterialsTable = pgTable("album_materials", {
  id: serial("id").primaryKey(),
  albumId: integer("album_id").notNull().references(() => albumOrdersTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").notNull().references(() => productsTable.id, { onDelete: "restrict" }),
  productName: text("product_name").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
  unitCost: numeric("unit_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  requestKey: varchar("request_key", { length: 160 }).notNull(),
  returnedAt: timestamp("returned_at"),
  returnedBy: integer("returned_by").references(() => staffTable.id, { onDelete: "set null" }),
  createdBy: integer("created_by").references(() => staffTable.id, { onDelete: "set null" }),
  createdByName: text("created_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const albumTasksTable = pgTable("album_tasks", {
  id: serial("id").primaryKey(),
  albumId: integer("album_id").notNull().references(() => albumOrdersTable.id, { onDelete: "cascade" }),
  role: varchar("role", { length: 20 }).notNull(),
  staffId: integer("staff_id").notNull().references(() => staffTable.id, { onDelete: "restrict" }),
  taskId: integer("task_id"),
  createdBy: integer("created_by").references(() => staffTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AlbumOrder = typeof albumOrdersTable.$inferSelect;
export type AlbumCatalogOption = typeof albumCatalogOptionsTable.$inferSelect;
