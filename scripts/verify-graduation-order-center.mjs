/** Read-only contract verification for the unified Graduation Order Center. */
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const schema = read("lib/db/src/schema/graduation.ts");
const migration = read("lib/db/migrations/0066_graduation_order_center.sql");
const server = read("src/server/graduation-operations.ts");
const core = read("src/server/graduation.ts");
const api = read("src/server/api.ts");
const ui = read("src/views/admin/graduation-order-center.tsx");
const admin = read("src/views/admin/graduation.tsx");
const publicTracking = read("src/views/graduation.tsx");

const checks = [
  ["unified individual/group order model", schema.includes('orderType: varchar("order_type"') && schema.includes('groupId: integer("group_id"')],
  ["permanent unique student code", migration.includes("graduation_orders_student_code_idx") && migration.includes("CREATE UNIQUE INDEX")],
  ["unique group student link", migration.includes("graduation_group_students_order_idx") && migration.includes("graduation_group_students_code_idx")],
  ["idempotent student payment allocation", migration.includes("graduation_student_payments_idempotency_idx") && server.includes("idempotencyKey")],
  ["all group payment strategies", ["equal", "oldest", "selected", "manual", "unallocated"].every((value) => server.includes(`\"${value}\"`) && ui.includes(`value=\"${value}\"`))],
  ["individual and group receipts", server.includes("receiptForOrder") && server.includes("groupReceipt") && ui.includes("thermalReceiptCss") && ui.includes("sheetReportCss")],
  ["QR and barcode output", server.includes("QRCode.toDataURL") && ui.includes("JsBarcode") && publicTracking.includes("qrDataUrl")],
  ["immutable template versions", schema.includes("graduationTemplateVersionsTable") && server.includes("currentVersion") && server.includes("templateSnapshot")],
  ["approval and correction workflow", core.includes('action === "approve" ? "approved" : "correction_requested"') && publicTracking.includes('approve.mutate("correction")')],
  ["production and delivery event history", schema.includes("graduationProductionEventsTable") && schema.includes("graduationDeliveryEventsTable") && server.includes("graduation_delivery_confirmed")],
  ["editable group student table", ui.includes("EditableCell") && ui.includes("ImportStudentsDialog") && ui.includes("writeFile")],
  ["group totals and shortage center", server.includes("materialRequirements") && server.includes("shortages") && server.includes("missingData")],
  ["requested graduation permissions", ["graduation.view", "graduation.group.edit", "graduation.payment.receive", "graduation.delivery.confirm"].every((permission) => api.includes(permission))],
  ["admin sections are wired", ["individual", "students", "templates"].every((section) => admin.includes(`mode === \"${section}\"`))],
  ["new groups use permanent year code", core.includes("AJN-GROUP-${groupYear}-")],
  ["no physical deletion of graduation orders", !server.includes("delete(graduationOrdersTable)") && !migration.toLowerCase().includes("drop table graduation_")],
];

let failed = false;
for (const [name, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}`);
  if (!passed) failed = true;
}

if (failed) process.exit(1);
console.log(`Graduation Order Center contract checks passed (${checks.length}/${checks.length})`);
