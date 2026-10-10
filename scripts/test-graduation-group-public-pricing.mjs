import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import vm from "node:vm";
import ts from "typescript";
const require = createRequire(import.meta.url);
function load(path) {
  const filename = resolve(path), module = { exports: {} };
  const output = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const localRequire = (name) => name.startsWith("@/") ? load(resolve("src", `${name.slice(2)}.ts`))
    : name.startsWith(".") ? load(resolve(dirname(filename), `${name}.ts`)) : require(name);
  new Function("require", "module", "exports", output)(localRequire, module, module.exports); return module.exports;
}
const lib = load("src/lib/graduation.ts"), flow = load("src/lib/graduation-student-flow.ts");
const pricing = load("src/lib/graduation-group-pricing.ts"), access = load("src/lib/graduation-group-pricing-access.ts");
const studentIdentity = load("src/lib/graduation-group-student-identity.ts");
const safety = load("src/server/write-safety.ts"), phone = load("src/lib/phone.ts"), measures = load("src/lib/graduation-measurements.ts");
const source = readFileSync("src/server/graduation.ts", "utf8"), ast = ts.createSourceFile("graduation.ts", source, ts.ScriptTarget.Latest, true);
const funcs = new Set(["json", "error", "studentReferenceError", "safeJson", "money", "phoneLast4", "groupMeta", "publicOrder", "createInvoice", "createOrder", "handleGraduationPublic", "createGraduationGroup"]);
const snippets = ast.statements.filter((node) => ts.isFunctionDeclaration(node) ? funcs.has(node.name?.text)
  : ts.isVariableStatement(node) && node.declarationList.declarations.some((d) => d.name.getText(ast) === "graduationGroupInputSchema"))
  .map((node) => node.getText(ast).replace(/^export /, "")).join("\n");
