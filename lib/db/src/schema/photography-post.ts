import { bigint, index, integer, numeric, pgTable, serial, text, timestamp, unique, varchar } from "drizzle-orm/pg-core";
import { staffTable } from "./staff";
import { productsTable } from "./products";
import { photographyShootsTable } from "./photography-shoots";

/**
 * Post-production layer: what happens to the footage after the shoot ends.
 *
 * Sits on top of `photography_shoots` (phase 1) and, like it, adds no columns to any
 * pre-existing table. An edit project refines the shoot's coarse `editing` stage into the
 * eight statuses the edit room actually works in.
 */
export const PHOTOGRAPHY_EDIT_STATUSES = [
  "waiting",
  "copying_files",
  "editing",
  "color_correction",
  "exporting",
  "quality_check",
  "ready",
  "delivered",
] as const;
export type PhotographyEditStatus = (typeof PHOTOGRAPHY_EDIT_STATUSES)[number];

/** Memory-card lifecycle, from the shelf to the edit room and back. */
export const MEMORY_CARD_STATUSES = [
  "available",
  "assigned",
  "full",
  "copying",
  "delivered",
  "returned",
  "damaged",
] as const;
export type MemoryCardStatus = (typeof MEMORY_CARD_STATUSES)[number];

/** Media kinds tracked by count and size only — the files themselves live elsewhere. */
export const PHOTOGRAPHY_MEDIA_KINDS = ["raw", "edited", "video", "drone", "preview"] as const;
export type PhotographyMediaKind = (typeof PHOTOGRAPHY_MEDIA_KINDS)[number];

export const photographyEditProjectsTable = pgTable(
  "photography_edit_projects",
  {
    id: serial("id").primaryKey(),
    shootId: integer("shoot_id")
      .notNull()
      .unique()
      .references(() => photographyShootsTable.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 30 }).notNull().default("waiting"),
    editorStaffId: integer("editor_staff_id").references(() => staffTable.id, { onDelete: "set null" }),
    editorName: text("editor_name"),
    dueDate: varchar("due_date", { length: 10 }),
    notes: text("notes"),

    // Milestones drive the turnaround metrics in reports.
    assignedAt: timestamp("assigned_at"),
    startedAt: timestamp("started_at"),
    readyAt: timestamp("ready_at"),
    deliveredAt: timestamp("delivered_at"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index("photography_edit_projects_status_idx").on(table.status, table.updatedAt),
    editorIdx: index("photography_edit_projects_editor_idx").on(table.editorStaffId, table.status),
  }),
);

export const photographyEditEventsTable = pgTable(
  "photography_edit_events",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => photographyEditProjectsTable.id, { onDelete: "cascade" }),
    staffId: integer("staff_id").references(() => staffTable.id, { onDelete: "set null" }),
    staffName: text("staff_name").notNull().default(""),
    type: varchar("type", { length: 40 }).notNull(),
    fromStatus: varchar("from_status", { length: 30 }),
    toStatus: varchar("to_status", { length: 30 }),
    note: text("note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    projectIdx: index("photography_edit_events_project_idx").on(table.projectId, table.createdAt),
  }),
);

/** Durable registry of physical cards. Optionally linked to an asset product. */
export const photographyMemoryCardsTable = pgTable(
  "photography_memory_cards",
  {
    id: serial("id").primaryKey(),
    label: text("label").notNull(),
    capacityGb: integer("capacity_gb").notNull().default(0),
    serialNumber: varchar("serial_number", { length: 120 }),
    productId: integer("product_id").references(() => productsTable.id, { onDelete: "set null" }),
    status: varchar("status", { length: 20 }).notNull().default("available"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index("photography_memory_cards_status_idx").on(table.status, table.label),
  }),
);

/** One card's journey through one shoot: who held it, which camera, what came off it. */
export const photographyCardAssignmentsTable = pgTable(
  "photography_card_assignments",
  {
    id: serial("id").primaryKey(),
    cardId: integer("card_id")
      .notNull()
      .references(() => photographyMemoryCardsTable.id, { onDelete: "cascade" }),
    shootId: integer("shoot_id")
      .notNull()
      .references(() => photographyShootsTable.id, { onDelete: "cascade" }),
    photographerStaffId: integer("photographer_staff_id").references(() => staffTable.id, { onDelete: "set null" }),
    photographerName: text("photographer_name").notNull().default(""),
    cameraProductId: integer("camera_product_id").references(() => productsTable.id, { onDelete: "set null" }),
    cameraName: text("camera_name"),
    status: varchar("status", { length: 20 }).notNull().default("assigned"),
    filesCopied: integer("files_copied").notNull().default(0),

    copiedAt: timestamp("copied_at"),
    deliveredAt: timestamp("delivered_at"),
    returnedAt: timestamp("returned_at"),
    note: text("note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    // A card can be reused across shoots, but only carried once per shoot.
    uniquePerShoot: unique("photography_card_assignments_unique").on(table.cardId, table.shootId),
    shootIdx: index("photography_card_assignments_shoot_idx").on(table.shootId, table.status),
  }),
);

/**
 * Metadata-only media ledger. Object storage is not provisioned, so the system records
 * what was captured and where it went — never the bytes themselves.
 */
export const photographyMediaBatchesTable = pgTable(
  "photography_media_batches",
  {
    id: serial("id").primaryKey(),
    shootId: integer("shoot_id")
      .notNull()
      .references(() => photographyShootsTable.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 20 }).notNull(),
    fileCount: integer("file_count").notNull().default(0),
    totalBytes: bigint("total_bytes", { mode: "number" }).notNull().default(0),
    cardId: integer("card_id").references(() => photographyMemoryCardsTable.id, { onDelete: "set null" }),
    externalUrl: text("external_url"),
    note: text("note"),
    recordedBy: integer("recorded_by").references(() => staffTable.id, { onDelete: "set null" }),
    recordedByName: text("recorded_by_name").notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    shootIdx: index("photography_media_batches_shoot_idx").on(table.shootId, table.kind),
  }),
);

export type PhotographyEditProject = typeof photographyEditProjectsTable.$inferSelect;
export type PhotographyEditEvent = typeof photographyEditEventsTable.$inferSelect;
export type PhotographyMemoryCard = typeof photographyMemoryCardsTable.$inferSelect;
export type PhotographyCardAssignment = typeof photographyCardAssignmentsTable.$inferSelect;
export type PhotographyMediaBatch = typeof photographyMediaBatchesTable.$inferSelect;
