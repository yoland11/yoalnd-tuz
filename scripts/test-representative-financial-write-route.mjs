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
  permissions: ["representative.portal.access", "representative.payments.create"] };

function fixture({ switchGroup = true } = {}) {
  const state = { assignment: 8, locked: false, transactions: 0, writes: 0, timelineWrites: 0 };
  const tables = Object.fromEntries(["graduationGroupsTable", "graduationOrdersTable",
    "graduationReceiptsTable", "staffTable", "entityTimelineTable"].map((name) => [name, { name }]));
  const sql = (parts, ...values) => ({ parts, values });
  const execute = async (query) => {
    const statement = query.parts.join("?");
    if (/^select 1/i.test(statement)) return { rows: [] };
    if (statement.includes("FROM representative_group_assignments"))
      return { rows: [{ group_id: state.assignment }] };
    if (statement.includes("INSERT INTO representative_payment_requests") ||
      statement.includes("INSERT INTO representative_custody_handovers")) {
      state.writes++;
      return { rows: [{ id: 21 }] };
    }
    return { rows: [] };
  };
  const query = {
    graduationOrdersTable: { findFirst: async () => ({ id: 31, groupId: 8, remainingAmount: "100" }) },
    graduationGroupsTable: { findFirst: async () => ({ id: 8 }) },
  };
  const tx = {
    execute,
    query,
    insert: () => ({ values: async () => { state.timelineWrites++; } }),
    select: () => ({ from: () => ({ where: () => ({
      for: async (mode) => { if (mode === "update") state.locked = true; return [{ id: 7 }]; },
    }) }) }),
  };
  const db = { execute, query, insert: () => ({ values: async () => undefined }),
    transaction: async (callback) => {
      state.transactions++;
      if (switchGroup) state.assignment = 9;
      return callback(tx);
    } };
  const handler = load("src/server/representative.ts", {
    "@workspace/db": { db, ...tables },
    "drizzle-orm": { sql, and: (...args) => args, desc: (x) => x, eq: (a, b) => [a, b], inArray: (a, b) => [a, b] },
    "@/server/graduation-group-pricing": { handleGraduationGroupPricing: async () => new Response(null, { status: 204 }) },
    "@/server/graduation-operations": { receivePayment: async () => { throw new Error("must not be called"); } },
  }).handleRepresentativePortal;
  return { state, call: (resource, body) => handler(new Request(`http://localhost/api/admin/representative/${resource}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }), [resource], rep) };
}

for (const [resource, body] of [
  ["payments", { orderId: 31, amount: 10, paymentMethod: "cash" }],
  ["custody", { amount: 10 }],
]) {
  const test = fixture();
  const response = await test.call(resource, body);
  assert.equal(response.status, 409, `${resource}: stale scope must reject after group changes`);
  assert.equal(test.state.transactions, 1, `${resource}: financial write must be transactional`);
  assert.equal(test.state.locked, true, `${resource}: financial write must share the staff row lock`);
  assert.equal(test.state.writes, 0, `${resource}: no old-group financial record may be inserted`);
}
for (const [resource, body] of [
  ["payments", { orderId: 31, amount: 10, paymentMethod: "cash" }],
  ["custody", { amount: 10 }],
]) {
  const test = fixture({ switchGroup: false });
  const response = await test.call(resource, body);
  assert.equal(response.status, 201, `${resource}: authorized write still succeeds`);
  assert.equal(test.state.writes, 1, `${resource}: record is inserted once`);
  assert.equal(test.state.timelineWrites, resource === "payments" ? 1 : 0,
    `${resource}: payment timeline stays inside its transaction`);
}

console.log("Representative financial write serialization tests passed");
