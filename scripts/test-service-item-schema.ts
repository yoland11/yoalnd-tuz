import assert from "node:assert/strict";
import { getTableConfig } from "drizzle-orm/pg-core";
import { productsTable } from "../lib/db/src/schema/products";
import { salesInvoiceItemsTable } from "../lib/db/src/schema/sales-invoices";

const serviceSchema: any = await import("../lib/db/src/schema/services");

function columnNames(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).columns.map((column) => column.name);
}

const productColumns = columnNames(productsTable);
const invoiceItemColumns = columnNames(salesInvoiceItemsTable);

assert.ok(productColumns.includes("item_type"), "products must store product/service type");
assert.ok(productColumns.includes("service_unit"), "products must store selling unit");
assert.ok(productColumns.includes("track_inventory"), "products must store inventory tracking");
assert.ok(invoiceItemColumns.includes("unit_snapshot"), "invoice lines must snapshot unit");
assert.ok(invoiceItemColumns.includes("track_inventory_snapshot"), "invoice lines must snapshot inventory behavior");
assert.ok(serviceSchema.serviceOrderItemsTable, "service-order line table must be exported");

const itemColumns = columnNames(serviceSchema.serviceOrderItemsTable);
for (const name of ["service_order_id", "product_id", "product_name", "unit", "quantity", "unit_price", "discount", "total"]) {
  assert.ok(itemColumns.includes(name), `service-order items must include ${name}`);
}

const productConfig = getTableConfig(productsTable);
assert.equal(productConfig.columns.find((column) => column.name === "item_type")?.default, "product");
assert.equal(productConfig.columns.find((column) => column.name === "track_inventory")?.default, true);
assert.equal(getTableConfig(salesInvoiceItemsTable).columns.find((column) => column.name === "track_inventory_snapshot")?.notNull, false);

console.log("Service item schema contract passed.");
