import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { bookingEventTypeWrite } from "../src/server/booking-event-type-validation";
import * as eventTypeValidation from "../src/server/booking-event-type-validation";
import { bookingGraduationHref, readBookingEventType } from "../src/lib/booking-event-types";
import { mergeRoutedKoshaCustomFields } from "../src/server/kosha-instruction-store";

for (const value of [undefined, null, "", "   "]) {
  assert.deepEqual(bookingEventTypeWrite(value, { mode: "create", required: true }), { ok: false, message: "اختر نوع المناسبة" });
}
for (const [input, expected] of [["engagement", "خطوبة"], ["حنه", "حنة"], ["wedding", "زفاف"], ["birthday", "عيد ميلاد"], ["graduation", "تخرج"], ["other", "مناسبة أخرى"]]) {
  assert.deepEqual(bookingEventTypeWrite(input, { mode: "create", required: true }), { ok: true, value: expected });
  assert.deepEqual(bookingEventTypeWrite(input, { mode: "edit", previous: "حفل قديم" }), { ok: true, value: expected });
}
assert.deepEqual(bookingEventTypeWrite("نوع مختلق", { mode: "create", required: true }), { ok: false, message: "نوع المناسبة غير صالح" });
assert.deepEqual(bookingEventTypeWrite("حفل تراثي قديم", { mode: "create" }), { ok: true, value: "حفل تراثي قديم" });
assert.deepEqual(bookingEventTypeWrite(undefined, { mode: "create" }), { ok: true, value: undefined });
assert.deepEqual(bookingEventTypeWrite(undefined, { mode: "edit", provided: false, previous: "حنة" }), { ok: true, value: "حنة" });
assert.deepEqual(bookingEventTypeWrite("حفل تراثي قديم", { mode: "edit", previous: "حفل تراثي قديم" }), { ok: true, value: "حفل تراثي قديم" });
assert.deepEqual(bookingEventTypeWrite("", { mode: "edit", previous: null }), { ok: true, value: null });
assert.deepEqual(bookingEventTypeWrite(null, { mode: "edit", previous: undefined }), { ok: true, value: undefined });
assert.deepEqual(bookingEventTypeWrite("", { mode: "edit", previous: "حنة" }), { ok: false, message: "اختر نوع المناسبة" });
assert.deepEqual(bookingEventTypeWrite("نوع مختلق", { mode: "edit", previous: "حنة" }), { ok: false, message: "نوع المناسبة غير صالح" });

// Exercise the actual API error wrapper, not a second implementation.
const api = readFileSync("src/server/api.ts", "utf8");
const start = api.indexOf("function admitBookingEventType(");
assert.ok(start >= 0, "API must admit event types through one shared structured contract");
const end = api.indexOf("\nfunction normalizeUnifiedBookingCustomFields", start);
const esbuild = createRequire(realpathSync(resolve("lib/db/node_modules/tsx/package.json")))("esbuild");
const code = esbuild.transformSync(api.slice(start, end) + "\nreturn admitBookingEventType;", { loader: "ts" }).code;
class CheckoutError extends Error { constructor(message: string, public status: number, public options: unknown) { super(message); } }
const admit = new Function("bookingEventTypeWrite", "CheckoutError", code)(bookingEventTypeWrite, CheckoutError);
assert.equal(admit("henna", { mode: "create", required: true }), "حنة");
assert.throws(() => admit("", { mode: "create", required: true }), (error: unknown) => {
  assert.ok(error instanceof CheckoutError);
  assert.equal(error.status, 422);
  assert.deepEqual(error.options, { code: "BOOKING_INVALID", fieldErrors: { eventType: "اختر نوع المناسبة" } });
  return true;
});

