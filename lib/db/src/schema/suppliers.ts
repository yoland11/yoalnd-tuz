import { pgTable, serial, text, timestamp, integer, varchar } from "drizzle-orm/pg-core";

export const suppliersTable = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  phone: varchar("phone", { length: 30 }),
  email: text("email"),
  address: text("address"),
  notes: text("notes"),
  balance: text("balance").notNull().default("0"),
  isActive: integer("is_active").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Supplier = typeof suppliersTable.$inferSelect;
export type InsertSupplier = typeof suppliersTable.$inferInsert;
