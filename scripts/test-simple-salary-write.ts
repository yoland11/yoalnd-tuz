import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { z } from "zod";

// Run the actual endpoint against a controlled transaction boundary. No database
// connections, cash-box writes or production credentials are used by this test.
const ast = ts.createSourceFile("api.ts", readFileSync("src/server/api.ts", "utf8"), ts.ScriptTarget.Latest, true);
let endpoint: ts.IfStatement | undefined;
function visit(node: ts.Node) {
  if (ts.isIfStatement(node) && node.expression.getText(ast) === 'parts[2] === "simple-salaries"') endpoint = node;
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(endpoint);
const code = ts.transpileModule(`async function invoke(){${endpoint.getText(ast)}}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const dialect = new PgDialect();
const original = { id: 31, payroll_run_id: 4, staff_id: 9, base_salary: "1000.00", gross_salary: "1000.00", net_salary: "1000.00", amount_paid: "400.00", payment_status: "partially_paid", financial_transaction_id: 80 };
type Fixture = { label: string; line?: Record<string, unknown> | null; payment?: boolean; financial?: boolean; failEvidence?: boolean; blocked?: boolean };
const fixtures: Fixture[] = [
  { label: "partial executed payment; repeated save", line: original, payment: true, financial: true, blocked: true },
  { label: "paid snapshot", line: { ...original, amount_paid: 0, payment_status: "paid" }, blocked: true },
  { label: "legacy partial alias", line: { ...original, amount_paid: 0, payment_status: "partial" }, blocked: true },
  { label: "legacy paid amount without newer status", line: { ...original, payment_status: null, financial_transaction_id: null }, blocked: true },
  { label: "stale zero cache with salary payment history", line: { ...original, amount_paid: 0, payment_status: "unpaid" }, payment: true, blocked: true },
  { label: "pending source financial request", line: { ...original, amount_paid: 0, payment_status: "unpaid", financial_transaction_id: null }, financial: true, blocked: true },
  { label: "legacy linked financial request", line: { ...original, amount_paid: 0, payment_status: "unpaid" }, financial: true, blocked: true },
  { label: "unknown non-unpaid status", line: { ...original, amount_paid: 0, payment_status: "pending" }, blocked: true },
  { label: "genuine legacy unpaid", line: { ...original, amount_paid: null, payment_status: null, financial_transaction_id: null } },
  { label: "genuine unpaid", line: { ...original, amount_paid: 0, payment_status: "unpaid", financial_transaction_id: null } },
  { label: "evidence database failure", line: { ...original, amount_paid: 0, payment_status: "unpaid" }, failEvidence: true },
];

for (const method of ["POST", "PATCH"]) for (const fixture of fixtures) {
  let line: any = structuredClone(fixture.line), run = { id: 4, total_net: 1000, updated: false };
  const beforeLine = structuredClone(line), beforeRun = structuredClone(run);
  let active = false, committed = false, lineLocked = false;
  const execute = async (query: any) => {
    const rendered = dialect.sqlToQuery(query), text = rendered.sql.replace(/\s+/g, " ").trim().toLowerCase(), values = rendered.params;
    if (text.startsWith("select id,full_name,username from staff")) return { rows: [{ id: 9, full_name: "موظف", username: "employee" }] };
    if (text.startsWith("insert into payroll_runs")) { assert.equal(active, true); run.updated = true; return { rows: [structuredClone(run)] }; }
    if (text.startsWith("select") && text.includes("from payroll_lines")) {
      lineLocked = active && text.includes("for update");
      return { rows: line ? [structuredClone({ ...line, period: "2026-11" })] : [] };
    }
    if (text.startsWith("select") && /from (employee_salary_payments|financial_transactions)/.test(text)) {
      assert.equal(active, true, "payment evidence must be read in the edit transaction");
      assert.equal(lineLocked, true, "serialize the edit with the existing payment flow's payroll-line lock");
      if (fixture.failEvidence) throw new Error("payment evidence unavailable");
      if (!text.includes("from financial_transactions")) return { rows: fixture.payment ? [{ id: 70, status: "paid", financial_transaction_id: 80 }] : [] };
      assert.ok(text.includes("source_type") && text.includes("source_id") && text.includes("approval_status"), "include direct pending/executed financial evidence even if caches are stale");
      return { rows: fixture.financial ? [{ id: 80, approval_status: "pending" }] : [] };
    }
    if (text.startsWith("update payroll_lines")) {
      assert.equal(active, true, "salary edits must be transactional");
      assert.equal(lineLocked, true);
      for (const field of ["base_salary", "bonus_amount", "penalty_amount", "gross_salary", "net_salary", "line_notes", "payment_status", "amount_paid"]) {
        const match = new RegExp(`\\b${field}\\s*=\\s*(\\$\\d+|'[^']*'|0)`).exec(text);
        if (match) line[field] = match[1].startsWith("$") ? values[Number(match[1].slice(1)) - 1] : match[1].startsWith("'") ? match[1].slice(1, -1) : 0;
      }
      return { rows: [structuredClone(line)] };
    }
    if (text.startsWith("update payroll_runs")) { assert.equal(active, true); run.total_net = Number(line.net_salary); return { rows: [] }; }
    throw new Error(`Unexpected controlled SQL: ${text}`);
  };
  const ctx: any = {
    sql, z, method, parts: ["admin", "hr", "simple-salaries", ...(method === "PATCH" ? ["31"] : [])],
    req: { headers: new Headers({ "x-request-id": "REQ-payroll-regression" }) }, actor: { id: 1, name: "admin", role: "admin" },
    body: async () => ({ employeeId: 9, month: "2026-11", baseSalary: 100, bonus: 0, deduction: 0, notes: "edit" }),
    canSimpleSalary: () => true, simpleRows: (r: any) => r.rows, int: Number,
    json: (data: unknown, status = 200) => ({ data, status }),
    error: (message: string, status: number, options: any = {}) => ({ status, data: { message, code: options.code, requestId: options.requestId } }),
    makeRequestId: (id: string) => id, logAdminActivity: async () => {}, console: { ...console, warn: () => {} },
    db: { execute, transaction: async (fn: any) => { active = true; try { const value = await fn({ execute }); committed = true; return value; } catch (cause) { line = structuredClone(beforeLine); run = structuredClone(beforeRun); throw cause; } finally { active = false; } } },
  };
  vm.createContext(ctx); vm.runInContext(code, ctx);
  const label = `${method}: ${fixture.label}`;
  if (fixture.failEvidence) {
    await assert.rejects(() => ctx.invoke(), /payment evidence unavailable/, label);
    assert.equal(committed, false, label); assert.deepEqual(line, beforeLine, label); assert.deepEqual(run, beforeRun, label);
  } else if (fixture.blocked) {
    const result = await ctx.invoke();
    assert.equal(result.status, 409, `${label}: ordinary salary edits must never erase or alter paid history, including a new total below paid`);
    assert.equal(result.data.code, "CONFLICT", label); assert.equal(result.data.requestId, "REQ-payroll-regression", label);
    assert.equal(committed, false, label); assert.deepEqual(line, beforeLine, label); assert.deepEqual(run, beforeRun, label);
  } else {
    const result = await ctx.invoke(); assert.equal(result.status, method === "POST" ? 201 : 200, label);
    assert.equal(committed, true, label); assert.equal(Number(line.net_salary), 100, label);
    assert.equal(Number(line.amount_paid || 0), 0, label);
  }
}
console.log("PASS actual simple salary POST/PATCH transactions: partial/paid/pending/legacy evidence rejects with 409; unpaid remains editable; evidence failures roll back without hiding errors (controlled IO)");
