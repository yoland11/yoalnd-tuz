import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql, eq, getTableName } from "drizzle-orm";
import { dispatchAssignmentsTable, crewsTable, fleetVehiclesTable } from "@workspace/db";
const dialect = new PgDialect();
const ast = ts.createSourceFile("api.ts", readFileSync("src/server/api.ts", "utf8"), ts.ScriptTarget.Latest, true);
let branch: ts.IfStatement | undefined;
function visit(node: ts.Node) { if (ts.isIfStatement(node) && node.expression.getText(ast) === 'section === "dispatch"') branch = node; ts.forEachChild(node, visit); }
visit(ast); assert.ok(branch);
const code = ts.transpileModule(`async function run(req,auth){const section='dispatch',method=req.method,parts=['dispatch'];${branch!.getText(ast)}}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const store = existsSync("src/server/booking-dispatch.ts") ? await import("../src/server/booking-dispatch") : null;
const period = { preparationStart: "2026-10-22T08:00:00+03:00", eventStart: "2026-10-22T20:00:00+03:00", eventEnd: "2026-10-23T01:00:00+03:00", returnEnd: "2026-10-23T12:00:00+03:00" };
function fixture(options: { conflict?: boolean; failVehicle?: boolean; noTiming?: boolean } = {}) {
  let state = { assignment: null as any, vehicle: "available", crew: "available", audit: 0, notices: 0, activity: 0 };
  let active = false; const queries: string[] = [];
  const tx: any = {
    execute: async (statement: any) => {
      const { sql: raw, params } = dialect.sqlToQuery(statement), q = raw.replace(/\s+/g, " ").trim(); queries.push(q);
      if (/^SELECT id,status,event_date/.test(q)) return { rows: [{ id: 7, status: "confirmed", event_date: "2026-10-22", details: { bookingOperations: { resourceWindow: options.noTiming ? null : period } } }] };
      if (q.startsWith("SELECT vehicle_id,crew_id")) return { rows: state.assignment ? [{ vehicle_id: state.assignment.vehicleId, crew_id: state.assignment.crewId }] : [] };
      if (q.startsWith("SELECT c.staff_id")) return { rows: [] };
      if (q.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (q.startsWith("SELECT entity_type,entity_id")) return { rows: [] };
      if (q.includes("FOR UPDATE")) return { rows: [{ id: params[0], is_active: true, status: "available" }] };
      if (q.startsWith("WITH bookings")) return { rows: options.conflict ? [{ source: "kosha", id: 8, event_date: "2026-10-23", details: { bookingOperations: { resourceWindow: { ...period, eventStart: "2026-10-23T05:00:00+03:00", eventEnd: "2026-10-23T06:00:00+03:00" } } } }] : [] };
      if (q.startsWith("INSERT INTO entity_timeline")) { assert.equal(active, true); state.audit++; return { rows: [] }; }
      throw Error("Unexpected dispatch SQL " + q);
    },
    query: { dispatchAssignmentsTable: { findFirst: async () => state.assignment } },
    insert: (table: any) => ({ values: (values: any) => ({ onConflictDoUpdate: () => ({ returning: async () => { assert.equal(getTableName(table), 'dispatch_assignments'); assert.equal(active, true, "dispatch assignment must be in the same transaction as resource updates"); state.assignment = { id: 21, status: "assigned", ...values }; return [state.assignment]; } }) }) }),
    update: (table: any) => ({ set: () => ({ where: async () => { assert.equal(active, true); if (getTableName(table) === 'fleet_vehicles') { if (options.failVehicle) throw Error("vehicle write unavailable"); state.vehicle = "outside"; } else { assert.equal(getTableName(table), 'crews'); state.crew = "busy"; } } }) }),
  };
  const database = { ...tx, transaction: async (run: any) => { const before = structuredClone(state); active = true; try { return await run(tx); } catch (cause) { state = before; throw cause; } finally { active = false; } } };
  const context: any = { db: database, dispatchAssignmentsTable, crewsTable, fleetVehiclesTable, sql, eq, Date, body: async (req: any) => req.payload,
    saveBookingDispatch: store?.saveBookingDispatch,
    EnterpriseDispatchSchema: { safeParse: (value: any) => ({ success: true, data: { score: 0, suggestions: {}, ...value } }) },
    recordEnterpriseMutation: async () => { state.activity++; }, createNotification: async () => { state.notices++; }, json: (data: any, status = 200) => ({ status, data }) };
  vm.createContext(context); vm.runInContext(code, context);
  return { get state() { return state; }, queries, run: () => context.run({ method: "POST", payload: { entityType: "service_order", entityId: 7, vehicleId: 4, crewId: 5 } }, { id: 1, fullName: "مدير", username: "manager" }) };
}
const normal = fixture(); await normal.run(); assert.equal(normal.state.assignment.id, 21); assert.equal(normal.state.vehicle, "outside"); assert.equal(normal.state.crew, "busy");
assert.equal(normal.state.audit, 1); await normal.run(); assert.equal(normal.state.audit, 1); assert.equal(normal.state.notices, 1, "same assignment retry creates no duplicate notification");
const conflict = fixture({ conflict: true }); await assert.rejects(() => conflict.run(), /مشغول|تعارض|متاحة/); assert.equal(conflict.state.assignment, null); assert.equal(conflict.state.notices, 0);
const rollback = fixture({ failVehicle: true }); await assert.rejects(() => rollback.run(), /vehicle write unavailable/); assert.equal(rollback.state.assignment, null); assert.equal(rollback.state.crew, "available"); assert.equal(rollback.state.audit, 0);
const unknown = fixture({ noTiming: true }); await assert.rejects(() => unknown.run(), /فترة تشغيل/); assert.equal(unknown.state.assignment, null);
assert.match(normal.queries[0], /service_orders.*FOR UPDATE/, "original source booking is locked before dispatch/resource locks");
console.log("PASS actual dispatch handler/store: original source lock, full-period vehicle/crew checks, atomic status/audit rollback and duplicate retry (controlled IO)");
