/** Execute the original booking transaction helper with the real followup resolver and controlled SQL. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { PgDialect } from "drizzle-orm/pg-core";
import * as followups from "../src/server/customer-followups";

const resolver = (followups as any).resolveFollowupBookingCustomer;
assert.equal(typeof resolver, "function", "followup booking must resolve the original customer before phone-based upsert or resource validation");
const source = readFileSync("src/server/api.ts", "utf8"), ast = ts.createSourceFile("api.ts", source, ts.ScriptTarget.Latest, true);
const findFunction = (name: string) => ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name) as ts.FunctionDeclaration;
const createNode = findFunction("createServiceOrderWithHistory"), insertNode = findFunction("insertServiceOrderWithTracking");
assert.ok(createNode && insertNode);
const functions = ts.transpileModule(`${createNode.getText(ast)}\n${insertNode.getText(ast)}\nexports.create=createServiceOrderWithHistory;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
let adminOptions: ts.Node | undefined;
const visit = (node: ts.Node) => {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "createServiceOrderWithHistory" && node.getStart(ast) > source.indexOf("async function handleAdmin(")) adminOptions = node.arguments[2];
  ts.forEachChild(node, visit);
}; visit(ast);
assert.ok(adminOptions);
const optionsJs = ts.transpileModule(`exports.options=${adminOptions!.getText(ast)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const dialect = new PgDialect();
const actor = { id: 8, role: "employee", permissions: [], canBook: true, canCreateCustomer: false };
const initial = { id: 17, customer_id: 5, service_key: "sound", assigned_staff_id: 8, followup_at: "2026-11-03T09:00:00Z", status: "waiting", completed_at: null, note: "", created_at: "2026-11-01T00:00:00Z", version: 1, customer_name: "العميل الأصلي", phone: "٠٧٧٠ ١٢٣ ٤٥٦٧", full_name: "موظف", contact_blocked: false, booking_id: null, booking_source: null };
for (const scenario of ["legacy-unicode", "duplicate-phone-variant", "phone-changed", "converted-retry", "unassigned", "no-source"] as const) {
  let row: any = { ...initial }, phone = "9647701234567";
  if (scenario === "phone-changed") row.phone = "07707654321";
  if (scenario === "converted-retry") row = { ...row, status: "converted", booking_id: 901, booking_source: "service", booking_number: "SRV-901" };
  const sqlSeen: string[] = [], orderWrites: any[] = [], history: any[] = [], steps: string[] = [];
  const tx: any = {
    async execute(query: any) {
      const { sql, params } = dialect.sqlToQuery(query); sqlSeen.push(sql);
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("FROM staff")) return { rows: [{ id: 8, is_active: true }] };
      if (sql.includes("FROM customer_followups f")) {
        if (scenario === "unassigned") return { rows: [] };
        return { rows: [{ ...row }] };
      }
      if (sql.includes("FROM customers")) { assert.ok(params.includes(5)); return { rows: [{ id: 5, phone: row.phone, status: "active" }] }; }
      throw Error("Unexpected SQL: " + sql);
    },
    insert(table: string) {
      return { values(value: any) {
        if (table === "orders") { steps.push("booking"); orderWrites.push(value); }
        else { steps.push("history"); history.push(value); }
        return { returning: async () => [{ ...value, id: 902, status: "pending" }] };
      } };
    },
  };
  const sandbox: any = {
    exports: {}, db: { async transaction(run: any) { try { return await run(tx); } catch (error) { orderWrites.length = 0; history.length = 0; throw error; } } },
    ensureTrackingColumns: async () => {}, ensurePaymentWorkflowColumns: async () => {}, ensureCustomerProfileColumns: async () => {},
    logServiceBookingStep: () => {}, ensureCustomerForPhone: async () => { steps.push("phone-upsert"); return { id: 6 }; },
    resolveFollowupBookingCustomer: resolver, CustomerFollowupError: followups.CustomerFollowupError,
    followupActor: () => actor, auth: { id: 8, username: "staff" }, req: { headers: { get: () => null } },
    completeFollowupConversion: async (_tx: any, input: any) => { assert.equal(_tx, tx); assert.equal(input.customerId, 5); steps.push("conversion"); },
    syncCentralBookingToPhotography: async () => { steps.push("photography"); },
    recordOccasionFollowups: async (executor:any,input:any) => { assert.equal(executor,tx); assert.equal(input.id,902); steps.push('occasion-followups'); },
    photographySync: undefined, serviceItems: [], customFields: scenario === "no-source" ? {} : { customerFollowupId: 17 },
    trackingCodeForPhone: () => "SRV-902", phoneLast4: () => "4567", serviceOrdersTable: "orders", serviceOrderItemsTable: "items", serviceOrderStatusHistoryTable: "history",
    money: Number, paymentSummary: (total: any, deposit: any) => ({ deposit: Number(deposit), remaining: Number(total) - Number(deposit), status: "unpaid" }),
    validateBookingResourceCreation: async () => { steps.push("resources"); if (scenario === "converted-retry") throw Error("first booking already reserved the equipment"); },
  };
  vm.runInNewContext(functions + optionsJs, sandbox);
  const options = sandbox.exports.options;
  const run = () => sandbox.exports.create({ serviceId: 11, phone, customerName: "العميل الأصلي", totalAmount: "150000", depositAmount: "0", customFields: sandbox.customFields }, "إضافة من الإدارة", options);
  if (["phone-changed", "converted-retry", "unassigned"].includes(scenario)) {
    await assert.rejects(run, (error: any) => {
      assert.ok(error instanceof followups.CustomerFollowupError);
      if (scenario === "converted-retry") assert.equal(error.existingBooking?.id, 901);
      return true;
    });
    assert.deepEqual(orderWrites, []); assert.deepEqual(history, []);
    assert.ok(!steps.includes("phone-upsert") && !steps.includes("resources"), "reject/recover before identity upsert, booking writes and equipment reservation");
  } else {
    const created = await run();
    assert.equal(created.customerId, scenario === "no-source" ? 6 : 5);
    assert.equal(created.customFields.customerId, created.customerId);
    assert.equal(created.totalAmount, "150000"); assert.equal(created.depositAmount, "0");
    assert.equal(steps.includes("phone-upsert"), scenario === "no-source", "only no-source legacy flow retains original phone resolution");
    if (scenario !== "no-source") assert.ok(sqlSeen.some(sql => sql.includes("FOR SHARE")), "original customer identity/phone remains locked without updates");
    assert.equal(history.length, 1); assert.ok(steps.includes("resources") && steps.includes("photography"));
  }
}
console.log("PASS original booking transaction: source customer/Unicode and duplicate phone identity, changed-phone/assignment rejection, lost-response recovery before reservations and unchanged no-source path/amounts (controlled SQL, not PG integration)");
