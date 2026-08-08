import {
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { customersTable } from "./customers";
import { staffTable } from "./staff";

/** Authentication is separate from the canonical business customer record. */
export const customerAccountsTable = pgTable(
  "customer_accounts",
  {
    id: serial("id").primaryKey(),
    customerId: integer("customer_id").notNull().references(() => customersTable.id, { onDelete: "restrict" }),
    customerCode: varchar("customer_code", { length: 32 }).notNull().unique(),
    username: varchar("username", { length: 80 }).notNull().unique(),
    phoneNormalized: varchar("phone_normalized", { length: 20 }).notNull(),
    email: text("email"),
    passwordHash: text("password_hash").notNull(),
    recoveryCodeHash: text("recovery_code_hash").notNull(),
    recoveryGeneratedAt: timestamp("recovery_generated_at").notNull().defaultNow(),
    recoveryAcknowledgedAt: timestamp("recovery_acknowledged_at"),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until"),
    linkStatus: varchar("link_status", { length: 24 }).notNull().default("linked"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    customerUnique: uniqueIndex("customer_accounts_customer_id_unique").on(table.customerId),
    phoneIdx: index("customer_accounts_phone_normalized_idx").on(table.phoneNormalized),
  }),
);

export const customerSessionsTable = pgTable(
  "customer_sessions",
  {
    id: serial("id").primaryKey(),
    sessionId: uuid("session_id").notNull().unique(),
    accountId: integer("account_id").notNull().references(() => customerAccountsTable.id, { onDelete: "cascade" }),
    customerId: integer("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    userAgent: text("user_agent"),
    deviceId: text("device_id"),
    ipAddress: varchar("ip_address", { length: 80 }),
    lastActiveAt: timestamp("last_active_at"),
    revokedAt: timestamp("revoked_at"),
    revokeReason: text("revoke_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    customerIdx: index("customer_sessions_customer_idx").on(table.customerId, table.expiresAt),
    accountIdx: index("customer_sessions_account_idx").on(table.accountId),
  }),
);

export const customerRecoveryRequestsTable = pgTable("customer_account_recovery_requests", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").references(() => customersTable.id, { onDelete: "set null" }),
  accountId: integer("account_id").references(() => customerAccountsTable.id, { onDelete: "set null" }),
  identifier: varchar("identifier", { length: 120 }).notNull(),
  phoneNormalized: varchar("phone_normalized", { length: 20 }),
  notes: text("notes"),
  status: varchar("status", { length: 24 }).notNull().default("pending"),
  reviewedBy: integer("reviewed_by").references(() => staffTable.id, { onDelete: "set null" }),
  reviewNotes: text("review_notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at"),
});

export const customerPrivatePhotosTable = pgTable(
  "customer_private_photos",
  {
    id: serial("id").primaryKey(),
    customerId: integer("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
    storagePath: text("storage_path").notNull(),
    mimeType: varchar("mime_type", { length: 80 }).notNull(),
    fileSize: integer("file_size").notNull(),
    width: integer("width"),
    height: integer("height"),
    checksum: varchar("checksum", { length: 128 }).notNull(),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    activeCustomerUnique: uniqueIndex("customer_private_photos_customer_id_unique").on(table.customerId),
    customerIdx: index("customer_private_photos_customer_idx").on(table.customerId, table.deletedAt),
  }),
);

export const customerAccountAuditLogsTable = pgTable("customer_account_audit_logs", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").references(() => customersTable.id, { onDelete: "set null" }),
  accountId: integer("account_id").references(() => customerAccountsTable.id, { onDelete: "set null" }),
  actorStaffId: integer("actor_staff_id").references(() => staffTable.id, { onDelete: "set null" }),
  action: varchar("action", { length: 100 }).notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  ipAddress: varchar("ip_address", { length: 80 }),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type CustomerAccount = typeof customerAccountsTable.$inferSelect;
