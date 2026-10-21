import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Booking products show the stock a product can really draw on.
const api = readFileSync("src/server/api.ts", "utf8");
const workspace = readFileSync("src/views/admin/booking-operations-workspace.tsx", "utf8");
const slice = (start, end) => {
  const from = api.indexOf(start);
  assert.ok(from >= 0, `missing: ${start}`);
  return api.slice(from, end ? api.indexOf(end, from) : from + 4000);
};

// 1. A product sharing stock reads the stock owner's quantity (its own stock is kept at 0)
//    and every product in that pool counts against it.
const summary = slice("async function getProductStockSummary(", "type ReservationItem");
assert.match(summary, /productSharedStockId\(product\)\s*\?\s*\(\(await getStockOwnerProduct\(productId\)\)\?\.stockProduct \?\? product\)/);
assert.match(summary, /: Number\(owner\.stock \?\? 0\);/, "non-variant stock comes from the stock owner");
assert.doesNotMatch(summary, /: Number\(product\.stock \?\? 0\);/, "a linked product's own stock (0) is never used");
assert.match(summary, /loadPoolReserved\(ownerId, options\.excludeSource\)/);
assert.match(summary, /stockOwnerName: ownerId !== productId \?/);
const pool = slice("async function loadPoolReserved(", "// Full stock summary");
assert.match(pool, /with recursive pool as \(\s*select id from products where id = \$\{ownerId\}\s*union\s*select p\.id from products p join pool on p\.shared_stock_product_id = pool\.id\s*\)/, "the pool follows chains of linked products");
assert.match(pool, /r\.status = 'reserved' and r\.variant_id is null and r\.product_id in \(select id from pool\)/);
assert.match(pool, /and not \(r\.source_type = \$\{excludeSource\.type\} and r\.source_id = \$\{excludeSource\.id\}\)/);

// 2. Saving a booking checks the same pool, so linked products are not refused for "no stock";
//    two lines drawing on one pool cannot overbook it together.
const check = slice("async function checkAvailability(", "// Bookings/orders currently reserving");
assert.match(check, /getProductStockSummary\(p, \{ excludeSource \}\)/);
assert.match(check, /requestedFromPool\.get\(summary\.stockOwnerId\)/);
assert.match(check, /requestedFromPool\.set\(summary\.stockOwnerId, already \+ requested\)/);

// 3. The booking's own holds do not reduce what the booking itself sees as available.
const products = slice("async function bookingOperationProducts(", "async function bookingOperationAssets(");
assert.match(products, /getProductStockSummary\(product, \{ excludeSource: \{ type: reference\.entityType, id: reference\.id \} \}\)/);
assert.match(products, /variants: \(stock\?\.variants \?\? \[\]\)\.map/, "each line carries its variants");
assert.match(products, /category: stock\?\.category \?\? null/);
const catalog = slice('if (resource === "catalog" && method === "GET") {', 'if (resource === "products") {');
assert.match(catalog, /getProductStockSummary\(product, \{ excludeSource: \{ type: reference\.entityType, id: reference\.id \} \}\)/);

// 4. The products tab lists every search result and does not depend on the search for a line's variants.
assert.doesNotMatch(workspace, /catalog\.data\?\.data\?\.slice\(0, 8\)/, "the store picker is not capped at 8 results");
assert.match(workspace, /const variants = item\?\.variants \?\? line\.variants \?\? \[\];/);
assert.match(workspace, /مخزون مشترك مع \$\{line\.stockOwnerName\}/);

console.log("PASS  booking products: shared stock pools, booking-own holds, save check, products tab");
