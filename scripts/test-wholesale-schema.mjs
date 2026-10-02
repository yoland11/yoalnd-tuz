import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("lib/db/migrations/0119_wholesale_sales.sql", "utf8");
for (const table of ["product_wholesale_price_tiers", "customer_product_prices"]) {
  assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, "i"));
}
for (const column of [
  "customers.customer_type",
  "customers.business_name",
  "customers.credit_limit",
  "products.wholesale_price",
  "sales_invoices.sale_type",
]) {
  const [table, name] = column.split(".");
  assert.match(migration, new RegExp(`ALTER TABLE ${table}\\b[\\s\\S]*?ADD COLUMN IF NOT EXISTS ${name}\\b`, "i"));
}
assert.match(migration, /UNIQUE\s*\(product_id,\s*minimum_quantity\)/i);
assert.match(migration, /UNIQUE\s*\(customer_id,\s*product_id\)/i);
assert.doesNotMatch(migration, /\b(DROP|TRUNCATE|DELETE FROM|UPDATE\s+(customers|products|sales_invoices))\b/i);
console.log("Wholesale additive schema contract passed.");