// Run the original admin-create occasion admission slice with controlled IO.
// No transaction, customer, payment, invoice or inventory writer is invoked.
const createStart = api.indexOf("      const customFields = normalizeUnifiedBookingCustomFields(\n        withDerivedServiceDetails(\n          service.type,\n          normalizeDetailsInput(rawBody?.customFields ?? data.customFields),");
assert.ok(createStart > 0);
const createEnd = api.indexOf("      const servicePaymentMethod =", createStart);
const createCode = esbuild.transformSync(api.slice(createStart, createEnd) + "\nreturn customFields;", { loader: "ts" }).code;
const identity = (fields: any) => ({ ...fields });
const create = new Function("admitBookingEventType", "normalizeUnifiedBookingCustomFields", "withDerivedServiceDetails", "normalizeDetailsInput", "service", "rawBody", "data", createCode);
const createFields = (customFields: Record<string, unknown>) => create(admit, identity, (_type: unknown, fields: any) => fields, identity, { type: "sound" }, { customFields }, {});
assert.equal(createFields({ bookingCenterVersion: 2, eventType: "wedding" }).eventType, "زفاف");
assert.throws(() => createFields({ bookingCenterVersion: 2 }), /اختر نوع المناسبة/);
assert.throws(() => createFields({ bookingCenterVersion: 2, eventType: "نوع مختلق" }), /نوع المناسبة غير صالح/);
assert.equal(Object.hasOwn(createFields({ bookingCenterVersion: 1 }), "eventType"), false);
assert.equal(createFields({ eventType: "حفل تراثي قديم" }).eventType, "حفل تراثي قديم");

const editStart = api.indexOf("        const previousFields = normalizeDetailsInput(prev.customFields);");
const editEnd = api.indexOf("        if (b?.eventLocation === undefined)", editStart);
assert.ok(editStart > 0 && editEnd > editStart);
const editCode = esbuild.transformSync(api.slice(editStart, editEnd) + "\nreturn update.customFields;", { loader: "ts" }).code;
const edit = new Function("admitBookingEventType", "normalizeUnifiedBookingCustomFields", "withDerivedServiceDetails", "normalizeDetailsInput", "prev", "b", "nextService", "update", editCode);
const editFields = (previous: Record<string, unknown>, requested: Record<string, unknown>) => edit(admit, identity, (_type: unknown, fields: any) => fields, identity, { customFields: previous }, { customFields: requested }, { type: "kosha" }, {});
assert.deepEqual(editFields({ eventType: "حنة" }, { note: "حقل آخر" }), { note: "حقل آخر" }, "an omitted occasion must not inject a pre-lock snapshot");
assert.equal(editFields({ eventType: "حفل تراثي قديم" }, { eventType: "حفل تراثي قديم" }).eventType, "حفل تراثي قديم");
assert.equal(Object.hasOwn(editFields({}, { note: "تعديل حجز قديم" }), "eventType"), false);
assert.equal(editFields({ eventType: null }, { eventType: "" }).eventType, null);
assert.equal(editFields({ eventType: "حنة" }, { eventType: "graduation" }).eventType, "تخرج");
assert.throws(() => editFields({ eventType: "حنة" }, { eventType: "" }), /اختر نوع المناسبة/);

const mergeStart = api.indexOf("      if (update.customFields !== undefined) {", editEnd);
const mergeEnd = api.indexOf("      const [row,photographySync]", mergeStart);
assert.ok(mergeStart > editEnd && mergeEnd > mergeStart);
const mergeCode = esbuild.transformSync(api.slice(mergeStart, mergeEnd) + "\nreturn update.customFields;", { loader: "ts" }).code;
const mergePatch = new Function("normalizeDetailsInput", "routedKoshaCustomFieldsSql", "serviceOrdersTable", "b", "update", mergeCode);
assert.deepEqual(mergePatch(identity, (_column: unknown, patch: unknown) => patch, {}, { paymentMethod: "cash" }, {
  customFields: { eventType: "خطوبة", paymentMethod: "cash" },
}), { paymentMethod: "cash" }, "payment metadata cannot re-inject an omitted stale occasion");
assert.equal(mergePatch(identity, (_column: unknown, patch: unknown) => patch, {}, { customFields: { eventType: "حنة" } }, {
  customFields: { eventType: "حنة" },
}).eventType, "حنة", "explicit occasions still reach the original SQL merge");

// Original route admission is source-specific and precedes the existing writes.
assert.match(api, /required: Number\(customFields\.bookingCenterVersion\) >= 2/);
assert.match(api, /previous: previousFields\.eventType/);
assert.match(api, /data\.eventType = admitBookingEventType\(data\.eventType, \{ mode: "edit", previous: fields\.eventType \}\)/);
assert.match(api, /parsed\.data\.eventType = admitBookingEventType\(parsed\.data\.eventType, \{ mode: "edit", previous: existing\.eventType \}\)/);
assert.match(api, /eventType: booking\.eventType \?\? null/);
assert.match(api, /source: "graduation",[\s\S]*?eventType: "تخرج"/);

