import {
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { customersTable } from "./customers";
import { financialAccountsTable, financialTransactionsTable } from "./master-cash-box";
import { productsTable } from "./products";
import { staffTable } from "./staff";

/**
 * Immutable asset-sale facts. The product, passport, depreciation profile and
 * their histories remain in place; this table records the disposal event only.
 */
export const assetSalesTable = pgTable("asset_sales", {
  id: serial("id").primaryKey(),
  saleNo: varchar("sale_no", { length: 50 }).notNull(),
  productId: integer("product_id").notNull().references(() => productsTable.id, { onDelete: "restrict" }),
  customerId: integer("customer_id").references(() => customersTable.id, { onDelete: "set null" }),
  buyerName: text("buyer_name").notNull(),
  buyerPhone: varchar("buyer_phone", { length: 30 }),
  saleDate: date("sale_date").notNull(),
  purchaseCost: numeric("purchase_cost", { precision: 16, scale: 2 }).notNull(),
  bookValue: numeric("book_value", { precision: 16, scale: 2 }).notNull(),
  accumulatedDepreciation: numeric("accumulated_depreciation", { precision: 16, scale: 2 }).notNull(),
  marketValue: numeric("market_value", { precision: 16, scale: 2 }),
  salePrice: numeric("sale_price", { precision: 16, scale: 2 }).notNull(),
  paidAmount: numeric("paid_amount", { precision: 16, scale: 2 }).notNull().default("0"),
  receivableAmount: numeric("receivable_amount", { precision: 16, scale: 2 }).notNull().default("0"),
  profitAmount: numeric("profit_amount", { precision: 16, scale: 2 }).notNull().default("0"),
  lossAmount: numeric("loss_amount", { precision: 16, scale: 2 }).notNull().default("0"),
  paymentMethod: varchar("payment_method", { length: 20 }).notNull(),
  collectionMethod: varchar("collection_method", { length: 20 }),
  financialAccountId: integer("financial_account_id").references(() => financialAccountsTable.id, { onDelete: "restrict" }),
  paymentStatus: varchar("payment_status", { length: 20 }).notNull().default("paid"),
  invoiceNumber: varchar("invoice_number", { length: 120 }),
  reason: text("reason").notNull(),
  notes: text("notes"),
  disposalReference: varchar("disposal_reference", { length: 80 }).notNull(),
  accountingReference: varchar("accounting_reference", { length: 80 }),
  financialTransactionId: integer("financial_transaction_id").references(() => financialTransactionsTable.id, { onDelete: "restrict" }),
  soldBy: integer("sold_by").references(() => staffTable.id, { onDelete: "set null" }),
  soldByName: text("sold_by_name").notNull().default(""),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  saleNoIdx: uniqueIndex("asset_sales_sale_no_idx").on(table.saleNo),
  productIdx: uniqueIndex("asset_sales_product_idx").on(table.productId),
  dateIdx: index("asset_sales_date_idx").on(table.saleDate),
  buyerIdx: index("asset_sales_buyer_idx").on(table.buyerPhone),
  accountIdx: index("asset_sales_account_idx").on(table.financialAccountId),
}));

export type AssetSale = typeof assetSalesTable.$inferSelect;
