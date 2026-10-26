import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { z } from "zod";

// Run the real admission/query functions without a database connection or write.
const source = readFileSync("src/server/employee-salaries.ts", "utf8");
const tree = ts.createSourceFile("employee-salaries.ts", source, ts.ScriptTarget.Latest, true);
const functionNames = ["historicalSalarySourcePredicate", "getEmployeeSalaryManagementDetail", "linkHistoricalSalaryPayment"];
const variableNames = ["rows", "num", "VEHICLE_PARTNERSHIP_SOURCE_PREFIX", "VEHICLE_PARTNERSHIP_TRANSACTION_PREFIX"];
const declarations = tree.statements.filter(node =>
  ts.isFunctionDeclaration(node) ? functionNames.includes(node.name?.text ?? "") :
    ts.isVariableStatement(node) && node.declarationList.declarations.some(d => ts.isIdentifier(d.name) && variableNames.includes(d.name.text)));
const code = ts.transpileModule(declarations.map(node => node.getText(tree).replace(/^export\s+/, "")).join("\n") +
  "\n({getEmployeeSalaryManagementDetail,linkHistoricalSalaryPayment})", {
  compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
}).outputText;
const dialect = new PgDialect();
const actor = { id: 2, name: "Payroll manager", role: "admin" };
const line = { id: 12, payroll_run_id: 4, staff_id: 9, net_salary: "10000.00", period: "2026-10", financial_transaction_id: null };
const legacyFinancial = { id: 30, direction: "expense", approval_status: "executed", reversed_at: null,
  amount: "10000.00", transaction_date: "2026-10-25", payment_method: "cash", source_type: "payroll", transaction_type: "salary_payment" };
function fixture(financial: Record<string, unknown> = legacyFinancial) {
  const queries: { sql: string; params: unknown[] }[] = [];
  const effects: string[] = [];
  const tx = { execute: async (query: Parameters<typeof dialect.sqlToQuery>[0]) => {
    const compiled = dialect.sqlToQuery(query); queries.push(compiled);
    if (/^select \* from financial_transactions/.test(compiled.sql)) return { rows: [financial] };
    if (/^select id from employee_salary_payments/.test(compiled.sql)) return { rows: [] };
    if (/^insert into employee_salary_payments/.test(compiled.sql)) { effects.push("payment"); return { rows: [{ id: 77, status: "paid" }] }; }
    if (/^update payroll_lines/.test(compiled.sql)) { effects.push("line"); return { rows: [] }; }
    throw new Error(`Unexpected mutation query: ${compiled.sql}`);
  } };
  const db = { transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    execute: async (query: Parameters<typeof dialect.sqlToQuery>[0]) => { queries.push(dialect.sqlToQuery(query)); return { rows: [] }; } };
  const api = vm.runInNewContext(code, { sql, z, db,
    ensureEmployeeSalaryManagementTables: async () => undefined,
    salaryContext: async () => ({ ...line }),
    refreshRunStatus: async () => { effects.push("run"); return "paid"; },
    addEvent: async () => { effects.push("audit"); },
  });
  return { api, queries, effects };
}

for (const financial of [
  { ...legacyFinancial, source_type: "vehicle_partnership_cost", transaction_type: "vp_driver_accrual" },
  { ...legacyFinancial, source_type: "vehicle_partnership_settlement", transaction_type: "vp_driver_settlement" },
  { ...legacyFinancial, source_type: "vehicle_partnership_future", transaction_type: "expense" },
  { ...legacyFinancial, source_type: "payroll", transaction_type: "vp_driver_accrual" },
  { ...legacyFinancial, source_type: "payroll", transaction_type: "vp_future_payment" },
]) {
  const run = fixture(financial);
  await assert.rejects(run.api.linkHistoricalSalaryPayment(4, 12, { financialTransactionId: 30, reason: "تسوية راتب قديم" }, actor),
    /شراكة المركبات|أجرة الرحلة/, `${financial.source_type}/${financial.transaction_type} cannot pay a monthly salary`);
  assert.deepEqual(run.effects, [], "source rejection precedes salary/paid/status/audit writes");
  assert.equal(run.queries.length, 1, "reject after locked source lookup, before linkage lookup/writes");
}
for (const financial of [legacyFinancial, { ...legacyFinancial, source_type: null, transaction_type: null },
  { ...legacyFinancial, source_type: "vehicle_expense", transaction_type: "salary_legacy" }]) {
  const run = fixture(financial);
  const result = await run.api.linkHistoricalSalaryPayment(4, 12, { financialTransactionId: 30, reason: "تسوية راتب قديم" }, actor);
  assert.equal(result.payment.id, 77);
  assert.equal(result.runStatus, "paid");
  assert.deepEqual(run.effects, ["payment", "line", "run", "audit"], "legacy flow preserves original transactional writes");
}
const detail = fixture();
await detail.api.getEmployeeSalaryManagementDetail(4, 12);
const suggestions = detail.queries.find(query => query.sql.includes("as match_score"));
assert.ok(suggestions, "inspect the actual historical salary suggestion SQL");
assert.ok(suggestions.params.includes("vehicle_partnership_"));
assert.ok(suggestions.params.includes("vp_"));
assert.match(suggestions.sql, /left\(coalesce\(ft\.source_type/);
assert.match(suggestions.sql, /left\(coalesce\(ft\.transaction_type/);
assert.match(suggestions.sql, /ft\.approval_status='executed'/);
assert.match(suggestions.sql, /ft\.reversed_at is null/);
console.log("PASS real historical salary linking/query guards: partnership/driver sources rejected before writes, nullable legacy sources preserved.");
