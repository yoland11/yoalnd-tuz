import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { sql, eq } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { lockBookingExecutionTeam } from "../src/server/booking-resource-period";
const ast = ts.createSourceFile("api.ts", readFileSync("src/server/api.ts", "utf8"), ts.ScriptTarget.Latest, true);
let branch: ts.IfStatement | undefined;
function visit(node: ts.Node) { if (ts.isIfStatement(node) && node.expression.getText(ast) === 'parts[3] === "employees" && method === "POST"') branch = node; ts.forEachChild(node, visit); }
visit(ast); assert.ok(branch);
const code = ts.transpileModule(`async function run(req,auth){const parts=['admin','kosha','7','employees'],method='POST',id=7,existing={bookingDetails:{oldSnapshot:true}};${branch!.getText(ast)}}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const dialect = new PgDialect();
const period = { preparationStart: "2026-10-22T08:00:00+03:00", eventStart: "2026-10-22T20:00:00+03:00", eventEnd: "2026-10-23T01:00:00+03:00", returnEnd: "2026-10-23T12:00:00+03:00" };
async function run(busy: boolean) {
  let active = false, writes = 0, saved: any, activity = 0, transactionalWrite = false;
  const executor: any = {
    execute: async (statement: any) => {
      const q = dialect.sqlToQuery(statement).sql.replace(/\s+/g, " ").trim();
      if (/^SELECT id,status,event_date/.test(q)) return { rows: [{ id: 7, status: "confirmed", event_date: "2026-10-22", details: { freshField: "preserve", bookingOperations: { resourceWindow: period } } }] };
      if (q.startsWith("SELECT vehicle_id,crew_id") || q.startsWith("SELECT m.staff_id")) return { rows: [] };
      if (q.startsWith("SELECT id,is_active")) return { rows: [{ id: 3, is_active: true, role: "staff", permissions: [] }] };
      if (q.startsWith("WITH bookings")) return { rows: busy ? [{ source: "service", id: 8, event_date: "2026-10-22", details: { bookingOperations: { resourceWindow: period } } }] : [] };
      throw Error("Unexpected direct team query " + q);
    },
    query: { staffTable: { findFirst: async () => ({ id: 3, fullName: "أحمد" }) } },
    update: () => ({ set: (value: any) => ({ where: async () => { transactionalWrite = active; writes++; saved = value; } }) }),
  };
  const db = { ...executor, transaction: async (fn: any) => { active = true; try { return await fn(executor); } finally { active = false; } } };
  const context: any = { db, sql, eq, staffTable: { id: "id" }, koshaBookingsTable: { id: "id", bookingDetails: "details" }, lockBookingExecutionTeam, optionalPositiveId: (v: any) => v == null ? undefined : Number(v), body: async () => ({ primaryEmployeeId: 3 }), bookingEvidenceWriteSql: (_: any, value: any) => value, logAdminActivity: async () => { activity++; }, json: (data: any) => data };
  vm.createContext(context); vm.runInContext(code, context);
  if (busy) { await assert.rejects(() => context.run({}, { id: 1 }), /مشغول/); assert.equal(writes, 0); assert.equal(activity, 0); }
  else { await context.run({}, { id: 1 }); assert.equal(writes, 1); assert.equal(transactionalWrite, true); assert.equal(saved.bookingDetails.primaryEmployeeId, 3); assert.equal(saved.bookingDetails.freshField, "preserve"); assert.equal(saved.bookingDetails.oldSnapshot, undefined); }
}
await run(true); await run(false);
console.log("PASS legacy direct team handler shares period checks, locks and fresh booking details without changing its identities (controlled IO)");
