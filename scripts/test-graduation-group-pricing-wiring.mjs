/** Executes the real admin creator against an isolated in-memory database boundary. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const loaded = new Map();
function loadTs(path) {
  const filename = resolve(path);
  if (loaded.has(filename)) return loaded.get(filename);
  const module = { exports: {} };
  loaded.set(filename, module.exports);
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const localRequire = (name) => name.startsWith(".")
    ? loadTs(resolve(dirname(filename), `${name}.ts`))
    : name.startsWith("@/") ? loadTs(resolve("src", `${name.slice(2)}.ts`)) : require(name);
  new Function("require", "module", "exports", output)(localRequire, module, module.exports);
  loaded.set(filename, module.exports);
  return module.exports;
}

const flow = loadTs("src/lib/graduation-student-flow.ts");
const phone = loadTs("src/lib/phone.ts");
const measurements = loadTs("src/lib/graduation-measurements.ts");
const safety = loadTs("src/server/write-safety.ts");
const pricing = existsSync("src/lib/graduation-group-pricing.ts")
  ? loadTs("src/lib/graduation-group-pricing.ts") : {};
const studentIdentity = existsSync("src/lib/graduation-group-student-identity.ts")
  ? loadTs("src/lib/graduation-group-student-identity.ts") : {};
const source = readFileSync("src/server/graduation-operations.ts", "utf8");
const parsed = ts.createSourceFile("operations.ts", source, ts.ScriptTarget.Latest, true);
const functions = new Set([
  "json", "fail", "record", "amount", "studentIdentity", "receiptSnapshot",
  "ensureIdentity", "findOrCreateCustomer", "addStudent", "patchStudent", "formatStudent",
]);
const snippets = parsed.statements.filter((statement) =>
  ts.isFunctionDeclaration(statement) ? functions.has(statement.name?.text)
    : ts.isVariableStatement(statement) && statement.declarationList.declarations.some(
      (declaration) => declaration.name.getText(parsed) === "studentPatchSchema",
    ),
).map((statement) => statement.getText(parsed)).join("\n");

const tableNames = [
  "customersTable", "graduationGroupsTable", "graduationOrdersTable",
  "graduationGroupStudentsTable", "graduationReceiptsTable", "qrTokensTable",
];
const tables = Object.fromEntries(tableNames.map((name) => [name, new Proxy({ name }, {
  get: (target, field) => field === "name" ? target.name : `${name}.${String(field)}`,
})]));
const eq = (field, value) => (row) => row[String(field).split(".").at(-1)] === value;
const and = (...conditions) => (row) => conditions.every((condition) =>
  typeof condition !== "function" || condition(row));
const sql = (parts, ...values) => ({ parts, values });

function fixture(configuration, { rejectReceipt = false } = {}) {
  let state = Object.fromEntries(tableNames.map((name) => [name, []]));
  state.graduationGroupsTable.push({
    id: 8, title: "دفعة الاختبار", status: "open", university: "جامعة", college: "كلية",
    department: "قسم", graduationYear: "2026", eventDate: null,
    defaultConfiguration: configuration,
  });
  function builder(kind, table, selection) {
    let values, predicate = () => true, executed;
    const run = () => {
      if (executed) return executed;
      const rows = state[table.name];
      if (kind === "select") {
        executed = selection?.value ? [{ value: rows.reduce((n, row) => Math.max(n, row.sequence), 0) + 1 }]
          : rows.filter(predicate).map((row) => ({ ...row }));
      } else if (kind === "insert") {
        if (rejectReceipt && table.name === "graduationReceiptsTable") throw new Error("receipt write failed");
        executed = (Array.isArray(values) ? values : [values]).map((value) => ({
          id: rows.length + 1, createdAt: new Date("2026-10-05T00:00:00Z"), ...value,
        }));
        rows.push(...executed);
      } else {
        executed = rows.filter(predicate);
        for (const row of executed) Object.assign(row, values);
      }
      return executed;
    };
    return {
      from(value) { table = value; return this; },
      where(value) { predicate = typeof value === "function" ? value : predicate; return this; },
      values(value) { values = value; return this; },
      set(value) { values = value; return this; },
      limit() { return this; }, for() { return this; },
      onConflictDoNothing() { return this; },
      returning() { return Promise.resolve().then(run); },
      then(done, failed) { return Promise.resolve().then(run).then(done, failed); },
    };
  }
  const db = {
    query: Object.fromEntries(tableNames.map((name) => [name, {
      findFirst: async ({ where }) => state[name].find(typeof where === "function" ? where : () => true),
    }])),
    select: (selection) => builder("select", undefined, selection),
    insert: (table) => builder("insert", table),
    update: (table) => builder("update", table),
    execute: async () => ({ rows: [] }),
    transaction: async (callback) => {
      const before = structuredClone(state);
      try { return await callback(db); }
      catch (error) { state = before; throw error; }
    },
  };
  const context = vm.createContext({
    ...tables, ...flow, ...phone, ...measurements, ...safety, ...pricing, ...studentIdentity,
    db, eq, and, sql, randomUUID, Date, console,
    z: require("zod/v4").z,
    NextResponse: { json: (body, options) => Response.json(body, options) },
    syncGraduationEnterpriseOrder: async () => {}, notifyTailorsMeasurementsPending: async () => {},
    audit: async () => {}, timeline: async () => {},
  });
  vm.runInContext(ts.transpileModule(`${snippets}\nglobalThis.save = addStudent; globalThis.patch = patchStudent;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText, context);
  return {
    save: (input) => context.save(8, { customerName: "طالب اختبار", ...input }, {
      id: 1, role: "admin", username: "admin", fullName: "إدارة", permissions: [], isActive: true,
    }),
    patch: (orderId, input) => context.patch(orderId, input, {
      id: 1, role: "admin", username: "admin", fullName: "إدارة", permissions: [], isActive: true,
    }, 8),
    rows: (name) => state[name],
  };
}

const active = {
  styleKey: "standard", fabric: { key: "standard" }, sashSelectionMode: "restricted",
  sashOptions: ["royal", "american"], sashType: "royal", defaultPrice: 99,
  sashPricing: { mode: "by_sash", prices: { royal: 50000, american: 45000 } },
};
for (const [label, sashType, expected] of [
  ["royal", "royal", 50000], ["american", "american", 45000], ["Arabic label", "ملكي", 50000],
  ["default approved type", undefined, 50000],
]) {
  const test = fixture(active);
  const result = await test.save({ sashType, totalAmount: 1, discountAmount: 9999 });
  assert.equal(result.order.total, expected, `${label} must use the stored group price`);
  const order = test.rows("graduationOrdersTable")[0];
  assert.equal(order.discountAmount, "0", "a configured price ignores client discounts");
  assert.equal(order.customText.sashType, sashType === "american" ? "american" : "royal");
  assert.equal(order.garmentDetails.sashType, sashType === "american" ? "أمريكي" : "ملكي");
  assert.equal(order.pricing.groupSashPricing.amount, expected);
  assert.equal(test.rows("graduationReceiptsTable")[0].snapshot.total, expected);
  assert.equal(test.rows("graduationGroupStudentsTable").length, 1);
}
const free = fixture({ ...active, sashPricing: { mode: "by_sash", prices: { royal: 0, american: 45000 } } });
assert.equal((await free.save({ sashType: "royal", totalAmount: 12000 })).order.total, 0);
assert.equal(free.rows("graduationOrdersTable")[0].paymentStatus, "paid");
const legacy = fixture({ defaultPrice: 500 });
assert.equal((await legacy.save({ totalAmount: 500, discountAmount: 50 })).order.total, 450);
assert.equal(legacy.rows("graduationOrdersTable")[0].pricing.groupSashPricing, undefined);
const sharedPhone = fixture(active);
assert.ok((await sharedPhone.save({ customerName: "محمد علي", phone: "07700000000", sashType: "royal" })).order);
assert.ok((await sharedPhone.save({ customerName: "حسن علي", phone: "07700000000", sashType: "royal" })).order,
  "different students can share a contact phone");
const duplicateName = await sharedPhone.save({ customerName: "مُحَمَّد  علي", phone: "07711111111", sashType: "royal" });
assert.equal(duplicateName.response.status, 409, "the same student name must be rejected within one group");
assert.equal(sharedPhone.rows("graduationOrdersTable").length, 2);
const editedDuplicate = await sharedPhone.patch(2, { customerName: "مُحَمَّد  علي" });
assert.equal(editedDuplicate.response.status, 409, "editing a student cannot duplicate another active name");
assert.equal(sharedPhone.rows("graduationOrdersTable")[1].customerName, "حسن علي");
assert.equal((await sharedPhone.patch(2, { customerName: "حسن محمد" })).order.customerName, "حسن محمد");
for (const configuration of [
  { ...active, sashPricing: { mode: "by_sash", prices: { american: 45000 } } },
  active,
]) {
  const test = fixture(configuration);
  const result = await test.save({ sashType: configuration === active ? "standard" : "royal" });
  assert.equal(result.response.status, 400, "missing or unapproved price must fail before creating an order");
  const error = await result.response.json();
  assert.equal(error.success, false);
  assert.ok(error.requestId);
  assert.equal(test.rows("graduationOrdersTable").length, 0);
}
const rollback = fixture(active, { rejectReceipt: true });
await assert.rejects(rollback.save({ sashType: "royal" }), /receipt write failed/);
for (const table of ["graduationOrdersTable", "graduationGroupStudentsTable", "qrTokensTable"])
  assert.equal(rollback.rows(table).length, 0, `${table} must roll back when the receipt write fails`);
console.log("PASS admin group student pricing, saved receipt agreement, legacy behavior and core write rollback");
