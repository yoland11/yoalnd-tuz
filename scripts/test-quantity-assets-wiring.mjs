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
const manager = read("src/views/admin/quantity-manager.tsx");
const quantityServer = read("src/server/quantity-assets.ts");
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
// The status handler must use its locked transaction, not the global connection.
// Actual rejection/rollback is also exercised by test-asset-status-action.cjs.
assert.match(api, /action !== "inspection" &&\s*\(await quantityProfilesFor\(tx, \[productId\]\)\)\.has\(productId\)/);
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
// «إدارة الكميات» lives inside the «طريقة تتبع الأصل» section of the edit page.
const trackingSection = assetForm.indexOf('<Section title="طريقة تتبع الأصل"');
const managerAt = assetForm.indexOf("<QuantityManager productId={editProductId}");
assert.ok(trackingSection > 0 && managerAt > trackingSection, "manager renders in the tracking section");
assert.ok(managerAt < assetForm.indexOf('<Section title="بيانات الشراء">'), "manager stays inside the tracking section");
assert.match(assetForm, /isEditMode && savedTracking === "quantity" \? \(\s*<div className="mt-4 space-y-4 border-t border-border\/30 pt-4" id="quantities">/);
assert.match(assetForm, /isEditMode && savedTracking === "quantity" \? null : \(\s*<Field label="الكمية الإجمالية">/, "no direct total edit after the first save");
assert.match(assetForm, /onChanged=\{syncQuantityFields\}/, "«تحديث الأصل» never writes stale totals back");
assert.match(assetForm, /purchaseCost: fresh\.profile\?\.purchasePrice != null/);
assert.doesNotMatch(assetForm, /<QuantityAssetPanel/, "no second quantity panel above the form");
assert.match(api, /parts\[3\] === "status"\)\s*return json\(\{ ready: await quantityAssetsSchemaReady\(db\) \}\)/);
assert.ok(
  assetForm.indexOf('"/admin/assets/quantity/status"') < assetForm.indexOf("const result = await persist(mode)"),
  "quantity readiness is checked before any record is created",
);
for (const label of ["إدارة الكميات", "الكمية الإجمالية", "المتوفر", "المحجوز", "الخارج", "التالف", "الصيانة", "المفقود", "إضافة كمية", "تخفيض كمية", "تسوية جرد", "تسجيل تلف", "تسجيل فقدان", "عرض سجل الحركات", "طباعة QR", "تحويل بين المستودعات", "إضافة كمية إلى الأصل", "تخفيض كمية الأصل", "سجل حركات الكميات", "لا يمكن تعديل الكمية الإجمالية مباشرة"])
  assert.ok(manager.includes(label), `manager label ${label}`);
assert.ok(panel.includes("الحجوزات المرتبطة") && panel.includes("فحص التوفر بتاريخ"), "availability by date and linked bookings stay visible");
// One menu: the six requested actions in order, then the controlled extras.
assert.match(manager, /const MAIN: QuantityAdjustmentKind\[\] = \["add", "reduce", "count", "damage", "loss"\];/);
assert.match(manager, /<DropdownMenu dir="rtl">[\s\S]*MAIN\.map[\s\S]*عرض سجل الحركات[\s\S]*MORE\.map/);
assert.match(manager, /requestId: dialog\.requestId/, "one durable request id per dialog (retries replay)");
assert.match(manager, /\/admin\/warehouse-transfers/, "transfers reuse the approval-gated warehouse transfer flow");
for (const field of ["notes:", "responsibleStaffId:", "photos: form.photos.map", "additionalToReturn: form.additional"])
  assert.ok(manager.includes(field), `manager sends ${field}`);
assert.match(manager, /\/movements\?\$\{params\}/, "history is filtered and paged on the server");
assert.doesNotMatch(manager, /cash-box|financial-transactions|\/expenses|journal/i, "quantity actions never post to accounting or the cash box");
assert.doesNotMatch(manager, /<button\b/, "shadcn Button only");
// Server: one stock movement per action, guarded against double counting.
for (const field of ["notes: z.string().trim().max(2000)", "responsibleStaffId: z.coerce.number()", "photos: z.array(z.string().trim().max(4000)).max(10)", "additionalToReturn: z.boolean()"])
  assert.ok(api.includes(field), `adjust schema ${field}`);
assert.match(quantityServer, /const guards = await adjustmentGuards\(executor, input\);\s*const plan = planQuantityAdjustment/, "guards run under the asset lock before any write");
assert.match(quantityServer, /reason like 'purchase_invoice%'/);
assert.match(quantityServer, /metadata->>'action' = \$\{action\}/);
assert.match(api, /quantityMovements\(db, productId, \{\s*from: params\.get\("from"\),/);
for (const filter of ['["individual", "أصول فردية"]', '["quantity", "متعددة الكمية"]', '["low_availability", "توفر منخفض"]'])
  assert.ok(list.includes(filter), `list filter ${filter}`);
assert.match(list, /التتبع والكمية/);
assert.match(workspace, /<QuantityBookingAssetDialog endpoint=\{`\$\{base\}\/assets`\}/);
assert.match(gate, /res\.trackingMode === "quantity"/);
assert.match(gate, /\/admin\/booking-operations\/kosha\/\$\{booking\.id\}\/assets/);
assert.match(dialog, /goodQuantity: good,\s*damagedQuantity: damaged,\s*missingQuantity: missing/);
assert.match(dialog, /requestId, confirmation: true/);
assert.doesNotMatch(dialog + panel + manager, /<button\b/, "shadcn Button only");

console.log("PASS  quantity asset wiring: additive schema, booking branch, guards, endpoints, Koshah, UI");
