/** Photography Production Center: rules, scope, duplicate prevention and wiring (no database needed). */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, overrides = {}) {
  const filename = resolve(path);
  const module = { exports: {} };
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const localRequire = (name) => Object.hasOwn(overrides, name) ? overrides[name]
    : name.startsWith("@/") ? load(resolve("src", `${name.slice(2)}.ts`), overrides)
    : name.startsWith(".") ? load(resolve(dirname(filename), `${name}.ts`), overrides)
    : require(name);
  new Function("require", "module", "exports", output)(localRequire, module, module.exports);
  return module.exports;
}
const read = (path) => readFileSync(resolve(path), "utf8");

// ------------------------------------------------------------------ pure rules
const rules = load("src/lib/photography-production.ts");
{
  const t = (from, to, extra = {}) => rules.evaluateProductionTransition({ from, to, canManage: false, isAssignee: true, ...extra });
  assert.deepEqual(t("remaining", "in_progress"), { ok: true, reopen: false });
  assert.equal(t("remaining", "completed").ok, true, "small jobs may be completed directly");
  assert.equal(t("waiting_files", "completed").status, 422, "work waiting for files cannot jump to completed");
  assert.equal(t("in_progress", "in_progress").status, 409, "a no-op move is rejected");
  assert.equal(t("in_progress", "delivered").status, 422, "unknown statuses are rejected");
  assert.equal(t("remaining", "in_progress", { isAssignee: false }).status, 403, "only the assignee or a manager moves work");
  assert.equal(t("completed", "in_progress").status, 403, "an employee cannot reopen completed work");
  assert.equal(t("completed", "remaining", { canManage: true }).status, 422, "completed work only reopens to in-progress");
  assert.equal(t("completed", "in_progress", { canManage: true }).status, 422, "reopening needs a written reason");
  assert.deepEqual(t("completed", "in_progress", { canManage: true, reason: "تعديل طلبه الزبون" }), { ok: true, reopen: true });

  assert.equal(rules.isOverdue({ status: "in_progress", dueDate: "2026-10-11" }, "2026-10-12"), true);
  assert.equal(rules.isOverdue({ status: "completed", dueDate: "2026-10-01" }, "2026-10-12"), false, "completed work is never overdue");
  assert.equal(rules.isOverdue({ status: "remaining", dueDate: "2026-10-12" }, "2026-10-12"), false, "due today is not yet overdue");
  assert.equal(rules.isOverdue({ status: "remaining", dueDate: null }, "2026-10-12"), false);
  assert.equal(rules.displayStatus({ status: "waiting_files", dueDate: "2026-10-01" }, "2026-10-12"), "overdue");

  const none = rules.bookingProgress([]);
  assert.equal(none.complete, false, "a booking without production is never 'complete'");
  assert.equal(none.label, "لا يوجد أمر إنتاج");
  const partial = rules.bookingProgress([{ kind: "video", status: "completed" }, { kind: "album", status: "in_progress" }]);
  assert.deepEqual([partial.required, partial.completed, partial.percent, partial.complete], [2, 1, 50, false], "only requested deliverables count");
  assert.deepEqual(partial.remainingKinds, ["album"]);
  assert.equal(partial.label, "الإنتاج غير مكتمل");
  const done = rules.bookingProgress([{ kind: "photos", status: "completed" }]);
  assert.deepEqual([done.percent, done.complete, done.label], [100, true, "الإنتاج مكتمل"]);

  assert.deepEqual(rules.suggestedKinds({ photographyServiceKind: "both", photoSessionDelivery: "album" }), ["video", "photos", "album"]);
  assert.deepEqual(rules.suggestedKinds({ photographyKinds: ["video", "aerial"] }), ["video"]);
  assert.deepEqual(rules.suggestedKinds({ photographyServiceKind: "aerial" }), []);
  assert.deepEqual(rules.suggestedKinds(null), []);

  assert.equal(rules.parseDueDate("2026-10-12"), "2026-10-12");
  assert.equal(rules.parseDueDate("2026-02-30"), undefined, "impossible dates are rejected");
  assert.equal(rules.parseDueDate("12/10/2026"), undefined);
  assert.equal(rules.parseDueDate(""), null);
  assert.equal(rules.parseDueDate(undefined), undefined);
  assert.deepEqual(rules.normalizeKinds(["album", "video", "video", "x"]), ["video", "album"]);
  assert.deepEqual(rules.tabKinds("album"), ["album", "printing"], "albums and printing share a tab");
  assert.deepEqual(rules.tabKinds("nope"), ["video", "photos", "album", "printing"]);
  assert.equal(rules.baghdadToday(new Date("2026-10-11T22:30:00Z")), "2026-10-12", "deadlines use the Iraq business day");
  assert.equal(rules.addDays("2026-12-31", 1), "2027-01-01");
}

