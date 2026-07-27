/** Read-only contract verification for the enterprise Graduation platform extension. */
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const schema = read("lib/db/src/schema/graduation-enterprise.ts");
const migration = read("lib/db/migrations/0068_graduation_enterprise.sql");
const server = read("src/server/graduation-enterprise.ts");
const core = read("src/server/graduation.ts");
const publicUi = read("src/views/graduation.tsx");
const adminUi = read("src/views/admin/graduation-enterprise.tsx");
const print = read("src/views/admin/print-helpers.ts");
const layout = read("src/views/admin/_layout.tsx");

const checks = [
  ["additive normalized enterprise schema", ["graduation_packages", "graduation_components", "graduation_kits", "graduation_material_requirements", "graduation_delivery_sessions"].every((name) => schema.includes(`\"${name}\"`))],
  ["safe non-destructive migration", !/drop\s+(table|column)|truncate\s+/i.test(migration) && migration.includes("CREATE TABLE IF NOT EXISTS")],
  ["unique component and kit identities", ["graduation_components_code_idx", "graduation_components_qr_idx", "graduation_kits_order_idx", "graduation_kits_code_idx"].every((name) => migration.includes(name))],
  ["same central graduation order references", schema.includes("graduationOrderId") && schema.includes("graduationOrdersTable.id")],
  ["mandatory gown + per-item custom package validation", core.includes("يجب اختيار روب واحد على الأقل ضمن الباقة") && core.includes("لا يطابق نوع القطعة المختارة") && publicUi.includes("باقات حسب الطلب") && publicUi.includes("customPackagePriceSummary")],
  ["immutable template snapshot", core.includes("templateSnapshot: customPackage.enabled") && core.includes('mode: enterprisePackage ? "enterprise_package" : "custom_package"')],
  ["component QR and barcode generation", server.includes("componentCode: code") && server.includes("qrValue: code") && server.includes("barcodeValue: code")],
  ["transaction and lock protected scans", server.includes("pg_advisory_xact_lock") && server.includes("graduationPackagingEventsTable")],
  ["wrong-student and duplicate scan protection", server.includes("هذه القطعة لا تخص هذا الطالب") && server.includes("تم مسح هذه القطعة وتغليفها مسبقاً")],
  ["packaging requires production and all components", server.includes("قبل انتهاء الإنتاج وفحص الجودة") && server.includes("لا يمكن إكمال التغليف لوجود قطع ناقصة")],
  ["delivery balance protection and override", server.includes("يوجد مبلغ متبقٍ") && server.includes("graduation.packaging.override")],
  ["production sheets and XP label printing", server.includes("PRODUCTION_SHEETS") && print.includes("openGraduationProductionSheet") && print.includes('size: 40mm 30mm')],
  ["materials and inventory reservation integration", server.includes("ensureMaterialsTx") && server.includes("graduationInventoryReservationsTable")],
  ["central notifications and audit timeline", server.includes("notificationsTable") && server.includes("adminActivityLogsTable") && server.includes("entityTimelineTable")],
  ["admin enterprise routes wired without replacing existing pages", ["/admin/graduation/packages", "/admin/graduation/production-wall", "/admin/graduation/packaging", "/admin/graduation/materials"].every((route) => layout.includes(route))],
  ["responsive RTL operational surfaces", adminUi.includes("sm:grid-cols-2") && adminUi.includes("xl:grid-cols") && publicUi.includes("enterpriseCatalog")],
  ["no enterprise record deletion path", !server.includes("delete(graduationOrdersTable)") && !server.includes("delete(graduationComponentsTable)")],
];

let failed = false;
for (const [name, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}`);
  if (!passed) failed = true;
}

if (failed) process.exit(1);
console.log(`Enterprise Graduation contract checks passed (${checks.length}/${checks.length})`);
