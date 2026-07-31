import { pgTable, serial, text, integer, timestamp, index, varchar, uuid } from "drizzle-orm/pg-core";
import { staffTable } from "./staff";

export const adminSessionsTable = pgTable("admin_sessions", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  userId: integer("user_id").notNull().references(() => staffTable.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // Opaque, non-secret identifier for this session. Used by the Active Devices
  // UI, the audit log, and cache scoping. Never exposes the bearer `token`.
  sessionId: uuid("session_id").defaultRandom(),
  // Which portal the session was opened from (admin | photography | kosha | staff).
  portal: varchar("portal", { length: 24 }),
  // Stable per-browser/device identifier supplied by the client (x-device-id).
  deviceId: text("device_id"),
  userAgent: text("user_agent"),
  ipAddress: varchar("ip_address", { length: 80 }),
  lastActiveAt: timestamp("last_active_at"),
  // Soft revocation — kept instead of a hard delete so the device list can show
  // status ("revoked from another device") and the audit trail stays intact.
  revokedAt: timestamp("revoked_at"),
  revokedBy: integer("revoked_by").references(() => staffTable.id, { onDelete: "set null" }),
  revokeReason: text("revoke_reason"),
}, (t) => ({
  tokenIdx: index("admin_sessions_token_idx").on(t.token),
  userIdx: index("admin_sessions_user_idx").on(t.userId),
  sessionIdIdx: index("admin_sessions_session_id_idx").on(t.sessionId),
}));

export type AdminSession = typeof adminSessionsTable.$inferSelect;