// ------------------------------------------------------------------ fake database
function sql(parts, ...values) { return { __sql: true, parts: [...parts], values }; }
sql.join = (items, sep) => ({ __join: true, items, sep });
function render(node) {
  let text = "";
  const params = [];
  const walk = (value) => {
    if (value?.__join) return value.items.forEach((item, index) => { if (index) walk(value.sep); walk(item); });
    value.parts.forEach((part, index) => {
      text += part;
      if (index < value.values.length) {
        const inner = value.values[index];
        if (inner?.__sql || inner?.__join) walk(inner);
        else { params.push(inner); text += "?"; }
      }
    });
  };
  walk(node);
  return { text: text.replace(/\s+/g, " ").trim(), params };
}

function splitTopLevel(text) {
  const out = [];
  let depth = 0, current = "";
  for (const char of text) {
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (char === "," && depth === 0) { out.push(current.trim()); current = ""; continue; }
    current += char;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function fixture({ missingTable = false } = {}) {
  const state = { items: [], timeline: [], executed: [], notifications: [], once: [], nextId: 1 };
  const bookings = {
    10: { booking_id: 10, tracking_code: "AJN-5330-AB12", customer_name: "علي وزينب", phone: "07701234567", event_date: "2026-10-20", booking_status: "confirmed", event_type: "زفاف", hall: "قاعة النور", archived_at: null, fields: { photographyServiceKind: "both" } },
    11: { booking_id: 11, tracking_code: null, customer_name: "ملغي", phone: "", event_date: "2026-10-21", booking_status: "cancelled", event_type: null, hall: null, archived_at: null, fields: {} },
    99: { booking_id: 99, tracking_code: null, customer_name: "صوتيات", phone: "", event_date: "2026-10-22", booking_status: "confirmed", event_type: null, hall: null, archived_at: null, fields: {} },
  };
  const staff = { 5: "مونتير فعال", 6: "مصور فعال" };
  const handle = async (query) => {
    const { text, params } = render(query);
    state.executed.push({ text, params });
    if (missingTable && text.includes("photography_production_items")) throw Object.assign(new Error('relation "photography_production_items" does not exist'), { code: "42P01" });
    if (text.startsWith("insert into photography_production_items")) {
      const [bookingId, kind, assigneeStaffId, assigneeName, dueDate, notes] = params;
      if (state.items.some((item) => item.booking_id === bookingId && item.kind === kind)) return { rows: [] };
      const row = { id: state.nextId++, booking_id: bookingId, kind, status: "remaining", assignee_staff_id: assigneeStaffId, assignee_name: assigneeName, due_date: dueDate, notes, started_at: null, completed_at: null };
      state.items.push(row);
      return { rows: [{ id: row.id }] };
    }
    if (text.startsWith("insert into entity_timeline")) { state.timeline.push({ text, params }); return { rows: [] }; }
    if (text.includes("for update of i")) {
      const item = state.items.find((entry) => entry.id === params[0]);
      return { rows: item ? [{ ...item, due_text: item.due_date, customer_name: bookings[item.booking_id].customer_name, tracking_code: bookings[item.booking_id].tracking_code }] : [] };
    }
    if (text.startsWith("update photography_production_items set")) {
      const setText = text.slice("update photography_production_items set".length, text.lastIndexOf(" where id = "));
      const item = state.items.find((entry) => entry.id === params[params.length - 1]);
      let cursor = 0;
      for (const assignment of splitTopLevel(setText)) {
        const [column, expression] = assignment.split(/ = (.*)/s);
        const value = expression.includes("?") ? params[cursor++] : expression.startsWith("now()") ? "NOW" : expression === "null" ? null : expression.startsWith("coalesce(started_at") ? item.started_at ?? "NOW" : expression;
        item[column.trim()] = value;
      }
      return { rows: [] };
    }
    if (text.includes("from photography_production_items i left join staff st") && text.includes("where i.booking_id = ?")) {
      const mine = text.includes("and i.assignee_staff_id = ?") ? params[1] : null;
      return { rows: state.items.filter((item) => item.booking_id === params[0] && (!mine || item.assignee_staff_id === mine)).map((item) => ({ ...item, assignee_name: item.assignee_name })) };
    }
    if (text.includes("from service_orders so left join services s on s.id = so.service_id where so.id = ?")) return { rows: bookings[params[0]] ? [bookings[params[0]]] : [] };
    if (text.includes("from staff where is_active = true and id in")) return { rows: params.filter((id) => staff[id]).map((id) => ({ id, name: staff[id] })) };
    if (text.includes("count(*) filter")) return { rows: [{ total: state.items.length, bookings: 1, incomplete_bookings: 1 }] };
    if (text.includes("count(*)::int as total") || text.includes("count(distinct i.booking_id)::int as total")) return { rows: [{ total: 0 }] };
    return { rows: [] };
  };
  const db = { execute: handle, transaction: async (fn) => fn({ execute: handle }) };
  class NextResponse extends Response {
    static json(data, init = {}) { return new Response(JSON.stringify(data), { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } }); }
  }
  const server = load("src/server/photography-production.ts", {
    "@workspace/db": { db },
    "drizzle-orm": { sql },
    "next/server": { NextResponse },
    "@/server/photography-booking-integration": { detectPhotographyBooking: async (id) => ({ isPhotography: id !== 99, reasons: [] }) },
  });
  const deps = {
    notify: async (input) => { state.notifications.push(input); },
    notifyOnce: async (input) => { state.once.push(input); },
  };
  const call = async (user, parts, method = "GET", body, search = "") => {
    const req = new Request(`http://localhost/api/admin/photography-production/${parts.join("/")}${search}`, {
      method,
      ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}),
    });
    req.nextUrl = new URL(req.url);
    const res = await server.handlePhotographyProduction(req, ["admin", "photography-production", ...parts], user, deps);
    return { status: res.status, body: await res.json() };
  };
  return { call, state, server };
}

