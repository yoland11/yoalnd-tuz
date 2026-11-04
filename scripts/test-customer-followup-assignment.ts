import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { CustomerFollowupError, handleCustomerFollowupRequest } from "../src/server/customer-followups";

const dialect = new PgDialect(), calls: Array<{ sql: string; params: any[] }> = [];
let row: any = { id: 9, customer_id: 5, service_key: "kosha", assigned_staff_id: 8, followup_at: "2027-01-01T10:00:00Z", status: "waiting", note: "ملاحظة محفوظة", completed_at: null, version: 3, created_at: "2026-11-03T10:00:00Z", customer_name: "عميل", phone: "9647701234567", full_name: "موظف سابق", contact_blocked: false };
const events = new Map<string, any>();
const db: any = {
  async execute(query: any) {
    const { sql, params: p } = dialect.sqlToQuery(query); calls.push({ sql, params: p });
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (sql.includes("FROM customer_followups f")) return { rows: [{ ...row }] };
    if (sql.includes("FROM customer_followup_events")) return { rows: events.has(p[0]) ? [events.get(p[0])] : [] };
    if (sql.includes("INSERT INTO customer_followup_events")) { events.set(p[3], { followup_id: p[0], payload_hash: p[4], result: JSON.parse(p[5]) }); return { rows: [{ id: 1 }] }; }
    if (sql.includes("FROM customers")) return { rows: [{ id: 5 }] };
    if (sql.includes("FROM staff")) {
      assert.notEqual(p[0], 8, "reassigning must not depend on the former employee still being active");
      if (p[0] === 10) return { rows: [] };
      return { rows: [{ id: p[0] ?? 9, full_name: "الموظف الجديد", department: "المبيعات", is_active: true }] };
    }
    if (sql.includes("UPDATE customer_followups SET assigned_staff_id=")) { row = { ...row, assigned_staff_id: p[0], full_name: "الموظف الجديد", version: row.version + 1 }; return { rows: [{ id: 9 }] }; }
    throw new Error("Unexpected query: " + sql);
  },
  async transaction(work: any) { const before = structuredClone(row), saved = new Map(events); try { return await work(db); } catch (error) { row = before; events.clear(); for (const [k, v] of saved) events.set(k, v); throw error; } },
};
const manager = { id: 1, role: "manager", permissions: [] as string[], canBook: false, canCreateCustomer: false };
const staff = { ...manager, id: 8, role: "employee" };
const request = (actor: typeof manager, parts: string[], method = "GET", body: unknown = {}, search = "") => handleCustomerFollowupRequest(db, actor, { method, parts, query: new URLSearchParams(search), readBody: async () => body });
const options: any = (await request(manager, ["9", "assignees"])).data;
assert.equal(options.employees[0].fullName, "الموظف الجديد");
const filters: any = (await request(manager, ["employees"])).data;
assert.ok(filters.employees.length > 0);
assert.ok(calls.some(q => q.sql.includes("EXISTS (SELECT 1 FROM customer_followups f WHERE f.assigned_staff_id=s.id)")), "filter roster includes original assignees regardless of current active status");
assert.ok(!calls.some(q => q.sql.includes("FROM customers")), "assignment options never expose the customer directory");
await assert.rejects(() => request(staff, ["employees"]), e => e instanceof CustomerFollowupError && e.status === 403);
await assert.rejects(() => request(manager, ["employees"], "GET", {}, "scope=mine"), e => e instanceof CustomerFollowupError && e.status === 403);
await assert.rejects(() => request(staff, ["9", "assignees"]), e => e instanceof CustomerFollowupError && e.status === 403);
await assert.rejects(() => request(manager, ["9", "assignees"], "GET", {}, "scope=mine"), e => e instanceof CustomerFollowupError && e.status === 403);
const command = { action: "assign", expectedVersion: 3, assignedStaffId: 9, idempotencyKey: "assign-retry-0001" };
await assert.rejects(() => request(staff, ["9", "actions"], "POST", command), e => e instanceof CustomerFollowupError && e.status === 403);
const result: any = (await request(manager, ["9", "actions"], "POST", command)).data;
assert.equal(result.followup.employee.id, 9); assert.equal(result.followup.version, 4); assert.equal(result.followup.note, "ملاحظة محفوظة");
const replay = (await request(manager, ["9", "actions"], "POST", command)).data;
assert.deepEqual(replay, result); assert.equal(row.version, 4); assert.equal(events.size, 1);
await assert.rejects(() => request(manager, ["9", "actions"], "POST", { ...command, expectedVersion: 4, assignedStaffId: 10, idempotencyKey: "assign-inactive-0001" }), e => e instanceof CustomerFollowupError && e.status === 422);
assert.equal(row.assigned_staff_id, 9); assert.equal(row.version, 4); assert.equal(events.size, 1);
console.log("PASS manager reassignment: scoped roster, no customer-directory escalation, inactive former employee repair, active target validation and exact transactional replay");
