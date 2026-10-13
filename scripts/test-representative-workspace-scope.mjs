/** Server isolation for academic batches and per-group workspaces (no database needed). */
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

const rep = { id: 7, username: "rep7", fullName: "ممثل", role: "employee", isActive: true, permissions: ["representative.portal.access"] };
const admin = { ...rep, id: 1, role: "admin", permissions: [] };
// Two groups with the same name in different batches must stay independent.
const groups = [
  { id: 8, group_no: "G8", title: "فيزيائيون", graduation_year: "2027", university: "تكريت", college: "العلوم", department: "الفيزياء", join_token: "t8", default_configuration: {} },
  { id: 9, group_no: "G9", title: "فيزيائيون", graduation_year: "2028", university: "تكريت", college: "العلوم", department: "الفيزياء", join_token: "t9", default_configuration: {} },
  { id: 10, group_no: "G10", title: "مجموعة قديمة", graduation_year: null, university: "", college: "", department: "", join_token: "t10", default_configuration: {} },
];
const orders = [
  { id: 81, group_id: 8, customer_name: "علي حسين", status: "submitted", production_stage: "new", total_amount: "100", paid_amount: "40", remaining_amount: "60", delivery: {}, archived_at: null, qr_token: "q81" },
  { id: 82, group_id: 8, customer_name: "زينب محمد", status: "submitted", production_stage: "ready", total_amount: "100", paid_amount: "100", remaining_amount: "0", delivery: {}, archived_at: null, qr_token: "q82" },
  { id: 91, group_id: 9, customer_name: "علي حسين", status: "submitted", production_stage: "new", total_amount: "250", paid_amount: "0", remaining_amount: "250", delivery: {}, archived_at: null, qr_token: "q91" },
];

// Like drizzle: nested fragments and sql.join() are inlined, and a raw array
// parameter is rejected (drizzle expands it to "($1, $2)", which Postgres
// cannot use with ANY(...::int[])).
function fakeSql(parts, ...values) { return { __sql: true, parts: [...parts], values }; }
fakeSql.join = (items, separator) => ({ __join: true, items, separator });
function render(query) {
  let statement = "";
  const values = [];
  const walk = (node) => {
    if (node?.__join) return node.items.forEach((item, index) => { if (index) walk(node.separator); walk(item); });
    node.parts.forEach((part, index) => {
      statement += part;
      if (index >= node.values.length) return;
      const value = node.values[index];
      if (value?.__sql || value?.__join) return walk(value);
      if (Array.isArray(value)) throw new Error(`array bound as a single SQL parameter near: ${part.slice(-40)}`);
      values.push(value);
      statement += "?";
    });
  };
  walk(query);
  return { statement: statement.replace(/\s+/g, " ").trim(), values };
}

