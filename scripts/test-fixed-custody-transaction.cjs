const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const { sql } = require("drizzle-orm");
const { PgDialect } = require("drizzle-orm/pg-core");

// Execute the real fixed-custody route branch. Only database IO is simulated;
// no production credentials, driver, or network connection are loaded.
const source = ts.createSourceFile("api.ts", fs.readFileSync("src/server/api.ts", "utf8"), ts.ScriptTarget.Latest, true);
let branch;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "handleBookingOperations") {
    branch = node.body.statements.find((child) => ts.isIfStatement(child) && child.expression.getText(source) === 'resource === "custody"');
  }
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(branch, "actual fixed-custody route branch exists");
const declarations = ["saveBookingOperations", "logCustodyAudit", "custodyAvailability", "custodyPreview", "executeLockedBookingAssetAction"].map((name) => {
  const declaration = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, name);
  return declaration.getText(source);
});
const javascript = ts.transpileModule(`${declarations.join("\n")}\nasync function run(req, auth, reference) { const resource='custody', method=req.method; ${branch.getText(source)} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const dialect = new PgDialect();
const protection={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/server/booking-operations-write-guard.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports:protection.exports,module:protection,require});
const table = (name, fields) => Object.assign({ name }, Object.fromEntries(fields.map((field) => [field, `${name}.${field}`])));
const tables = {
  productsTable: table("products", ["id"]),
  koshaBookingsTable: table("booking", ["id"]),
  serviceOrdersTable: table("service", ["id", "customFields"]),
  equipmentCustodyTable: table("custody", ["id", "productId", "staffId", "status", "notes", "quantity"]),
  assetProfilesTable: table("profiles", ["id", "productId"]),
  assetPassportsTable: table("passports", ["productId"]),
  entityTimelineTable: table("timelines", ["id"]),
};
const compare = (field, value) => ({ field: field.split(".")[1], value });
function matches(row, where) {
  if (!where) return true;
  if (where.and) return where.and.every((condition) => matches(row, condition));
  return row[where.field] === where.value;
}
const day = "2026-10-18T08:00:00";
function fixture() {
  return {
    booking: { id: 7, eventDate: "2026-10-18", status: "confirmed", bookingDetails: { privateNote: "preserve fresh fields", bookingOperations: { custodyEmployeeIds: [5], assets: [{ productId: 90, quantity: 1, stage: "reserved" }] } } },
    reservations: [{ id: 1, group_id: 2, group_name: "Camera kit", product_id: 10, staff_id: 5, full_name: "Crew", username: "crew", booking_type: "kosha_booking", booking_id: 7, status: "reserved", start_at: new Date(day), end_at: new Date(new Date(day).getTime() + 8 * 3600000), checkout_at: null, returned_at: null, depreciation_applied_at: null }],
    candidates: [{ group_id: 2, group_name: "Camera kit", group_type: "general", staff_id: 5, full_name: "Crew", username: "crew", department: null, product_id: 10, asset_name: "Camera", barcode: null, serial_number: null, asset_status: "active", qr_token: null, warehouse_id: null, shelf_code: null, metadata: {} }],
    products: [{ id: 10, name: "Camera", isActive: true, isAsset: true, costPrice: "100" }, { id: 20, name: "Lens", isActive: true, isAsset: true, costPrice: "50" }, { id: 90, name: "Other", isActive: true, isAsset: true }],
    custody: [], profiles: [{ id: 3, productId: 10, purchasePrice: "100", currentValue: "80", usageCount: 2, expectedLifeUses: 10, status: "active", deletedAt: null }],
    passports: [{ productId: 10, lastStaffId: null, lastLocation: "Warehouse", metadata: { automaticDepreciation: true } }], audits: [], timelines: [],
  };
}
function harness(initial = fixture(), settings = {}) {
  let state = structuredClone(initial);
  let active = false;
  let transaction;
  const events = [];
  const after = [];
  const locks = new Set();
  const requireLock = (id) => assert.ok(locks.has(Number(id)), `product ${id} must be locked before decision/write`);
  function connection(draft) {
    const tx = {
      execute: async (statement) => {
        const { sql: text, params } = dialect.sqlToQuery(statement);
        const normalized = text.replace(/\s+/g, " ").trim();
        if (/^select .*from (kosha_bookings|service_orders).*for update/i.test(normalized)) {
          events.push("booking-lock");
          return { rows: [{ id: 7 }] };
        }
        if (/^select .*from products .*for update/i.test(normalized)) {
          assert.equal(events[0], "booking-lock", "booking lock precedes product locks");
          locks.add(Number(params[0])); events.push(`product-lock:${params[0]}`);
          if (settings.onLock) settings.onLock(draft, Number(params[0]));
          return { rows: draft.products.filter((row) => row.id === Number(params[0])) };
        }
        if (normalized.startsWith("select") && /from employee_custody_group_assets a/.test(normalized)) {
          return { rows: draft.candidates.filter((row) => params.map(Number).includes(row.staff_id)).map((row) => ({ product_id: row.product_id })) };
        }
        if (normalized.startsWith("select") && /from employee_custody_groups g/.test(normalized)) {
          return { rows: draft.candidates.filter((row) => params.map(Number).includes(row.staff_id)) };
        }
        if (normalized.startsWith("select") && /from products p left join asset_profiles/.test(normalized)) {
          const id = Number(params.at(-1)); requireLock(id);
          const product = draft.products.find((row) => row.id === id);
          const profile = draft.profiles.find((row) => row.productId === id);
          const passport = draft.passports.find((row) => row.productId === id);
          return { rows: product ? [{ id, is_active: product.isActive, asset_status: profile?.status, deleted_at: profile?.deletedAt, metadata: passport?.metadata, is_checked_out: draft.custody.some((row) => row.productId === id && row.status === "issued"), conflict_booking: settings.conflict ?? null }] : [] };
        }
        if (normalized.startsWith("select") && /from employee_custody_reservations/.test(normalized)) {
          events.push("reservation-read");
          return { rows: structuredClone(draft.reservations) };
        }
        if (normalized.startsWith("insert into employee_custody_reservations")) {
          const [groupId, productId, staffId, bookingType, bookingId, startAt, endAt] = params;
          requireLock(productId);
          const existing = draft.reservations.find((row) => row.product_id === productId);
          const values = { id: existing?.id ?? draft.reservations.length + 1, group_id: groupId, product_id: productId, staff_id: staffId, booking_type: bookingType, booking_id: bookingId, start_at: startAt, end_at: endAt, status: "reserved" };
          if (existing) Object.assign(existing, values); else draft.reservations.push(values);
          return { rows: [] };
        }
        if (normalized.startsWith("update employee_custody_reservations")) {
          if (normalized.includes("status='released'")) {
            for (const row of draft.reservations.filter((row) => row.status === "reserved")) { requireLock(row.product_id); row.status = "released"; }
          } else {
            const row = draft.reservations.find((row) => row.id === params.at(-1)); assert.ok(row); requireLock(row.product_id);
            if (normalized.includes("status='checked_out'")) Object.assign(row, { status: "checked_out", checkout_at: new Date(), condition_out: params[0], signature_url: params[1] });
            else Object.assign(row, { status: params[0], returned_at: new Date(), condition_in: params[1], damage_reason: params[2], damage_photo_url: params[3], ...(normalized.includes("depreciation_applied_at") ? { depreciation_applied_at: row.depreciation_applied_at ?? new Date() } : {}) });
          }
          return { rows: [] };
        }
        if (normalized.startsWith("insert into employee_custody_audit")) {
          assert.equal(active, true, "audit participates in transaction");
          if (settings.failAudit) throw new Error("audit offline");
          draft.audits.push(params); return { rows: [] };
        }
        throw new Error(`Unexpected SQL: ${normalized}`);
      },
      query: {},
      insert: (target) => ({ values: (input) => {
        const values = structuredClone(input);
        const commit = () => {
          if (target.name === "timelines") { draft.timelines.push(values); return values; }
          requireLock(values.productId);
          const rows = draft[target.name];
          let row = rows.find((row) => target.name !== "custody" && row.productId === values.productId);
          if (row) return row;
          row = { id: rows.length + 1, status: "issued", ...values }; rows.push(row); return row;
        };
        return { returning: async () => [commit()], then: (resolve, reject) => Promise.resolve().then(commit).then(resolve, reject), onConflictDoUpdate: async ({ set }) => {
          const existing = draft[target.name].find((row) => row.productId === values.productId);
          if (existing) { requireLock(values.productId); Object.assign(existing, structuredClone(set)); } else commit();
        } };
      } }),
      update: (target) => ({ set: (values) => ({ where: async (where) => {
        if (target.name === "booking") {
          if(values.bookingDetails?.getSQL){const query=dialect.sqlToQuery(values.bookingDetails);const patch=JSON.parse(query.params.find(value=>typeof value==='string'&&value.startsWith('{')));draft.booking.bookingDetails=structuredClone(protection.exports.mergeBookingOperationalEvidence(draft.booking.bookingDetails,patch));}
          else draft.booking.bookingDetails = structuredClone(values.bookingDetails);
          return;
        }
        for (const row of draft[target.name].filter((row) => matches(row, where))) { requireLock(row.productId); Object.assign(row, structuredClone(values)); }
      } }) }),
    };
    for (const [key, target] of Object.entries(tables)) tx.query[key] = {
      findFirst: async ({ where } = {}) => {
        if (key === "koshaBookingsTable" || key === "serviceOrdersTable") { events.push("fresh-booking"); return draft.booking; }
        const row = draft[target.name].find((row) => matches(row, where));
        if (key === "productsTable") requireLock(row?.id ?? where.value); else if (row) requireLock(row.productId);
        return row;
      },
      findMany: async ({ where, limit } = {}) => {
        const rows = draft[target.name].filter((row) => matches(row, where));
        if (where?.and?.find((condition) => condition.field === "productId")) requireLock(where.and.find((condition) => condition.field === "productId").value);
        return structuredClone(rows.slice(0, limit));
      },
    };
    return tx;
  }
  const db = {
    execute: async () => { throw new Error("global database IO is forbidden in a custody transaction"); },
    query: new Proxy({}, { get: () => { throw new Error("global database query is forbidden in a custody transaction"); } }),
    transaction: async (work) => {
      const draft = structuredClone(state); locks.clear(); active = true; transaction = connection(draft);
      try { const result = await work(transaction); state = draft; events.push("commit"); return result; }
      catch (cause) { events.push("rollback"); throw cause; }
      finally { active = false; }
    },
  };
  class IndividualCustodyError extends Error { constructor(message, status = 422) { super(message); this.status = status; } }
  const context = {
    ...tables, db, sql, Date, IndividualCustodyError,bookingEvidenceWriteSql:protection.exports.bookingEvidenceWriteSql,
    eq: compare, and: (...and) => ({ and }), desc: (value) => value,
    ensureCustodyGroupTables: async () => {}, hasPermission: (auth, permission) => auth.role === "admin" || auth.permissions.includes(permission),
    body: async (req) => req.payload, int: Number,
    optionalPositiveId: (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : undefined,
    nullableText: (value) => typeof value === "string" && value.trim() ? value.trim() : null,
    assetMetadataObject: (value) => value && typeof value === "object" ? value : {},
    bookingOperationsState: (details) => details.bookingOperations ?? {},
    quantityProfilesFor: async (tx) => { assert.equal(tx, transaction); return new Map((settings.quantityIds ?? []).map((id) => [id, {}])); },
    json: (payload) => ({ status: 200, payload }), error: (message, status) => ({ status, payload: { message } }),
    erpActorFromAdmin: (auth) => ({ id: auth.id, name: auth.fullName }), actor: (auth) => ({ id: auth.id, name: auth.fullName }),
    logAdminActivity: async () => {},
    addEntityTimeline: async (input) => { assert.equal(active, false, "global timeline runs after commit"); state.timelines.push(input); },
    runAfter: (_label, task) => { assert.equal(active, false); after.push(task); },
  };
  vm.createContext(context); vm.runInContext(javascript, context);
  return {
    get state() { return state; }, events,
    async bookingAction(input) {
      const actor = { id: 1, fullName: "Operator", username: "operator", role: "admin", permissions: [], isActive: true };
      return db.transaction(async (tx) => {
        await tx.execute(sql`select id from kosha_bookings where id=${7} for update`);
        await tx.execute(sql`select id from products where id=${10} for update`);
        const row = await tx.query.koshaBookingsTable.findFirst({ where: compare("booking.id", 7) });
        const details = row.bookingDetails;
        return context.executeLockedBookingAssetAction({}, actor, { source: "kosha", entityType: "kosha_booking", id: 7, row, details, operations: details.bookingOperations, eventDate: row.eventDate }, { productId: 10, quantity: 1, problem: "none", photoUrls: [], estimatedCost: 0, ...input }, tx, false);
      });
    },
    async run(payload, permissions = ["products"], role = "employee") {
      const reference = { source: "kosha", entityType: "kosha_booking", id: 7, details: { stale: true }, operations: { custodyEmployeeIds: [99], assets: [] }, eventDate: "2020-01-01" };
      const req = { method: "POST", payload, nextUrl: { searchParams: new URLSearchParams() } };
      const result = await context.run(req, { id: 1, fullName: "Operator", username: "operator", role, permissions, isActive: true }, reference);
      for (const task of after.splice(0)) await task();
      return result;
    },
  };
}

(async () => {
  const checkout = harness();
  await checkout.run({ action: "checkout" });
  assert.deepEqual(checkout.events.filter((event) => event.includes("lock")), ["booking-lock", "product-lock:10", "product-lock:90"]);
  assert.equal(checkout.state.custody.length, 1);
  assert.equal(checkout.state.booking.bookingDetails.privateNote, "preserve fresh fields");
  assert.equal(checkout.state.booking.bookingDetails.bookingOperations.assets.length, 2, "fresh unrelated linked asset survives");
  await checkout.run({ action: "checkout" });
  assert.equal(checkout.state.custody.length, 1, "checkout retry has one durable custody row");
  assert.equal(checkout.state.audits.length, 1, "checkout retry has no extra audit");

  const blocked = harness(fixture(), { onLock: (state, id) => { if (id === 10) state.profiles[0].status = "maintenance"; } });
  await assert.rejects(() => blocked.run({ action: "checkout" }), /حالة الأصل|متاحة/);
  assert.equal(blocked.state.custody.length, 0, "post-lock status is authoritative");

  const auditFailure = harness(fixture(), { failAudit: true });
  await assert.rejects(() => auditFailure.run({ action: "checkout" }), /audit offline/);
  assert.equal(auditFailure.state.custody.length, 0, "audit failure rolls custody back");
  assert.equal(auditFailure.state.reservations[0].status, "reserved");

  const returned = harness(checkout.state);
  await returned.run({ action: "return", assets: [{ productId: 10, condition: "good" }] });
  assert.equal(returned.state.custody[0].status, "returned");
  assert.equal(returned.state.profiles[0].usageCount, 3);
  await returned.run({ action: "return", assets: [{ productId: 10, condition: "good" }] });
  assert.equal(returned.state.profiles[0].usageCount, 3, "return retry cannot depreciate twice");
  assert.equal(returned.state.audits.length, 2, "return retry cannot duplicate audit");

  const foreignState = structuredClone(checkout.state); foreignState.custody[0].notes = "kosha_booking #700";
  const foreign = harness(foreignState);
  await assert.rejects(() => foreign.run({ action: "return", assets: [{ productId: 10, condition: "good" }] }), /عهدة|صرف|مسؤولية/);
  assert.equal(foreign.state.custody[0].status, "issued", "foreign custody cannot be closed");
  const foreignWorkspace = harness(foreignState);
  await assert.rejects(() => foreignWorkspace.bookingAction({ mode: "return", custodyId: 1 }), /عهدة|صرف|حجز/);
  assert.equal(foreignWorkspace.state.custody[0].status, "issued", "workspace cannot bypass the source-owned group return");
  const workspace = harness(checkout.state);
  await workspace.bookingAction({ mode: "return", custodyId: 1 });
  assert.equal(workspace.state.reservations[0].status, "returned", "workspace return also settles the same fixed-custody reservation");
  const laterState = structuredClone(checkout.state);
  laterState.custody[0].status = "returned";
  laterState.custody.push({ ...laterState.custody[0], id: 2, status: "issued" });
  laterState.booking.bookingDetails.bookingOperations.assets.find(row => row.productId === 10).custodyId = 2;
  const later = harness(laterState);
  await later.bookingAction({ mode: "return", custodyId: 1 });
  assert.equal(later.state.custody[1].status, "issued", "stale workspace retry cannot close the later same-booking issue");

  const damage = harness(checkout.state);
  await assert.rejects(() => damage.run({ action: "return", assets: [{ productId: 10, condition: "damaged", damageReason: "Lens crack", damagePhotoUrl: "proof" }] }), (cause) => cause.status === 403);
  const missing = harness(checkout.state);
  await assert.rejects(() => missing.run({ action: "return", managerApproval: true, assets: [{ productId: 10, condition: "missing", damageReason: "Missing", damagePhotoUrl: "proof" }] }, ["products", "asset_damage_record"]), (cause) => cause.status === 403);
  const damaged = harness(checkout.state);
  await damaged.run({ action: "return", assets: [{ productId: 10, condition: "damaged", damageReason: "Lens crack", damagePhotoUrl: "proof" }] }, ["products", "asset_damage_record"]);
  assert.equal(damaged.state.profiles[0].status, "maintenance");
  assert.equal(damaged.state.passports[0].metadata.damageHold, true);
  assert.equal(damaged.state.passports[0].metadata.inspectionBlocked, true);
  await damaged.bookingAction({ mode: "inspect" });
  assert.equal(damaged.state.profiles[0].status, "maintenance", "a clean inspection cannot silently lift a damage hold");
  const terminalState = structuredClone(checkout.state);
  terminalState.profiles[0].status = "sold";
  terminalState.passports[0].metadata.damageHold = true;
  const terminal = harness(terminalState);
  await terminal.run({ action: "return", assets: [{ productId: 10, condition: "good" }] });
  assert.equal(terminal.state.profiles[0].status, "sold", "good return cannot reactivate terminal asset");
  assert.equal(terminal.state.passports[0].metadata.damageHold, true, "return preserves existing inspection holds");
  await terminal.bookingAction({ mode: "inspect" });
  assert.equal(terminal.state.profiles[0].status, "sold", "inspection cannot undo the terminal status preserved by group return");
  assert.equal(terminal.state.profiles[0].usageCount, 3, "group return plus workspace inspection records one use, not two");
  const laterInspectionState = structuredClone(returned.state);
  laterInspectionState.custody.push({ id: 2, productId: 10, staffId: 8, status: "issued", quantity: 1, notes: "kosha_booking #800" });
  laterInspectionState.passports[0].lastStaffId = 8;
  const laterInspection = harness(laterInspectionState);
  await assert.rejects(() => laterInspection.bookingAction({ mode: "inspect" }), /عهدة|صرف|إخراج|خرج/);
  assert.equal(laterInspection.state.passports[0].lastStaffId, 8, "old inspection cannot clear a later holder");
  const lostState = structuredClone(returned.state);
  lostState.profiles[0].status = "lost";
  lostState.passports[0].lastLocation = "مفقود";
  const lostInspection = harness(lostState);
  await lostInspection.bookingAction({ mode: "inspect" });
  assert.equal(lostInspection.state.profiles[0].status, "lost");
  assert.equal(lostInspection.state.passports[0].lastLocation, "مفقود", "inspection is not proof of recovering a missing asset");

  const quantity = harness(fixture(), { quantityIds: [10] });
  await assert.rejects(() => quantity.run({ action: "checkout" }), /كمية|فردية/);
  assert.equal(quantity.state.custody.length, 0, "fixed custody cannot bypass the quantity engine");
  const duplicateLines = harness(checkout.state);
  const duplicated = await duplicateLines.run({ action: "return", assets: [{ productId: 10, condition: "good" }, { productId: 10, condition: "good" }] });
  assert.equal(duplicated.status, 422);
  assert.equal(duplicateLines.state.custody[0].status, "issued");

  const reserve = harness();
  await reserve.run({ action: "reserve", employeeIds: [5] });
  const count = reserve.state.audits.length;
  await reserve.run({ action: "reserve", employeeIds: [5] });
  assert.equal(reserve.state.audits.length, count, "identical reserve retry is a no-op");
  const checkedOutReserve = harness(checkout.state);
  await assert.rejects(() => checkedOutReserve.run({ action: "reserve" }), /خرجت|صرف|إرجاع/);
  assert.equal(checkedOutReserve.state.reservations[0].status, "checked_out");
  const closedReservation = harness(returned.state);
  await assert.rejects(() => closedReservation.run({ action: "reserve" }), /تاريخ|مغلقة|سابقة|إرجاع/);
  assert.equal(closedReservation.state.reservations[0].status, "returned", "reservation retry cannot rewrite a completed custody lifecycle");

  for (const action of ["set-employees", "release"]) {
    const task = harness();
    await task.run({ action, employeeIds: [8] });
    assert.equal(task.events[0], "booking-lock");
    assert.ok(task.events.includes("product-lock:10"), `${action} locks prior holds`);
    assert.ok(task.events.includes("commit"));
  }
  const preserveOut = harness(checkout.state);
  await preserveOut.run({ action: "release" });
  assert.equal(preserveOut.state.reservations[0].status, "checked_out", "release never removes checked-out reservations");
  assert.equal(preserveOut.state.booking.bookingDetails.bookingOperations.assets.find((item) => item.productId === 10).stage, "out");
  console.log("PASS actual fixed custody transaction: lock ordering, fresh state, ownership, retries, permissions and rollback (controlled IO, no PostgreSQL integration)");
})().catch((cause) => { console.error(cause); process.exitCode = 1; });
