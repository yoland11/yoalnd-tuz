import { pgTable, serial, text, numeric, integer, boolean, jsonb, timestamp, varchar, date, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { customersTable } from "./customers";
import { customerAddressesTable } from "./customer-profile";
import { salesInvoicesTable } from "./sales-invoices";
import { ordersTable } from "./orders";
import { staffTable } from "./staff";

export type PricedRegion = { name: string; price: number; estimatedDays?: number };

/**
 * Iraqi governorates.  This table doubles as the province registry for
 * province-based delivery: `price` is the default (standard) fee and the
 * columns below layer the per-type pricing on top of it.  Fees live here and
 * never inside an invoice component.
 */
export const deliveryZonesTable = pgTable("delivery_zones", {
  id: serial("id").primaryKey(),
  governorate: text("governorate").notNull(),
  governorateAr: text("governorate_ar").notNull(),
  areas: jsonb("areas").$type<string[]>().notNull().default([]),
  pricedRegions: jsonb("priced_regions").$type<PricedRegion[]>().notNull().default([]),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  estimatedDays: integer("estimated_days").notNull().default(2),
  isActive: boolean("is_active").notNull().default(true),
  // ── Province delivery pricing ──
  expressFee: numeric("express_fee", { precision: 12, scale: 2 }).notNull().default("0"),
  sameDayFee: numeric("same_day_fee", { precision: 12, scale: 2 }).notNull().default("0"),
  codFee: numeric("cod_fee", { precision: 12, scale: 2 }).notNull().default("0"),
  /** Order subtotal at or above which the delivery fee is waived.  0 disables. */
  freeDeliveryThreshold: numeric("free_delivery_threshold", { precision: 14, scale: 2 }).notNull().default("0"),
  deliveryCompany: text("delivery_company"),
  /** Maximum shippable weight in kg.  0 means unlimited. */
  maxWeight: numeric("max_weight", { precision: 10, scale: 2 }).notNull().default("0"),
  sortOrder: integer("sort_order").notNull().default(0),
  notes: text("notes"),
});

export const insertDeliveryZoneSchema = createInsertSchema(deliveryZonesTable).omit({ id: true });
export type InsertDeliveryZone = z.infer<typeof insertDeliveryZoneSchema>;
export type DeliveryZone = typeof deliveryZonesTable.$inferSelect;

/** How the customer takes possession of the goods. */
export const DELIVERY_METHODS = ["pickup", "city", "province"] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];

/** Service level for a province delivery.  Drives which zone fee is resolved. */
export const DELIVERY_TYPES = ["standard", "express", "same_day", "office_pickup", "door"] as const;
export type DeliveryType = (typeof DELIVERY_TYPES)[number];

