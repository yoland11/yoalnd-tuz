import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Wiring contract for مركز أوامر العمل: existing tasks and chat are reused, not duplicated.
const read = (path) => readFileSync(path, "utf8");
const api = read("src/server/api.ts");
const server = read("src/server/work-commands.ts");
const migration = read("lib/db/migrations/0126_work_command_center.sql");
const schema = read("lib/db/src/schema/enterprise.ts");
const portal = read("src/views/staff/unified-portal.tsx");
const routes = read("src/views/admin/index.tsx");
const layout = read("src/views/admin/_layout.tsx");

// Database: additive only, and the reviewed-migration runner accepts it.
assert.doesNotMatch(
  migration,
  /\b(?:DROP\s+(?:TABLE|COLUMN|INDEX|TYPE|SCHEMA)|TRUNCATE|DELETE\s+FROM|UPDATE\b|ALTER\s+TABLE[\s\S]*?\b(?:DROP\s+COLUMN|ALTER\s+COLUMN|RENAME\s+(?:COLUMN|TO)))\b/i,
  "0126 passes the reviewed-migration safety check",
);
assert.match(migration, /CREATE TABLE IF NOT EXISTS "work_orders" \(\s*"task_id" integer PRIMARY KEY REFERENCES "tasks"/, "a work order is a task; work_orders only extends it");
assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS "(?:work_tasks|work_messages|work_channels)"/, "no parallel task or chat tables");
assert.match(migration, /"internal_messages_client_key_idx"\s+ON "internal_messages" \("channel_id", "client_key"\) WHERE "client_key" IS NOT NULL/);
assert.match(migration, /"internal_channels_work_department_idx"/);
assert.match(schema, /export const workOrdersTable = pgTable\("work_orders"/);
assert.match(schema, /export const internalChannelReadsTable = pgTable\("internal_channel_reads"/);

// The server module stays out of finance, stock and bookings.
assert.doesNotMatch(
  server.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""),
  /\b(?:stock_movements|warehouse_stock|financial_transactions|cash_box\w*|payments|sales_invoices|purchase_invoices|journal_entries)\b/,
  "work orders never touch financial or inventory records",
);
// Bookings and customers are only read (to link an order to a customer's booking).
assert.doesNotMatch(
  server,
  /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:kosha_bookings|service_orders|customers)\b/i,
  "work orders never write bookings or customers",
);
assert.match(server, /export async function resolveOrderCustomer/, "the booking's own customer is resolved on the server");
// Editable order types and departments live in the existing settings table.
assert.match(server, /INSERT INTO settings \(key, value, updated_at\) VALUES \(\$\{CATALOG_SETTING\}/);
assert.doesNotMatch(read("lib/db/migrations/0126_work_command_center.sql"), /work_departments|work_order_types/, "no new tables for the catalog");
// The issue permission is part of the normal permission catalog on both sides.
assert.match(api, /"task_approve",\s*"work_orders\.issue",/);
assert.match(read("src/views/admin/_lib.ts"), /"task_approve",\s*"work_orders\.issue",/);
assert.match(read("src/views/admin/_lib.ts"), /"work_orders\.issue": "مركز أوامر العمل: إصدار أوامر"/);
assert.match(server, /canGrant: role === "admin" \|\| has\("staff"\)/, "granting follows the staff screen's permission rule");
assert.match(server, /FOR UPDATE/, "transitions lock the task row");
assert.match(server, /sp\.photo_url AS sender_photo[\s\S]{0,400}LEFT JOIN staff sp ON sp\.id = m\.sender_id/, "messages carry the sender's staff photo");
assert.match(server, /ON CONFLICT \(channel_id, client_key\) WHERE client_key IS NOT NULL DO NOTHING/, "message sends are idempotent");
assert.match(server, /return null;\s*\}\s*\n\s*export \{ ACTIVE_TASK_STATUSES \}/, "no transcription provider is wired");

// API: one section, per-object authorization, structured errors.
const section = api.slice(api.indexOf('if (section === "work-commands") {'), api.indexOf('if (section === "product-insights") {'));
assert.ok(section.length > 500, "work-commands section exists");
assert.match(section, /cause instanceof WorkCommandError\) return error\(cause\.message, cause\.status\)/);
for (const route of [
  /parts\[2\] === "catalog" && method === "PUT"/,
  /parts\[2\] === "team" && parts\[4\] === "issue" && method === "POST"/,
  /parts\[2\] === "customers" && parts\[4\] === "bookings"/,
  /!parts\[4\] && method === "PATCH"[\s\S]{0,120}updateWorkChannel/,
  /parts\[4\] === "archive" && method === "POST"/,
  /!parts\[4\] && method === "PATCH"[\s\S]{0,400}editWorkOrder/,
])
  assert.match(section, route);
assert.match(section, /"staff_permission_changed", "staff", staffId/, "permission changes are audited");
assert.match(section, /throw cause;/, "unknown failures reach the global handler with a request id");
assert.match(section, /voiceUrl\.startsWith\("data:"\)\) return error\("تعذر حفظ الرسالة الصوتية في التخزين، أعد المحاولة", 503/, "a failed upload is never saved inline");

// Existing task routes follow the same completion policy.
const complete = api.slice(api.indexOf('if (method === "POST" && parts[2] && parts[3] === "complete") {'), api.indexOf('if (method === "DELETE" && parts[2] && parts[3] === "photos" && parts[4]) {'));
assert.match(complete, /workOrderCompletionPolicy\(db, id!, photos\.length \+ files\.length\)/);
assert.match(complete, /status: nextStatus/);
const submit = api.slice(api.indexOf('if (method === "POST" && parts[2] && parts[3] === "submit") {'), api.indexOf('if (method === "POST" && parts[2] && parts[3] === "review") {'));
assert.match(submit, /workOrderCompletionPolicy\(db, id!, 0\)/);

// Legacy enterprise chat keeps working before 0126 (explicit columns) and hides new private channels.
const chatStart = api.indexOf('if (section === "chat") {');
const chat = api.slice(chatStart, api.indexOf(".insert(internalChannelsTable)", chatStart));
assert.match(chat, /columns: legacyInternalMessageColumns/);
assert.doesNotMatch(chat, /\.returning\(\);/, "no RETURNING * on internal_messages");
assert.ok(chat.includes("internalMessagesTable") && chat.length < 8000, "slice covers the message routes only");
assert.match(chat, /canReadInternalChannel\(/);
assert.match(api, /function canReadInternalChannel[\s\S]{0,300}\["work_department", "work_channel"\]/, "older channels keep their visibility");

// Daily sweep includes deadline alerts.
assert.match(api, /sweepWorkOrderDeadlines\(db, \(notice\) => createNotification\(notice\), \{ force: true \}\)/);

// UI entry points.
assert.match(routes, /<Route path="\/admin\/work-commands">/);
assert.match(layout, /href: "\/admin\/work-commands"/);
assert.match(portal, /\{tab === "work" \? <WorkCommandCenter mode="staff" \/> : null\}/);
assert.match(read("src/views/admin/booking-operations-workspace.tsx"), /<IssueWorkOrderButton defaults=\{\{ booking:/);
assert.match(read("src/views/admin/product-details.tsx"), /<CreateWorkOrderDialog/);

console.log("PASS  work commands wiring: additive migration, reused tasks/chat, policy gate, legacy chat, sweep, entry points");
