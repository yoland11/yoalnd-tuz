/** Representative payment routes: approve/reject are reachable, approval is idempotent and never drops money (no database needed). */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, overrides = {}) {
  const filename = resolve(path);
  const module = { exports: {} };
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const localRequire = (name) => Object.hasOwn(overrides, name) ? overrides[name]
    : name.startsWith("@/") ? load(resolve("src", `${name.slice(2)}.ts`), overrides)
    : name.startsWith(".") ? load(resolve(dirname(filename), `${name}.ts`), overrides)
    : require(name);
  new Function("require", "module", "exports", output)(localRequire, module, module.exports);
  return module.exports;
}

// Like drizzle: nested fragments are inlined and values become parameters.
function fakeSql(parts, ...values) { return { __sql: true, parts: [...parts], values }; }
fakeSql.join = (items, separator) => ({ __join: true, items, separator });
function render(query) {
  let statement = "";
  const values = [];
  const walk = (node) => {
    if (node?.__join) return node.items.forEach((item, index) => { if (index) walk(node.separator); walk(item); });
    node.parts.forEach((part, index) => {
      statement += part;
      if (index >= node.values.length) return;
      const value = node.values[index];
      if (value?.__sql || value?.__join) return walk(value);
      if (Array.isArray(value)) throw new Error(`array bound as a single SQL parameter near: ${part.slice(-40)}`);
      values.push(value);
      statement += "?";
    });
  };
  walk(query);
  return { statement: statement.replace(/\s+/g, " ").trim(), values };
}

const rep = { id: 7, username: "rep7", fullName: "ممثل الشعبة", role: "employee", isActive: true, permissions: ["representative.portal.access", "representative.payments.create"] };
const admin = { id: 1, username: "admin", fullName: "الإدارة", role: "admin", isActive: true, permissions: [] };

