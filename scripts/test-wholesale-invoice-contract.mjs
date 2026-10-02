import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const api = readFileSync("src/server/api.ts", "utf8");
const pos = readFileSync("src/views/admin/pos.tsx", "utf8");
const priceResolver = readFileSync("src/server/wholesale-pricing.ts", "utf8");
const migration = readFileSync("lib/db/migrations/0119_wholesale_sales.sql", "utf8");

assert.match(api, /saleType:\s*z\.enum\(\["retail",\s*"wholesale"\]\)/);
assert.match(api, /saleType:\s*salesInvoicesTable\.saleType/);
assert.match(api, /resolveWholesaleUnitPrice\(/);
assert.match(api, /productWholesalePriceTiersTable/);
assert.match(api, /customerProductPricesTable/);
assert.match(api, /getCustomerAccountSummary\(\{ id: wholesaleCustomer\.id/);
assert.match(api, /wholesaleCustomer\.creditLimit/);
assert.match(api, /paymentStatus:\s*paidAmount > 0 \? "pending_approval"/);
assert.match(api, /deductSalesInvoiceStockInTransaction\(/);
assert.match(priceResolver, /source:\s*"customer"/);
assert.match(priceResolver, /source:\s*"tier"/);
assert.match(priceResolver, /source:\s*"base"/);
assert.match(priceResolver, /source:\s*"retail"/);
assert.match(pos, /wholesale-price-quote/);
assert.match(pos, /priceOverride:\s*Boolean\(i\.priceOverride\)/);
assert.match(pos, /saleType,\s*date:/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS product_wholesale_price_tiers/i);
assert.match(migration, /CREATE TABLE IF NOT EXISTS customer_product_prices/i);
assert.doesNotMatch(migration, /\b(DROP|TRUNCATE|DELETE FROM)\b/i);

console.log("Wholesale invoice integration contract passed.");
