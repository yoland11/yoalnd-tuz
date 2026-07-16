import { pgTable, serial, text, timestamp, integer, varchar, numeric, boolean } from "drizzle-orm/pg-core";

export const suppliersTable = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  supplierCode: varchar("supplier_code", { length: 40 }).unique(),
  company: text("company"),
  contactPerson: text("contact_person"),
  phone: varchar("phone", { length: 30 }),
  whatsapp: varchar("whatsapp", { length: 30 }),
  email: text("email"),
  address: text("address"),
  notes: text("notes"),
  balance: text("balance").notNull().default("0"),
  category: varchar("category", { length: 60 }),
  paymentTerms: varchar("payment_terms", { length: 80 }),
  creditLimit: numeric("credit_limit", { precision: 16, scale: 2 }).notNull().default("0"),
  openingBalance: numeric("opening_balance", { precision: 16, scale: 2 }).notNull().default("0"),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  isActive: integer("is_active").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const supplierProductsTable = pgTable("supplier_products", {
  id: serial("id").primaryKey(), supplierId: integer("supplier_id").notNull().references(() => suppliersTable.id, { onDelete: "cascade" }), productId: integer("product_id").notNull(),
  lastPurchasePrice: numeric("last_purchase_price", { precision: 16, scale: 2 }).notNull().default("0"), supplierSku: varchar("supplier_sku", { length: 100 }), supplierBarcode: varchar("supplier_barcode", { length: 100 }), isDefault: boolean("is_default").notNull().default(false), isPreferred: boolean("is_preferred").notNull().default(false), createdAt: timestamp("created_at").notNull().defaultNow(), updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Supplier = typeof suppliersTable.$inferSelect;
export type InsertSupplier = typeof suppliersTable.$inferInsert;
