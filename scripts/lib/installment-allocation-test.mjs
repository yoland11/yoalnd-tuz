import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Exercises the real request function without connecting to any database. The
// boundary double records the allocation SQL emitted by production code.
export async function testInstallmentAllocation(text = readFileSync("src/server/installments.ts", "utf8")) {
  const tree = ts.createSourceFile("installments.ts", text, ts.ScriptTarget.Latest, true);
  const statements = tree.statements.filter(node =>
    ts.isFunctionDeclaration(node) && node.name?.text === "postInstallmentPayment" ||
    ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(tree) === "money"));
  const code = ts.transpileModule(statements.map(node => node.getText(tree)).join("\n"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const cases = [
    { name: "partial first schedule", amount: 40, held: [], expected: [[11, 40]] },
    { name: "crosses into second schedule", amount: 75, held: [], expected: [[11, 50], [12, 25]] },
    { name: "respects pending first-schedule hold", amount: 40, held: [{ installment_id: 11, amount: 30 }], expected: [[11, 20], [12, 20]] },
    { name: "skips fully held schedule", amount: 40, held: [{ installment_id: 11, amount: 50 }], expected: [[12, 40]] },
  ];
  for (const fixture of cases) {
    const writes = [], allocations = [];
    const tx = {
      async execute(query) {
        const { text: statement, values } = query;
        if (statement.includes("SELECT * FROM installment_contracts")) return { rows: [{ id: 5, status: "active", balance_at_conversion: 100, collected_amount: 0 }] };
        if (statement.includes("WHERE idempotency_key=")) return { rows: [] };
        if (statement.includes("SELECT coalesce(sum(amount)")) return { rows: [{ amount: fixture.held.reduce((total, item) => total + item.amount, 0) }] };
        if (statement.includes("SELECT * FROM installment_schedule")) return { rows: [{ id: 11, remaining_amount: 50 }, { id: 12, remaining_amount: 50 }] };
        if (statement.includes("JOIN installment_payments")) return { rows: fixture.held };
        if (statement.includes("SELECT nextval")) return { rows: [{ id: 23 }] };
        if (statement.includes("INSERT INTO installment_payments")) {
          writes.push(statement);
          assert.match(statement, /'pending'/);
          return { rows: [{ id: 23, amount: fixture.amount, status: "pending" }] };
        }
        if (statement.includes("INSERT INTO installment_payment_allocations")) {
          writes.push(statement); allocations.push([values[1], Number(values[2])]);
          return { rows: [] };
        }
        throw new Error(`Unexpected database operation: ${statement}`);
      },
      insert() { return { values: async () => {} }; },
    };
    const context = vm.createContext({
      exports: {},
      sql: (strings, ...values) => ({ text: strings.join("?"), values }),
      db: { transaction: callback => callback(tx) },
      ensureMasterCashBoxTables: async () => {},
      fail: (error, status) => ({ error, status }),
      createPaymentFinancialMovement: async (_tx, payment) => ({ ...payment, financial_transaction_id: 9 }),
      addHistory: async () => {}, entityTimelineTable: {},
    });
    vm.runInContext(code, context);
    const result = await context.exports.postInstallmentPayment(5, {
      amount: fixture.amount, paymentMethod: "cash", idempotencyKey: "stable-request", allocations: [],
    }, { id: 7, fullName: "موظف" });
    assert.equal(result.status, undefined, `${fixture.name}: valid request must not be rejected: ${result.error}`);
    assert.deepEqual(allocations, fixture.expected, `${fixture.name}: allocate by due order only up to the requested amount`);
    assert.equal(result.payment.status, "pending");
    assert.equal(writes.some(statement => /UPDATE (?:sales_invoices|installment_schedule|installment_contracts)/.test(statement)), false);
  }
}
