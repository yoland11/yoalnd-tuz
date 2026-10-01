import { readFileSync } from "node:fs";

const migrations = new URL("../lib/db/migrations/0115_kosha_cost_center_links.sql", import.meta.url);
const koshasSchema = readFileSync(new URL("../lib/db/src/schema/koshas.ts", import.meta.url), "utf8");
const purchaseSchema = readFileSync(new URL("../lib/db/src/schema/purchase-invoices.ts", import.meta.url), "utf8");
const accountingSchema = readFileSync(new URL("../lib/db/src/schema/accounting.ts", import.meta.url), "utf8");
const financeView = readFileSync(new URL("../src/views/admin/kosha-finance.tsx", import.meta.url), "utf8");
const adminRoutes = readFileSync(new URL("../src/views/admin/index.tsx", import.meta.url), "utf8");
const operationsSchema = readFileSync(new URL("../lib/db/src/schema/kosha-finance.ts", import.meta.url), "utf8");
const operationsMigration = readFileSync(new URL("../lib/db/migrations/0117_kosha_operations.sql", import.meta.url), "utf8");
const migrationRunner = readFileSync(new URL("./apply-reviewed-schema-migration.ts", import.meta.url), "utf8");
const staffPortal = readFileSync(new URL("../src/views/staff/index.tsx", import.meta.url), "utf8");
const projectCostMigration = readFileSync(new URL("../lib/db/migrations/0118_kosha_construction_cost_links.sql", import.meta.url), "utf8");
let failures = 0;
function check(label, condition) {
  if (condition) console.log(`PASS ${label}`);
  else { failures += 1; console.error(`FAIL ${label}`); }
}

