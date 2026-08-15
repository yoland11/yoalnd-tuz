/** Read-only contract verification for AJN Research Center. */
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const schema = read("lib/db/src/schema/research-center.ts");
const migration = read("lib/db/migrations/0069_research_center.sql");
const server = read("src/server/research-center.ts");
const runtimeSchema = read("src/server/research-center-schema.ts");
const api = read("src/server/api.ts");
const adminUi = read("src/views/admin/research-center.tsx");
const publicUi = read("src/views/research.tsx");
const layout = read("src/views/admin/_layout.tsx");
const app = read("src/App.tsx");
const print = read("src/views/admin/print-helpers.ts");
const globalSearch = read("src/views/admin/global-search.tsx");

const checks = [
  ["normalized integrated schema", ["research_orders", "research_chapters", "research_sources", "research_files", "research_plagiarism_reports", "research_ai_generations"].every((table) => schema.includes(`\"${table}\"`))],
  ["additive non-destructive migration", migration.includes("CREATE TABLE IF NOT EXISTS") && !/drop\s+(table|column)|truncate\s+/i.test(migration)],
  ["stable research and QR identities", migration.includes("research_orders_no_idx") && migration.includes("research_orders_qr_idx") && server.includes("AJN-RS-${new Date().getFullYear()}-")],
  ["existing customers and invoices reused", schema.includes("customersTable.id") && schema.includes("salesInvoicesTable.id") && server.includes("salesInvoiceItemsTable")],
  ["existing AJN accounting flow reused atomically", server.includes("createAndExecuteSourceFinancialTransaction") && server.includes('sourceType: "research_order"') && server.includes("pg_advisory_xact_lock") && server.includes("idempotencyKey")],
  ["chapter versions and customer approvals", server.includes("researchChapterVersionsTable") && server.includes("revision_requested") && publicUi.includes("طلب تعديل")],
  ["versioned private Supabase file storage", server.includes("storage/v1/object/sign") && server.includes("RESEARCH_PRIVATE_BUCKET") && server.includes("researchFilesTable.version") && adminUi.includes("رفع إصدار")],
  ["six scholarly source adapters", ["searchCrossref", "searchOpenAlex", "searchSemantic", "searchPubMed", "searchDoaj", "searchArxiv"].every((adapter) => server.includes(adapter))],
  ["advanced source filters", ["author", "journal", "language", "category", "year"].every((filter) => adminUi.includes(`filters.${filter}`)) && server.includes('searchParams.get("author")')],
  ["Google Scholar safe external discovery", adminUi.includes("scholar.google.com/scholar")],
  ["customer source approval", schema.includes("selectedByCustomer") && server.includes("research_source_customer_selected") && publicUi.includes("المصادر المقترحة")],
  ["AI refuses unlinked or fabricated citations", server.includes("بعض المصادر المختارة غير مرتبطة") && server.includes("لا تخترع مراجع") && server.includes("تم رفض النص")],
  ["bibliography styles available", ["APA7", "IEEE", "MLA", "Harvard", "Chicago"].every((style) => server.includes(style))],
  ["notifications audit and timeline", server.includes("notificationsTable") && server.includes("adminActivityLogsTable") && server.includes("entityTimelineTable")],
  ["admin and public routes wired", api.includes("handleAdminResearch") && api.includes("handleResearchPublic") && app.includes('/research/track/:token')],
  ["complete research navigation", ["/admin/research/new", "/admin/research/orders", "/admin/research/sources", "/admin/research/ai", "/admin/research/reports"].every((route) => layout.includes(route))],
  ["global AJN search integration", api.includes('type: "research_order"') && globalSearch.includes("research_order")],
  ["shared print toolkit used", print.includes("openResearchReceiptPrint") && print.includes("sheetReportCss")],
  ["RTL responsive and dark-compatible surfaces", adminUi.includes('dir="rtl"') && adminUi.includes("sm:grid-cols") && publicUi.includes('dir="rtl"')],
  ["runtime request path performs no schema mutation", runtimeSchema.includes("select 1") && !/(create|alter|drop|truncate)\s+(table|index|column)/i.test(runtimeSchema)],
  ["no research order deletion path", !server.includes("delete(researchOrdersTable)")],
];

let failed = false;
for (const [name, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}`);
  if (!passed) failed = true;
}

if (failed) process.exit(1);
console.log(`AJN Research Center contract checks passed (${checks.length}/${checks.length})`);
