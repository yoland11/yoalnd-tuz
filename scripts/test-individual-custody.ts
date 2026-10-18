import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Runs the actual service and real Drizzle SQL generation against a controlled,
// transactional IO boundary. This is NOT real PostgreSQL concurrency coverage.
const dialect = new PgDialect();
const issuedAt = new Date("2026-10-18T08:00:00Z");
const standalone = { kind: "standalone" } as const;
const linked = { kind: "linked", entityType: "photography", entityId: 7, issueNote: "إخراج · photography #7" } as const;
function custody(patch: Record<string, unknown> = {}) {
  return { id: 1, product_id: 10, staff_id: 2, quantity: 1, status: "issued", signature_url: null,
    issued_at: issuedAt, returned_at: null, notes: null, issued_by: 1, created_at: issuedAt, updated_at: issuedAt, ...patch };
}
type State = {
  product: any; staff: any[]; custody: any[]; profile: any; passport: any; links: any[];
  quantityTracked: boolean; audit: any[]; failAudit: boolean; failRead: boolean; stock: number;
};
function fixture(patch: Partial<State> = {}) {
  let state: State = {
    product: { id: 10, name: "Camera", name_ar: "كاميرا", cost_price: "1000.00", is_active: true },
    staff: [{ id: 1, full_name: "المدير", username: "manager", is_active: true }, { id: 2, full_name: "علي", username: "ali", is_active: true }],
    custody: [], profile: { product_id: 10, status: "active", deleted_at: null, purchase_price: "1000", current_value: "900" },
    passport: { product_id: 10, last_staff_id: null, last_location: "داخل المخزن", maintenance_cost: "5.00", metadata: { serialHint: "keep" } },
    links: [{ product_id: 10, entity_type: "photography", entity_id: 7 }],
    quantityTracked: false, audit: [], failAudit: false, failRead: false, stock: 11, ...patch,
  };
  const trace: string[] = [];
  let onLock: ((draft: State) => void) | undefined;
  const transaction = async <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
    const draft = structuredClone(state);
    const traceStart = trace.length;
    let locked = false;
    const tx = { execute: async (query: any) => {
      const built = dialect.sqlToQuery(query);
      const q = built.sql.replace(/\s+/g, " ").trim().toLowerCase();
      const p = built.params;
      trace.push(q);
      const rows = (value: any[]) => ({ rows: structuredClone(value) });
      if (q.startsWith("select") && q.includes("from products ")) {
        assert.match(q, /for update$/, "the original product row is the canonical lock");
        assert.equal(trace.length - traceStart, 1, "no mutable state may be read before the product lock");
        locked = true;
        onLock?.(draft);
        return rows(draft.product && draft.product.id === p[0] ? [draft.product] : []);
      }
      assert.equal(locked, true, "every query follows the product lock");
      if (draft.failRead && q.includes("from equipment_custody")) throw new Error("custody database unavailable");
      if (q.includes("as quantity_tracking_probe")) return rows([{ tracked: draft.quantityTracked }]);
      if (q.startsWith("select") && q.includes("from asset_links")) {
        assert.match(q, /for share$/, "the exact source link remains locked through the mutation");
        return rows(draft.links.filter((r) => r.product_id === p[0] && r.entity_type === p[1] && r.entity_id === p[2]));
      }
      if (q.startsWith("select") && q.includes("from staff ")) return rows(draft.staff.filter((r) => r.id === p[0]));
      if (q.startsWith("select") && q.includes("from equipment_custody where id")) return rows(draft.custody.filter((r) => r.id === p[0]));
      if (q.startsWith("select") && q.includes("from equipment_custody")) {
        let found = draft.custody.filter((r) => r.product_id === p[0]);
        if (q.includes("and notes =")) found = found.filter((r) => r.notes === p[1]);
        if (q.includes("status = 'issued'")) found = found.filter((r) => r.status === "issued");
        if (q.includes("status = 'returned'")) found = found.filter((r) => r.status === "returned" && r.notes === p[1]);
        found.sort((a, b) => b.id - a.id);
        return rows(q.includes("limit 1") ? found.slice(0, 1) : found);
      }
      if (q.startsWith("select") && q.includes("from asset_profiles")) return rows(draft.profile ? [draft.profile] : []);
      if (q.startsWith("select") && q.includes("from asset_passports")) return rows(draft.passport ? [draft.passport] : []);
      if (q.startsWith("insert into equipment_custody")) {
        const row = custody({ id: Math.max(0, ...draft.custody.map((r) => r.id)) + 1,
          product_id: p[0], staff_id: p[1], quantity: p[2], signature_url: p[3], notes: p[4], issued_by: p[5] });
        draft.custody.push(row);
        return rows([row]);
      }
      if (q.startsWith("update equipment_custody")) {
        const row = draft.custody.find((r) => r.id === p[0] && r.product_id === p[1] && r.status === "issued");
        if (!row) return rows([]);
        row.status = "returned"; row.returned_at = new Date(); row.updated_at = row.returned_at;
        return rows([row]);
      }
      if (q.startsWith("insert into asset_passports")) {
        draft.passport = { ...(draft.passport ?? {}), product_id: p[0], last_staff_id: p[1], last_location: p[2],
          maintenance_cost: String(Number(draft.passport?.maintenance_cost ?? 0) + Number(p[3])), metadata: JSON.parse(String(p[4])) };
        return rows([]);
      }
      if (q.startsWith("insert into asset_profiles")) {
        if (draft.profile) draft.profile.status = p[3];
        else draft.profile = { product_id: p[0], purchase_price: p[1], current_value: p[2], status: p[3], deleted_at: null };
        return rows([]);
      }
      if (q.startsWith("update asset_profiles")) { draft.profile.status = p[0]; return rows([]); }
      if (q.startsWith("insert into entity_timeline")) {
        if (draft.failAudit) throw new Error("audit unavailable");
        draft.audit.push(JSON.parse(String(p[2]))); return rows([]);
      }
      throw new Error(`Unexpected SQL in custody test: ${q}`);
    } };
    const result = await fn(tx);
    state = draft;
    return result;
  };
  const deps = {
    isQuantityTracked: async (tx: any, productId: number) => {
      const result = await tx.execute(sql`select ${productId} as quantity_tracking_probe`);
      return result.rows[0].tracked;
    },
    audit: async (tx: any, event: any) => {
      await tx.execute(sql`insert into entity_timeline(entity_id,type,metadata) values (${event.productId},${event.action},${JSON.stringify(event)}::jsonb)`);
    },
  };
  return { read: () => state, trace, transaction, deps, atLock: (fn: (draft: State) => void) => { onLock = fn; } };
}

