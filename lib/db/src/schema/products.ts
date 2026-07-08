import { date, pgTable, serial, text, numeric, integer, boolean, timestamp, varchar, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { categoriesTable } from "./categories";
import { customersTable } from "./customers";
import { staffTable } from "./staff";

export const productsTable = pgTable("products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  nameAr: text("name_ar").notNull(),
  nameKu: text("name_ku"),
  nameTr: text("name_tr"),

  description: text("description"),
  descriptionAr: text("description_ar"),
  descriptionKu: text("description_ku"),
  descriptionTr: text("description_tr"),

  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  originalPrice: numeric("original_price", { precision: 10, scale: 2 }),
  costPrice: numeric("cost_price", { precision: 14, scale: 2 }).notNull().default("0"),

  stock: integer("stock").notNull().default(0),
  minStock: integer("min_stock").notNull().default(0),
  sharedStockProductId: integer("shared_stock_product_id"),

  isRental: boolean("is_rental").notNull().default(false),
  pricePerDay: numeric("price_per_day", { precision: 12, scale: 2 }).notNull().default("0"),
  // Explicit fixed-asset flag. Only is_asset products appear in Asset Depreciation /
  // Passport / Management. Provisioned at runtime (see ensureAdminProductsColumns).
  isAsset: boolean("is_asset").notNull().default(false),

  barcode: varchar("barcode", { length: 100 }),

  categoryId: integer("category_id").references(() => categoriesTable.id),
  subcategoryId: integer("subcategory_id").references(() => categoriesTable.id),

  category: varchar("category", { length: 100 }),
  subcategory: varchar("subcategory", { length: 100 }),

  images: jsonb("images")
    .$type<string[]>()
    .notNull()
    .default([]),

  videos: jsonb("videos")
    .$type<string[]>()
    .notNull()
    .default([]),

  imageMetadata: jsonb("image_metadata")
    .$type<Record<string, unknown>[]>()
    .notNull()
    .default([]),

  colors: jsonb("colors")
    .$type<
      Array<{
        name: string;
        hex: string;
        image?: string | null;
        imageUrl?: string | null;
      } | string>
    >()
    .notNull()
    .default([]),

  isFeatured: boolean("is_featured").notNull().default(false),

  isActive: boolean("is_active").notNull().default(true),

  sortOrder: integer("sort_order").notNull().default(0),

  // ===== Archive Support =====
  // Only archived_at exists in the production DB (added via runtime `alter table
  // ... add column if not exists`). archived_by / archive_reason were declared but
  // never migrated or used, which made Drizzle SELECT non-existent columns → every
  // products query 500'd. Removed until they are actually provisioned + used.
  archivedAt: timestamp("archived_at"),
  // ===========================

  createdAt: timestamp("created_at").notNull().defaultNow(),

  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const rentalOrdersTable = pgTable("rental_orders", {
  id: serial("id").primaryKey(),
  orderNo: varchar("order_no", { length: 40 }).notNull().unique(),
  productId: integer("product_id").notNull().references(() => productsTable.id),
  stockSourceProductId: integer("stock_source_product_id").references(() => productsTable.id),
  customerId: integer("customer_id").references(() => customersTable.id),
  customerName: text("customer_name").notNull().default(""),
  phone: varchar("phone", { length: 30 }).notNull(),
  phoneLast4: varchar("phone_last4", { length: 4 }),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  days: integer("days").notNull().default(1),
  pricePerDay: numeric("price_per_day", { precision: 12, scale: 2 }).notNull().default("0"),
  totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  paidAmount: numeric("paid_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  remainingAmount: numeric("remaining_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  paymentMethod: varchar("payment_method", { length: 20 }).notNull().default("cash"),
  paymentStatus: varchar("payment_status", { length: 20 }).notNull().default("paid"),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  notes: text("notes"),
  stockApplied: integer("stock_applied").notNull().default(1),
  stockRestoredAt: timestamp("stock_restored_at"),
  financialTransactionId: integer("financial_transaction_id"),
  createdBy: integer("created_by").references(() => staffTable.id),
  createdByName: text("created_by_name").notNull().default(""),
  returnedAt: timestamp("returned_at"),
  cancelledAt: timestamp("cancelled_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const stockMovementsTable = pgTable("stock_movements", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").references(() => productsTable.id),
  stockSourceProductId: integer("stock_source_product_id").references(() => productsTable.id),
  quantityChange: numeric("quantity_change", { precision: 12, scale: 3 }).notNull(),
  reason: varchar("reason", { length: 80 }).notNull(),
  relatedType: varchar("related_type", { length: 40 }),
  relatedId: integer("related_id"),
  createdBy: integer("created_by"),
  createdByName: text("created_by_name").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertProductSchema = createInsertSchema(productsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof productsTable.$inferSelect;
export type StockMovement = typeof stockMovementsTable.$inferSelect;
export type RentalOrder = typeof rentalOrdersTable.$inferSelect;