const user = (id, permissions, role = "employee") => ({ id, username: `u${id}`, fullName: `موظف ${id}`, role, permissions, isActive: true });
const manager = user(1, ["photography.assignment.manage"]);
const editor = user(5, ["photography"]);
const photographer = user(6, ["photography"]);
const bookingClerk = user(7, ["bookings"]);
const outsider = user(8, ["sales"]);

// ------------------------------------------------------------------ access
{
  const { server } = fixture();
  assert.deepEqual(server.productionAccess(editor), { manage: false, order: false, viewAll: false, work: true });
  assert.deepEqual(server.productionAccess(bookingClerk), { manage: false, order: true, viewAll: true, work: true });
  assert.deepEqual(server.productionAccess(manager), { manage: true, order: true, viewAll: true, work: true });
  assert.equal(server.productionAccess(user(2, [], "manager")).manage, true);
  assert.equal(server.productionAccess({ ...manager, isActive: false }).work, false, "inactive accounts have no access");
  assert.equal(server.productionAccess(outsider).work, false);
}

// ------------------------------------------------------------------ scope of lists
{
  const { call, state } = fixture();
  assert.equal((await call(outsider, ["board"])).status, 403);
  const mine = await call(editor, ["board"]);
  assert.equal(mine.status, 200);
  assert.equal(mine.body.scope, "mine", "employees only see their own work, even without mine=1");
  const scoped = state.executed.filter((q) => q.text.includes("from photography_production_items i"));
  assert.ok(scoped.length >= 2 && scoped.every((q) => q.text.includes("i.assignee_staff_id = ?") && q.params.includes(5)), "every list/summary query is scoped to the employee");

  state.executed.length = 0;
  const all = await call(manager, ["board"], "GET", undefined, "?tab=album&status=overdue&q=B-10-5330&eventFrom=2026-10-01");
  assert.equal(all.body.scope, "all");
  const list = state.executed.find((q) => q.text.includes("order by case when i.status = 'completed'"));
  assert.ok(!list.text.includes("i.assignee_staff_id = ?"), "managers are not scoped to themselves");
  assert.ok(list.text.includes("i.kind in (?::text, ?::text)") && list.params.includes("album") && list.params.includes("printing"), "the album tab covers albums and printing");
  assert.ok(list.text.includes("i.status <> 'completed' and i.due_date < ?::date"), "overdue is derived on the server");
  assert.ok(list.text.includes("or so.id = ?::int") && list.params.includes(10), "short booking numbers are searchable");
  assert.ok(list.text.includes("left(so.event_date, 10) >= ?::text"));
  assert.ok(list.text.includes("so.archived_at is null") && list.text.includes("<> 'cancelled'"), "archived and cancelled bookings are excluded from the center");
  assert.ok(/limit \?::int offset \?::int/.test(list.text), "lists are paginated on the server");
  const summary = state.executed.find((q) => q.text.includes("count(*) filter"));
  assert.ok(!summary.text.includes("i.due_date < ?::date and") || summary.text.includes("filter (where i.status <> 'completed' and i.due_date < ?::date)"), "summary cards are not narrowed by the status filter");

  state.executed.length = 0;
  const table = await call(manager, ["bookings"], "GET", undefined, "?completion=incomplete&pageSize=500");
  assert.equal(table.status, 200);
  assert.equal(table.body.pageSize, 100, "page size is capped");
  assert.ok(state.executed.some((q) => q.text.includes("exists (select 1 from photography_production_items x where x.booking_id = i.booking_id and x.status <> 'completed')")));
}