let migration = "";
try { migration = readFileSync(migrations, "utf8"); } catch { /* asserted below */ }
check("Koshah has an optional legacy-compatible financial code and unique ORM index", /financialCode: varchar\("financial_code"/.test(koshasSchema) && !/financialCode: varchar\("financial_code"[^\n]*\)\.notNull\(\)/.test(koshasSchema) && /uniqueIndex\("koshas_financial_code_idx"\)/.test(koshasSchema));
check("purchase line has nullable cost-center and booking links", /costCategory: varchar\("cost_category"/.test(purchaseSchema) && /koshaId: integer\("kosha_id"\)\.references/.test(purchaseSchema) && /bookingId: integer\("booking_id"\)\.references/.test(purchaseSchema));
check("purchase line can link one shared asset product", /assetProductId: integer\("asset_product_id"\)\.references/.test(purchaseSchema));
check("migration adds Koshah code without rewriting legacy rows", /ADD COLUMN IF NOT EXISTS\s+"financial_code"\s+varchar/i.test(migration) && !/^\s*UPDATE\s+"koshas"/im.test(migration));
check("migration adds nullable purchase-line references and indexes", /ALTER TABLE\s+"purchase_invoice_items"/i.test(migration) && /ADD COLUMN IF NOT EXISTS\s+"cost_category"\s+varchar/i.test(migration) && /purchase_invoice_items_kosha/i.test(migration));
check("migration does not rewrite purchase, payment or historical booking amounts", !/^\s*(UPDATE|DELETE|DROP|TRUNCATE)\s+(purchase_invoice_items|purchase_invoices|financial_transactions|kosha_bookings)\b/im.test(migration));
const api = readFileSync(new URL("../src/server/api.ts", import.meta.url), "utf8");
check("Koshah creation reserves a database sequence ID and writes its stable code", /pg_get_serial_sequence\('koshas',\s*'id'\)/.test(api) && /financialCode:\s*`KOSHA-\$\{String\(nextId\)\.padStart\(10,\s*"0"\)\}`/.test(api));
const expenseMigrationUrl = new URL("../lib/db/migrations/0116_kosha_expense_links.sql", import.meta.url);
let expenseMigration = "";
try { expenseMigration = readFileSync(expenseMigrationUrl, "utf8"); } catch { /* asserted below */ }
check("existing expense rows gain optional Koshah/category/booking links", /koshaId: integer\("kosha_id"\)\.references/.test(accountingSchema) && /costCategory: varchar\("cost_category"/.test(accountingSchema) && /bookingId: integer\("booking_id"\)\.references/.test(accountingSchema));
check("expense migration is additive and leaves all old rows unclassified", /ALTER TABLE\s+"expenses"/i.test(expenseMigration) && /ADD COLUMN IF NOT EXISTS\s+"kosha_id"/i.test(expenseMigration) && /ADD COLUMN IF NOT EXISTS\s+"cost_category"/i.test(expenseMigration) && !/^\s*UPDATE\s+"expenses"/im.test(expenseMigration));
check("expense feature reuses pending AJN financial requests", /approvalStatus:\s*"pending"/.test(api) && /createSourceFinancialRequest\(/.test(api) && /validateExpenseKoshaReferences/.test(api));
check("purchase Koshah links persist per line in both create and update", (api.match(/assetProductId:\s*item\.assetProductId\s*\?\?\s*null/g) ?? []).length >= 2 && /validatePurchaseKoshaItems\(items\)/.test(api) && /validatePurchaseKoshaItems\(newItems\)/.test(api));
check("supplier payments remain canonical source settlements", /sourceType:\s*"purchase_invoice"/.test(api) && /sourceEvent:\s*`supplier_payment:\$\{idempotencyKey/.test(api));
check("Koshah finance read endpoint requires accounting permission and uses canonical executed transactions", /section === "kosha-finance"[\s\S]{0,220}requirePermission\(req, "accounting"\)/.test(api) && /approvalStatus === "executed"/.test(api) && /financialTransactionsTable\.sourceType, "kosha_booking"/.test(api));
check("Koshah statement includes vehicle costs by the same executed financial transaction ID", /vehicleRows\.map\(\(row\) => row\.financialTransactionId\)/.test(api) && /sourceKey: `financial:\$\{transaction\.id\}`/.test(api) && /uniqueStatementCosts/.test(api));
check("supplier balances reconcile only executed settlements and investment recovery is lifetime-scoped", /paidByInvoice\.set/.test(api) && /transaction\.approvalStatus !== "executed"/.test(api) && /lifetimeSummary\.recoveredInvestment/.test(api));
check("Koshah finance page exposes the statement and Arabic management tabs behind an accounting route", /admin\/kosha-finance\/:id/.test(adminRoutes) && /aria-label="تبويبات حساب الكوشة"/.test(financeView) && ["نظرة عامة", "المواد", "المشتريات", "المصاريف", "الأصول", "الصيانة", "الحجوزات", "تكاليف الحجوزات", "التلف والفقدان", "حساب الكوشة", "الاستثمار", "السجل"].every((label) => financeView.includes(label)));
check("Koshah damage history reuses the legacy booking table without changing its required booking constraint", ["koshaConstructionProjectsTable", "koshaAssetAssignmentsTable", "koshaMaintenanceRecordsTable", "koshaDamageReportsTable"].every((name) => operationsSchema.includes(name)) && ["kosha_construction_projects", "kosha_asset_assignments", "kosha_maintenance_records"].every((name) => operationsMigration.includes(`CREATE TABLE IF NOT EXISTS \"${name}\"`)) && /ALTER TABLE \"kosha_damage_reports\"[\s\S]*ADD COLUMN IF NOT EXISTS \"kosha_id\"/i.test(operationsMigration) && !/ALTER COLUMN \"booking_id\"/i.test(operationsMigration) && !/CREATE TABLE IF NOT EXISTS \"kosha_damage_reports\"/i.test(operationsMigration) && /bookingId: integer\("booking_id"\)\.notNull\(\)/.test(operationsSchema) && /if \(!bookingId\) return error\("الحجز مطلوب لتسجيل بلاغ التلف أو الفقدان"/.test(api) && /description: text\("description"\)\.notNull\(\)/.test(operationsSchema) && /photoUrl: text\("photo_url"\)/.test(operationsSchema) && !/safeNullableRelaxation/.test(migrationRunner));
check("shared assets preserve one product identity and maintenance costs point to canonical expenses", /uniqueIndex\("kosha_asset_assignments_active_product_idx"\)/.test(operationsSchema) && /expense_id.*REFERENCES "expenses"/.test(operationsMigration));
check("Koshah operational writes require accounting, audit actions and no duplicate cash posting", /section === "kosha-finance"[\s\S]{0,220}requirePermission\(req, "accounting"\)/.test(api) && /kosha_construction_project_created/.test(api) && /kosha_asset_assigned/.test(api) && /kosha_maintenance_recorded/.test(api) && /kosha_damage_reported/.test(api) && !/if \(method === "POST" && koshaSection === "maintenance"\)[\s\S]{0,900}createSourceFinancialRequest/.test(api));
check("Koshah QR opens an authenticated staff passport and does not expose finance publicly", /publicQrTarget\([\s\S]{0,500}entityType === "kosha"/.test(api) && /const safeTarget = row\.entityType === "kosha"/.test(api) && /resource === "passport"/.test(api) && /\/staff\/koshas\/passport\/:id/.test(staffPortal));
check("preparation readiness uses existing work-order checklist and asset records", /koshaWorkOrderChecklistTable/.test(api) && /koshaWorkOrderAssetsTable/.test(api) && /upcomingPreparations/.test(api) && /إنشاء طلب تجهيز/.test(financeView));
check("construction project cost links are nullable, investment-only and keep old rows untouched", /constructionProjectId: integer\("construction_project_id"\)\.references\(\(\) => koshaConstructionProjectsTable\.id/.test(accountingSchema) && /constructionProjectId: integer\("construction_project_id"\)\.references\(\(\) => koshaConstructionProjectsTable\.id/.test(purchaseSchema) && /ADD COLUMN IF NOT EXISTS "construction_project_id" integer[\s\S]*REFERENCES "kosha_construction_projects"/i.test(projectCostMigration) && !/^\s*UPDATE\s+(expenses|purchase_invoice_items)/im.test(projectCostMigration) && api.includes("actualInvestmentByProject") && api.includes("item.constructionProjectId"));

check("Koshah finance detail displays the existing main image with a useful fallback", /mainImage\?: string \| null/.test(financeView) && /data\.kosha\.mainImage/.test(financeView) && /alt=\{data\.kosha\.name\}/.test(financeView) && /\/images\/kosha\.png/.test(financeView));
if (failures) process.exit(1);
console.log("Koshah cost-center schema contract verified.");
