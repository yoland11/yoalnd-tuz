import { pgTable, serial, text, integer, timestamp, varchar, jsonb } from "drizzle-orm/pg-core";
import { staffTable } from "./staff";
import { customersTable } from "./customers";

export const tasksTable = pgTable("tasks", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  status: varchar("status", { length: 30 }).notNull().default("new"),
  priority: varchar("priority", { length: 20 }).notNull().default("medium"),
  dueAt: timestamp("due_at"),
  assignedStaffIds: jsonb("assigned_staff_ids").$type<number[]>().notNull().default([]),
  relatedType: varchar("related_type", { length: 30 }),
  relatedId: integer("related_id"),
  notes: text("notes"),
  attachments: jsonb("attachments").$type<string[]>().notNull().default([]),
  createdBy: integer("created_by").references(() => staffTable.id),
  archivedAt: timestamp("archived_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const taskCommentsTable = pgTable("task_comments", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => tasksTable.id),
  staffId: integer("staff_id").references(() => staffTable.id),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const taskAttachmentsTable = pgTable("task_attachments", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => tasksTable.id),
  fileUrl: text("file_url").notNull(),
  fileName: text("file_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const messageThreadsTable = pgTable("message_threads", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").references(() => customersTable.id),
  phone: varchar("phone", { length: 30 }),
  customerName: text("customer_name").notNull().default(""),
  subject: text("subject").notNull().default("رسالة زبون"),
  status: varchar("status", { length: 20 }).notNull().default("new"),
  relatedType: varchar("related_type", { length: 30 }),
  relatedId: integer("related_id"),
  lastMessageAt: timestamp("last_message_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const messageRepliesTable = pgTable("message_replies", {
  id: serial("id").primaryKey(),
  threadId: integer("thread_id").notNull().references(() => messageThreadsTable.id),
  senderType: varchar("sender_type", { length: 20 }).notNull().default("customer"),
  staffId: integer("staff_id").references(() => staffTable.id),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const customerActivityLogsTable = pgTable("customer_activity_logs", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").references(() => customersTable.id),
  sessionId: varchar("session_id", { length: 80 }),
  phone: varchar("phone", { length: 30 }),
  action: varchar("action", { length: 60 }).notNull(),
  entityType: varchar("entity_type", { length: 40 }),
  entityId: integer("entity_id"),
  entityLabel: text("entity_label"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  ipAddress: varchar("ip_address", { length: 80 }),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const attendanceRecordsTable = pgTable("attendance_records", {
  id: serial("id").primaryKey(),
  staffId: integer("staff_id").notNull().references(() => staffTable.id),
  checkInAt: timestamp("check_in_at").notNull().defaultNow(),
  checkOutAt: timestamp("check_out_at"),
  status: varchar("status", { length: 20 }).notNull().default("present"),
  notes: text("notes"),
  editedBy: integer("edited_by").references(() => staffTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const qrTokensTable = pgTable("qr_tokens", {
  id: serial("id").primaryKey(),
  entityType: varchar("entity_type", { length: 30 }).notNull(),
  entityId: integer("entity_id").notNull(),
  token: varchar("token", { length: 80 }).notNull().unique(),
  targetUrl: text("target_url").notNull(),
  scanCount: integer("scan_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastScannedAt: timestamp("last_scanned_at"),
});

export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  audienceType: varchar("audience_type", { length: 20 }).notNull().default("admin"),
  staffId: integer("staff_id").references(() => staffTable.id),
  customerId: integer("customer_id").references(() => customersTable.id),
  type: varchar("type", { length: 60 }).notNull().default("general"),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  entityType: varchar("entity_type", { length: 40 }),
  entityId: integer("entity_id"),
  href: text("href"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  readAt: timestamp("read_at"),
  archivedAt: timestamp("archived_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const notificationSubscriptionsTable = pgTable("notification_subscriptions", {
  id: serial("id").primaryKey(),
  ownerType: varchar("owner_type", { length: 20 }).notNull().default("staff"),
  staffId: integer("staff_id").references(() => staffTable.id),
  customerId: integer("customer_id").references(() => customersTable.id),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  isActive: integer("is_active").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const notificationSettingsTable = pgTable("notification_settings", {
  id: serial("id").primaryKey(),
  ownerType: varchar("owner_type", { length: 20 }).notNull().default("global"),
  ownerId: integer("owner_id"),
  pushEnabled: integer("push_enabled").notNull().default(1),
  ordersEnabled: integer("orders_enabled").notNull().default(1),
  messagesEnabled: integer("messages_enabled").notNull().default(1),
  tasksEnabled: integer("tasks_enabled").notNull().default(1),
  inventoryEnabled: integer("inventory_enabled").notNull().default(1),
  customerEnabled: integer("customer_enabled").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Task = typeof tasksTable.$inferSelect;
export type MessageThread = typeof messageThreadsTable.$inferSelect;
export type MessageReply = typeof messageRepliesTable.$inferSelect;
export type CustomerActivityLog = typeof customerActivityLogsTable.$inferSelect;
export type AttendanceRecord = typeof attendanceRecordsTable.$inferSelect;
export type QrToken = typeof qrTokensTable.$inferSelect;
export type Notification = typeof notificationsTable.$inferSelect;
export type NotificationSubscription = typeof notificationSubscriptionsTable.$inferSelect;
export type NotificationSettings = typeof notificationSettingsTable.$inferSelect;
