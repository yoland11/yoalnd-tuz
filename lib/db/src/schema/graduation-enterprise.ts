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
import {
  graduationGroupsTable,
  graduationOrdersTable,
  graduationTemplatesTable,
  graduationTemplateVersionsTable,
} from "./graduation";
import { productsTable } from "./products";
import { staffTable } from "./staff";

export const graduationPackagesTable = pgTable(
  "graduation_packages",
  {
    id: serial("id").primaryKey(),
    code: varchar("code", { length: 80 }).notNull(),
    name: text("name").notNull(),
    description: text("description"),
    previewImageUrl: text("preview_image_url"),
    templateId: integer("template_id").references(
      () => graduationTemplatesTable.id,
      { onDelete: "set null" },
    ),
    templateVersionId: integer("template_version_id").references(
      () => graduationTemplateVersionsTable.id,
      { onDelete: "set null" },
    ),
    configuration: jsonb("configuration")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    defaultPrice: numeric("default_price", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    defaultCost: numeric("default_cost", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    discountAmount: numeric("discount_amount", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    productionDays: integer("production_days").notNull().default(7),
    isActive: boolean("is_active").notNull().default(true),
    isFeatured: boolean("is_featured").notNull().default(false),
    isArchived: boolean("is_archived").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: integer("created_by").references(() => staffTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("graduation_packages_code_idx").on(table.code),
    index("graduation_packages_active_idx").on(
      table.isActive,
      table.isArchived,
      table.sortOrder,
    ),
  ],
);

export const graduationPackageItemsTable = pgTable(
  "graduation_package_items",
  {
    id: serial("id").primaryKey(),
    packageId: integer("package_id")
      .notNull()
      .references(() => graduationPackagesTable.id, { onDelete: "cascade" }),
    itemType: varchar("item_type", { length: 30 }).notNull(),
    templateId: integer("template_id").references(
      () => graduationTemplatesTable.id,
      { onDelete: "set null" },
    ),
    productId: integer("product_id").references(() => productsTable.id, {
      onDelete: "set null",
    }),
    code: varchar("code", { length: 100 }),
    name: text("name").notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 3 })
      .notNull()
      .default("1"),
    unitPrice: numeric("unit_price", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    unitCost: numeric("unit_cost", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    isRequired: boolean("is_required").notNull().default(true),
    configuration: jsonb("configuration")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("graduation_package_items_package_idx").on(
      table.packageId,
      table.sortOrder,
    ),
  ],
);

export const graduationUniversityProfilesTable = pgTable(
  "graduation_university_profiles",
  {
    id: serial("id").primaryKey(),
    code: varchar("code", { length: 80 }).notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en"),
    college: text("college"),
    department: text("department"),
    logoUrl: text("logo_url"),
    officialColors: jsonb("official_colors")
      .$type<string[]>()
      .notNull()
      .default([]),
    approvedTemplateIds: jsonb("approved_template_ids")
      .$type<number[]>()
      .notNull()
      .default([]),
    recommendedFonts: jsonb("recommended_fonts")
      .$type<string[]>()
      .notNull()
      .default([]),
    rules: jsonb("rules")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: integer("created_by").references(() => staffTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("graduation_university_profiles_code_idx").on(table.code),
    index("graduation_university_profiles_name_idx").on(table.nameAr),
  ],
);

export const graduationColorCombinationsTable = pgTable(
  "graduation_color_combinations",
  {
    id: serial("id").primaryKey(),
    code: varchar("code", { length: 80 }).notNull(),
    name: text("name").notNull(),
    colors: jsonb("colors")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    isActive: boolean("is_active").notNull().default(true),
    isFeatured: boolean("is_featured").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: integer("created_by").references(() => staffTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("graduation_color_combinations_code_idx").on(table.code),
    index("graduation_color_combinations_active_idx").on(
      table.isActive,
      table.sortOrder,
    ),
  ],
);

export const graduationFavoritesTable = pgTable(
  "graduation_favorites",
  {
    id: serial("id").primaryKey(),
    customerId: integer("customer_id").references(() => customersTable.id, {
      onDelete: "cascade",
    }),
    sessionKey: varchar("session_key", { length: 96 }),
    favoriteType: varchar("favorite_type", { length: 30 }).notNull(),
    referenceId: integer("reference_id"),
    configuration: jsonb("configuration")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("graduation_favorites_owner_reference_idx").on(
      table.customerId,
      table.sessionKey,
      table.favoriteType,
      table.referenceId,
    ),
  ],
);

export const graduationMeasurementsTable = pgTable(
  "graduation_measurements",
  {
    id: serial("id").primaryKey(),
    graduationOrderId: integer("graduation_order_id")
      .notNull()
      .references(() => graduationOrdersTable.id, { onDelete: "cascade" }),
    height: numeric("height", { precision: 7, scale: 2 }),
    weight: numeric("weight", { precision: 7, scale: 2 }),
    shoulder: numeric("shoulder", { precision: 7, scale: 2 }),
    sleeveLength: numeric("sleeve_length", { precision: 7, scale: 2 }),
    chest: numeric("chest", { precision: 7, scale: 2 }),
    waist: numeric("waist", { precision: 7, scale: 2 }),
    robeLength: numeric("robe_length", { precision: 7, scale: 2 }),
    suggestedSize: varchar("suggested_size", { length: 30 }),
    confirmedSize: varchar("confirmed_size", { length: 30 }),
    notes: text("notes"),
    version: integer("version").notNull().default(1),
    measuredBy: integer("measured_by").references(() => staffTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("graduation_measurements_order_version_idx").on(
      table.graduationOrderId,
      table.version,
    ),
  ],
);

export const graduationComponentsTable = pgTable(
  "graduation_components",
  {
    id: serial("id").primaryKey(),
    graduationOrderId: integer("graduation_order_id")
      .notNull()
      .references(() => graduationOrdersTable.id, { onDelete: "cascade" }),
    groupId: integer("group_id").references(() => graduationGroupsTable.id, {
      onDelete: "set null",
    }),
    componentCode: varchar("component_code", { length: 120 }).notNull(),
    qrValue: varchar("qr_value", { length: 160 }).notNull(),
    barcodeValue: varchar("barcode_value", { length: 160 }).notNull(),
    componentType: varchar("component_type", { length: 30 }).notNull(),
    templateId: integer("template_id").references(
      () => graduationTemplatesTable.id,
      { onDelete: "set null" },
    ),
    productId: integer("product_id").references(() => productsTable.id, {
      onDelete: "set null",
    }),
    model: text("model"),
    color: varchar("color", { length: 80 }),
    size: varchar("size", { length: 30 }),
    configuration: jsonb("configuration")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    productionStatus: varchar("production_status", { length: 40 })
      .notNull()
      .default("pending"),
    packagingStatus: varchar("packaging_status", { length: 40 })
      .notNull()
      .default("pending"),
    isRequired: boolean("is_required").notNull().default(true),
    packedAt: timestamp("packed_at"),
    packedBy: integer("packed_by").references(() => staffTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("graduation_components_code_idx").on(table.componentCode),
    uniqueIndex("graduation_components_qr_idx").on(table.qrValue),
    uniqueIndex("graduation_components_barcode_idx").on(table.barcodeValue),
    index("graduation_components_order_idx").on(table.graduationOrderId),
    index("graduation_components_status_idx").on(
      table.productionStatus,
      table.packagingStatus,
    ),
  ],
);

export const graduationKitsTable = pgTable(
  "graduation_kits",
  {
    id: serial("id").primaryKey(),
    graduationOrderId: integer("graduation_order_id")
      .notNull()
      .references(() => graduationOrdersTable.id, { onDelete: "cascade" }),
    groupId: integer("group_id").references(() => graduationGroupsTable.id, {
      onDelete: "set null",
    }),
    kitCode: varchar("kit_code", { length: 120 }).notNull(),
    qrValue: varchar("qr_value", { length: 160 }).notNull(),
    barcodeValue: varchar("barcode_value", { length: 160 }).notNull(),
    status: varchar("status", { length: 40 })
      .notNull()
      .default("awaiting_packaging"),
    requiredChecklist: jsonb("required_checklist")
      .$type<Record<string, boolean>>()
      .notNull()
      .default({}),
    packageImageUrl: text("package_image_url"),
    packagedBy: integer("packaged_by").references(() => staffTable.id, {
      onDelete: "set null",
    }),
    packagedAt: timestamp("packaged_at"),
    readyAt: timestamp("ready_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("graduation_kits_order_idx").on(table.graduationOrderId),
    uniqueIndex("graduation_kits_code_idx").on(table.kitCode),
    uniqueIndex("graduation_kits_qr_idx").on(table.qrValue),
    uniqueIndex("graduation_kits_barcode_idx").on(table.barcodeValue),
    index("graduation_kits_status_idx").on(table.status),
  ],
);

export const graduationKitItemsTable = pgTable(
  "graduation_kit_items",
  {
    id: serial("id").primaryKey(),
    kitId: integer("kit_id")
      .notNull()
      .references(() => graduationKitsTable.id, { onDelete: "cascade" }),
    componentId: integer("component_id")
      .notNull()
      .references(() => graduationComponentsTable.id, { onDelete: "cascade" }),
    verified: boolean("verified").notNull().default(false),
    verifiedAt: timestamp("verified_at"),
    verifiedBy: integer("verified_by").references(() => staffTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("graduation_kit_items_component_idx").on(table.componentId),
    uniqueIndex("graduation_kit_items_kit_component_idx").on(
      table.kitId,
      table.componentId,
    ),
  ],
);

export const graduationPackagingEventsTable = pgTable(
  "graduation_packaging_events",
  {
    id: serial("id").primaryKey(),
    graduationOrderId: integer("graduation_order_id")
      .notNull()
      .references(() => graduationOrdersTable.id, { onDelete: "cascade" }),
    kitId: integer("kit_id").references(() => graduationKitsTable.id, {
      onDelete: "set null",
    }),
    componentId: integer("component_id").references(
      () => graduationComponentsTable.id,
      { onDelete: "set null" },
    ),
    eventType: varchar("event_type", { length: 40 }).notNull(),
    scanValue: varchar("scan_value", { length: 180 }),
    result: varchar("result", { length: 30 }).notNull(),
    expectedOrderId: integer("expected_order_id"),
    actualOrderId: integer("actual_order_id"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    employeeId: integer("employee_id").references(() => staffTable.id, {
      onDelete: "set null",
    }),
    employeeName: text("employee_name").notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("graduation_packaging_events_order_idx").on(
      table.graduationOrderId,
      table.createdAt,
    ),
    index("graduation_packaging_events_result_idx").on(table.result),
  ],
);

export const graduationMaterialRequirementsTable = pgTable(
  "graduation_material_requirements",
  {
    id: serial("id").primaryKey(),
    graduationOrderId: integer("graduation_order_id")
      .notNull()
      .references(() => graduationOrdersTable.id, { onDelete: "cascade" }),
    productId: integer("product_id").references(() => productsTable.id, {
      onDelete: "set null",
    }),
    materialCode: varchar("material_code", { length: 100 }).notNull(),
    name: text("name").notNull(),
    unit: varchar("unit", { length: 24 }).notNull().default("piece"),
    requiredQuantity: numeric("required_quantity", { precision: 14, scale: 3 })
      .notNull()
      .default("0"),
    reservedQuantity: numeric("reserved_quantity", { precision: 14, scale: 3 })
      .notNull()
      .default("0"),
    consumedQuantity: numeric("consumed_quantity", { precision: 14, scale: 3 })
      .notNull()
      .default("0"),
    status: varchar("status", { length: 30 }).notNull().default("planned"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("graduation_material_requirements_order_code_idx").on(
      table.graduationOrderId,
      table.materialCode,
    ),
    index("graduation_material_requirements_status_idx").on(table.status),
  ],
);

export const graduationInventoryReservationsTable = pgTable(
  "graduation_inventory_reservations",
  {
    id: serial("id").primaryKey(),
    graduationOrderId: integer("graduation_order_id")
      .notNull()
      .references(() => graduationOrdersTable.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id, { onDelete: "restrict" }),
    quantity: numeric("quantity", { precision: 14, scale: 3 })
      .notNull()
      .default("0"),
    status: varchar("status", { length: 30 }).notNull().default("reserved"),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    reservedAt: timestamp("reserved_at").notNull().defaultNow(),
    releasedAt: timestamp("released_at"),
    consumedAt: timestamp("consumed_at"),
    createdBy: integer("created_by").references(() => staffTable.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    uniqueIndex("graduation_inventory_reservations_key_idx").on(
      table.idempotencyKey,
    ),
    index("graduation_inventory_reservations_order_idx").on(
      table.graduationOrderId,
      table.status,
    ),
  ],
);

export const graduationProductionSheetsTable = pgTable(
  "graduation_production_sheets",
  {
    id: serial("id").primaryKey(),
    graduationOrderId: integer("graduation_order_id")
      .notNull()
      .references(() => graduationOrdersTable.id, { onDelete: "cascade" }),
    sheetType: varchar("sheet_type", { length: 40 }).notNull(),
    version: integer("version").notNull().default(1),
    snapshot: jsonb("snapshot")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    generatedBy: integer("generated_by").references(() => staffTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("graduation_production_sheets_order_type_version_idx").on(
      table.graduationOrderId,
      table.sheetType,
      table.version,
    ),
  ],
);

export const graduationDeliverySessionsTable = pgTable(
  "graduation_delivery_sessions",
  {
    id: serial("id").primaryKey(),
    sessionCode: varchar("session_code", { length: 100 }).notNull(),
    groupId: integer("group_id").references(() => graduationGroupsTable.id, {
      onDelete: "set null",
    }),
    sessionDate: date("session_date").notNull(),
    status: varchar("status", { length: 30 }).notNull().default("open"),
    deliveredCount: integer("delivered_count").notNull().default(0),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdBy: integer("created_by").references(() => staffTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    closedAt: timestamp("closed_at"),
  },
  (table) => [
    uniqueIndex("graduation_delivery_sessions_code_idx").on(table.sessionCode),
    index("graduation_delivery_sessions_group_idx").on(table.groupId),
  ],
);

export type GraduationPackage = typeof graduationPackagesTable.$inferSelect;
export type GraduationComponent = typeof graduationComponentsTable.$inferSelect;
export type GraduationKit = typeof graduationKitsTable.$inferSelect;