// ------------------------------------------------------------------ production order + duplicate prevention
{
  const { call, state } = fixture();
  assert.equal((await call(editor, ["booking", "10", "order"], "POST", { kinds: ["video"] })).status, 403, "employees cannot create production orders");
  assert.equal((await call(bookingClerk, ["booking", "99", "order"], "POST", { kinds: ["video"] })).status, 422, "only photography bookings can be sent to production");
  assert.equal((await call(bookingClerk, ["booking", "11", "order"], "POST", { kinds: ["video"] })).status, 409, "cancelled bookings cannot be sent to production");
  assert.equal((await call(bookingClerk, ["booking", "10", "order"], "POST", { kinds: [] })).status, 422);
  assert.equal((await call(bookingClerk, ["booking", "10", "order"], "POST", { kinds: ["video"], items: { video: { assigneeStaffId: 77 } } })).status, 422, "inactive or unknown employees are rejected");
  assert.equal((await call(bookingClerk, ["booking", "10", "order"], "POST", { kinds: ["video"], items: { video: { dueDate: "2026-13-01" } } })).status, 422);
  assert.equal(state.items.length, 0, "rejected orders write nothing");

  const first = await call(bookingClerk, ["booking", "10", "order"], "POST", {
    kinds: ["photos", "video", "video"],
    items: { video: { assigneeStaffId: 5, dueDate: "2026-10-25" }, photos: { assigneeStaffId: 6 } },
  });
  assert.equal(first.status, 201);
  assert.deepEqual(first.body.created, ["video", "photos"]);
  assert.deepEqual(first.body.existing, []);
  assert.equal(first.body.items.length, 2, "one work item per requested deliverable");
  assert.equal(first.body.progress.label, "الإنتاج غير مكتمل");
  assert.equal(state.timeline.length, 2, "each created item is recorded in the booking timeline");
  assert.deepEqual(state.notifications.map((n) => [n.audienceType, n.staffId, n.type]), [["staff", 5, "photography_production_assigned"], ["staff", 6, "photography_production_assigned"]]);

  state.items.find((item) => item.kind === "video").status = "completed";
  const again = await call(bookingClerk, ["booking", "10", "order"], "POST", { kinds: ["video", "photos", "album"], items: { video: { assigneeStaffId: 6 } } });
  assert.equal(again.status, 201);
  assert.deepEqual(again.body.created, ["album"], "repeating an order only adds what is missing");
  assert.deepEqual(again.body.existing, ["video", "photos"]);
  assert.equal(state.items.length, 3, "no duplicate items");
  const video = state.items.find((item) => item.kind === "video");
  assert.equal(video.status, "completed", "completed work is never overwritten by a new order");
  assert.equal(video.assignee_staff_id, 5, "existing assignments are kept");
  const insert = state.executed.find((q) => q.text.startsWith("insert into photography_production_items"));
  assert.ok(insert.text.includes("on conflict (booking_id, kind) do nothing"), "duplicates are prevented by the database constraint");
  const repeat = await call(bookingClerk, ["booking", "10", "order"], "POST", { kinds: ["album"] });
  assert.equal(repeat.status, 200, "a pure repeat creates nothing");
  assert.equal(state.timeline.length, 3);
}

