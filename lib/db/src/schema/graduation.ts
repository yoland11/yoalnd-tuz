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
import { relations } from "drizzle-orm";
import { customersTable } from "./customers";
import { productsTable } from "./products";
import { staffTable } from "./staff";

export const graduationGroupsTable = pgTable(
  "graduation_groups",
  {
    id: serial("id").primaryKey(),
    groupNo: varchar("group_no", { length: 50 }).notNull(),
    joinToken: varchar("join_token", { length: 96 }).notNull(),
    title: text("title").notNull(),
    representativeName: text("representative_name").notNull().default(""),
    representativePhone: varchar("representative_phone", { length: 30 })
      .notNull()
      .default(""),
    university: text("university"),
    college: text("college"),
    department: text("department"),
    graduationYear: varchar("graduation_year", { length: 10 }),
    eventDate: date("event_date"),
    defaultConfiguration: jsonb("default_configuration")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    status: varchar("status", { length: 24 }).notNull().default("open"),
    expiresAt: timestamp("expires_at"),
    createdBy: integer("created_by").references(() => staffTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("graduation_groups_no_idx").on(table.groupNo),
    uniqueIndex("graduation_groups_token_idx").on(table.joinToken),
    index("graduation_groups_status_idx").on(table.status),
  ],
);

export const graduationOrdersTable = pgTable(
  "graduation_orders",
  {
    id: serial("id").primaryKey(),
    orderNo: varchar("order_no", { length: 50 }).notNull(),
    qrToken: varchar("qr_token", { length: 96 }).notNull(),
    customerId: integer("customer_id").references(() => customersTable.id, {
      onDelete: "set null",
    }),
    groupId: integer("group_id").references(() => graduationGroupsTable.id, {
      onDelete: "set null",
    }),
    customerName: text("customer_name").notNull(),
    phone: varchar("phone", { length: 30 }).notNull(),
    phoneLast4: varchar("phone_last4", { length: 4 }),
    status: varchar("status", { length: 30 }).notNull().default("draft"),
    productionStage: varchar("production_stage", { length: 40 })
      .notNull()
      .default("new"),
    styleKey: varchar("style_key", { length: 60 })
      .notNull()
      .default("standard"),
    packageKey: varchar("package_key", { length: 60 }),
    measurements: jsonb("measurements")
      .$type<Record<string, string | number | null>>()
      .notNull()
      .default({}),
    colors: jsonb("colors")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    fabric: jsonb("fabric")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    decoration: jsonb("decoration")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    customText: jsonb("custom_text")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    accessories: jsonb("accessories").$type<string[]>().notNull().default([]),
    universityTemplate: jsonb("university_template")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    previewAssets: jsonb("preview_assets")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    inventoryItems: jsonb("inventory_items")
      .$type<Array<{ productId: number; quantity: number; label: string }>>()
      .notNull()
      .default([]),
    pricing: jsonb("pricing")
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    subtotal: numeric("subtotal", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    discountAmount: numeric("discount_amount", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    totalAmount: numeric("total_amount", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    paidAmount: numeric("paid_amount", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    remainingAmount: numeric("remaining_amount", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    paymentMethod: varchar("payment_method", { length: 20 })
      .notNull()
      .default("cash"),
    paymentStatus: varchar("payment_status", { length: 20 })
      .notNull()
      .default("unpaid"),
    invoiceId: integer("invoice_id"),
    financialTransactionId: integer("financial_transaction_id"),
    inventoryApplied: boolean("inventory_applied").notNull().default(false),
    productionEstimate: jsonb("production_estimate")
      .$type<Record<string, number | string>>()
      .notNull()
      .default({}),
    qualityChecklist: jsonb("quality_checklist")
      .$type<Record<string, boolean>>()
      .notNull()
      .default({}),
    designApprovedAt: timestamp("design_approved_at"),
    assignedStaffId: integer("assigned_staff_id").references(
      () => staffTable.id,
      { onDelete: "set null" },
    ),
    delivery: jsonb("delivery")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    dueDate: date("due_date"),
    notes: text("notes"),
    internalNotes: text("internal_notes"),
    submittedAt: timestamp("submitted_at"),
    readyAt: timestamp("ready_at"),
    deliveredAt: timestamp("delivered_at"),
    archivedAt: timestamp("archived_at"),
    createdBy: integer("created_by").references(() => staffTable.id, {
      onDelete: "set null",
    }),
    createdByName: text("created_by_name").notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("graduation_orders_no_idx").on(table.orderNo),
    uniqueIndex("graduation_orders_qr_token_idx").on(table.qrToken),
    index("graduation_orders_phone_idx").on(table.phone),
    index("graduation_orders_customer_idx").on(table.customerId),
    index("graduation_orders_group_idx").on(table.groupId),
    index("graduation_orders_status_idx").on(table.status),
    index("graduation_orders_stage_idx").on(table.productionStage),
    index("graduation_orders_due_idx").on(table.dueDate),
    index("graduation_orders_created_idx").on(table.createdAt),
  ],
);

export const graduationResourcesTable = pgTable(
  "graduation_resources",
  {
    id: serial("id").primaryKey(),
    resourceType: varchar("resource_type", { length: 30 }).notNull(),
    code: varchar("code", { length: 80 }).notNull(),
    name: text("name").notNull(),
    productId: integer("product_id").references(() => productsTable.id, {
      onDelete: "set null",
    }),
    operatorId: integer("operator_id").references(() => staffTable.id, {
      onDelete: "set null",
    }),
    operatorName: text("operator_name").notNull().default(""),
    status: varchar("status", { length: 30 }).notNull().default("available"),
    metrics: jsonb("metrics")
      .$type<Record<string, string | number | boolean | null>>()
      .notNull()
      .default({}),
    usageCount: integer("usage_count").notNull().default(0),
    maintenanceDueAt: timestamp("maintenance_due_at"),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: integer("created_by").references(() => staffTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("graduation_resources_code_idx").on(table.code),
    index("graduation_resources_type_idx").on(table.resourceType),
    index("graduation_resources_status_idx").on(table.status),
    index("graduation_resources_product_idx").on(table.productId),
  ],
);

export const graduationGroupsRelations = relations(
  graduationGroupsTable,
  ({ many, one }) => ({
    orders: many(graduationOrdersTable),
    creator: one(staffTable, {
      fields: [graduationGroupsTable.createdBy],
      references: [staffTable.id],
    }),
  }),
);

export const graduationOrdersRelations = relations(
  graduationOrdersTable,
  ({ one }) => ({
    customer: one(customersTable, {
      fields: [graduationOrdersTable.customerId],
      references: [customersTable.id],
    }),
    group: one(graduationGroupsTable, {
      fields: [graduationOrdersTable.groupId],
      references: [graduationGroupsTable.id],
    }),
    assignedStaff: one(staffTable, {
      fields: [graduationOrdersTable.assignedStaffId],
      references: [staffTable.id],
    }),
    creator: one(staffTable, {
      fields: [graduationOrdersTable.createdBy],
      references: [staffTable.id],
    }),
  }),
);

export const graduationResourcesRelations = relations(
  graduationResourcesTable,
  ({ one }) => ({
    product: one(productsTable, {
      fields: [graduationResourcesTable.productId],
      references: [productsTable.id],
    }),
    operator: one(staffTable, {
      fields: [graduationResourcesTable.operatorId],
      references: [staffTable.id],
    }),
  }),
);

export type GraduationOrder = typeof graduationOrdersTable.$inferSelect;
export type GraduationGroup = typeof graduationGroupsTable.$inferSelect;
export type GraduationResource = typeof graduationResourcesTable.$inferSelect;
