import {
  index,
  integer,
  pgTable,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export const rateLimitBucketsTable = pgTable(
  "rate_limit_buckets",
  {
    keyHash: varchar("key_hash", { length: 64 }).primaryKey(),
    action: varchar("action", { length: 80 }).notNull(),
    hitCount: integer("hit_count").notNull().default(0),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("rate_limit_buckets_reset_at_idx").on(table.resetAt)],
);

export const ajnSchemaRevisionsTable = pgTable("ajn_schema_revisions", {
  revision: integer("revision").primaryKey(),
  description: varchar("description", { length: 500 }).notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
