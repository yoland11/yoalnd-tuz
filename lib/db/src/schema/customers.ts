import { integer, jsonb, numeric, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const customersTable = pgTable("customers", {
  id: serial("id").primaryKey(),
  phone: varchar("phone", { length: 20 }).notNull().unique(),
  name: text("name").notNull().default(""),
  fullName: text("full_name"),
  email: text("email"),
  avatarUrl: text("avatar_url"),
  avatarMetadata: jsonb("avatar_metadata").$type<Record<string, unknown>>().notNull().default({}),
  address: text("address"),
  city: text("city"),
  customerType: varchar("customer_type", { length: 20 }).notNull().default("retail"),
  businessName: text("business_name"),
  ownerName: text("owner_name"),
  province: varchar("province", { length: 100 }),
  creditLimit: numeric("credit_limit", { precision: 14, scale: 2 }),
  specialDiscountPercent: numeric("special_discount_percent", { precision: 5, scale: 2 }),
  notes: text("notes"),
  role: varchar("role", { length: 20 }).notNull().default("customer"),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  rewardPoints: integer("reward_points").notNull().default(0),
  rewardLevel: varchar("reward_level", { length: 20 }).notNull().default("bronze"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCustomerSchema = createInsertSchema(customersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type Customer = typeof customersTable.$inferSelect;
