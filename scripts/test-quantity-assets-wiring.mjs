import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Wiring contract for quantity-based assets: one master asset, existing systems reused.
const read = (path) => readFileSync(path, "utf8");
const api = read("src/server/api.ts");
const migration = read("lib/db/migrations/0124_quantity_assets.sql");
const schema = read("lib/db/src/schema/admin-extensions.ts");
const kosha = read("src/server/kosha-equipment.ts");
const sale = read("src/server/asset-sale-logic.ts");
const assetForm = read("src/views/admin/asset-new.tsx");
const panel = read("src/views/admin/quantity-asset-panel.tsx");
const list = read("src/views/admin/operations.tsx");
const workspace = read("src/views/admin/booking-operations-workspace.tsx");
const gate = read("src/views/admin/asset-gate.tsx");
const dialog = read("src/views/admin/quantity-booking-asset-dialog.tsx");

// Database: one additive table, no rewrite of existing assets or stock.
assert.match(migration, /CREATE TABLE IF NOT EXISTS "asset_quantity_profiles"/);
assert.doesNotMatch(
  migration,
  /\b(?:DROP|TRUNCATE|DELETE\s+FROM|UPDATE\b|ALTER\s+TABLE|RENAME)\b/i,
  "migration is additive only",
);
assert.match(migration, /CHECK \("tracking_mode" IN \('individual', 'quantity'\)\)/);
assert.match(migration, /"quantity_missing" >= 0/);
assert.match(migration, /UNIQUE INDEX IF NOT EXISTS "asset_quantity_profiles_product_idx"/);
assert.doesNotMatch(migration, /quantity_total|quantity_in_warehouse/, "no parallel warehouse balance");
assert.match(schema, /export const assetQuantityProfilesTable = pgTable\("asset_quantity_profiles"/);

// Booking lifecycle: quantity assets branch before the individual custody flow.
const locked = api.slice(api.indexOf("async function executeLockedBookingAssetAction"));
const branch = locked.indexOf("executeQuantityBookingAction(db");
assert.ok(branch > 0, "locked booking action delegates quantity assets");
assert.ok(branch < locked.indexOf("assetConflictForBooking("), "quantity branch runs before the one-booking-per-day conflict");
assert.ok(branch < locked.indexOf("insert(equipmentCustodyTable)"), "quantity branch runs before per-piece custody");
assert.equal(
  (api.match(/withQuantityAssetErrors\(\(\) =>\s*executeBookingAssetAction\(/g) ?? []).length,
  2,
  "both booking asset callers convert rule errors after rollback",
);
assert.match(api, /bookingAssetActionReportsProblem\(input\) &&\s*!can\("asset_damage_record"\)/);
assert.match(api, /requestId: z\.string\(\)\.trim\(\)\.min\(8\)\.max\(80\)\.optional\(\)/);

// Admin endpoints, guards and read models.
for (const route of ['quantityAction === "tracking"', 'quantityAction === "adjust"', 'quantityAction === "movements"'])
  assert.ok(api.includes(route), `missing ${route}`);
assert.match(api, /TOTAL_CHANGING_ADJUSTMENTS\.includes\(input\.kind\) && !managerRole/);
assert.match(api, /كمية الأصل متعدد الكمية لا تُعدّل من بطاقة المنتج/);
// Individual custody quantity rejection is executed by test-quantity-assets.ts;
// extraction to a transaction-only helper must not depend on message placement.
assert.match(api, /مجموعات العهدة تتبع القطع الفردية/);
assert.match(api, /action !== "inspection" &&\s*\(await quantityProfilesFor\(db, \[productId\]\)\)\.has\(productId\)/);
assert.match(api, /quantityTracked: \(await quantityProfilesFor\(db, \[productId\]\)\)\.has\(productId\)/);
assert.match(sale, /if \(input\.quantityTracked\)/);
assert.match(api, /trackingMode: quantity \? "quantity" : "individual",\s*imageUrl:/, "QR scan returns the quantity picture");
assert.match(api, /case "low_availability": return row\.lowAvailability;/);
assert.match(api, /quantityListFigures\(\s*db,/);
assert.match(kosha, /quantityAvailability\(tx, \{/);
assert.match(kosha, /reservedQty: groupQuantity/);

// UI.
for (const label of ["طريقة تتبع الأصل", "أصل متعدد الكمية", "أصل فردي", "وحدة القياس", "الكمية الإجمالية", "تكلفة القطعة", "القيمة الإجمالية", "تكلفة الاقتناء الإجمالية"])
  assert.ok(assetForm.includes(label) || read("src/lib/quantity-assets.ts").includes(label), `asset form label ${label}`);
assert.match(assetForm, /stock: quantityMode \? totalQuantityValue : 1/, "opening quantity uses the product initial stock movement");
assert.match(assetForm, /<QuantityAssetPanel productId=\{editProductId\} \/>/);
assert.match(api, /parts\[3\] === "status"\)\s*return json\(\{ ready: await quantityAssetsSchemaReady\(db\) \}\)/);
assert.ok(
  assetForm.indexOf('"/admin/assets/quantity/status"') < assetForm.indexOf("const result = await persist(mode)"),
  "quantity readiness is checked before any record is created",
);
for (const label of ["إدارة الكميات", "إجمالي الكمية", "المتوفر", "المحجوز", "الخارج", "التالف", "الصيانة", "المفقود", "إضافة كمية", "تعديل جرد", "عرض حركات الكمية", "طباعة QR", "الحجوزات المرتبطة", "تحويل بين المستودعات"])
  assert.ok(panel.includes(label), `panel label ${label}`);
assert.match(panel, /requestId: dialog\.requestId/);
assert.match(panel, /\/admin\/warehouse-transfers/, "transfers reuse the approval-gated warehouse transfer flow");
for (const filter of ['["individual", "أصول فردية"]', '["quantity", "متعددة الكمية"]', '["low_availability", "توفر منخفض"]'])
  assert.ok(list.includes(filter), `list filter ${filter}`);
assert.match(list, /التتبع والكمية/);
assert.match(workspace, /<QuantityBookingAssetDialog endpoint=\{`\$\{base\}\/assets`\}/);
assert.match(gate, /res\.trackingMode === "quantity"/);
assert.match(gate, /\/admin\/booking-operations\/kosha\/\$\{booking\.id\}\/assets/);
assert.match(dialog, /goodQuantity: good,\s*damagedQuantity: damaged,\s*missingQuantity: missing/);
assert.match(dialog, /requestId, confirmation: true/);
assert.doesNotMatch(dialog + panel, /<button\b/, "shadcn Button only");

console.log("PASS  quantity asset wiring: additive schema, booking branch, guards, endpoints, Koshah, UI");