function fixture({ requests = [], orders = [], payments = [], receive } = {}) {
  const state = {
    requests: new Map(requests.map((row) => [row.id, { group_id: 8, payment_method: "cash", notes: null, representative_id: 7, representative_name: "ممثل الشعبة", ...row }])),
    orders: new Map(orders.map((order) => [order.id, order])),
    payments,
    receiveCalls: [],
    timeline: [],
    inserts: [],
    executed: [],
    errors: [],
  };
  const handle = async (query) => {
    const { statement, values } = render(query);
    state.executed.push({ statement, values });
    if (/^select 1/i.test(statement)) return { rows: [] };
    if (statement.includes("FROM representative_group_assignments")) return { rows: [{ group_id: 8 }] };
    if (statement.startsWith("UPDATE representative_payment_requests SET status='processing'")) {
      const row = state.requests.get(values[0]);
      const stale = row?.status === "processing" && row.stale && statement.includes("updated_at < now() - interval '15 minutes'");
      const claimable = row && (row.status === "pending" || stale);
      if (!claimable) return { rows: [] };
      row.status = "processing";
      row.stale = false;
      return { rows: [{ ...row }] };
    }
    if (statement.startsWith("UPDATE representative_payment_requests SET status='pending'")) {
      assert.match(statement, /AND status='processing'$/, "a release never reopens an approved request");
      const row = state.requests.get(values[0]);
      if (row?.status === "processing") row.status = "pending";
      return { rows: [] };
    }
    if (statement.startsWith("UPDATE representative_payment_requests SET status='approved'")) {
      const row = state.requests.get(values[2]);
      Object.assign(row, { status: "approved", approved_by: values[0], posted_payment_id: values[1] });
      return { rows: [] };
    }
    if (statement.startsWith("UPDATE representative_payment_requests SET status='rejected'")) {
      const row = state.requests.get(values[2]);
      if (row?.status !== "pending") return { rows: [] };
      Object.assign(row, { status: "rejected", rejection_note: values[0], approved_by: values[1] });
      return { rows: [{ ...row }] };
    }
    if (statement.includes("FROM graduation_student_payments p LEFT JOIN graduation_receipts r")) {
      const found = state.payments.filter((payment) => payment.batch === values[0]).sort((a, b) => a.id - b.id)[0];
      return { rows: found ? [{ id: found.id, receiptNo: found.receiptNo }] : [] };
    }
    if (/^SELECT remaining_amount FROM graduation_orders WHERE id = \? FOR UPDATE$/.test(statement))
      return { rows: [{ remaining_amount: state.orders.get(values[0])?.remainingAmount }] };
    if (statement.startsWith("SELECT COALESCE(SUM(amount), 0) AS total FROM representative_payment_requests")) {
      assert.match(statement, /status IN \('pending', 'processing'\)/);
      const total = [...state.requests.values()]
        .filter((row) => row.graduation_order_id === values[0] && ["pending", "processing"].includes(row.status))
        .reduce((sum, row) => sum + Number(row.amount), 0);
      return { rows: [{ total: String(total) }] };
    }
    if (statement.startsWith("INSERT INTO representative_payment_requests")) {
      const row = { id: 900 + state.inserts.length, group_id: values[0], graduation_order_id: values[1], amount: values[2], payment_method: values[3], status: "pending" };
      state.inserts.push(row);
      state.requests.set(row.id, row);
      return { rows: [row] };
    }
    if (statement.startsWith("UPDATE representative_custody_handovers SET status='confirmed'"))
      return { rows: [{ id: values[1], status: "confirmed", confirmed_by: values[0] }] };
    if (statement.startsWith("INSERT INTO representative_custody_handovers")) {
      state.inserts.push({ custody: values });
      return { rows: [{ id: 1 }] };
    }
    return { rows: [] };
  };
  const findById = (map) => async ({ where }) => map.get(where[1]);
  const query = {
    graduationOrdersTable: { findFirst: findById(state.orders) },
    graduationGroupsTable: { findFirst: async () => ({ id: 8, title: "فيزيائيون", groupNo: "G8" }) },
  };
  const select = () => ({
    from: (table) => table.name === "staffTable"
      ? { where: () => ({ for: async () => [{ id: rep.id }] }) }
      : Promise.resolve([{ id: 8 }]),
  });
  const insert = () => ({ values: async (value) => { state.timeline.push(value); } });
  const db = {
    execute: handle,
    transaction: async (fn) => fn({ execute: handle, select, query, insert }),
    select,
    query,
    insert,
  };
  const tables = Object.fromEntries(["graduationGroupsTable", "graduationOrdersTable", "graduationReceiptsTable", "staffTable", "entityTimelineTable"].map((name) => [name, { name }]));
  const handler = load("src/server/representative.ts", {
    "@workspace/db": { db, ...tables },
    "drizzle-orm": { sql: fakeSql, and: (...args) => args, desc: (x) => x, eq: (a, b) => [a, b], inArray: (a, b) => [a, b] },
    "@/server/graduation-group-pricing": { handleGraduationGroupPricing: async () => new Response(null, { status: 204 }) },
    "@/server/graduation-operations": {
      receivePayment: async (...args) => {
        state.receiveCalls.push(args);
        if (!receive) throw new Error("receivePayment must not be called");
        return receive(...args);
      },
    },
  }).handleRepresentativePortal;
  const call = async (user, parts, method = "GET", body) => {
    const original = console.error;
    console.error = (...args) => state.errors.push(args);
    try {
      return await handler(
        new Request(`http://localhost/api/admin/representative/${parts.join("/")}`, { method, ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) }),
        parts, user);
    } finally {
      console.error = original;
    }
  };
  return { call, state };
}

const posted = (id) => ({ payments: [{ id, receiptNo: `AJN-GR-P-2026-${String(id).padStart(6, "0")}` }], allocated: 1, unallocated: 0 });

