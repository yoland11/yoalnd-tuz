import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Execute the real route bodies: bypassing the transactional custody helper,
// losing the source identity, or emitting side effects on retry must fail.
const text = readFileSync("src/server/api.ts", "utf8");
const tree = ts.createSourceFile("api.ts", text, ts.ScriptTarget.Latest, true);
const found = {};
function visit(node) {
  if (ts.isIfStatement(node) && node.expression.getText(tree) === 'section === "asset-links"') found.admin = node;
  if (ts.isIfStatement(node) && node.expression.getText(tree) === 'action === "assets"' && node.getText(tree).includes('const entityType = "photography"')) found.photography = node;
  if (ts.isIfStatement(node) && node.expression.getText(tree) === 'action === "assets"' && node.getText(tree).includes("await runShootAssetOperation(")) found.shootCaller = node;
  if (ts.isFunctionDeclaration(node) && node.name?.text === "runShootAssetOperation") found.shoot = node;
  ts.forEachChild(node, visit);
}
visit(tree);
for (const name of ["admin", "photography", "shoot", "shootCaller"]) assert.ok(found[name], `Missing ${name} route`);

const auth = { id: 17, fullName: "موظف", role: "staff", permissions: ["services"] };
const product = { id: 9, nameAr: "كاميرا", name: "Camera", costPrice: "50" };
const cases = [
  { kind: "admin", entityType: "service", entityId: 31, issueNote: "إخراج · service #31", staffId: 23 },
  { kind: "photography", entityType: "photography", entityId: 32, issueNote: "إخراج · photography #32", staffId: 17 },
  { kind: "shoot", entityType: "photography_shoot", entityId: 33, issueNote: "إخراج · تصوير ميداني #33", staffId: 17 },
  { kind: "shootCaller", entityType: "photography_shoot", entityId: 33, issueNote: "إخراج · تصوير ميداني #33", staffId: 17 },
];

function harness(testCase, payload, options = {}) {
  const writes = [], calls = [], effects = [];
  const tableNames = ["productsTable", "equipmentCustodyTable", "assetProfilesTable", "assetPassportsTable"];
  const tables = Object.fromEntries(tableNames.map(name => [name, new Proxy({ name }, { get: (obj, key) => obj[key] ?? `${name}.${String(key)}` })]));
  const chain = value => new Proxy({}, { get: (_, key) => key === "then" ? Promise.resolve(value).then.bind(Promise.resolve(value)) : () => chain(value) });
  const db = {
    query: Object.fromEntries(tableNames.map(name => [name, { findFirst: async () => name === "productsTable" ? product : null }])),
    execute: async query => { if (!/^\s*select/i.test(query)) writes.push(query); return { rows: [{ quantity: 1 }] }; },
    insert: table => { writes.push(["insert", table.name]); return chain([{ id: 41 }]); },
    update: table => { writes.push(["update", table.name]); return chain([]); },
  };
  const context = vm.createContext({
    ...tables, db, auth, order: { id: 32 }, shoot: { id: 33 }, event: { id: 34 }, actorName: "موظف", section: "asset-links", action: "assets", method: "POST", exports: {},
    requireAnyPermission: async () => options.denied ?? auth,
    isResponse: value => value === options.denied && Boolean(options.denied),
    ensureAssetLinksTable: async () => {}, body: async () => payload,
    optionalPositiveId: value => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null,
    nullableText: value => value == null || value === "" ? null : String(value),
    eq: (...args) => args, and: (...args) => args, desc: value => value,
    sql: (strings, ...values) => strings.reduce((result, part, index) => result + part + (index < values.length ? String(values[index]) : ""), ""),
    json: value => value, error: (message, status) => ({ error: message, status }),
    photographyStaffName: () => "موظف", erpActorFromAdmin: value => ({ id: value.id, name: value.fullName }),
    addEntityTimeline: async value => effects.push(["timeline", value]),
    logAdminActivity: async (...args) => effects.push(["admin", args]),
    createNotification: async value => effects.push(["notification", value]),
    runIndividualCustody: async (passedAuth, input) => {
      calls.push({ auth: passedAuth, input });
      if (options.failure) throw options.failure;
      return { row: { id: 41 }, product: { id: 9, name: "اسم حديث", costPrice: "50" }, changed: options.changed !== false, problem: input.problem ?? "none", repairCost: input.repairCost ?? 0 };
    },
  });
  const source = testCase.kind === "shoot"
    ? found.shoot.getText(tree) + "\nexports.run = runShootAssetOperation;"
    : `${testCase.kind === "shootCaller" ? found.shoot.getText(tree) : ""}\nasync function route(req) { ${found[testCase.kind].getText(tree)} }\nexports.run = route;`;
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
  const req = { nextUrl: { searchParams: new URLSearchParams() } };
  return { writes, calls, effects, run: () => context.exports.run(testCase.kind === "shoot" ? { req, auth, mode: payload.mode, productId: 9, product, shootId: 33, eventId: 34, actor: { id: 17, name: "موظف" }, payload } : req) };
}

