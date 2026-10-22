import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import * as periods from "../src/server/booking-resource-period";
const dialect = new PgDialect();
const source = ts.createSourceFile("api.ts", readFileSync("src/server/api.ts", "utf8"), ts.ScriptTarget.Latest, true);
const handler = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "handleKoshaWorkOrders") as ts.FunctionDeclaration;
const create = handler.body!.statements.find(node => ts.isIfStatement(node) && node.expression.getText(source) === 'req.method === "POST" && !id')!;
const reassign = handler.body!.statements.find(node => ts.isIfStatement(node) && node.expression.getText(source) === 'req.method === "POST" && action === "reassign"')!;
assert.ok(create); assert.ok(reassign);
const code = ts.transpileModule(`async function run(req,auth,mode){const id=mode==='reassign'?41:null,action=mode,workOrder={bookingId:7,leaderId:2};${create.getText(source)}${reassign.getText(source)}}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const period = { preparationStart: "2026-10-22T08:00:00+03:00", eventStart: "2026-10-22T20:00:00+03:00", eventEnd: "2026-10-23T01:00:00+03:00", returnEnd: "2026-10-23T12:00:00+03:00" };
function fixture(busy: boolean) {
  let writes = 0, notices = 0, active = false; const queries: string[] = [];
  const execute = async (statement: any) => {
    const built = dialect.sqlToQuery(statement), q = built.sql.replace(/\s+/g, " ").trim(); queries.push(q);
    if (/^select id from staff/.test(q)) return { rows: [{ id: 3 }] };
    if (/^SELECT id,status,event_date/.test(q)) return { rows: [{ id: 7, status: "confirmed", event_date: "2026-10-22", booking_id: 7, details: { bookingOperations: { resourceWindow: period } } }] };
    if (q.startsWith("SELECT vehicle_id,crew_id") || q.startsWith("SELECT m.staff_id")) return { rows: [] };
    if (q.startsWith("SELECT id,is_active")) return { rows: [{ id: 3, is_active: true, permissions: ["koshas"] }] };
    if (q.startsWith("SELECT id,booking_id,leader_id")) return { rows: [{ id: 41, booking_id: 7, leader_id: 2, status: "ASSIGNED" }] };
    if (q.startsWith("WITH bookings")) return { rows: busy ? [{ source: "service", id: 8, event_date: "2026-10-22", details: { bookingOperations: { resourceWindow: period } } }] : [] };
    if (/^(insert|update)/i.test(q)) { assert.equal(active, true); writes++; return { rows: q.startsWith("insert into kosha_work_orders") ? [{ id: 41 }] : [] }; }
    throw Error("Unexpected work-order query " + q);
  };
  const database = { execute, query: { koshaBookingsTable: { findFirst: async () => ({ id: 7, eventDate: "2026-10-22", customerName: "عميل" }) }, staffTable: { findFirst: async () => ({ id: 3, isActive: true, permissions: ["koshas"] }) } }, transaction: async (run: any) => { const before = writes; active = true; try { return await run({ execute }); } catch (cause) { writes = before; throw cause; } finally { active = false; } } };
  const context: any = { db: database, sql, eq: () => ({}), and: () => ({}), staffTable: { id: "id", isActive: "active" }, koshaBookingsTable: { id: "id" },
    lockBookingExecutionTeam: (periods as any).lockBookingExecutionTeam, body: async (req: any) => req.payload, deny: () => null,
    nullableText: (value: any) => value ?? null, koshatWorkOrderNumber: () => "KO-7", erpActorFromAdmin: () => ({ id: 1 }),
    addEntityTimeline: async () => {}, logAdminActivity: async () => {}, loadKoshatWorkOrder: async () => ({ id: 41 }), recordKoshatWorkOrderEvent: async () => {},
    createNotification: async () => { notices++; }, json: (data: any, status = 200) => ({ data, status }), error: (message: string, status: number) => ({ message, status }),
  };
  vm.createContext(context); vm.runInContext(code, context);
  return { get writes() { return writes; }, get notices() { return notices; }, queries, run: (mode: "create" | "reassign") => context.run({ method: "POST", payload: { bookingId: 7, leaderId: 3, memberIds: [] } }, { id: 1, fullName: "مدير", username: "admin" }, mode) };
}
for (const mode of ["create", "reassign"] as const) {
  const conflict = fixture(true); await assert.rejects(() => conflict.run(mode), /مشغول|فترة/); assert.equal(conflict.writes, 0); assert.equal(conflict.notices, 0);
  const available = fixture(false); await available.run(mode); assert.ok(available.writes > 0); assert.ok(available.queries.some(q => q.includes("FROM staff") && q.includes("FOR UPDATE")));
}
console.log("PASS original work-order create/reassign handlers share locked full-period employee checks before writes/notifications (controlled IO)");
