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

const admin = { id: 1, username: "admin", fullName: "مدير", role: "admin",
  isActive: true, permissions: [] };

function fixture({ activeGroups = [9], historicalGroups = [], payments = false, custody = false,
  paymentGroups = [9], staffActive = true, staffPermitted = true } = {}) {
  const state = { assignments: [
    ...activeGroups.map((groupId) => ({ groupId, isActive: true })),
    ...historicalGroups.map((groupId) => ({ groupId, isActive: false })),
  ],
    locked: false, txCount: 0 };
  const tables = Object.fromEntries(["graduationGroupsTable", "graduationOrdersTable",
    "graduationReceiptsTable", "staffTable", "entityTimelineTable"].map((name) => [name, { name }]));
  const sql = (parts, ...values) => ({ parts, values });
  const staff = { id: 7, username: "rep7", fullName: "ممثل", role: "employee", isActive: staffActive,
    permissions: staffPermitted ? ["representative.portal.access"] : [] };
  function select() {
    let table;
    const rows = () => table?.name === "staffTable" ? [staff]
      : table?.name === "graduationGroupsTable" ? [{ id: 8, title: "G8" }, { id: 9, title: "G9" }] : [];
    return { from(value) { table = value; return this; }, where() { return this; },
      for(lock) { if (table?.name === "staffTable" && lock === "update") state.locked = true;
        return Promise.resolve(rows()); },
      then(done, failed) { return Promise.resolve(rows()).then(done, failed); } };
  }
  async function execute(query) {
    const statement = query.parts.join("?");
    if (/^select 1/i.test(statement)) return { rows: [] };
    if (statement.includes("FROM representative_group_assignments"))
      return { rows: state.assignments.filter((a) => !statement.includes("is_active = true") || a.isActive)
        .map((a) => ({ group_id: a.groupId })) };
    if (statement.includes("SELECT DISTINCT group_id FROM representative_payment_requests"))
      return { rows: payments ? paymentGroups.map((group_id) => ({ group_id })) : [] };
    if (statement.includes("representative_payment_requests") && statement.includes("EXISTS"))
      return { rows: [{ hasPayments: payments, hasCustody: custody }] };
    if (statement.includes("UPDATE representative_group_assignments")) {
      for (const row of state.assignments) row.isActive = false;
      return { rows: [] };
    }
    if (statement.includes("INSERT INTO representative_group_assignments")) {
      const groupId = Number(query.values.find((value) => value === 8 || value === 9));
      const existing = state.assignments.find((a) => a.groupId === groupId);
      if (existing) existing.isActive = true;
      else state.assignments.push({ groupId, isActive: true });
      return { rows: [{ staff_id: 7, group_id: groupId, is_active: true }] };
    }
    return { rows: [] };
  }
  const tx = { select, execute, query: { graduationGroupsTable: { findFirst: async () => ({ id: 8, title: "G8" }) } } };
  const db = { select, execute, query: tx.query,
    transaction: async (callback) => { state.txCount++; const old = structuredClone(state.assignments);
      try { return await callback(tx); } catch (error) { state.assignments = old; throw error; } } };
  const handler = load("src/server/representative.ts", {
    "@workspace/db": { db, ...tables },
    "drizzle-orm": { sql, and: (...args) => args, desc: (x) => x, eq: (a, b) => [a, b], inArray: (a, b) => [a, b] },
    "@/server/graduation-group-pricing": { handleGraduationGroupPricing: async () => new Response(null, { status: 204 }) },
    "@/server/graduation-operations": { receivePayment: async () => { throw new Error("must not be called"); } },
  }).handleRepresentativePortal;
  return { state, call: (data) => handler(new Request("http://localhost/api/admin/representative/assignments", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ staffId: 7, groupId: 8, ...data }),
  }), ["assignments"], admin) };
}

const replace = fixture();
assert.equal((await replace.call()).status, 201);
assert.equal(replace.state.txCount, 1, "replacement must be transactional");
assert.equal(replace.state.locked, true, "the staff row must be locked before assignment changes");
assert.deepEqual(replace.state.assignments.filter((row) => row.isActive).map((row) => row.groupId), [8]);

for (const options of [{ payments: true }, { custody: true }]) {
  const bound = fixture(options);
  assert.equal((await bound.call()).status, 409, "financial history prevents a group switch");
  assert.deepEqual(bound.state.assignments.filter((row) => row.isActive).map((row) => row.groupId), [9]);
  assert.equal((await bound.call({ groupId: 9, isActive: false })).status, 409,
    "financial history prevents deactivating the representative's group");
  assert.deepEqual(bound.state.assignments.filter((row) => row.isActive).map((row) => row.groupId), [9]);
}
const ambiguous = fixture({ activeGroups: [8, 9] });
assert.equal((await ambiguous.call()).status, 409, "legacy multiple groups need explicit correction");
assert.equal((await ambiguous.call({ resolveAmbiguous: true })).status, 201);
assert.deepEqual(ambiguous.state.assignments.filter((row) => row.isActive).map((row) => row.groupId), [8]);
const financiallyAmbiguous = fixture({ activeGroups: [8, 9], payments: true });
assert.equal((await financiallyAmbiguous.call({ groupId: 8, isActive: false })).status, 409,
  "deactivation cannot resolve a financially bound legacy ambiguity to the wrong group");
assert.deepEqual(financiallyAmbiguous.state.assignments.filter((row) => row.isActive).map((row) => row.groupId), [8, 9]);
const restore = fixture({ activeGroups: [], historicalGroups: [8], payments: true, paymentGroups: [8] });
assert.equal((await restore.call()).status, 201, "the sole historical paid group can be restored");
assert.deepEqual(restore.state.assignments.filter((row) => row.isActive).map((row) => row.groupId), [8]);
const conflictingHistory = fixture({ activeGroups: [], historicalGroups: [8, 9], payments: true, paymentGroups: [8] });
assert.equal((await conflictingHistory.call()).status, 409, "conflicting historical assignments stay locked");
for (const options of [{ staffActive: false }, { staffPermitted: false }]) {
  const ineligible = fixture(options);
  assert.equal((await ineligible.call()).status, 403, "only active staff with portal permission can be assigned");
}

console.log("Representative assignment route tests passed");