// ------------------------------------------------------------------ status changes
{
  const { call, state } = fixture();
  await call(manager, ["booking", "10", "order"], "POST", { kinds: ["video", "photos"], items: { video: { assigneeStaffId: 5 }, photos: { assigneeStaffId: 5 } } });
  const [video, photos] = state.items;
  const before = state.timeline.length;

  assert.equal((await call(photographer, ["items", String(video.id)], "PATCH", { status: "in_progress" })).status, 403, "another employee cannot move this work");
  assert.equal((await call(editor, ["items", String(video.id)], "PATCH", { assigneeStaffId: 6 })).status, 403, "employees cannot reassign");
  assert.equal((await call(editor, ["items", String(video.id)], "PATCH", { dueDate: "2026-10-30" })).status, 403, "employees cannot move deadlines");
  assert.equal((await call(editor, ["items", String(video.id)], "PATCH", { status: "in_progress", expectedStatus: "waiting_files" })).body.code, "STALE_DATA", "stale boards are rejected");
  assert.equal(state.timeline.length, before, "rejected changes write no history");

  const started = await call(editor, ["items", String(video.id)], "PATCH", { status: "in_progress", expectedStatus: "remaining" });
  assert.equal(started.status, 200);
  assert.equal(video.status, "in_progress");
  assert.equal(video.status_changed_by, 5, "who changed the status is stored");
  assert.equal(video.status_changed_at, "NOW", "when the status changed is stored");
  assert.equal(video.started_at, "NOW");
  assert.equal(state.timeline.length, before + 1);

  assert.equal((await call(editor, ["items", String(video.id)], "PATCH", { status: "in_progress" })).status, 409);
  await call(editor, ["items", String(video.id)], "PATCH", { status: "completed" });
  assert.equal(video.completed_at, "NOW");
  assert.equal(state.once.length, 0, "no completion alert while other work remains");
  assert.equal((await call(editor, ["items", String(video.id)], "PATCH", { status: "in_progress", reason: "x" })).status, 403, "employees cannot reopen completed work");
  assert.equal((await call(manager, ["items", String(video.id)], "PATCH", { status: "in_progress" })).status, 422, "reopening needs a reason");

  const finished = await call(editor, ["items", String(photos.id)], "PATCH", { status: "completed" });
  assert.equal(finished.body.progress.complete, true);
  assert.equal(finished.body.progress.label, "الإنتاج مكتمل");
  assert.deepEqual(state.once.map((n) => [n.type, n.entityType, n.entityId]), [["photography_production_complete", "service_order", 10]], "one completion alert per booking");

  const reopened = await call(manager, ["items", String(video.id)], "PATCH", { status: "in_progress", reason: "الزبون طلب تعديل" });
  assert.equal(reopened.status, 200);
  assert.equal(video.completed_at, null, "reopening clears the completion time");
  assert.equal(reopened.body.progress.complete, false);
  const reassigned = await call(manager, ["items", String(video.id)], "PATCH", { assigneeStaffId: 6, dueDate: "2026-10-30" });
  assert.equal(reassigned.status, 200);
  assert.equal(video.assignee_staff_id, 6);
  assert.equal(video.due_date, "2026-10-30");
  assert.equal(state.notifications.at(-1).staffId, 6, "the new assignee is notified");
  const noop = await call(manager, ["items", String(video.id)], "PATCH", { assigneeStaffId: 6 });
  assert.equal(noop.body.changed, false, "re-saving the same assignee is not a change");
  assert.equal(state.notifications.filter((n) => n.staffId === 6).length, 1, "no duplicate assignment notification");
  assert.ok(!state.executed.some((q) => /(insert into|update) (service_orders|sales_invoices|payments|master_cash|financial|inventory|stock|employee_salar)/i.test(q.text)), "no accounting, inventory, salary or booking writes");
}

