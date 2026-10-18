const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const { z } = require("zod");
const { sql } = require("drizzle-orm");
const { PgDialect } = require("drizzle-orm/pg-core");

// Run the real HTTP action branch; only external database IO is controlled.
const source = ts.createSourceFile("api.ts", fs.readFileSync("src/server/api.ts", "utf8"), ts.ScriptTarget.Latest, true);
let branch;
function visit(node) {
  if (ts.isIfStatement(node) && node.expression.getText(source) === 'parts[2] === "action" && method === "POST"') {
    assert.equal(branch, undefined, "one original asset-status action branch");
    branch = node;
  }
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(branch);
const javascript = ts.transpileModule(`async function run(req, auth) { const parts=['admin','assets','action'], method='POST'; ${branch.getText(source)} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const dialect = new PgDialect();
const tables = Object.fromEntries(["products", "assetProfiles", "assetPassports", "equipmentCustody", "entityTimeline"].map(name => [name + "Table", {
  name, id: name + ".id", productId: name + ".productId", status: name + ".status", entityType: name + ".entityType", entityId: name + ".entityId", actorId: name + ".actorId", metadata: name + ".metadata",
}]));
const eq = (field, value) => ({ field: field.split(".")[1], value });
function matches(row, where) {
  if (!where) return true;
  if (where.and) return where.and.every(part => matches(row, part));
  if (where.queryChunks) {
    const query = dialect.sqlToQuery(where);
    assert.match(query.sql, /assetActionRequestId/);
    return row.metadata?.assetActionRequestId === query.params.at(-1);
  }
  return row[where.field] === where.value;
}
const auth = { id: 1, fullName: "Manager", username: "manager", role: "admin", permissions: ["products"], isActive: true };
function fixture() {
  return {
    products: [{ id: 10, name: "Stand", nameAr: "ستاند", costPrice: "100", isActive: true, isAsset: true }],
    assetProfiles: [{ id: 3, productId: 10, status: "maintenance", currentValue: "80", purchasePrice: "100", deletedAt: null }],
    assetPassports: [{ id: 2, productId: 10, lastStaffId: null, lastLocation: "Warehouse", maintenanceCost: "5", metadata: { preserve: true } }],
    equipmentCustody: [], entityTimeline: [],
  };
}
function harness(initial = fixture(), settings = {}) {
  let state = structuredClone(initial), active = false, locked = false;
  const events = [], notifications = [], activities = [];
  const mustLock = () => { if (active) assert.equal(locked, true, "fresh state and writes require the original product lock"); };
  function connection(draft) {
    const db = {
      execute: async statement => {
        const query = dialect.sqlToQuery(statement);
        assert.match(query.sql, /select .*from products .*for update/i);
        assert.equal(query.params[0], 10);
        locked = true; events.push("product-lock");
        if (settings.onLock) settings.onLock(draft);
        return { rows: draft.products.filter(row => row.id === 10) };
      }, query: {},
      insert: target => ({ values: values => {
        const commit = set => {
          mustLock();
          if (target.name === "entityTimeline" && settings.failTimeline) throw new Error("timeline unavailable");
          if (!active) events.push("unsafe-global-write");
          let row = target.name !== "entityTimeline" && draft[target.name].find(row => row.productId === values.productId);
          if (row && set) Object.assign(row, structuredClone(set));
          else if (!row) { row = { id: draft[target.name].length + 1, ...structuredClone(values) }; draft[target.name].push(row); }
          return row;
        };
        return { then: (resolve, reject) => Promise.resolve().then(() => commit()).then(resolve, reject), returning: async () => [commit()], onConflictDoUpdate: async ({ set }) => commit(set) };
      } }),
      update: target => ({ set: values => ({ where: async where => {
        mustLock(); if (!active) events.push("unsafe-global-write");
        for (const row of draft[target.name].filter(row => matches(row, where))) Object.assign(row, structuredClone(values));
      } }) }),
    };
    for (const [key, target] of Object.entries(tables)) db.query[key] = {
      findFirst: async ({ where } = {}) => { mustLock(); return structuredClone(draft[target.name].find(row => matches(row, where))); },
      findMany: async ({ where, limit } = {}) => { mustLock(); return structuredClone(draft[target.name].filter(row => matches(row, where)).slice(0, limit)); },
    };
    return db;
  }
  const db = connection(state);
  db.transaction = async work => {
    active = true; locked = false; const draft = structuredClone(state); events.push("begin");
    try { const result = await work(connection(draft)); state = draft; events.push("commit"); return result; }
    catch (cause) { events.push("rollback"); throw cause; }
    finally { active = false; }
  };
  class IndividualCustodyError extends Error { constructor(message, status = 422) { super(message); this.status = status; } }
  const context = {
    ...tables, db, sql, z, IndividualCustodyError,
    eq, and: (...and) => ({ and }),
    body: async req => req.payload,
    optionalPositiveId: value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null,
    enterpriseNumber: value => Number.isFinite(Number(value)) ? Number(value) : 0,
    nullableText: value => typeof value === "string" && value.trim() ? value.trim() : null,
    hasPermission: (user, permission) => user.isActive && (user.role === "admin" || user.permissions.includes(permission)),
    assetMetadataObject: value => value && typeof value === "object" && !Array.isArray(value) ? value : {},
    assetPassportHasCustodyHold: passport => passport?.metadata?.damageHold === true || passport?.metadata?.inspectionBlocked === true,
    quantityProfilesFor: async executor => { if (active) assert.notEqual(executor, db); return new Map(settings.quantity ? [[10, {}]] : []); },
    erpActorFromAdmin: user => ({ id: user.id, name: user.fullName }),
    addEntityTimeline: async input => { if (settings.failTimeline) throw new Error("timeline unavailable"); if (active) throw new Error("global timeline inside transaction"); state.entityTimeline.push(input); },
    logAdminActivity: async (...input) => { assert.equal(active, false, "global activity runs after commit"); activities.push(input); },
    createNotification: async input => { assert.equal(active, false, "notification delivery runs after commit"); notifications.push(input); if (settings.failNotification) throw new Error("notification unavailable"); },
    revalidateTag: () => { assert.equal(active, false); }, ENTERPRISE_COMMAND_CENTER_TAG: "command-center",
    error: (message, status = 400) => ({ status, payload: { message } }),
    validationError: () => ({ status: 422 }), json: payload => ({ status: 200, payload }),
  };
  vm.createContext(context); vm.runInContext(javascript, context);
  return {
    get state() { return state; }, events, notifications, activities,
    async run(payload, user = auth) {
      try { return await context.run({ payload: { productId: 10, ...payload } }, user); }
      catch (cause) { if (cause instanceof IndividualCustodyError) return { status: cause.status, payload: { message: cause.message } }; throw cause; }
    },
  };
}
(async () => {
  const issuedState = fixture(); issuedState.equipmentCustody.push({ id: 8, productId: 10, staffId: 4, quantity: 1, status: "issued" }); issuedState.assetPassports[0].lastStaffId = 4;
  const issued = harness(issuedState);
  assert.equal((await issued.run({ action: "available" })).status, 409, "a status shortcut must not reactivate an issued asset");
  assert.equal(issued.state.assetProfiles[0].status, "maintenance");
  assert.equal(issued.state.assetPassports[0].lastStaffId, 4);

  const stale = harness(fixture(), { onLock: state => { state.assetProfiles[0].status = "sold"; } });
  assert.equal((await stale.run({ action: "repair", requestId: "repair-001", cost: 20, notes: "Fixed" })).status, 409, "post-lock terminal status is authoritative");
  assert.deepEqual(stale.events, ["begin", "product-lock", "rollback"]);
  const holderState = fixture(); holderState.assetPassports[0].lastStaffId = 4;
  assert.equal((await harness(holderState).run({ action: "available" })).status, 409, "a legacy passport holder is not silently overridden");

  const repair = harness();
  const request = { action: "repair", requestId: "repair-001", cost: 20, notes: "Fixed" };
  assert.equal((await repair.run(request)).status, 200);
  assert.equal(repair.state.assetPassports[0].maintenanceCost, "25");
  assert.equal(repair.state.entityTimeline[0].metadata.previousStatus, "maintenance", "audit retains the original pre-write condition");
  await repair.run(request);
  assert.equal(repair.state.assetPassports[0].maintenanceCost, "25", "a durable retry cannot charge the same repair twice");
  assert.equal(repair.state.entityTimeline.length, 1);
  assert.equal(repair.activities.length, 1);
  assert.equal((await repair.run({ ...request, cost: 30 })).status, 409, "a retry key cannot silently change repair cost");
  assert.equal(repair.state.assetPassports[0].maintenanceCost, "25");
  assert.equal((await harness().run({ action: "repair", cost: 20, notes: "Fixed" })).status, 422, "nonzero repairs require a durable retry identity");

  const rollback = harness(fixture(), { failTimeline: true });
  await assert.rejects(() => rollback.run(request), /timeline unavailable/);
  assert.equal(rollback.state.assetProfiles[0].status, "maintenance");
  assert.equal(rollback.state.assetPassports[0].maintenanceCost, "5");
  assert.equal(rollback.activities.length, 0);
  const revoked = { ...auth, role: "staff", permissions: ["products"] };
  assert.equal((await harness().run({ action: "lost" }, revoked)).status, 403, "products access is not loss approval");
  assert.equal((await repair.run(request, revoked)).status, 403, "authorization is checked again before a replay");
  for (const action of ["damage", "maintenance", "repair"]) assert.equal((await harness().run({ action, notes: "Reason" }, revoked)).status, 403);
  assert.equal((await repair.run(request, { ...auth, id: 2 })).status, 409, "another actor cannot adopt the same operation identity");
  const laterState = structuredClone(repair.state);
  laterState.equipmentCustody.push({ id: 9, productId: 10, staffId: 7, quantity: 1, status: "issued" });
  laterState.assetPassports[0].lastStaffId = 7;
  const later = harness(laterState);
  assert.equal((await later.run(request)).payload.replayed, true);
  assert.equal(later.state.assetPassports[0].lastStaffId, 7, "an old successful repair retry cannot affect a later holder");
  assert.equal(later.state.assetPassports[0].maintenanceCost, "25");
  const damageInField = harness(issuedState);
  assert.equal((await damageInField.run({ action: "damage", requestId: "field-damage-001", notes: "Bent frame" })).status, 200);
  assert.equal(damageInField.state.equipmentCustody[0].status, "issued", "damage status is not a second return workflow");
  assert.equal(damageInField.state.assetPassports[0].lastStaffId, 4);
  const notifyFailure = harness(fixture(), { failNotification: true });
  const damageRequest = { action: "damage", requestId: "damage-001", notes: "Bent frame" };
  await assert.rejects(() => notifyFailure.run(damageRequest), /notification unavailable/);
  assert.equal(notifyFailure.state.entityTimeline.length, 1, "the original movement stays durably audited after delivery failure");
  assert.equal((await notifyFailure.run(damageRequest)).payload.replayed, true);
  assert.equal(notifyFailure.notifications.length, 1, "retry does not duplicate a post-commit delivery attempt");

  const heldState = fixture(); heldState.assetPassports[0].metadata.damageHold = true; heldState.assetPassports[0].metadata.inspectionBlocked = true;
  for (const shortcut of ["reserved", "transferred"]) {
    const maintenance = harness();
    assert.equal((await maintenance.run({ action: shortcut }, revoked)).status, 409, `${shortcut} cannot erase a legacy maintenance marker before an available shortcut`);
    assert.equal(maintenance.state.assetProfiles[0].status, "maintenance");
  }
  assert.equal((await harness(heldState).run({ action: "available" })).status, 409, "available is not a repair approval");
  const held = harness(heldState); await held.run(request);
  assert.equal(held.state.assetProfiles[0].status, "active");
  assert.equal(held.state.assetPassports[0].metadata.preserve, true);
  assert.equal(held.state.assetPassports[0].metadata.damageHold, false, "explicit permitted repair clears only the inspection/damage hold");
  assert.equal(held.state.assetPassports[0].metadata.inspectionBlocked, false);
  for (const status of ["lost", "retired", "locked", "sold", "disposed"]) {
    const state = fixture(); state.assetProfiles[0].status = status;
    assert.equal((await harness(state).run({ action: "available" })).status, 409, `${status} cannot be reactivated by the generic shortcut`);
  }
  const quantity = harness(fixture(), { quantity: true });
  assert.equal((await quantity.run({ action: "repair", notes: "Fixed" })).status, 409);
  assert.equal(quantity.state.assetProfiles[0].status, "maintenance");
  for (const cost of [-1, "bad", Infinity]) assert.equal((await harness().run({ ...request, cost })).status, 422);
  const legacy = harness(); assert.equal((await legacy.run({ action: "inspection", notes: "Checked" })).status, 200, "cost-free legacy actions remain supported");
  assert.equal(legacy.events.includes("unsafe-global-write"), false);
  console.log("PASS actual asset status action: original lock, holder/terminal/quantity guards, atomic audit, repair replay and trusted permissions (controlled IO, no PostgreSQL integration)");
})().catch(cause => { console.error(cause); process.exitCode = 1; });
