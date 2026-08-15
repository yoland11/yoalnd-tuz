/** Read-only contract checks for the Class Representatives Portal. */
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const server = read("src/server/representative.ts");
const api = read("src/server/api.ts");
const app = read("src/App.tsx");
const ui = read("src/views/representative/index.tsx");
const migration = read("lib/db/migrations/0081_representative_portal.sql");
const operations = read("src/server/graduation-operations.ts");
const compactUi = ui.replace(/\s+/g, " ");
const compactServer = server.replace(/\s+/g, " ");

const checks = [
  ["representative route is registered", app.includes('path="/representative/*"') && app.includes('path="/representative"')],
  ["server-side representative permissions exist", ["representative.portal.access", "representative.group.view", "representative.payments.create", "representative.reports.export"].every((permission) => api.includes(permission))],
  ["group access is server-enforced", server.includes("groupIdsFor") && server.includes("requireGroup") && server.includes("!ids.includes(groupId)")],
  ["representative has no implicit graduation-wide access", !server.includes('user.permissions.includes("graduation")')],
  ["payment recording remains pending", server.includes("status: \"pending\"") && server.includes("representative_payment_requests")],
  ["approved payment uses central graduation allocation", server.includes("receivePayment(") && operations.includes("export async function receivePayment")],
  ["duplicate approval is blocked", server.includes("status='processing'") && server.includes("AND status='pending' RETURNING *")],
  ["receipt is linked to central payment", server.includes("posted_payment_id") && server.includes("graduation_receipts") && ui.includes("طباعة الوصل")],
  ["print action is gated by permission and an existing receipt", compactUi.includes('hasPerm(me.data, "representative.receipts.print")') && compactUi.includes('item.status === "approved" && item.receiptNo')],
  ["receipt printing reuses the read-only server endpoint", ui.includes('`/payments/${item.id}/receipt`') && compactServer.includes('req.method === "GET"') && compactServer.includes("!receipt.receiptNo || !receipt.snapshot")],
  ["receipt action exposes loading and errors", ui.includes("printingId") && ui.includes("تعذرت طباعة الوصل")],
  ["custody confirmation is admin-only", server.includes("resource === \"custody\"") && server.includes("اعتماد تسليم العهدة متاح للإدارة فقط")],
  ["issues have a protected server endpoint", server.includes("resource === \"issues\"") && server.includes("representative.issues.create")],
  ["additive database migration exists", migration.includes("CREATE TABLE IF NOT EXISTS representative_group_assignments") && migration.includes("representative_payment_requests")],
  ["RTL responsive portal surface exists", ui.includes('dir="rtl"') && ui.includes("lg:grid-cols")],
];

let failed = false;
for (const [name, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}`);
  if (!passed) failed = true;
}
if (failed) process.exit(1);
console.log(`Representative Portal contract checks passed (${checks.length}/${checks.length})`);