// ------------------------------------------------------------------ failures are explicit, never empty data
{
  const { call } = fixture({ missingTable: true });
  const res = await call(manager, ["board"]);
  assert.equal(res.status, 503);
  assert.equal(res.body.code, "DATABASE_ERROR");
  assert.ok(res.body.requestId && /0123_photography_production_items/.test(res.body.message), "a missing migration is reported, not shown as 'no work'");
  assert.equal(res.body.items, undefined);
}

// ------------------------------------------------------------------ migration + wiring
{
  const migration = read("lib/db/migrations/0123_photography_production_items.sql");
  assert.ok(!/\b(?:DROP\s+(?:TABLE|COLUMN|INDEX|TYPE|SCHEMA)|TRUNCATE|DELETE\s+FROM|UPDATE\b|ALTER\s+TABLE[\s\S]*?\b(?:DROP\s+COLUMN|ALTER\s+COLUMN|RENAME\s+(?:COLUMN|TO)))\b/i.test(migration), "the migration is additive-only");
  assert.ok(/CREATE TABLE IF NOT EXISTS photography_production_items/.test(migration));
  assert.ok(/UNIQUE \(booking_id, kind\)/.test(migration), "one item per booking deliverable");
  assert.ok(/REFERENCES service_orders\(id\)/.test(migration) && /REFERENCES staff\(id\)/.test(migration), "reuses bookings and staff");
  assert.ok(!/ALTER TABLE/i.test(migration), "no existing table is altered");

  const source = read("src/server/photography-production.ts");
  assert.ok(!/update service_orders|insert into (sales_invoices|financial_transactions|master_cash)/i.test(source), "production never touches booking status or accounting");
  const api = read("src/server/api.ts");
  assert.ok(/section === "photography-production"[\s\S]{0,200}handlePhotographyProduction\(/.test(api), "the admin API dispatches the center");
  assert.ok(/productionDeadlineAlerts\(\)/.test(api), "deadline alerts run in the existing smart-notification sweep");
  assert.ok(/<PhotographyProductionPanel bookingId=\{booking\.id\} \/>/.test(read("src/views/admin/booking-operations-workspace.tsx")), "booking details show the production section");
  assert.ok(/path="\/admin\/photography-production"/.test(read("src/views/admin/index.tsx")));
  assert.ok(/\/staff\/photography\/production/.test(read("src/views/staff/photography/index.tsx")), "employees reach their work from the staff portal");
}

console.log("photography production center: all checks passed");