// --- approval reaches the approval route (it used to be read as a new payment: «تحقق من بيانات الدفعة»)
{
  const { call, state } = fixture({
    requests: [{ id: 12, graduation_order_id: 81, amount: "50000.00", status: "pending", notes: "دفعة أولى" }],
    orders: [{ id: 81, groupId: 8, remainingAmount: "50000.00" }],
    receive: async () => posted(501),
  });
  const response = await call(admin, ["payments", "12", "approve"], "POST", {});
  const body = await response.json();
  assert.equal(response.status, 200, `approve answered ${response.status}: ${JSON.stringify(body)}`);
  assert.equal(body.status, "approved");
  assert.equal(body.receiptNo, "AJN-GR-P-2026-000501");
  assert.equal(state.receiveCalls.length, 1, "the payment is posted once through the canonical receivePayment");
  const [input, actor, groupId, orderId] = state.receiveCalls[0];
  assert.deepEqual(input, { amount: 50000, paymentMethod: "cash", notes: "دفعة أولى", strategy: "selected", selectedStudentIds: [81], idempotencyKey: "representative-request-12" });
  assert.equal(actor.id, 7, "the payment is received by the representative who collected it");
  assert.equal(groupId, undefined);
  assert.equal(orderId, 81);
  assert.equal(state.requests.get(12).status, "approved");
  assert.equal(state.requests.get(12).posted_payment_id, 501);
  assert.equal(state.requests.get(12).approved_by, 1);
  assert.equal(state.timeline.length, 1, "the approval is recorded on the student's timeline");
  assert.equal(state.inserts.length, 0, "approving never creates another payment request");

  const again = await call(admin, ["payments", "12", "approve"], "POST", {});
  assert.equal(again.status, 409, "an approved request cannot be approved twice");
  assert.equal(state.receiveCalls.length, 1);
}

// --- rejection reaches the rejection route
{
  const { call, state } = fixture({ requests: [{ id: 13, graduation_order_id: 81, amount: "35000", status: "pending" }], orders: [{ id: 81, remainingAmount: "50000" }] });
  const response = await call(admin, ["payments", "13", "reject"], "POST", { note: "مكررة" });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "rejected");
  assert.equal(state.requests.get(13).status, "rejected");
  assert.equal(state.requests.get(13).rejection_note, "مكررة");
  assert.equal(state.inserts.length, 0);
}

// --- a payment larger than the remaining balance is refused, not silently capped
{
  const { call, state } = fixture({
    requests: [{ id: 14, graduation_order_id: 82, amount: "35000", status: "pending" }],
    orders: [{ id: 82, remainingAmount: "0.00" }],
    receive: async () => posted(502),
  });
  const response = await call(admin, ["payments", "14", "approve"], "POST", {});
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.match(body.error?.message ?? body.message ?? JSON.stringify(body), /أكبر من المتبقي/);
  assert.equal(state.receiveCalls.length, 0, "nothing is posted");
  assert.equal(state.requests.get(14).status, "pending", "the request goes back to the queue");
}

// --- a retry after an interrupted approval links the payment already posted
{
  const { call, state } = fixture({
    requests: [{ id: 15, graduation_order_id: 82, amount: "35000", status: "processing", stale: true }],
    orders: [{ id: 82, remainingAmount: "0.00" }],
    payments: [{ id: 600, batch: "representative-request-15", receiptNo: "AJN-GR-P-2026-000600" }],
  });
  const response = await call(admin, ["payments", "15", "approve"], "POST", {});
  assert.equal(response.status, 200);
  assert.equal((await response.json()).receiptNo, "AJN-GR-P-2026-000600");
  assert.equal(state.receiveCalls.length, 0, "the payment is not posted twice");
  assert.equal(state.requests.get(15).status, "approved");
  assert.equal(state.requests.get(15).posted_payment_id, 600);
}

// --- an approval still running cannot be claimed by a second click
{
  const { call, state } = fixture({ requests: [{ id: 19, graduation_order_id: 81, amount: "1000", status: "processing", stale: false }], orders: [{ id: 81, remainingAmount: "5000" }] });
  assert.equal((await call(admin, ["payments", "19", "approve"], "POST", {})).status, 409);
  assert.equal((await call(admin, ["payments", "19", "reject"], "POST", { note: "x" })).status, 409);
  assert.equal(state.requests.get(19).status, "processing");
}

// --- a posting without its receipt is reported, never approved blindly
{
  const { call, state } = fixture({
    requests: [{ id: 16, graduation_order_id: 81, amount: "10000", status: "pending" }],
    orders: [{ id: 81, remainingAmount: "50000" }],
    payments: [{ id: 601, batch: "representative-request-16", receiptNo: null }],
  });
  const response = await call(admin, ["payments", "16", "approve"], "POST", {});
  assert.equal(response.status, 409);
  assert.equal(state.receiveCalls.length, 0);
  assert.equal(state.requests.get(16).status, "pending");
  assert.ok(state.errors.some(([message]) => message === "representative payment approval found a partial posting"));
}