function fixture({ assignments = [8], registry = [{ key: "2029", createdAt: "x", createdBy: 1, createdByName: "admin" }] } = {}) {
  const state = { executed: [], writes: [] };
  const handle = async (query) => {
    const { statement, values } = render(query);
    state.executed.push({ statement, values });
    if (/^select 1/i.test(statement)) return { rows: [] };
    if (statement.includes("FROM representative_group_assignments")) return { rows: assignments.map((group_id) => ({ group_id })) };
    if (statement.includes("SELECT value FROM settings")) return { rows: registry ? [{ value: { batches: registry } }] : [] };
    if (/^(INSERT INTO settings|UPDATE settings|UPDATE graduation_groups|UPDATE graduation_orders|INSERT INTO entity_timeline)/.test(statement)) {
      state.writes.push({ statement, values });
      return { rows: [] };
    }
    if (statement.includes("SELECT graduation_year FROM graduation_groups")) return { rows: groups.filter((g) => g.graduation_year) };
    if (/FROM graduation_groups g ORDER BY/.test(statement)) return { rows: groups };
    if (/FROM graduation_groups g WHERE g\.id = \?/.test(statement)) return { rows: groups.filter((g) => g.id === values[0]) };
    if (/FROM graduation_groups WHERE id = \? FOR UPDATE/.test(statement)) return { rows: groups.filter((g) => g.id === values[0]) };
    if (/o\.group_id IN \(\?/.test(statement)) return { rows: orders.filter((o) => values.includes(o.group_id)) };
    if (/FROM graduation_orders o WHERE o\.group_id = \?/.test(statement)) return { rows: orders.filter((o) => o.group_id === values[0]) };
    if (/FROM graduation_orders WHERE id = \? FOR UPDATE/.test(statement)) return { rows: orders.filter((o) => o.id === values[0]) };
    if (/FROM graduation_orders WHERE group_id = \?/.test(statement)) return { rows: orders.filter((o) => o.group_id === values[0]) };
    if (statement.includes("FROM graduation_student_payments p")) return { rows: [] };
    if (statement.includes("FROM representative_payment_requests p")) return { rows: [] };
    return { rows: [] };
  };
  const db = {
    execute: handle,
    transaction: async (fn) => fn({ execute: handle }),
    select: () => ({ from: () => Promise.resolve(groups.map((g) => ({ id: g.id }))) }),
    query: { graduationGroupsTable: { findFirst: async () => groups[0] } },
  };
  const tables = Object.fromEntries(["graduationGroupsTable", "graduationOrdersTable", "graduationReceiptsTable", "staffTable", "entityTimelineTable"].map((name) => [name, { name }]));
  const handler = load("src/server/representative.ts", {
    "@workspace/db": { db, ...tables },
    "drizzle-orm": { sql: fakeSql, and: (...args) => args, desc: (x) => x, eq: (a, b) => [a, b], inArray: (a, b) => [a, b] },
    "@/server/graduation-group-pricing": { handleGraduationGroupPricing: async () => new Response(null, { status: 204 }) },
    "@/server/graduation-operations": { receivePayment: async () => { throw new Error("must not be called"); } },
  }).handleRepresentativePortal;
  const call = (user, parts, method = "GET", body) => handler(
    new Request(`http://localhost/api/admin/representative/${parts.join("/")}`, { method, ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) }),
    parts, user);
  return { call, state };
}

// --- representative is confined to its own group
{
  const { call, state } = fixture();
  const foreign = await call(rep, ["groups", "9", "workspace"]);
  assert.equal(foreign.status, 403, "a representative cannot open another group's workspace");
  assert.ok(!state.executed.some((q) => q.values.includes(9)), "no query for the foreign group is executed");

  const own = await call(rep, ["groups", "8", "workspace"]);
  assert.equal(own.status, 200);
  const body = await own.json();
  assert.deepEqual(body.students.map((s) => s.name).sort(), ["زينب محمد", "علي حسين"], "only the group's own students are returned");
  assert.equal(body.stats.total, 200, "group totals are computed from the group's students only");
  assert.equal(body.stats.paid, 140);
  assert.equal(body.permissions.admin, false);
  const requestsQuery = state.executed.find((q) => q.statement.includes("FROM representative_payment_requests p"));
  assert.ok(requestsQuery.values.includes(8) && requestsQuery.values.includes(7), "payment requests are scoped to the group and the representative");
  const postedQuery = state.executed.find((q) => q.statement.includes("FROM graduation_student_payments p"));
  assert.ok(postedQuery.statement.includes("o.group_id = ?") && postedQuery.values.every((value) => value === 8), "payment statements are scoped to the group");

  const batches = await call(rep, ["batches"]);
  assert.equal(batches.status, 200);
  const overview = await batches.json();
  assert.deepEqual(overview.groups.map((g) => g.id), [8], "the batch view lists only the assigned group");
  assert.deepEqual(overview.batches.map((b) => b.key), ["2027"], "only the representative's own batch is visible");
  assert.equal(overview.batches[0].stats.total, 200, "batch totals for a representative come from the assigned group only");
  assert.equal(overview.batches[0].groups, 1);
  assert.equal(overview.global, null, "global statistics are administrator-only");
  assert.ok(!state.executed.some((q) => q.statement.includes("FROM settings")), "the batch registry is not read for representatives");

  assert.equal((await call(rep, ["batches"], "POST", { key: "2030" })).status, 403);
  assert.equal((await call(rep, ["groups", "10", "batch"], "PATCH", { key: "2027", confirm: true })).status, 403);
  assert.equal((await call(rep, ["groups", "8", "batch"], "PATCH", { key: "2027", confirm: true })).status, 403);
  assert.equal(state.writes.length, 0, "rejected operations write nothing");
  assert.equal((await call(rep, ["payments", "pending"])).status, 403, "the approval queue is administrator-only");
  assert.equal((await call(rep, ["payments", "71", "image"])).status, 403, "receipt photos are administrator-only");
}

