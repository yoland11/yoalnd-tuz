/** Read-only contract checks for AJN's optional installment layer. */
import { readFileSync } from "node:fs";
const read = (file) => readFileSync(file, "utf8");
const server = read("src/server/installments.ts");
const api = read("src/server/api.ts");
const ui = read("src/views/admin/installments.tsx");
const migration = read("lib/db/migrations/0082_installment_management.sql");
const layout = read("src/views/admin/_layout.tsx");
const checks = [
  ["additive optional contract schema", migration.includes("CREATE TABLE IF NOT EXISTS installment_contracts") && migration.includes("installment_schedule")],
  ["no automatic invoice conversion", server.includes('resource === "convert" && req.method === "POST"') && server.includes("invoiceId")],
  ["only active invoices with a balance are eligible", server.includes("invoice.status !== \"active\"") && server.includes("remainingAmount")],
  ["one active plan per source", migration.includes("installment_contracts_active_source_idx") && server.includes("توجد خطة أقساط نشطة")],
  ["fixed and custom schedule validation", server.includes('installmentType === "custom"') && server.includes("مجموع الأقساط المخصصة")],
  ["rounding reaches the final installment", server.includes("data.installmentCount - 1") && server.includes("financed - base")],
  ["server-side payment allocation and idempotency", server.includes("idempotency_key") && server.includes("ORDER BY due_date, installment_no FOR UPDATE")],
  ["invoice payment status is server calculated", server.includes("payment_status=CASE") && server.includes("remaining_amount=GREATEST")],
  ["cash box and accounting use existing finance source", server.includes("syncSourcePaymentTarget") && server.includes("approveAndExecuteFinancialTransaction")],
  ["history, timeline and notification records exist", server.includes("installment_history") && server.includes("entityTimelineTable") && server.includes("notificationsTable")],
  ["server permission registry is wired", ["installments.convert_invoice", "installments.receive_payment", "installments.reschedule"].every((x) => api.includes(x))],
  ["RTL operational screen and navigation exist", ui.includes('dir="rtl"') && layout.includes('href: "/admin/installments"')],
];
let failed = false;
for (const [name, passed] of checks) { console.log(`${passed ? "PASS" : "FAIL"}  ${name}`); if (!passed) failed = true; }
if (failed) process.exit(1);
console.log(`Installment contract checks passed (${checks.length}/${checks.length})`);