// --- failures keep the cause: logged with a request ID, structured error, request back in the queue
{
  const { call, state } = fixture({
    requests: [{ id: 17, graduation_order_id: 81, amount: "10000", status: "pending" }],
    orders: [{ id: 81, remainingAmount: "50000" }],
    receive: async () => { throw new Error("connection reset"); },
  });
  const response = await call(admin, ["payments", "17", "approve"], "POST", {});
  const body = await response.json();
  assert.equal(response.status, 500);
  assert.ok(response.headers.get("x-request-id"), "the failure carries a request ID");
  assert.ok(JSON.stringify(body).includes(response.headers.get("x-request-id")), "the error payload repeats the request ID");
  assert.equal(state.requests.get(17).status, "pending");
  assert.ok(state.errors.some(([message, context]) => message === "representative payment approval failed" && context.paymentRequestId === 17 && context.requestId));
}
{
  const { call, state } = fixture({
    requests: [{ id: 18, graduation_order_id: 81, amount: "10000", status: "pending" }],
    orders: [{ id: 81, remainingAmount: "50000" }],
    receive: async () => ({ response: Response.json({ error: "لا توجد طلبات قابلة للدفع" }, { status: 404 }) }),
  });
  const response = await call(admin, ["payments", "18", "approve"], "POST", {});
  assert.equal(response.status, 404, "the canonical path's own error is returned as is");
  assert.equal(state.requests.get(18).status, "pending");
}

// --- only the administration approves or rejects
{
  const { call, state } = fixture({ requests: [{ id: 20, graduation_order_id: 81, amount: "1000", status: "pending" }], orders: [{ id: 81, remainingAmount: "5000" }] });
  assert.equal((await call(rep, ["payments", "20", "approve"], "POST", {})).status, 403);
  assert.equal((await call(rep, ["payments", "20", "reject"], "POST", { note: "x" })).status, 403);
  assert.equal(state.requests.get(20).status, "pending");
  assert.equal(state.inserts.length, 0, "a representative's approve call is never read as a new payment");
}

// --- new requests: pending requests count against the remaining balance
{
  const { call, state } = fixture({
    requests: [{ id: 21, graduation_order_id: 81, amount: "30000", status: "pending" }],
    orders: [{ id: 81, groupId: 8, customerName: "علي حسين", remainingAmount: "50000" }],
  });
  const duplicate = await call(rep, ["payments"], "POST", { orderId: 81, amount: 30000, paymentMethod: "cash" });
  const message = JSON.stringify(await duplicate.json());
  assert.equal(duplicate.status, 409, "a second payment past the remaining balance is refused");
  assert.match(message, /بانتظار الاعتماد/);
  assert.match(message, /30,000 د\.ع/);
  assert.equal(state.inserts.length, 0);
  const lockAt = state.executed.findIndex((q) => /FROM graduation_orders WHERE id = \? FOR UPDATE/.test(q.statement));
  const sumAt = state.executed.findIndex((q) => q.statement.startsWith("SELECT COALESCE(SUM(amount), 0) AS total"));
  assert.ok(lockAt >= 0 && lockAt < sumAt, "the student's row is locked before pending requests are summed");

  const fits = await call(rep, ["payments"], "POST", { orderId: 81, amount: 20000, paymentMethod: "transfer" });
  assert.equal(fits.status, 201, "a payment within the remaining balance is recorded");
  assert.equal(state.inserts.length, 1);
  assert.equal(state.inserts[0].payment_method, "transfer");
}

// --- custody confirmation reaches its own route instead of creating a handover
{
  const { call, state } = fixture();
  const response = await call(admin, ["custody", "5", "confirm"], "POST", {});
  assert.equal(response.status, 200);
  assert.equal((await response.json()).handover.status, "confirmed");
  assert.equal(state.inserts.length, 0);
}

console.log("Representative payment approval route checks passed.");
