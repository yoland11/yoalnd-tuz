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

export const graduationTemplatesTable = pgTable(
  "graduation_templates",
  {
    id: serial("id").primaryKey(),
    code: varchar("code", { length: 80 }).notNull(),
    name: text("name").notNull(),
    templateType: varchar("template_type", { length: 40 })
      .notNull()
      .default("package"),
    university: text("university"),
    college: text("college"),
    department: text("department"),
    previewImageUrl: text("preview_image_url"),
    modelUrl: text("model_url"),
    currentVersion: integer("current_version").notNull().default(1),
    defaultPrice: numeric("default_price", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    // Additive product economics (Hybrid model): scalar accounting/inventory
    // fields live as real columns; per-type attributes (sizes, colors, print,
    // tassel, size chart, production time…) stay inside `configuration`.
    costPrice: numeric("cost_price", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    discountPrice: numeric("discount_price", { precision: 14, scale: 2 }),
    sku: varchar("sku", { length: 80 }),
    barcode: varchar("barcode", { length: 120 }),
    trackStock: boolean("track_stock").notNull().default(false),
    stock: integer("stock").notNull().default(0),
    minStock: integer("min_stock").notNull().default(0),
    images: jsonb("images").$type<string[]>().notNull().default([]),
    configuration: jsonb("configuration")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    isActive: boolean("is_active").notNull().default(true),
    isFeatured: boolean("is_featured").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: timestamp("archived_at"),
    createdBy: integer("created_by").references(() => staffTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("graduation_templates_code_idx").on(table.code),
    index("graduation_templates_type_idx").on(table.templateType),
    index("graduation_templates_active_idx").on(table.isActive),
  ],
);

export const graduationTemplateVersionsTable = pgTable(
  "graduation_template_versions",
  {
    id: serial("id").primaryKey(),
    templateId: integer("template_id")
      .notNull()
      .references(() => graduationTemplatesTable.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdBy: integer("created_by").references(() => staffTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("graduation_template_versions_unique_idx").on(
      table.templateId,
      table.version,
    ),
    index("graduation_template_versions_template_idx").on(table.templateId),
  ],
);

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
    groupCreditAmount: numeric("group_credit_amount", {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default("0"),
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
    studentCode: varchar("student_code", { length: 80 }),
    orderType: varchar("order_type", { length: 20 })
      .notNull()
      .default("individual"),
    qrToken: varchar("qr_token", { length: 96 }).notNull(),
    barcodeValue: varchar("barcode_value", { length: 120 }),
    receiptNo: varchar("receipt_no", { length: 80 }),
    customerId: integer("customer_id").references(() => customersTable.id, {
      onDelete: "set null",
    }),
    groupId: integer("group_id").references(() => graduationGroupsTable.id, {
      onDelete: "set null",
    }),
    customerName: text("customer_name").notNull(),
    phone: varchar("phone", { length: 30 }).notNull(),
    phone2: varchar("phone_2", { length: 30 }),
    phoneLast4: varchar("phone_last4", { length: 4 }),
    status: varchar("status", { length: 30 }).notNull().default("draft"),
    productionStage: varchar("production_stage", { length: 40 })
      .notNull()
      .default("new"),
    styleKey: varchar("style_key", { length: 60 })
      .notNull()
      .default("standard"),
    packageKey: varchar("package_key", { length: 60 }),
    studentProfile: jsonb("student_profile")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    garmentDetails: jsonb("garment_details")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    templateVersionId: integer("template_version_id").references(
      () => graduationTemplateVersionsTable.id,
      { onDelete: "set null" },
    ),
    templateSnapshot: jsonb("template_snapshot")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
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
    // Graduation Extras (Phase 1): photography-session snapshot + linked
    // service_order id. Flowers live in graduation_order_items (itemType 'flower'),
    // so only the photography link/snapshot is stored here. Existing orders → {}.
    extras: jsonb("extras")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    universityTemplate: jsonb("university_template")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    previewAssets: jsonb("preview_assets")
      .$type<Record<string, unknown>>()
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
    // Post-creation group accessories contribution (Phase 1 accessories). Kept
    // separate from `subtotal` (base package) so recalc never double-counts and
    // existing orders (default 0) keep their original totals untouched.
    accessoriesTotal: numeric("accessories_total", { precision: 14, scale: 2 })
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
    uniqueIndex("graduation_orders_student_code_idx").on(table.studentCode),
    uniqueIndex("graduation_orders_receipt_no_idx").on(table.receiptNo),
    uniqueIndex("graduation_orders_qr_token_idx").on(table.qrToken),
    index("graduation_orders_phone_idx").on(table.phone),
    index("graduation_orders_customer_idx").on(table.customerId),
    index("graduation_orders_group_idx").on(table.groupId),
    index("graduation_orders_status_idx").on(table.status),
    index("graduation_orders_stage_idx").on(table.productionStage),
    index("graduation_orders_due_idx").on(table.dueDate),
    index("graduation_orders_created_idx").on(table.createdAt),
    index("graduation_orders_barcode_idx").on(table.barcodeValue),
  ],
);

// One row per selected custom-package piece (gown / sash / cap / accessory).
// Every row is a price + customization SNAPSHOT taken at order time so future
// product price changes never alter past orders.
export const graduationOrderItemsTable = pgTable(
  "graduation_order_items",
  {
    id: serial("id").primaryKey(),
    graduationOrderId: integer("graduation_order_id")
      .notNull()
      .references(() => graduationOrdersTable.id, { onDelete: "cascade" }),
    groupId: integer("group_id").references(() => graduationGroupsTable.id, {
      onDelete: "set null",
    }),
    itemType: varchar("item_type", { length: 30 }).notNull().default("custom"),
    templateId: integer("template_id").references(
      () => graduationTemplatesTable.id,
      { onDelete: "set null" },
    ),
    productId: integer("product_id").references(() => productsTable.id, {
      onDelete: "set null",
    }),
    productName: text("product_name").notNull().default(""),
    productSku: varchar("product_sku", { length: 80 }),
    variantLabel: text("variant_label"),
    size: varchar("size", { length: 60 }),
    color: varchar("color", { length: 80 }),
    quantity: numeric("quantity", { precision: 12, scale: 3 })
      .notNull()
      .default("1"),
    originalUnitPrice: numeric("original_unit_price", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    finalUnitPrice: numeric("final_unit_price", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    customizationCharge: numeric("customization_charge", {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default("0"),
    lineTotal: numeric("line_total", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    customization: jsonb("customization")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    imageUrl: text("image_url"),
    snapshot: jsonb("snapshot")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    notes: text("notes"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("graduation_order_items_order_idx").on(
      table.graduationOrderId,
      table.sortOrder,
    ),
    index("graduation_order_items_template_idx").on(table.templateId),
  ],
);

export const graduationGroupStudentsTable = pgTable(
  "graduation_group_students",
  {
    id: serial("id").primaryKey(),
    groupId: integer("group_id")
      .notNull()
      .references(() => graduationGroupsTable.id, { onDelete: "cascade" }),
    graduationOrderId: integer("graduation_order_id")
      .notNull()
      .references(() => graduationOrdersTable.id, { onDelete: "cascade" }),
    customerId: integer("customer_id").references(() => customersTable.id, {
      onDelete: "set null",
    }),
    templateVersionId: integer("template_version_id").references(
      () => graduationTemplateVersionsTable.id,
      { onDelete: "set null" },
    ),
    studentCode: varchar("student_code", { length: 80 }).notNull(),
    sequence: integer("sequence").notNull(),
    isDesignLocked: boolean("is_design_locked").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("graduation_group_students_order_idx").on(
      table.graduationOrderId,
    ),
    uniqueIndex("graduation_group_students_code_idx").on(table.studentCode),
    uniqueIndex("graduation_group_students_sequence_idx").on(
      table.groupId,
      table.sequence,
    ),
    index("graduation_group_students_group_idx").on(table.groupId),
  ],
);

export const graduationStudentPaymentsTable = pgTable(
  "graduation_student_payments",
  {
    id: serial("id").primaryKey(),
    paymentBatchId: varchar("payment_batch_id", { length: 96 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 120 }).notNull(),
    graduationOrderId: integer("graduation_order_id").references(
      () => graduationOrdersTable.id,
      { onDelete: "set null" },
    ),
    groupId: integer("group_id").references(() => graduationGroupsTable.id, {
      onDelete: "set null",
    }),
    customerId: integer("customer_id").references(() => customersTable.id, {
      onDelete: "set null",
    }),
    amount: numeric("amount", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    paymentMethod: varchar("payment_method", { length: 30 })
      .notNull()
      .default("cash"),
    allocationStrategy: varchar("allocation_strategy", { length: 40 })
      .notNull()
      .default("individual"),
    receiptVoucherId: integer("receipt_voucher_id"),
    financialTransactionId: integer("financial_transaction_id"),
    notes: text("notes"),
    receivedBy: integer("received_by").references(() => staffTable.id, {
      onDelete: "set null",
    }),
    receivedByName: text("received_by_name").notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("graduation_student_payments_idempotency_idx").on(
      table.idempotencyKey,
    ),
    index("graduation_student_payments_order_idx").on(table.graduationOrderId),
    index("graduation_student_payments_group_idx").on(table.groupId),
    index("graduation_student_payments_batch_idx").on(table.paymentBatchId),
  ],
);

export const graduationReceiptsTable = pgTable(
  "graduation_receipts",
  {
    id: serial("id").primaryKey(),
    receiptNo: varchar("receipt_no", { length: 80 }).notNull(),
    receiptType: varchar("receipt_type", { length: 30 })
      .notNull()
      .default("student"),
    graduationOrderId: integer("graduation_order_id").references(
      () => graduationOrdersTable.id,
      { onDelete: "set null" },
    ),
    groupId: integer("group_id").references(() => graduationGroupsTable.id, {
      onDelete: "set null",
    }),
    paymentId: integer("payment_id").references(
      () => graduationStudentPaymentsTable.id,
      { onDelete: "set null" },
    ),
    snapshot: jsonb("snapshot")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    reprintCount: integer("reprint_count").notNull().default(0),
    issuedBy: integer("issued_by").references(() => staffTable.id, {
      onDelete: "set null",
    }),
    issuedByName: text("issued_by_name").notNull().default(""),
    issuedAt: timestamp("issued_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("graduation_receipts_no_idx").on(table.receiptNo),
    index("graduation_receipts_order_idx").on(table.graduationOrderId),
    index("graduation_receipts_group_idx").on(table.groupId),
  ],
);

export const graduationPreviewsTable = pgTable(
  "graduation_previews",
  {
    id: serial("id").primaryKey(),
    graduationOrderId: integer("graduation_order_id")
      .notNull()
      .references(() => graduationOrdersTable.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: varchar("status", { length: 30 }).notNull().default("ready"),
    assets: jsonb("assets")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    configurationSnapshot: jsonb("configuration_snapshot")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    generatedBy: integer("generated_by").references(() => staffTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("graduation_previews_order_version_idx").on(
      table.graduationOrderId,
      table.version,
    ),
    index("graduation_previews_order_idx").on(table.graduationOrderId),
  ],
);

export const graduationApprovalsTable = pgTable(
  "graduation_approvals",
  {
    id: serial("id").primaryKey(),
    graduationOrderId: integer("graduation_order_id")
      .notNull()
      .references(() => graduationOrdersTable.id, { onDelete: "cascade" }),
    previewId: integer("preview_id").references(
      () => graduationPreviewsTable.id,
      { onDelete: "set null" },
    ),
    approvalToken: varchar("approval_token", { length: 96 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("pending"),
    note: text("note"),
    signatureDataUrl: text("signature_data_url"),
    approvedVersion: integer("approved_version"),
    respondedAt: timestamp("responded_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("graduation_approvals_token_idx").on(table.approvalToken),
    index("graduation_approvals_order_idx").on(table.graduationOrderId),
  ],
);

export const graduationProductionEventsTable = pgTable(
  "graduation_production_events",
  {
    id: serial("id").primaryKey(),
    graduationOrderId: integer("graduation_order_id")
      .notNull()
      .references(() => graduationOrdersTable.id, { onDelete: "cascade" }),
    stage: varchar("stage", { length: 40 }).notNull(),
    previousStage: varchar("previous_stage", { length: 40 }),
    scanType: varchar("scan_type", { length: 40 }),
    evidenceUrl: text("evidence_url"),
    notes: text("notes"),
    employeeId: integer("employee_id").references(() => staffTable.id, {
      onDelete: "set null",
    }),
    employeeName: text("employee_name").notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("graduation_production_events_order_idx").on(
      table.graduationOrderId,
    ),
    index("graduation_production_events_stage_idx").on(table.stage),
  ],
);

export const graduationDeliveryEventsTable = pgTable(
  "graduation_delivery_events",
  {
    id: serial("id").primaryKey(),
    graduationOrderId: integer("graduation_order_id")
      .notNull()
      .references(() => graduationOrdersTable.id, { onDelete: "cascade" }),
    groupId: integer("group_id").references(() => graduationGroupsTable.id, {
      onDelete: "set null",
    }),
    sessionCode: varchar("session_code", { length: 80 }),
    status: varchar("status", { length: 30 }).notNull().default("delivered"),
    deliveredBy: integer("delivered_by").references(() => staffTable.id, {
      onDelete: "set null",
    }),
    deliveredByName: text("delivered_by_name").notNull().default(""),
    receivedBy: text("received_by"),
    signatureDataUrl: text("signature_data_url"),
    packageImageUrl: text("package_image_url"),
    balanceConfirmed: boolean("balance_confirmed").notNull().default(false),
    verification: jsonb("verification")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("graduation_delivery_events_order_idx").on(
      table.graduationOrderId,
    ),
    index("graduation_delivery_events_group_idx").on(table.groupId),
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
    students: many(graduationGroupStudentsTable),
    payments: many(graduationStudentPaymentsTable),
    receipts: many(graduationReceiptsTable),
    creator: one(staffTable, {
      fields: [graduationGroupsTable.createdBy],
      references: [staffTable.id],
    }),
  }),
);

export const graduationOrdersRelations = relations(
  graduationOrdersTable,
  ({ many, one }) => ({
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
    templateVersion: one(graduationTemplateVersionsTable, {
      fields: [graduationOrdersTable.templateVersionId],
      references: [graduationTemplateVersionsTable.id],
    }),
    groupStudent: one(graduationGroupStudentsTable),
    payments: many(graduationStudentPaymentsTable),
    receipts: many(graduationReceiptsTable),
    previews: many(graduationPreviewsTable),
    approvals: many(graduationApprovalsTable),
    productionEvents: many(graduationProductionEventsTable),
    deliveryEvents: many(graduationDeliveryEventsTable),
    items: many(graduationOrderItemsTable),
  }),
);

export const graduationOrderItemsRelations = relations(
  graduationOrderItemsTable,
  ({ one }) => ({
    order: one(graduationOrdersTable, {
      fields: [graduationOrderItemsTable.graduationOrderId],
      references: [graduationOrdersTable.id],
    }),
    template: one(graduationTemplatesTable, {
      fields: [graduationOrderItemsTable.templateId],
      references: [graduationTemplatesTable.id],
    }),
    product: one(productsTable, {
      fields: [graduationOrderItemsTable.productId],
      references: [productsTable.id],
    }),
  }),
);

export const graduationTemplatesRelations = relations(
  graduationTemplatesTable,
  ({ many, one }) => ({
    versions: many(graduationTemplateVersionsTable),
    creator: one(staffTable, {
      fields: [graduationTemplatesTable.createdBy],
      references: [staffTable.id],
    }),
  }),
);

export const graduationTemplateVersionsRelations = relations(
  graduationTemplateVersionsTable,
  ({ many, one }) => ({
    template: one(graduationTemplatesTable, {
      fields: [graduationTemplateVersionsTable.templateId],
      references: [graduationTemplatesTable.id],
    }),
    orders: many(graduationOrdersTable),
    groupStudents: many(graduationGroupStudentsTable),
  }),
);

export const graduationGroupStudentsRelations = relations(
  graduationGroupStudentsTable,
  ({ one }) => ({
    group: one(graduationGroupsTable, {
      fields: [graduationGroupStudentsTable.groupId],
      references: [graduationGroupsTable.id],
    }),
    order: one(graduationOrdersTable, {
      fields: [graduationGroupStudentsTable.graduationOrderId],
      references: [graduationOrdersTable.id],
    }),
    customer: one(customersTable, {
      fields: [graduationGroupStudentsTable.customerId],
      references: [customersTable.id],
    }),
  }),
);

export const graduationStudentPaymentsRelations = relations(
  graduationStudentPaymentsTable,
  ({ one }) => ({
    order: one(graduationOrdersTable, {
      fields: [graduationStudentPaymentsTable.graduationOrderId],
      references: [graduationOrdersTable.id],
    }),
    group: one(graduationGroupsTable, {
      fields: [graduationStudentPaymentsTable.groupId],
      references: [graduationGroupsTable.id],
    }),
  }),
);

export const graduationReceiptsRelations = relations(
  graduationReceiptsTable,
  ({ one }) => ({
    order: one(graduationOrdersTable, {
      fields: [graduationReceiptsTable.graduationOrderId],
      references: [graduationOrdersTable.id],
    }),
    group: one(graduationGroupsTable, {
      fields: [graduationReceiptsTable.groupId],
      references: [graduationGroupsTable.id],
    }),
    payment: one(graduationStudentPaymentsTable, {
      fields: [graduationReceiptsTable.paymentId],
      references: [graduationStudentPaymentsTable.id],
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
export type GraduationTemplate = typeof graduationTemplatesTable.$inferSelect;
export type GraduationTemplateVersion =
  typeof graduationTemplateVersionsTable.$inferSelect;
export type GraduationGroupStudent =
  typeof graduationGroupStudentsTable.$inferSelect;
export type GraduationStudentPayment =
  typeof graduationStudentPaymentsTable.$inferSelect;
export type GraduationReceipt = typeof graduationReceiptsTable.$inferSelect;
export type GraduationOrderItem =
  typeof graduationOrderItemsTable.$inferSelect;
