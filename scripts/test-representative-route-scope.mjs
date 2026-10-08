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

const rep = { id: 7, username: "rep7", fullName: "ممثل", role: "employee", isActive: true,
  permissions: ["representative.portal.access"] };
const admin = { ...rep, id: 1, role: "admin", permissions: [] };
const foreignPayment = { id: 42, group_id: 9, representative_id: 7,
  status: "approved", receiptNo: "R-42", snapshot: { amount: 100 } };

function fixture({ assignments = [8], failAssignments = false } = {}) {
  const tables = Object.fromEntries(["graduationGroupsTable", "graduationOrdersTable",
    "graduationReceiptsTable", "staffTable", "entityTimelineTable"].map((name) => [name, { name }]));
  const sql = (parts, ...values) => ({ parts, values });
  const db = {
    execute: async (query) => {
      const statement = query.parts.join("?");
      if (/^select 1/i.test(statement)) return { rows: [] };
      if (statement.includes("FROM representative_group_assignments")) {
        if (failAssignments) throw new Error("database unavailable");
        return { rows: assignments.map((group_id) => ({ group_id })) };
      }
      if (statement.includes("FROM representative_payment_requests")) {
        if (/\bWHERE\b[\s\S]*\bp\.group_id\b/i.test(statement)) return { rows: [] };
        return { rows: [foreignPayment] };
      }
      return { rows: [] };
    },
    select: () => ({ from: () => Promise.resolve([{ id: 8 }, { id: 9 }]) }),
    query: { graduationGroupsTable: { findFirst: async () => ({ id: 8, title: "مجموعة ٨", groupNo: "G8" }) } },
  };
  const handler = load("src/server/representative.ts", {
    "@workspace/db": { db, ...tables },
    "drizzle-orm": { sql, and: (...args) => args, desc: (x) => x, eq: (a, b) => [a, b], inArray: (a, b) => [a, b] },
    "@/server/graduation-group-pricing": { handleGraduationGroupPricing: async () => new Response(null, { status: 204 }) },
    "@/server/graduation-operations": { receivePayment: async () => { throw new Error("must not be called"); } },
  }).handleRepresentativePortal;
  return (user, parts) => handler(new Request("http://localhost/api/admin/representative/" + parts.join("/")), parts, user);
}

for (const assignments of [[], [8, 9]]) {
  const response = await fixture({ assignments })(rep, ["payments"]);
  assert.equal(response.status, 403, "missing or ambiguous assignment must fail closed");
}
const ownList = await fixture()(rep, ["payments"]);
assert.equal(ownList.status, 200);
assert.deepEqual((await ownList.json()).items, [], "foreign-group payments remain hidden even when the actor created them");
const foreignReceipt = await fixture()(rep, ["payments", "42", "receipt"]);
assert.equal(foreignReceipt.status, 404, "foreign-group receipts cannot be read by their former creator");
const adminList = await fixture()(admin, ["payments"]);
assert.equal(adminList.status, 200);
assert.equal((await adminList.json()).items[0].id, 42, "admin keeps the all-group payment view");
const representativeScope = await fixture()(rep, ["scope"]);
assert.equal(representativeScope.status, 200);
assert.deepEqual(await representativeScope.json(), { kind: "group", group: { id: 8, title: "مجموعة ٨", groupNo: "G8" } },
  "representative header receives only its assigned group");
const adminScope = await fixture()(admin, ["scope"]);
assert.deepEqual(await adminScope.json(), { kind: "admin", group: null },
  "administrator header explicitly retains the global view");
const failedQuery = await fixture({ failAssignments: true })(rep, ["payments"]);
assert.equal(failedQuery.status, 500, "an assignment database failure is not an empty group");
const error = await failedQuery.json();
assert.equal(error.code, "DATABASE_ERROR");
assert.ok(error.requestId);

console.log("Representative route scope tests passed");
