import { index, jsonb, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

export const desktopIdempotencyKeysTable = pgTable("desktop_idempotency_keys", {
  id: serial("id").primaryKey(),
  idempotencyKey: varchar("idempotency_key", { length: 100 }).notNull(),
  requestMethod: varchar("request_method", { length: 10 }).notNull(),
  requestPath: text("request_path").notNull(),
  requestHash: varchar("request_hash", { length: 64 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("processing"),
  responseStatus: varchar("response_status", { length: 3 }),
  responseBody: jsonb("response_body"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
}, (table) => [
  uniqueIndex("desktop_idempotency_key_unique_idx").on(table.idempotencyKey),
  index("desktop_idempotency_created_at_idx").on(table.createdAt),
  index("desktop_idempotency_status_idx").on(table.status),
]);

export type DesktopIdempotencyKey = typeof desktopIdempotencyKeysTable.$inferSelect;