// --- student edits stay inside the group and keep names unique
{
  const { call, state } = fixture();
  assert.equal((await call(rep, ["groups", "9", "students", "91"], "PATCH", { customerName: "اسم جديد" })).status, 403);
  assert.equal((await call(rep, ["groups", "8", "students", "91"], "PATCH", { customerName: "اسم جديد" })).status, 404, "a student from another group cannot be edited through this group");
  assert.equal((await call(rep, ["groups", "8", "students", "81"], "PATCH", { customerName: "زينب  محمد" })).status, 409, "duplicate names inside the group are rejected");
  assert.equal(state.writes.length, 0);
  const saved = await call(rep, ["groups", "8", "students", "81"], "PATCH", { customerName: "علي حسين جاسم" });
  assert.equal(saved.status, 200);
  assert.equal(state.writes.filter((w) => w.statement.startsWith("UPDATE graduation_orders")).length, 1);
  assert.equal(state.writes.filter((w) => w.statement.startsWith("INSERT INTO entity_timeline")).length, 1, "every edit is audited");
}

// --- administrator: all batches, separate statistics, safe batch creation and assignment
{
  const { call, state } = fixture({ assignments: [] });
  const overview = await (await call(admin, ["batches"])).json();
  assert.deepEqual(overview.batches.map((b) => b.key), ["2029", "2028", "2027", "unassigned"]);
  const b27 = overview.batches.find((b) => b.key === "2027");
  const b28 = overview.batches.find((b) => b.key === "2028");
  assert.equal(b27.stats.total, 200);
  assert.equal(b28.stats.total, 250, "same-named groups in different batches keep separate totals");
  assert.equal(overview.batches.find((b) => b.key === "2029").groups, 0, "a created batch without groups is listed for administrators");
  assert.equal(overview.global.total, 450);

  assert.equal((await call(admin, ["batches"], "POST", { key: "2027" })).status, 409, "a batch already used by groups is not duplicated");
  assert.equal((await call(admin, ["batches"], "POST", { key: "2029" })).status, 409, "a registered batch is not duplicated");
  assert.equal((await call(admin, ["batches"], "POST", { key: "فيزيائيون" })).status, 400);
  assert.equal((await call(admin, ["batches"], "POST", { key: "2030" })).status, 201);
  assert.equal(state.writes.filter((w) => w.statement.startsWith("UPDATE settings")).length, 1);

  assert.equal((await call(admin, ["groups", "8", "batch"], "PATCH", { key: "2028", confirm: true })).status, 409, "a group's existing batch is never re-labelled");
  assert.equal((await call(admin, ["groups", "10", "batch"], "PATCH", { key: "2027" })).status, 400, "assignment requires explicit confirmation");
  const assigned = await call(admin, ["groups", "10", "batch"], "PATCH", { key: "2027", confirm: true });
  assert.equal(assigned.status, 200);
  assert.equal(state.writes.filter((w) => w.statement.startsWith("UPDATE graduation_groups")).length, 1);
  assert.equal(state.writes.filter((w) => w.statement.startsWith("INSERT INTO entity_timeline")).length, 1, "batch assignment is audited");

  assert.equal((await call(admin, ["groups", "9", "workspace"])).status, 200, "the administrator can open any group");
}

console.log("Representative batch and group workspace isolation checks passed.");
