import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { productsTable } from "./products";
import { salesInvoicesTable, salesInvoiceItemsTable } from "./sales-invoices";

/** A sellable offer. Its stock is always derived from its component products. */
export const productBundlesTable = pgTable("product_bundles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  image: text("image"),
  barcode: varchar("barcode", { length: 100 }),
  normalPrice: numeric("normal_price", { precision: 14, scale: 2 }).notNull().default("0"),
  offerPrice: numeric("offer_price", { precision: 14, scale: 2 }).notNull().default("0"),
  // This is a sellable-offer charge, not a component price or stock cost.
  deliveryFee: numeric("delivery_fee", { precision: 14, scale: 2 }).notNull().default("0"),
  isActive: boolean("is_active").notNull().default(true),
  startsAt: timestamp("starts_at"),
  endsAt: timestamp("ends_at"),
  showInStore: boolean("show_in_store").notNull().default(false),
  showInSalesInvoices: boolean("show_in_sales_invoices").notNull().default(true),
  // Used offers remain part of the financial record. Archiving only removes
  // them from new sales/catalogues; immutable invoice snapshots stay intact.
  archivedAt: timestamp("archived_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const productBundleItemsTable = pgTable("product_bundle_items", {
  id: serial("id").primaryKey(),
  bundleId: integer("bundle_id").notNull().references(() => productBundlesTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").notNull().references(() => productsTable.id, { onDelete: "restrict" }),
  quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Immutable component record used for stock reversals and historical invoices. */
export const salesInvoiceBundleSnapshotsTable = pgTable("sales_invoice_bundle_snapshots", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => salesInvoicesTable.id, { onDelete: "cascade" }),
  salesInvoiceItemId: integer("sales_invoice_item_id").notNull().references(() => salesInvoiceItemsTable.id, { onDelete: "cascade" }),
  bundleId: integer("bundle_id").references(() => productBundlesTable.id, { onDelete: "set null" }),
  bundleName: text("bundle_name").notNull(),
  bundleBarcode: varchar("bundle_barcode", { length: 100 }),
  bundleQuantity: numeric("bundle_quantity", { precision: 14, scale: 3 }).notNull(),
  // Immutable financial context for the bundle line at the time of sale.
  deliveryFeePerBundle: numeric("delivery_fee_per_bundle", { precision: 14, scale: 2 }).notNull().default("0"),
  components: jsonb("components").$type<Array<{
    productId: number;
    stockSourceProductId: number;
    productName: string;
    quantityPerBundle: string;
    totalQuantity: string;
    costPrice: string;
  }>>().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ProductBundle = typeof productBundlesTable.$inferSelect;
