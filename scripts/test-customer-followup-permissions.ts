import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { CustomerFollowupError, handleCustomerFollowupRequest } from "../src/server/customer-followups";

const seen: Array<{ sql: string; params: unknown[] }> = [], dialect = new PgDialect();
const db: any = {
  async execute(query: any) {
    const compiled = dialect.sqlToQuery(query); seen.push(compiled);
    const text = compiled.sql;
    if (text.includes(" AS converted")) return { rows: [{ today: 0, overdue: 0, upcoming: 0, converted: 0, total: 0, completed: 0 }] };
    if (text.includes("count(*)::int AS total")) return { rows: [{ total: 0 }] };
    if (text.includes("FROM staff")) return { rows: [{ id: compiled.params[0], is_active: true, full_name: "موظف" }] };
    if (text.includes("FROM customers")) return { rows: [{ id: 5, name: "عميل", phone: "9647701234567" }] };
    return { rows: [] };
  },
  async transaction(work: any) { return work(db); },
};
const manager = { id: 1, role: "manager", permissions: [] as string[], canBook: false, canCreateCustomer: false };
const employee = { ...manager, id: 8, role: "employee" };
const request = (actor: typeof manager, method = "GET", parts: string[] = [], query = "", body: unknown = {}) => handleCustomerFollowupRequest(db, actor, { method, parts, query: new URLSearchParams(query), readBody: async () => body });

await assert.rejects(() => request(manager, "GET", ["options"]), error => error instanceof CustomerFollowupError && error.status === 403, "manager followup authority must not become global customer lookup authority");
await assert.rejects(() => request(manager, "POST", [], "", { customerId: 5, serviceKey: "kosha", followupAt: "2027-01-01T10:00:00+03:00", assignedStaffId: 1, idempotencyKey: "manager-no-customer-permission" }), error => error instanceof CustomerFollowupError && error.status === 403);
assert.ok(!seen.some(query => query.sql.includes("FROM customers")), "denied global operations never read the customer directory");

seen.length = 0;
const result: any = await request(employee);
assert.equal(result.data.capabilities.canCreate, false);
const candidates = seen.find(query => query.sql.includes("source_candidates"))!;
assert.ok(candidates.sql.includes("owned.assigned_staff_id="));
const inquiryBranch = candidates.sql.slice(candidates.sql.indexOf("FROM customer_followups b"));
assert.match(inquiryBranch, /b\.assigned_staff_id\s*=/, "inquiry suggestion sources themselves must be assigned; another owned inquiry for that customer is insufficient");

seen.length = 0;
await request({ ...manager, role: "super_admin", id: 9 });
assert.ok(seen.some(query => query.sql.includes("f.assigned_staff_id =") && query.params.includes(9)), "unrecognized role names do not acquire new all-record privileges");

seen.length = 0;
await assert.rejects(() => request({ ...manager, permissions: ["customers"], canCreateCustomer: true }, "POST", [], "scope=mine", { customerId: 5, serviceKey: "booking_confirmation", followupAt: "2027-01-01T10:00:00+03:00", assignedStaffId: 1, idempotencyKey: "scope-suggestion-create-1", suggestionKey: "inquiry:42:booking_confirmation" }), error => error instanceof CustomerFollowupError && error.code === "SUGGESTION_UNAVAILABLE");
const validationCandidates = seen.find(query => query.sql.includes("source_candidates"))!;
assert.match(validationCandidates.sql, /owned\.assigned_staff_id=/, "suggestion revalidation retains manager's explicit assigned-only scope");
assert.ok(validationCandidates.params.includes(1));
console.log("PASS followup permission boundaries: no manager customer-directory escalation, assigned inquiry sources, original-role semantics and retained source-validation scope");