for (const testCase of cases) {
  const multiple = harness(testCase, { mode: "checkout", productId: 9, entityType: testCase.entityType, entityId: testCase.entityId, quantity: 2 });
  await multiple.run();
  assert.equal(multiple.calls[0]?.input.quantity, 2, `${testCase.kind} must forward invalid individual quantities so the engine can reject them`);
  assert.equal(multiple.writes.length, 0);
  const invalid = harness(testCase, { mode: "return", productId: 9, entityType: testCase.entityType, entityId: testCase.entityId, problem: "discard" });
  assert.equal((await invalid.run()).status, 422, `${testCase.kind} must reject unknown return conditions`);
  assert.equal(invalid.calls.length, 0);
  assert.equal(invalid.writes.length, 0);
  for (const mode of ["checkout", "return"]) {
    const payload = { mode, productId: 9, custodyId: 41, entityType: testCase.entityType, entityId: testCase.entityId, staffId: 23, quantity: 1, problem: "broken", cost: 12, note: "ضرر", managerApproval: true };
    const test = harness(testCase, payload);
    const result = await test.run();
    assert.equal(test.writes.length, 0, `${testCase.kind} ${mode} must perform all custody writes inside the shared transaction`);
    assert.equal(test.calls.length, 1, `${testCase.kind} ${mode} must use canonical custody validation`);
    assert.equal(test.calls[0].auth, auth, "The helper must receive actual authenticated permissions");
    const input = test.calls[0].input;
    assert.equal(input.mode, mode);
    assert.equal(input.actorId, 17);
    assert.equal(input.productId, 9);
    assert.equal(input.staffId, testCase.staffId);
    assert.equal(input.quantity, 1);
    assert.equal(input.source.kind, "linked");
    assert.equal(input.source.entityType, testCase.entityType);
    assert.equal(input.source.entityId, testCase.entityId);
    assert.equal(input.source.issueNote, testCase.issueNote);
    assert.equal(Boolean(input.closeCustodyOnLoss), testCase.entityType === "photography_shoot");
    if (mode === "return") {
      assert.equal(input.custodyId, 41, "the original issue identity must survive every linked return adapter");
      assert.equal(input.problem, "broken");
      assert.equal(input.repairCost, 12);
      assert.equal(input.note, "ضرر");
      assert.equal(input.managerApproval, true);
    }
    assert.equal(result.name, "اسم حديث", "Response must reflect the locked product snapshot");
    assert.equal(result.ok, true);
    assert.equal(result.productId, 9);
    assert.ok(test.effects.length > 0, "A changed operation retains its timeline/admin notifications");

    const retry = harness(testCase, payload, { changed: false });
    assert.equal((await retry.run()).ok, true);
    assert.equal(retry.effects.length, 0, `${testCase.kind} ${mode} retry must not duplicate side effects`);
    assert.equal(retry.writes.length, 0);

    const failure = Object.assign(new Error("Source custody does not match"), { status: 409, code: "CUSTODY_SOURCE_CONFLICT" });
    const rejected = harness(testCase, payload, { failure });
    await assert.rejects(rejected.run, error => error === failure, "Canonical errors must reach the structured boundary mapper");
    assert.equal(rejected.effects.length, 0);
    assert.equal(rejected.writes.length, 0);
  }
}

const denied = { status: 403, error: "Forbidden" };
assert.equal(await harness(cases[0], { mode: "checkout", productId: 9, entityType: "service", entityId: 31 }, { denied }).run(), denied);
console.log("PASS linked custody routes: transactional ownership, source identity, auth, retries, structured errors");