async function run() {
  // A removed/unimplemented helper must fail with the missing behavior named.
  const service = await import("../src/server/individual-custody").catch((error: any) => {
    if (error.code === "ERR_MODULE_NOT_FOUND" || error.code === "MODULE_NOT_FOUND")
      assert.fail("Missing transaction custody service: checkout must lock the original product before mutable reads and writes");
    throw error;
  });
  const execute = service.executeIndividualCustody;
  const checkout: any = { mode: "checkout", productId: 10, actorId: 1, staffId: 2, source: standalone, checklist: { confirmed: true } };
  const returned: any = { mode: "return", productId: 10, actorId: 1, custodyId: 1, source: standalone };
  const call = (f: ReturnType<typeof fixture>, input: any) => f.transaction((tx) => execute(tx, input, f.deps));
  const rejects = async (f: ReturnType<typeof fixture>, input: any, status: number, code?: string) => {
    const before = structuredClone(f.read());
    await assert.rejects(() => call(f, input), (e: any) => e instanceof service.IndividualCustodyError && e.status === status && (!code || e.code === code));
    assert.deepEqual(f.read(), before, "rejected operation commits no mutations");
  };

  // Missing lock, missing passport upsert, or stock deduction breaks this case.
  const fresh = fixture({ passport: null });
  const issued = await call(fresh, { ...checkout, quantity: 3, signatureUrl: "/stored/signature.png", notes: "حامل" });
  assert.equal(issued.changed, true);
  assert.deepEqual([issued.row.productId, issued.row.staffId, issued.row.quantity, issued.row.signatureUrl, issued.staffName], [10, 2, 3, "/stored/signature.png", "علي"]);
  assert.equal(issued.row.issuedAt instanceof Date, true);
  assert.deepEqual(issued.product, { id: 10, name: "كاميرا", costPrice: "1000.00" });
  assert.equal(fresh.read().passport.last_staff_id, 2);
  assert.equal(fresh.read().stock, 11);
  assert.equal(fresh.read().audit.length, 1);
  assert.match(fresh.trace[1], /quantity_tracking_probe/, "quantity mode is checked immediately after the product lock");
  await rejects(fresh, checkout, 409);

  // A race discovered only after lock must prevent a second holder.
  const competing = fixture();
  competing.atLock((draft) => { draft.custody.push(custody()); });
  await rejects(competing, checkout, 409);
  await rejects(fixture({ quantityTracked: true }), checkout, 409);
  await rejects(fixture({ quantityTracked: true, custody: [custody()] }), returned, 409);
  for (const quantity of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) await rejects(fixture(), { ...checkout, quantity }, 422);
  await rejects(fixture(), { ...checkout, checklist: undefined }, 422, "CUSTODY_CHECKLIST_REQUIRED");
  await call(fixture(), { ...checkout, checklist: { confirmed: false, reason: "ملاحظة مقبولة" } });
  await rejects(fixture({ product: null }), checkout, 404);
  await rejects(fixture({ product: { ...fixture().read().product, is_active: false } }), checkout, 423);
  await rejects(fixture({ staff: [{ id: 2, full_name: "علي", username: "ali", is_active: false }] }), checkout, 422);
  await call(fixture({ staff: [{ id: 2, full_name: "", username: "legacy", is_active: null }] }), checkout);
  await rejects(fixture({ staff: [] }), checkout, 404);
  for (const status of ["maintenance", "lost", "retired", "locked", "sold", "disposed"])
    await rejects(fixture({ profile: { status, deleted_at: null } }), checkout, 423);
  await rejects(fixture({ profile: { status: "active", deleted_at: issuedAt } }), checkout, 423);
  for (const metadata of [{ damageHold: true }, { inspectionBlocked: true }])
    await rejects(fixture({ passport: { metadata, last_staff_id: null } }), checkout, 423);

  // A link by itself is not custody ownership; exact note and unique issue are required.
  await rejects(fixture({ links: [] }), { ...checkout, source: linked }, 409);
  await rejects(fixture(), { ...checkout, notes: linked.issueNote }, 422);
  for (const quantity of [0, -1, 1.5, 2, Number.NaN, Number.POSITIVE_INFINITY])
    await rejects(fixture(), { ...checkout, source: linked, quantity }, 422);
  const linkedIssue = fixture();
  await call(linkedIssue, { ...checkout, source: linked });
  assert.equal(linkedIssue.read().custody[0].notes, "إخراج · photography #7");
  await rejects(fixture({ custody: [custody()] }), { ...returned, source: linked }, 409);
  await rejects(fixture({ custody: [custody({ notes: linked.issueNote })] }), returned, 409);
  for (const notes of ["kosha_booking #7", "service_order #7", "حجز service_order #7", "إخراج · photography_shoot #7"])
    await rejects(fixture({ custody: [custody({ notes })] }), returned, 409);
  await rejects(fixture({ custody: [custody(), custody({ id: 2 })] }), returned, 409);
  await rejects(fixture({ custody: [custody({ notes: linked.issueNote }), custody({ id: 2, notes: "إخراج · photography #8" })] }), { ...returned, source: linked }, 409);
  await rejects(fixture({ custody: [custody({ product_id: 11 })] }), returned, 409);
  await rejects(fixture({ custody: [custody()], passport: { last_staff_id: 3, metadata: {} } }), returned, 409);
  await rejects(fixture({ custody: [custody()] }), { ...returned, custodyId: undefined }, 422);

  // A replay for an old returned ID must not inspect or clear a newer holder.
  const delayed = fixture({ custody: [custody({ notes: linked.issueNote, status: "returned" }), custody({ id: 2, notes: linked.issueNote })], passport: { last_staff_id: 2, metadata: {}, maintenance_cost: "5" } });
  await rejects(delayed, { ...returned, source: linked, custodyId: undefined }, 409);
  const delayedBefore = structuredClone(delayed.read());
  assert.equal((await call(delayed, { ...returned, source: linked })).changed, false);
  assert.deepEqual(delayed.read(), delayedBefore, "original closed issue replay leaves the new same-source issue and holder untouched");
  const replay = fixture({ custody: [custody({ status: "returned", returned_at: issuedAt }), custody({ id: 2, staff_id: 1 })],
    passport: { last_staff_id: 1, metadata: { damageHold: true }, maintenance_cost: "20" } });
  const replayBefore = structuredClone(replay.read());
  const repeated = await call(replay, returned);
  assert.equal(repeated.changed, false);
  assert.deepEqual(replay.read(), replayBefore);
  assert.equal(replay.trace.some((q) => q.includes("from asset_passports") || q.includes("status = 'issued'")), false);
  const history = fixture({ custody: [custody({ notes: linked.issueNote, status: "returned", returned_at: issuedAt })] });
  assert.equal((await call(history, { ...returned, source: linked, custodyId: undefined })).changed, false);
  await rejects(fixture({ custody: [custody({ status: "returned", notes: linked.issueNote }), custody({ id: 2, notes: "other" })] }), { ...returned, source: linked, custodyId: undefined }, 409);

  // Legacy null holder is valid; holds and terminal profile state survive returns.
  const normal = fixture({ custody: [custody()], profile: { status: "locked", deleted_at: null },
    passport: { last_staff_id: null, maintenance_cost: "5", metadata: { inspectionBlocked: true, serialHint: "keep" } } });
  assert.equal((await call(normal, returned)).row.status, "returned");
  assert.equal(normal.read().profile.status, "locked");
  assert.equal(normal.read().passport.last_staff_id, null);
  assert.equal(normal.read().passport.last_location, "داخل المخزن");
  assert.deepEqual(normal.read().passport.metadata, { inspectionBlocked: true, serialHint: "keep" });
  assert.equal(normal.read().audit.length, 1);
  const deleted = fixture({ custody: [custody()], profile: { status: "active", deleted_at: issuedAt, deleted_reason: "retain history" } });
  await call(deleted, returned);
  assert.deepEqual(deleted.read().profile, { status: "active", deleted_at: issuedAt, deleted_reason: "retain history" });
  const unprofiled = fixture({ custody: [custody()], profile: null, passport: null });
  await call(unprofiled, returned);
  assert.equal(unprofiled.read().profile, null, "ordinary return cannot create a depreciation profile");
  assert.equal(unprofiled.read().passport.last_staff_id, null);
  const recent = fixture({ custody: [custody({ status: "returned", notes: linked.issueNote }), custody({ id: 4, status: "returned", notes: linked.issueNote })] });
  assert.equal((await call(recent, { ...returned, custodyId: undefined, source: linked })).row.id, 4);

  // Forged capabilities must not produce damage or loss writes.
  const broken = { ...returned, problem: "broken", repairCost: 25, canRecordDamage: true };
  await rejects(fixture({ custody: [custody()] }), { ...broken, canRecordDamage: false }, 403);
  await rejects(fixture({ custody: [custody()] }), { ...returned, problem: "lost", managerApproval: true, canApproveLoss: false }, 403);
  await rejects(fixture({ custody: [custody()] }), { ...returned, problem: "lost", managerApproval: false, canApproveLoss: true }, 422);
  await rejects(fixture({ custody: [custody()] }), { ...broken, repairCost: Number.NaN }, 422);
  await rejects(fixture({ custody: [custody()] }), { ...returned, problem: "invented" }, 422);
  const damage = fixture({ custody: [custody()], passport: { last_staff_id: 2, maintenance_cost: "5", metadata: { serialHint: "keep" } } });
  await call(damage, broken);
  assert.deepEqual([damage.read().custody[0].status, damage.read().profile.status, damage.read().passport.maintenance_cost], ["returned", "maintenance", "30"]);
  assert.deepEqual(damage.read().passport.metadata, { serialHint: "keep", damageHold: true });
  assert.equal(damage.read().passport.last_staff_id, null);
  assert.equal((await call(damage, broken)).changed, false);
  assert.equal(damage.read().passport.maintenance_cost, "30");
  assert.equal(damage.read().audit.length, 1);
  const protectedDamage = fixture({ custody: [custody()], profile: { status: "sold", deleted_at: null } });
  await call(protectedDamage, broken);
  assert.equal(protectedDamage.read().profile.status, "sold");
  const heldDamage = fixture({ custody: [custody()], profile: { status: "locked", deleted_at: null } });
  await call(heldDamage, broken);
  assert.equal(heldDamage.read().profile.status, "locked");

  const lost = fixture({ custody: [custody({ notes: linked.issueNote })], passport: { last_staff_id: 2, maintenance_cost: "5", metadata: { serialHint: "keep" } } });
  const loss = { ...returned, custodyId: undefined, source: linked, problem: "lost", managerApproval: true, canApproveLoss: true };
  await call(lost, loss);
  assert.deepEqual([lost.read().custody[0].status, lost.read().profile.status, lost.read().passport.last_staff_id], ["issued", "lost", 2]);
  assert.deepEqual(lost.read().passport.metadata, { serialHint: "keep", damageHold: true, individualCustodyLossId: 1 });
  assert.equal((await call(lost, loss)).changed, false);
  assert.equal(lost.read().audit.length, 1);
  const shoot = fixture({ custody: [custody({ notes: linked.issueNote })] });
  await call(shoot, { ...loss, closeCustodyOnLoss: true });
  assert.equal(shoot.read().custody[0].status, "returned");
  assert.equal(shoot.read().passport.last_location, "مفقود", "closing loss liability cannot claim the missing asset is physically in the warehouse");
  const terminalLoss = fixture({ custody: [custody()], profile: { status: "retired", deleted_at: null } });
  await call(terminalLoss, { ...returned, problem: "lost", managerApproval: true, canApproveLoss: true });
  assert.equal(terminalLoss.read().profile.status, "retired");
  assert.equal(terminalLoss.read().passport.metadata.individualCustodyLossId, 1);
  assert.equal((await call(terminalLoss, { ...returned, problem: "lost", managerApproval: true, canApproveLoss: true })).changed, false);
  assert.equal(terminalLoss.read().audit.length, 1, "durable loss marker suppresses repeat audit even when a protected terminal profile cannot become lost");

  // Database and audit failures must propagate and roll back all original writes.
  const auditFailure = fixture({ failAudit: true });
  await assert.rejects(() => call(auditFailure, checkout), /audit unavailable/);
  assert.equal(auditFailure.read().custody.length, 0);
  assert.equal(auditFailure.read().passport.last_staff_id, null);
  const returnFailure = fixture({ failAudit: true, custody: [custody()] });
  await assert.rejects(() => call(returnFailure, broken), /audit unavailable/);
  assert.equal(returnFailure.read().custody[0].status, "issued");
  assert.equal(returnFailure.read().profile.status, "active");
  assert.equal(returnFailure.read().passport.maintenance_cost, "5.00");
  await assert.rejects(() => call(fixture({ failRead: true }), checkout), /custody database unavailable/);
  console.log("PASS actual individual custody service + real Drizzle SQL boundary: product-lock ordering, rollback, unique/source ownership, returned-ID replay, legacy null holder, holds, quantity separation, damage cost once and trusted approval");
  console.log("LIMITATION: controlled transactional executor only; NOT real PostgreSQL concurrency or database integration coverage");
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
