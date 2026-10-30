import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Exercise the actual API expressions. The older transport contract's separate
// netProfit model already handled losses while these production fields did not.
const source = readFileSync(new URL("../src/server/api.ts", import.meta.url), "utf8");
const api = ts.createSourceFile("api.ts", source, ts.ScriptTarget.Latest, true);
const sanitizer = api.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "money");
assert.ok(sanitizer, "actual API input sanitizer is available");
const sanitizerJs = ts.transpileModule(sanitizer.getText(api), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const expressions = [];
const vehicleStart = source.indexOf('if (section === "vehicles" && parts[1] && parts[2] === "financial"');
const vehicleEnd = source.indexOf('if (section === "vehicles" && parts[1] && parts[2] === "expenses"', vehicleStart);
assert.ok(vehicleStart > 0 && vehicleEnd > vehicleStart);
function visit(node) {
  if (ts.isPropertyAssignment(node)) {
    const name = node.name.getText(api), expression = node.initializer.getText(api);
    if ((name === "tripProfit" && !expression.includes("value.profit") && node.getStart(api) > vehicleStart && node.getStart(api) < vehicleEnd) ||
        (name === "netProfit" && expression.includes("transportationRevenue") && expression.includes("vehicleExpenses"))) {
      expressions.push({ name, expression, line: api.getLineAndCharacterOfPosition(node.getStart(api)).line + 1 });
    }
  }
  ts.forEachChild(node, visit);
}
visit(api);
assert.equal(expressions.filter(row => row.name === "tripProfit").length, 2, "both original trip source results are covered");
assert.equal(expressions.filter(row => row.name === "netProfit").length, 1, "detail summary is covered; list stats live in addPlanVehicleStats (test-vehicle-transport-plans)");

const formatter = { exports: {} };
const formatterJs = ts.transpileModule(readFileSync(new URL("../src/lib/money.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(formatterJs, formatter, { timeout: 1000 });

for (const row of expressions) {
  function calculate(revenue, expenses) {
    return vm.runInNewContext(`${sanitizerJs}\n(${row.expression})`, {
      transportationRevenue: revenue, vehicleExpenses: expenses,
      executedTransportationRevenue: revenue, fee: revenue, tripExpenses: expenses,
      stats: { transportationRevenue: revenue, vehicleExpenses: expenses },
      tripExpenseOf: () => expenses, serviceOrderByExpense: new Map(), order: { id: 1 },
    }, { timeout: 1000 });
  }
  const location = `${row.name} at api.ts:${row.line}`;
  assert.equal(calculate(100000, 150000), -50000, `${location}: loss must not become zero`);
  assert.equal(calculate(150000, 100000), 50000, `${location}: original profit unchanged`);
  assert.equal(calculate(150000, 150000), 0, `${location}: break-even unchanged`);
  assert.equal(calculate(0, 150000), -150000, `${location}: costs without revenue remain loss`);
  assert.equal(formatter.exports.formatCurrency(calculate(11029.411764705883, 280000)), "-268,970.59 د.ع", `${location}: original fractional revenue/formatter`);
  assert.equal(formatter.exports.formatCurrency(calculate(999999999999.95, 1000000000000.97)), "-1.02 د.ع", `${location}: large original numeric DTO`);
  console.log(`PASS ${location}: actual signed loss/profit/zero and shared formatting`);
}
for (const value of [-100, "-100", NaN, Infinity, "invalid"]) {
  assert.equal(vm.runInNewContext(`${sanitizerJs}\nmoney(value)`, { value }, { timeout: 1000 }), 0, "global positive-only input contract remains unchanged");
}
assert.equal(vm.runInNewContext(`${sanitizerJs}\nmoney('100,000.25')`, {}, { timeout: 1000 }), 100000.25);
console.log("PASS original API money sanitizer is unchanged; no database or financial write executed.");
