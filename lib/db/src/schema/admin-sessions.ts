import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { staffTable } from "./staff";

export const adminSessionsTable = pgTable("admin_sessions", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  userId: integer("user_id").notNull().references(() => staffTable.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  tokenIdx: index("admin_sessions_token_idx").on(t.token),
  userIdx: index("admin_sessions_user_idx").on(t.userId),
}));

export type AdminSession = typeof adminSessionsTable.$inferSelect;