export const DELIVERY_STATUSES = [
  "pending_prep",
  "ready_to_ship",
  "handed_to_company",
  "in_transit",
  "arrived_province",
  "out_for_delivery",
  "delivered",
  "failed",
  "returned",
  "cancelled",
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** Who absorbs the delivery fee. */
export const DELIVERY_FEE_PAYERS = ["customer", "store"] as const;
export type DeliveryFeePayer = (typeof DELIVERY_FEE_PAYERS)[number];

/**
 * The delivery detail captured on a sales invoice / POS sale.  One row per
 * source document; the delivery order (below) is generated from it.
 */
export const deliveryDetailsTable = pgTable(
  "delivery_details",
  {
    id: serial("id").primaryKey(),
    salesInvoiceId: integer("sales_invoice_id").references(() => salesInvoicesTable.id, { onDelete: "cascade" }),
    orderId: integer("order_id").references(() => ordersTable.id),
    customerId: integer("customer_id").references(() => customersTable.id),
    customerAddressId: integer("customer_address_id").references(() => customerAddressesTable.id),
    provinceId: integer("province_id").references(() => deliveryZonesTable.id),
    method: varchar("method", { length: 20 }).notNull().default("pickup"),
    // Address snapshot — kept on the document so later edits to the customer's
    // saved address never rewrite history on an issued invoice.
    provinceName: text("province_name").notNull().default(""),
    city: text("city").notNull().default(""),
    district: text("district").notNull().default(""),
    area: text("area").notNull().default(""),
    landmark: text("landmark").notNull().default(""),
    fullAddress: text("full_address").notNull().default(""),
    mapsUrl: text("maps_url"),
    receiverName: text("receiver_name").notNull().default(""),
    receiverPhone: varchar("receiver_phone", { length: 20 }),
    receiverAltPhone: varchar("receiver_alt_phone", { length: 20 }),
    deliveryCompany: text("delivery_company"),
    deliveryType: varchar("delivery_type", { length: 20 }).notNull().default("standard"),
    /** Fee actually charged, after any override. */
    deliveryFee: numeric("delivery_fee", { precision: 12, scale: 2 }).notNull().default("0"),
    /** Fee resolved from the province pricing, before override.  Kept for audit. */
    baseFee: numeric("base_fee", { precision: 12, scale: 2 }).notNull().default("0"),
    feeOverridden: boolean("fee_overridden").notNull().default(false),
    feeOverrideReason: text("fee_override_reason"),
    feePaidBy: varchar("fee_paid_by", { length: 20 }).notNull().default("customer"),
    codEnabled: boolean("cod_enabled").notNull().default(false),
    codFee: numeric("cod_fee", { precision: 12, scale: 2 }).notNull().default("0"),
    /** Amount the delivery company is expected to collect on our behalf. */
    codAmount: numeric("cod_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    codCollectedAt: timestamp("cod_collected_at"),
    expectedShipDate: date("expected_ship_date"),
    expectedArrivalDate: date("expected_arrival_date"),
    preferredTime: varchar("preferred_time", { length: 40 }),
    notes: text("notes"),
    isFragile: boolean("is_fragile").notNull().default(false),
    needsRefrigeration: boolean("needs_refrigeration").notNull().default(false),
    createdBy: integer("created_by").references(() => staffTable.id),
    createdByName: text("created_by_name").notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    // One delivery detail per source document — the guard against duplicates.
    salesInvoiceUnique: uniqueIndex("delivery_details_sales_invoice_unique").on(table.salesInvoiceId),
    provinceIdx: index("delivery_details_province_idx").on(table.provinceId),
    customerIdx: index("delivery_details_customer_idx").on(table.customerId),
  }),
);

/**
 * The shippable unit handed to the delivery company.  Generated once per
 * delivery-bearing document and then tracked through DELIVERY_STATUSES.
 */
export const deliveryOrdersTable = pgTable(
  "delivery_orders",
  {
    id: serial("id").primaryKey(),
    deliveryNo: varchar("delivery_no", { length: 40 }).notNull().unique(),
    deliveryDetailsId: integer("delivery_details_id").references(() => deliveryDetailsTable.id, { onDelete: "cascade" }),
    salesInvoiceId: integer("sales_invoice_id").references(() => salesInvoicesTable.id, { onDelete: "cascade" }),
    orderId: integer("order_id").references(() => ordersTable.id),
    customerId: integer("customer_id").references(() => customersTable.id),
    customerAddressId: integer("customer_address_id").references(() => customerAddressesTable.id),
    provinceId: integer("province_id").references(() => deliveryZonesTable.id),
    financialTransactionId: integer("financial_transaction_id"),
    qrToken: varchar("qr_token", { length: 80 }),
    status: varchar("status", { length: 30 }).notNull().default("pending_prep"),
    statusUpdatedAt: timestamp("status_updated_at").notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at"),
    returnedAt: timestamp("returned_at"),
    labelPrintedAt: timestamp("label_printed_at"),
    labelPrintCount: integer("label_print_count").notNull().default(0),
    createdBy: integer("created_by").references(() => staffTable.id),
    createdByName: text("created_by_name").notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    detailsUnique: uniqueIndex("delivery_orders_details_unique").on(table.deliveryDetailsId),
    statusIdx: index("delivery_orders_status_idx").on(table.status),
    provinceIdx: index("delivery_orders_province_idx").on(table.provinceId),
  }),
);

export const deliveryOrderStatusHistoryTable = pgTable("delivery_order_status_history", {
  id: serial("id").primaryKey(),
  deliveryOrderId: integer("delivery_order_id").notNull().references(() => deliveryOrdersTable.id, { onDelete: "cascade" }),
  status: varchar("status", { length: 30 }).notNull(),
  reason: text("reason"),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => staffTable.id),
  createdByName: text("created_by_name").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type DeliveryDetail = typeof deliveryDetailsTable.$inferSelect;
export type InsertDeliveryDetail = typeof deliveryDetailsTable.$inferInsert;
export type DeliveryOrder = typeof deliveryOrdersTable.$inferSelect;
export type InsertDeliveryOrder = typeof deliveryOrdersTable.$inferInsert;
export type DeliveryOrderStatusHistory = typeof deliveryOrderStatusHistoryTable.$inferSelect;
