import { boolean, integer, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { customersTable } from "./customers";

export const customerAddressesTable = pgTable("customer_addresses", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  type: varchar("type", { length: 20 }).notNull().default("home"),
  fullName: text("full_name").notNull().default(""),
  phone: varchar("phone", { length: 20 }).notNull(),
  governorate: text("governorate").notNull().default(""),
  city: text("city").notNull().default(""),
  address: text("address").notNull().default(""),
  landmark: text("landmark").notNull().default(""),
  notes: text("notes").notNull().default(""),
  isDefault: boolean("is_default").notNull().default(false),
  // ── Province delivery fields ──
  // provinceId points at delivery_zones; the FK is declared in SQL rather than
  // here to keep this module free of a delivery -> customer-profile cycle.
  provinceId: integer("province_id"),
  district: text("district").notNull().default(""),
  area: text("area").notNull().default(""),
  altPhone: varchar("alt_phone", { length: 20 }),
  mapsUrl: text("maps_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const customerPreferencesTable = pgTable(
  "customer_preferences",
  {
    id: serial("id").primaryKey(),
    customerId: integer("customer_id").notNull().references(() => customersTable.id),
    defaultPaymentMethod: varchar("default_payment_method", { length: 20 }).notNull().default("cash"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    customerIdUnique: uniqueIndex("customer_preferences_customer_id_unique").on(table.customerId),
  }),
);

export type CustomerAddress = typeof customerAddressesTable.$inferSelect;
export type CustomerPreference = typeof customerPreferencesTable.$inferSelect;
