import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import ts from "typescript";
const require = createRequire(import.meta.url);
function load(path, overrides = {}) {
  const filename = resolve(path);
  const module = { exports: {} };
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const localRequire = (name) => Object.hasOwn(overrides, name) ? overrides[name]
    : name.startsWith("@/") ? load(resolve("src", `${name.slice(2)}.ts`))
    : name.startsWith(".") ? load(resolve(dirname(filename), `${name}.ts`)) : require(name);
  new Function("require", "module", "exports", output)(localRequire, module, module.exports);
  return module.exports;
}
const names = ["graduationGroupsTable", "entityTimelineTable", "adminActivityLogsTable"];
const tables = Object.fromEntries(names.map((name) => [name, new Proxy({ name }, {
  get: (target, field) => field === "name" ? target.name : String(field),
})]));
const config = { sashSelectionMode: "restricted", sashOptions: ["royal", "american"],
  colors: { sash: "#4fade8", embroidery: "#efede6" } };
const policy = { mode: "by_sash", prices: { royal: 23000, american: 25000 } };
const admin = { id: 1, role: "admin", permissions: [], isActive: true, fullName: "إدارة", username: "admin" };
const rep = { ...admin, id: 2, role: "employee", permissions: ["representative.portal.access"] };
function fixture({ assigned = true, assignmentGroupIds, rejectAudit = false, status = "open" } = {}) {
  let state = { graduationGroupsTable: [{ id: 8, joinToken: "token", groupNo: "G-8", title: "مجموعة", status, defaultConfiguration: structuredClone(config) }],
    entityTimelineTable: [], adminActivityLogsTable: [] };
  let writes = 0;
  const eq = (field, value) => (row) => row[field] === value;
  const or = (...predicates) => (row) => predicates.some((test) => test(row));
  function builder(kind, table) {
    let values, predicate = () => true;
    const run = () => {
      if (kind === "select") return state[table.name].filter(predicate);
      if (kind === "insert") {
        if (rejectAudit && table.name === "adminActivityLogsTable") throw new Error("audit unavailable");
        state[table.name].push(structuredClone(values)); writes++; return [values];
      }
      const rows = state[table.name].filter(predicate);
      for (const row of rows) Object.assign(row, structuredClone(values));
      writes++; return rows;
    };
    return { from(value) { table = value; return this; }, where(test) { predicate = test; return this; },
      for() { return Promise.resolve().then(run); }, set(value) { values = value; return this; },
      values(value) { values = value; return this; }, returning() { return Promise.resolve().then(run); },
      then(done, failed) { return Promise.resolve().then(run).then(done, failed); } };
  }
  const db = { select: () => builder("select"), update: (table) => builder("update", table), insert: (table) => builder("insert", table),
    execute: async () => ({ rows: (assignmentGroupIds ?? (assigned ? [8] : [])).map((group_id) => ({ group_id })) }),
    transaction: async (callback) => { const before = structuredClone(state); try { return await callback(db); } catch (cause) { state = before; throw cause; } } };
  const handler = load("src/server/graduation-group-pricing.ts", {
    "@workspace/db": { db, ...tables }, "drizzle-orm": { eq, or, sql: (parts, ...values) => ({ parts, values }) },
  }).handleGraduationGroupPricing;
  return {
    call: (user, representative = false, body = { sashPricing: policy }, method = "PUT") => handler(new Request("http://localhost/test", {
      method, ...(method === "GET" ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
    }), "token", user, representative),
    rows: () => state, writes: () => writes,
  };
}
for (const permission of ["products", "accounting", "graduation.view", "graduation.group.edit"]) {
  const test = fixture(); const response = await test.call({ ...rep, permissions: [permission] });
  assert.equal(response.status, 403); assert.equal((await response.json()).code, "PERMISSION_DENIED"); assert.equal(test.writes(), 0);
}
for (const user of [admin, { ...rep, permissions: ["graduation.price.edit"] }, rep]) {
  const test = fixture(); const response = await test.call(user, user === rep);
  assert.equal(response.status, 200);
  assert.deepEqual(test.rows().graduationGroupsTable[0].defaultConfiguration, { ...config, sashPricing: policy });
  assert.equal(test.rows().entityTimelineTable[0].metadata.appliesTo, "new_orders_only");
  assert.equal(test.rows().adminActivityLogsTable.length, 1);
}
for (const options of [{ assigned: false }, {}]) {
  const test = fixture(options);
  const response = await test.call(options.assigned === false ? rep : { ...rep, isActive: false }, true);
  assert.equal(response.status, 403); assert.equal(test.writes(), 0);
}
for (const permissions of [["representative.portal.access"], ["representative.portal.access", "graduation"]]) {
  const ambiguous = fixture({ assignmentGroupIds: [8, 9] });
  const response = await ambiguous.call({ ...rep, permissions }, true);
  assert.equal(response.status, 403, "two active groups must not grant sash-pricing access");
  assert.equal(ambiguous.writes(), 0);
}
const closed = fixture({ status: "closed" });
assert.equal((await closed.call(admin)).status, 409);
assert.equal((await (await closed.call(admin)).json()).code, "CONFLICT");
const invalid = fixture();
assert.equal((await invalid.call(admin, false, { sashPricing: { mode: "by_sash", prices: { royal: -1 } } })).status, 400);
assert.equal(invalid.writes(), 0);
const free = fixture();
assert.equal((await free.call(admin, false, { sashPricing: { mode: "by_sash", prices: { royal: 0, american: 25000 } } })).status, 200);
assert.equal(free.rows().graduationGroupsTable[0].defaultConfiguration.sashPricing.prices.royal, 0);
const rollback = fixture({ rejectAudit: true });
assert.equal((await rollback.call(admin)).status, 500);
assert.deepEqual(rollback.rows().graduationGroupsTable[0].defaultConfiguration, config);
assert.equal(rollback.rows().entityTimelineTable.length, 0);
console.log("PASS real price setter: scoped permissions, assigned representatives, validation, config merge and atomic audit rollback");