const tableNames = ["graduationGroupsTable", "graduationOrdersTable", "graduationOrderItemsTable", "graduationGroupStudentsTable", "graduationReceiptsTable", "qrTokensTable", "salesInvoicesTable", "salesInvoiceItemsTable", "customersTable"];
const tables = Object.fromEntries(tableNames.map((name) => [name, new Proxy({ name }, { get: (obj, key) => key === "name" ? obj.name : String(key) })]));
const fabricKey = lib.DEFAULT_GRADUATION_CONFIG.fabrics[0].key;
const policyConfig = { styleKey: "standard", fabric: { key: fabricKey }, sashSelectionMode: "restricted", sashOptions: ["royal", "american"], sashType: "royal", sashPricing: { mode: "by_sash", prices: { royal: 23000, american: 25000 } } };
function fixture(configuration = policyConfig, { failInvoice = false } = {}) {
  let state = Object.fromEntries(tableNames.map((name) => [name, []]));
  state.graduationGroupsTable.push({ id: 8, joinToken: "token", groupNo: "G-8", status: "open", defaultConfiguration: configuration });
  const eq = (field, value) => (row) => row[field] === value;
  const and = (...predicates) => (row) => predicates.every((test) => typeof test !== "function" || test(row));
  const or = (...predicates) => (row) => predicates.some((test) => test(row));
  function builder(kind, table, selection) {
    let values, predicate = () => true, cached;
    const run = () => {
      if (cached) return cached;
      const rows = state[table.name];
      if (kind === "select") return cached = selection?.next ? [{ next: 1 }] : rows.filter(predicate);
      if (kind === "insert") {
        if (failInvoice && table.name === "salesInvoiceItemsTable") throw new Error("invoice item failure");
        cached = (Array.isArray(values) ? values : [values]).map((v) => ({ id: rows.length + 1, createdAt: new Date(), ...v })); rows.push(...cached); return cached;
      }
      cached = rows.filter(predicate); for (const row of cached) Object.assign(row, values); return cached;
    };
    return { from(value) { table = value; return this; }, where(test) { predicate = test; return this; }, values(value) { values = value; return this; },
      set(value) { values = value; return this; }, for() { return this; }, limit() { return this; }, orderBy() { return this; },
      onConflictDoNothing() { return this; }, returning() { return Promise.resolve().then(run); }, then(done, fail) { return Promise.resolve().then(run).then(done, fail); } };
  }
  const db = { query: Object.fromEntries(tableNames.map((name) => [name, { findFirst: async ({ where }) => state[name].find(where) }])),
    select: (selection) => builder("select", undefined, selection), insert: (table) => builder("insert", table), update: (table) => builder("update", table),
    transaction: async (callback) => { const before = structuredClone(state); try { return await callback(db); } catch (cause) { state = before; throw cause; } } };
  const config = structuredClone(lib.DEFAULT_GRADUATION_CONFIG);
  const noop = async () => {};
  const context = vm.createContext({ ...lib, ...flow, ...pricing, ...access, ...safety, ...phone, ...measures, ...studentIdentity, ...tables, db, eq, and, or,
    asc: (x) => x, desc: (x) => x, isNull: () => () => true, sql: (parts, ...values) => ({ parts, values }),
    z: require("zod/v4").z, createHash, randomUUID, Date, console, process, Object, JSON,
    NextResponse: { json: (body, options) => Response.json(body, options) },
    ensureGraduationTables: noop, ensureCustomer: async () => ({ id: 1 }), getConfig: async () => config,
    persistMedia: async (value) => value, getGraduationEnterpriseCatalog: async () => ({}),
    QC_KEYS: [], today: () => "2026-10-05", QRCode: { toDataURL: async () => "data:test" },
    describeGraduationIssues: (issues) => JSON.stringify(issues), createProductionTasks: noop,
    notify: noop, notifyTailorsMeasurementsPending: noop, sendTelegramMessage: noop, addTimeline: noop, addActivity: noop,
    ensureCustomerProfile: noop, recordCustomerActivity: noop, syncGraduationEnterpriseOrder: noop,
    safeServerError: (cause) => ({ message: cause.message }),
    requestBody: async (request) => request.json(),
  });
  vm.runInContext(ts.transpileModule(`${snippets}\nglobalThis.create = createOrder; globalThis.createGroup = createGraduationGroup; globalThis.handle = handleGraduationPublic;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, context);
  return { context, rows: () => state, create: (changes = {}) => context.create({
    customerName: "طالب اختبار", phone: "07700000000", styleKey: "standard", fabric: { key: fabricKey },
    groupToken: "token", sashPricing: configuration.sashPricing, customText: { sashType: "royal" }, ...changes,
  }) };
}

// A failed attempt must not recover an unrelated recent order by phone/name.
const failed = fixture();
failed.rows().graduationOrdersTable.push({ id: 99, groupId: 99, customerName: "طالب اختبار", phone: "9647700000000", status: "submitted", createdAt: new Date() });
failed.context.createOrder = async () => { throw new Error("core transaction rolled back"); };
await assert.rejects(failed.context.handle(new Request("http://localhost/api/graduation/orders", { method: "POST", body: JSON.stringify({ customerName: "طالب اختبار", phone: "07700000000" }) }), ["graduation", "orders"]), /core transaction rolled back/);

const anonymous = fixture();
const groupResult = await anonymous.context.createGroup({ title: "دفعة الاختبار", representativeName: "ممثل اختبار", representativePhone: "07700000000", defaultConfiguration: policyConfig }, null, "http://localhost");
assert.equal(groupResult.response.status, 403, "anonymous creation cannot set financial prices");

for (const [sashType, expected] of [["royal", 23000], ["american", 25000]]) {
  const test = fixture(); const result = await test.create({ discountAmount: 999999, customText: { sashType } });
  if (result.response) throw new Error(JSON.stringify(await result.response.json()));
  assert.equal(result.order.totalAmount, expected);
  assert.equal(test.rows().graduationOrdersTable[0].pricing.groupSashPricing.amount, expected);
  assert.equal(test.rows().graduationReceiptsTable[0].snapshot.total, expected);
  assert.equal(test.rows().salesInvoicesTable[0].total, String(expected));
  assert.equal(test.rows().salesInvoiceItemsTable[0].total, String(expected));
}
const fallback = fixture({ ...policyConfig, sashSelectionMode: "per_student", sashType: "standard", sashPricing: { mode: "by_sash", prices: { standard: 18000, side: 19000, royal: 23000, american: 25000 } } });
assert.equal((await fallback.create({ customText: {} })).order.totalAmount, 18000);
const sharedPhone = fixture();
assert.ok((await sharedPhone.create({ customerName: "محمد علي", phone: "07700000000" })).order);
assert.ok((await sharedPhone.create({ customerName: "حسن علي", phone: "07700000000" })).order,
  "two group students may use the same contact phone");
const repeatedName = await sharedPhone.create({ customerName: "مُحَمَّد  علي", phone: "07711111111" });
assert.equal(repeatedName.response.status, 409, "the public form rejects a duplicate name in its group");
assert.equal(sharedPhone.rows().graduationOrdersTable.length, 2);
const invalidGroup = fixture();
let customerWrites = 0;
invalidGroup.context.ensureCustomer = async () => { customerWrites++; return { id: 1 }; };
assert.equal((await invalidGroup.create({ groupToken: "missing" })).response?.status, 404);
assert.equal(customerWrites, 0, "an invalid group link must not create a customer");
sharedPhone.context.ensureCustomer = async () => { customerWrites++; return { id: 1 }; };
assert.equal((await sharedPhone.create({ customerName: "محمد علي", phone: "07722222222" })).response?.status, 409);
assert.equal(customerWrites, 0, "a duplicate student name must not create a customer");
const injectedKit = fixture();
const approvedKit = await injectedKit.create({
  styleKey: "luxury", packageKey: "unapproved", accessories: ["unapproved"],
  customPackage: { enabled: true, items: [{ itemType: "robe", templateId: 999, quantity: 50 }] },
});
if (approvedKit.response) throw new Error(JSON.stringify(await approvedKit.response.json()));
assert.equal(approvedKit.order.totalAmount, 23000);
assert.equal(injectedKit.rows().graduationOrdersTable[0].styleKey, "standard");
assert.equal(injectedKit.rows().graduationOrdersTable[0].packageKey, null);
assert.deepEqual(Array.from(injectedKit.rows().graduationOrdersTable[0].accessories), []);
assert.equal(injectedKit.rows().graduationOrdersTable[0].templateSnapshot?.type, undefined, "client cannot add an unapproved custom kit at the fixed price");
const notificationFailure = fixture();
notificationFailure.context.notify = async () => { throw new Error("notification unavailable"); };
const confirmed = await notificationFailure.create();
assert.equal(confirmed.order.id, notificationFailure.rows().graduationOrdersTable[0].id);
assert.equal(confirmed.order.totalAmount, 23000);
assert.ok(confirmed.warning, "a post-save notification failure must return the exact committed order with a warning");
const stale = fixture();
const staleResult = await stale.create({ sashPricing: { mode: "by_sash", prices: { royal: 18000, american: 25000 } } });
assert.equal(staleResult.response?.status, 409, "changed displayed price must require confirmation, not charge a different amount");
assert.equal(stale.rows().graduationOrdersTable.length, 0);
const unseen = fixture();
assert.equal((await unseen.create({ sashPricing: undefined })).response?.status, 409, "a newly enabled policy must be shown before submission");
const rollback = fixture(policyConfig, { failInvoice: true });
await assert.rejects(rollback.create(), /invoice item failure/);
for (const name of ["graduationOrdersTable", "graduationReceiptsTable", "salesInvoicesTable", "qrTokensTable", "graduationGroupStudentsTable"])
  assert.equal(rollback.rows()[name].length, 0, `${name} must roll back with failed invoice`);

const retried = fixture();
const retryKey = randomUUID();
const retryBody = JSON.stringify({ customerName: "طالب اختبار", phone: "07700000000", styleKey: "standard",
  fabric: { key: fabricKey }, groupToken: "token", sashPricing: policyConfig.sashPricing,
  customText: { sashType: "royal" } });
const retryRequest = () => new Request("http://localhost/api/graduation/orders", {
  method: "POST", headers: { "Content-Type": "application/json", "x-idempotency-key": retryKey }, body: retryBody,
});
const firstRetryResponse = await retried.context.handle(retryRequest(), ["graduation", "orders"]);
const secondRetryResponse = await retried.context.handle(retryRequest(), ["graduation", "orders"]);
assert.equal(firstRetryResponse.status, 201);
assert.equal(secondRetryResponse.status, 201);
const firstRetryOrder = (await firstRetryResponse.json()).order;
assert.equal(firstRetryOrder.id, (await secondRetryResponse.json()).order.id);
assert.equal(firstRetryOrder.templateSnapshot?.submissionFingerprint, undefined,
  "the private retry fingerprint must not appear in the public receipt");
assert.equal(retried.rows().graduationOrdersTable.length, 1, "repeating the same save key must not create another order");
assert.equal(retried.rows().salesInvoicesTable.length, 1, "repeating the same save key must not create another invoice");
const changedRetry = await retried.context.handle(new Request("http://localhost/api/graduation/orders", {
  method: "POST", headers: { "Content-Type": "application/json", "x-idempotency-key": retryKey },
  body: JSON.stringify({ ...JSON.parse(retryBody), customerName: "طالب مختلف" }),
}), ["graduation", "orders"]);
assert.equal(changedRetry.status, 409, "a retry key cannot silently confirm a different order");
assert.equal(retried.rows().graduationOrdersTable.length, 1);
console.log("PASS real public creator pricing/receipt/invoice agreement, authorization, fallback, atomic rollback and failure isolation");