// Run each original PATCH transaction callback. Removing a hook, using a stale
// pre-lock value, or running it outside the callback must fail these cases.
const ast = ts.createSourceFile("api.ts", api, ts.ScriptTarget.Latest, true);
const transactions: ts.ArrowFunction[] = [];
const walk = (node: ts.Node) => {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "db.transaction" && ts.isArrowFunction(node.arguments[0])) {
    transactions.push(node.arguments[0]);
  }
  ts.forEachChild(node, walk);
};
walk(ast);
const routedFormatter = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "formatRoutedKoshaServiceBooking");
assert.ok(routedFormatter);
const formatterSandbox: any = {
  exports: {}, formatKoshaBooking: async (row: any) => row,
  detectBookingDepartments: () => ["kosha"], departmentBadge: () => "كوشات",
};
vm.runInNewContext(ts.transpileModule(`exports.format=${routedFormatter.getText(ast)}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, formatterSandbox);
for (const fixture of [
  { fields: {}, expected: "" },
  { fields: { eventType: null }, expected: "" },
  { fields: { eventType: "حفل تراثي قديم" }, expected: "حفل تراثي قديم" },
  { fields: { eventType: "حنه" }, expected: "حنه" },
]) {
  const formatted = await formatterSandbox.exports.format({ id: 91, customFields: fixture.fields }, { type: "kosha", nameAr: "زفاف", name: "wedding" });
  assert.equal(formatted.eventType, fixture.expected, "a paid service name cannot invent a historical occasion");
  assert.equal(formatted.id, 91);
  assert.equal(formatted.source, "service");
}

const centralList = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "listCentralBookingCenterRows");
assert.ok(centralList);
const centralListCode = ts.transpileModule(`exports.list=${centralList.getText(ast)}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const baseRow = { customerName: "عميل قديم", phone: "07701234567", status: "confirmed", createdAt: new Date("2026-11-12T12:00:00Z"), totalAmount: "100", paidAmount: "20", depositAmount: "20", remainingAmount: "80" };
const sourceFixtures: Record<string, any[]> = {
  serviceOrdersTable: [
    { ...baseRow, id: 1, serviceId: 1, customFields: { eventType: "حنه" } },
    { ...baseRow, id: 2, serviceId: 1, customFields: { eventType: "حفل تراثي قديم" } },
    { ...baseRow, id: 3, serviceId: 1, customFields: null },
    { ...baseRow, id: 4, serviceId: 1, customFields: { bookingSource: "graduation", graduationOrderId: "75", privateFixture: "must stay private" } },
    { ...baseRow, id: 5, serviceId: 1, customFields: { bookingSource: "graduation", graduationOrderId: "75bad" } },
    { ...baseRow, id: 6, serviceId: 1, customFields: { bookingSource: "graduation", graduationOrderId: 2147483648 } },
    { ...baseRow, id: 7, serviceId: 1, customFields: { bookingSource: "manual", graduationOrderId: 76, eventType: "تخرج" } },
  ],
  servicesTable: [{ id: 1, type: "wedding", name: "خدمة مناسبات" }],
  koshaBookingsTable: [{ ...baseRow, id: 1, eventType: "عيد ميلاد" }, { ...baseRow, id: 2, eventType: null }],
  ordersTable: [{ ...baseRow, id: 1, trackingCode: "STORE-1", total: "100" }],
  graduationOrdersTable: [{ ...baseRow, id: 1, orderNo: "GRAD-1" }],
  photographyOrdersTable: [{ ...baseRow, id: 1, orderNo: "PHOTO-1" }],
  rentalOrdersTable: [{ ...baseRow, id: 1, orderNo: "RENT-1" }],
};
let failedSource: string | undefined;
const readFailure = new Error("controlled booking read failure");
const listSandbox: any = {
  exports: {}, sql: () => ({}), desc: () => ({}), readBookingEventType,
  db: { query: Object.fromEntries(Object.entries(sourceFixtures).map(([name, rows]) => [name, {
    findMany: async (options?: { limit: number }) => {
      if (name === failedSource) throw readFailure;
      if (name !== "servicesTable") assert.equal(options?.limit, 20_000);
      return rows;
    },
  }])) },
  shortBookingNumber: (source: string, id: number) => `${source}-${id}`,
  serviceOrderDepartments: () => ["kosha"], koshaBookingDepartments: () => ["kosha"], centralBookingDepartments: () => ["store"],
  bookingAssignedStaff: () => ({ staff: [] }),
  ...Object.fromEntries(Object.keys(sourceFixtures).map(name => [name, {}])),
};
vm.runInNewContext(centralListCode, listSandbox);
const centralResult = await listSandbox.exports.list(20_000);
assert.equal(centralResult.truncated, false);
assert.deepEqual(JSON.parse(JSON.stringify(Object.fromEntries(centralResult.rows.map((row: any) => [`${row.source}:${row.id}`, row.eventType])))), {
  "service:1": "حنه", "service:2": "حفل تراثي قديم", "service:3": null,
  "service:4": "تخرج", "service:5": null, "service:6": null, "service:7": "تخرج",
  "kosha:1": "عيد ميلاد", "kosha:2": null,
  "store:1": null, "graduation:1": "تخرج", "photography:1": null, "rental:1": null,
});
for (const [source, id, eventType, href] of [
  ["service", 4, "تخرج", "/admin/graduation/orders?order=75"],
  ["service", 5, null, "/admin/graduation/orders"],
  ["service", 6, null, "/admin/graduation/orders"],
  ["service", 7, "تخرج", "/admin/graduation/orders?order=76"],
  ["graduation", 1, "تخرج", "/admin/graduation/orders?order=1"],
] as const) {
  const row = centralResult.rows.find((row: any) => row.source === source && row.id === id);
  assert.ok(row);
  assert.equal(readBookingEventType(source, row), eventType, "central card receives the actual occasion from original projection");
  assert.equal(bookingGraduationHref(row), href, "central card keeps its original valid graduation order relationship");
  assert.equal(Object.hasOwn(row, "customFields"), false, "central list does not expose private source JSON");
  assert.equal(Object.hasOwn(row, "privateFixture"), false);
}
for (const row of centralResult.rows) assert.deepEqual([row.total, row.paid, row.remaining], [100, 20, 80], "occasion projection preserves original money");
failedSource = "koshaBookingsTable";
await assert.rejects(() => listSandbox.exports.list(20_000), error => error === readFailure, "source failures cannot become empty booking lists");

const patchCallbacks = [
  { source: "service", kind: "routed", marker: "syncCentralBookingToPhotography(order.id" },
  { source: "service", kind: "service", marker: "serviceItemsToSave !== null" },
  { source: "kosha", kind: "kosha", marker: "let canonicalPlan:TransportPlan" },
] as const;

// Request A read engagement; request B committed henna before A acquired the
// original lock. A's omitted occasion must preserve live henna without followups.
const routedFunction = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "updateRoutedKoshaServiceBooking");
assert.ok(routedFunction && ts.isFunctionDeclaration(routedFunction) && routedFunction.body);
const routedPreparation = routedFunction.body.statements.slice(0, routedFunction.body.statements.findIndex(node => node.getText(ast).startsWith("const [row] = await db.transaction"))).map(node => node.getText(ast)).join("\n");
const preparationSandbox: any = {
  exports: {}, req: {}, body: async () => ({ notes: "تعديل آخر" }),
  KoshaBookingUpdateSchema: { safeParse: (data: unknown) => ({ success: true, data }) },
  order: { id: 91, customFields: { eventType: "خطوبة" } }, serviceOrdersTable: { customFields: "fields" },
  admitBookingEventType: admit, nullableText: (value: unknown) => value,
  routedKoshaCustomFieldsSql: (_column: unknown, patch: unknown) => patch,
};
vm.runInNewContext(ts.transpileModule(`exports.prepare=async()=>{${routedPreparation}\nreturn update.customFields;}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, preparationSandbox);
const routedOmittedPatch = await preparationSandbox.exports.prepare();
assert.equal(Object.hasOwn(routedOmittedPatch, "eventType"), false, "routed PATCH must not write an omitted stale occasion");
const serviceOmittedPatch = editFields({ eventType: "خطوبة" }, { note: "تعديل آخر" });
for (const [kind, patch] of [["service", serviceOmittedPatch], ["routed", routedOmittedPatch]] as const) {
  const callback = transactions.find(node => node.getText(ast).includes(patchCallbacks.find(route => route.kind === kind)!.marker));
  assert.ok(callback);
  let liveFields = { eventType: "حنة", latestMetadata: "محفوظ" };
  const tx = { update: () => ({ set: (update: any) => ({ where: () => ({ returning: async () => {
    liveFields = mergeRoutedKoshaCustomFields(liveFields, update.customFields) as typeof liveFields;
    return [{ id: 91, customFields: liveFields }];
  } }) }) }) };
  const sandbox: any = {
    exports: {}, update: { customFields: patch }, order: { id: 91 }, id: 91,
    serviceOrdersTable: { id: "id" }, eq: () => ({}), serviceItemsToSave: null,
    auth: { id: 4, fullName: "موظف", username: "staff" }, req: { headers: { get: () => null } },
    guardBookingResourceWrite: async (_tx: unknown, _ref: unknown, write: (before: unknown) => Promise<unknown>) => write({ details: { ...liveFields } }),
    syncCentralBookingToPhotography: async () => undefined,
    bookingEventTypeNeedsFollowups: eventTypeValidation.bookingEventTypeNeedsFollowups,
    recordOccasionFollowups: async () => { throw new Error("omitted occasion caused spurious followups"); },
  };
  vm.runInNewContext(ts.transpileModule(`exports.run=${callback.getText(ast)}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, sandbox);
  await sandbox.exports.run(tx);
  assert.equal(liveFields.eventType, "حنة", `${kind} omission preserves the occasion committed before its lock`);
  assert.equal(liveFields.latestMetadata, "محفوظ");
}

for (const route of patchCallbacks) {
  const candidates = transactions.filter(node => node.getText(ast).includes(route.marker));
  assert.equal(candidates.length, 1, `one original ${route.kind} PATCH transaction`);
  const callbackCode = ts.transpileModule(`exports.run=${candidates[0].getText(ast)}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const cases = [
    { before: "زفاف", after: "حنة", count: 1 },
    { before: undefined, after: "خطوبة", count: 1 },
    { before: "حنه", after: "حنة", count: 0 },
    { before: "engagement", after: "خطوبة", count: 0 },
    { before: "خطوبة", after: "خطوبة", count: 0 },
    { before: "حنة", after: "تخرج", count: 0 },
    { before: "حفل تراثي قديم", after: "حفل تراثي قديم", count: 0 },
    { before: undefined, after: undefined, count: 0 },
  ];
  for (const fixture of cases) {
    let previous = fixture.before;
    const calls: Array<{ source: string; id: number; staffId: number }> = [];
    const failure = new Error("followup transaction failure");
    let failFollowups = false;
    const saved = { id: 91, customerId: 7, eventType: fixture.after, customFields: { eventType: fixture.after } };
    const tx = {
      query: { koshaBookingsTable: { findFirst: async () => ({ id: 91, eventType: previous }) } },
      update: () => ({ set: () => ({ where: () => ({ returning: async () => [saved] }) }) }),
    };
    const sandbox = {
      exports: {} as any,
      update: route.source === "kosha" ? { eventType: fixture.after } : { customFields: { eventType: fixture.after } },
      id: 91, order: { id: 91 }, auth: { id: 4, fullName: "موظف", username: "staff" },
      req: { headers: { get: () => null } },
      serviceOrdersTable: { id: "service.id" }, koshaBookingsTable: { id: "kosha.id", eventType: "kosha.eventType" },
      eq: () => ({}), serviceItemsToSave: null, transportPlanChange: null,
      bookingEventTypeNeedsFollowups: (eventTypeValidation as any).bookingEventTypeNeedsFollowups,
      guardBookingResourceWrite: async (executor: unknown, ref: any, write: (live: unknown) => Promise<unknown>) => {
        assert.equal(executor, tx);
        assert.deepEqual(JSON.parse(JSON.stringify(ref)), { source: route.source, id: 91 });
        return write({ details: { eventType: previous } });
      },
      syncCentralBookingToPhotography: async (_id: unknown, _actor: unknown, executor: unknown) => { assert.equal(executor, tx); },
      recordOccasionFollowups: async (executor: unknown, input: any) => {
        assert.equal(executor, tx, "followups use the original write transaction");
        calls.push(JSON.parse(JSON.stringify(input)));
        if (failFollowups) throw failure;
      },
    };
    vm.runInNewContext(callbackCode, sandbox);
    await sandbox.exports.run(tx);
    assert.equal(calls.length, fixture.count, `${route.kind}: ${fixture.before} → ${fixture.after}`);
    if (fixture.count) {
      assert.deepEqual(calls[0], { source: route.source, id: 91, staffId: 4 });
      previous = fixture.after;
      await sandbox.exports.run(tx);
      assert.equal(calls.length, 1, "retry observes the saved occasion and creates no duplicate work");
      previous = fixture.before;
      failFollowups = true;
      await assert.rejects(() => sandbox.exports.run(tx), error => error === failure, "followup errors abort the original booking transaction");
    }
  }
}
console.log("PASS original booking occasion admission and PATCH transactions: v2 required, legacy preservation, normalized changes, stable identities, unchanged/retry suppression and atomic error propagation");
