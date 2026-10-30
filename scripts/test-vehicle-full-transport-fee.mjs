import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const compile = (code, jsx = false) => ts.transpileModule(code, { fileName: jsx ? "fixture.tsx" : "fixture.ts", compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const apiText = read("src/server/api.ts");
const api = ts.createSourceFile("api.ts", apiText, ts.ScriptTarget.Latest, true);
const start = apiText.indexOf('if (section === "vehicles" && parts[1] && parts[2] === "financial"');
const end = apiText.indexOf('if (section === "vehicles" && parts[1] && parts[2] === "expenses"', start);
assert.ok(start > 0 && end > start);
const within = node => node.getStart(api) > start && node.getStart(api) < end;
const found = [];
function walk(node) { found.push(node); ts.forEachChild(node, walk); }
walk(api);
const variable = name => {
  const node = found.find(node => within(node) && ts.isVariableDeclaration(node) && node.name.getText(api) === name);
  assert.ok(node?.initializer, `actual vehicle variable ${name}`);
  return node.initializer.getText(api);
};
const money = found.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "money");
const serviceLoop = found.find(node => within(node) && ts.isForOfStatement(node) && node.expression.getText(api) === "serviceTripRows");
const summary = found.find(node => within(node) && ts.isPropertyAssignment(node) && node.name.getText(api) === "summary");
assert.ok(money && serviceLoop && summary);
const legacy = { exports: {} }, formatter = { exports: {} };
vm.runInNewContext(compile(read("src/lib/booking-transport.ts")), legacy);
vm.runInNewContext(compile(read("src/lib/money.ts")), formatter);
const formatMoney = formatter.exports.formatMoney;
const mapper = compile(`${money.getText(api)}
const tripExpenseOf=${variable("tripExpenseOf")};
const trips=${variable("trips")};
${serviceLoop.getText(api)}
const unallocatedBookings=${variable("unallocatedBookings")};
const allocatedTransportationRevenue=${variable("allocatedTransportationRevenue")};
const transportationRevenue=${variable("transportationRevenue")};
const vehicleExpenses=${variable("vehicleExpenses")};
exports.result={trips,summary:${summary.initializer.getText(api)}};`);

function project(source, paid, total = 195000, fee = 15000, cost = 5000) {
  const booking = { id: 101, totalAmount: String(total), paidAmount: String(paid), transportationFee: String(fee), trackingCode: "QA-K", customerName: "عميل فحص", paymentStatus: "partial" };
  const order = { id: 202, total_amount: String(total), deposit_amount: String(paid), transportation: { fee: String(fee) }, tracking_code: "QA-S", customer_name: "عميل فحص", payment_status: "partial" };
  const before = JSON.stringify({ booking, order });
  const context = {
    exports: {}, bookingRows: source !== "service" ? [booking] : [], serviceTripRows: source !== "kosha" ? [order] : [],
    driverById: new Map(), reversedByTransaction: new Map(), categories: {},
    expenseRows: [{ id: 7, bookingId: source === "kosha" ? 101 : null, amount: String(cost), financialTransactionId: 11, status: "executed" }],
    serviceOrderByExpense: new Map(source !== "kosha" ? [[7, 202]] : []), expenses: [{ effectiveAmount: cost }],
    executedTransportRevenue: legacy.exports.executedTransportRevenue,
  };
  vm.runInNewContext(mapper, context, { timeout: 1000 });
  assert.equal(JSON.stringify({ booking, order }), before, "original booking values are never mutated");
  return context.exports.result;
}
for (const source of ["kosha", "service"]) {
  for (const paid of [150000, 0, 50000, 195000]) {
    const { trips, summary } = project(source, paid);
    assert.equal(summary.transportationRevenue, 15000, `${source}: full saved fee independent of booking collections`);
    assert.equal(summary.tripCount, 1, `${source}: recorded trip exists even before collection`);
    assert.equal(trips[0].transportationFee, 15000);
    assert.equal(trips[0].tripProfit, 10000, "cost affects profit, never the gross fee");
    assert.equal(summary.netProfit, 10000);
    assert.equal(formatMoney(trips[0].executedTransportationRevenue), formatMoney(legacy.exports.executedTransportRevenue(15000, paid, 195000)), "legacy collection attribution retains its original value");
  }
  assert.equal(project(source, 0, 0).summary.transportationRevenue, 15000, "recorded fee is not a share of the booking total");
  assert.equal(project(source, 150000, 195000, 15000, 20000).summary.netProfit, -5000, "loss remains signed");
  assert.equal(project(source, 150000, 195000, 15000.25).summary.transportationRevenue, 15000.25, "saved decimal fee unchanged");
  assert.equal(project(source, 150000, 195000, 0).summary.transportationRevenue, 0, "zero fee is not invented");
  assert.equal(project(source, 150000, 195000, -1).summary.transportationRevenue, 0, "invalid negative fee keeps the original input guard");
}
const mixed = project("both", 150000);
assert.equal(mixed.summary.transportationRevenue, 30000, "two distinct source trips contribute their full fees once each");
assert.equal(mixed.summary.tripCount, 2);
assert.equal(mixed.summary.vehicleExpenses, 5000, "vehicle cost is not duplicated across source types");

const stats = found.find(node => ts.isVariableDeclaration(node) && node.name.getText(api) === "statsResult" && node.initializer?.getText(api).includes("as service_transportation_revenue"));
assert.ok(stats && ts.isAwaitExpression(stats.initializer));
const query = vm.runInNewContext(stats.initializer.expression.arguments[0].getText(api), { sql }, { timeout: 1000 });
const statement = new PgDialect().sqlToQuery(query).sql;
assert.doesNotMatch(statement, /paid_amount|deposit_amount|total_amount|least\s*\(/i, "fleet gross fee is independent of booking collection ratio");
assert.match(statement, /k\.transportation_fee::numeric/);
assert.match(statement, /->>'fee'/);
assert.match(statement, /k\.transportation_vehicle_id=v\.id/);
assert.match(statement, /k\.transportation_mode='ajn'/);
assert.match(statement, /k\.archived_at is null and k\.status <> 'cancelled'/);
assert.match(statement, /->>'vehicleId'=v\.id::text/);
assert.match(statement, /->>'mode'='ajn'/);
assert.match(statement, /s\.archived_at is null and s\.status not in \('cancelled','canceled'\)/);
assert.match(apiText.slice(start, end), /eq\(koshaBookingsTable.transportationMode, "ajn"\)/);

function renderFragment(fragment, context, jsx = true) {
  const target = { exports: {}, require, formatCurrency: formatter.exports.formatCurrency,
    Card: props => createElement("section", null, props.children), Link: props => createElement("a", { href: props.href }, props.children), ...context };
  vm.runInNewContext(compile(fragment, jsx), target, { timeout: 1000 });
  return renderToStaticMarkup(createElement(target.exports.Render));
}
const vehicleText = read("src/views/admin/vehicles.tsx"), vehicleAst = ts.createSourceFile("vehicles.tsx", vehicleText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const tripsNode = vehicleAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "VehicleTrips");
assert.ok(tripsNode);
const trip = project("service", 150000).trips[0];
const vehicleHtml = renderFragment(`${tripsNode.getText(vehicleAst)}; exports.Render=()=> <VehicleTrips rows={rows}/>;`, { rows: [trip], transportMoney: value => value == null ? "غير موزّع" : formatter.exports.formatCurrency(value), TransportReceiptAction: () => null });
assert.ok(vehicleHtml.includes("15,000"));
assert.ok(!vehicleHtml.includes("11,538.46"), "vehicle trip table must not present collection share as income");
assert.ok(!vehicleHtml.includes(">المنفذ<"));
assert.equal((vehicleHtml.match(/<th\b/g) ?? []).length, 7);
assert.ok(renderFragment(`${tripsNode.getText(vehicleAst)}; exports.Render=()=> <VehicleTrips rows={rows}/>;`, { rows: [], transportMoney: value => value == null ? "غير موزّع" : formatter.exports.formatCurrency(value), TransportReceiptAction: () => null }).includes('colSpan="7"'));

const enterpriseText = read("src/views/admin/enterprise.tsx"), enterpriseAst = ts.createSourceFile("enterprise.tsx", enterpriseText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = enterpriseAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "VehicleProfitabilityTab");
assert.ok(component);
let table, metric;
function uiWalk(node) {
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(enterpriseAst) === "table" && node.getText(enterpriseAst).includes("data.trips")) table = node;
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(enterpriseAst) === "Metric" &&
      node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(enterpriseAst) === "value" && attribute.initializer?.getText(enterpriseAst) === "{transportMoney(data.summary.transportationRevenue)}")) metric = node;
  ts.forEachChild(node, uiWalk);
}
uiWalk(component);
assert.ok(table && metric);
const commandHtml = renderFragment(`exports.Render=()=> <>${metric.getText(enterpriseAst)}${table.getText(enterpriseAst)}</>;`, {
  data: project("service", 150000), Route: () => null,
  transportMoney: value => value == null ? "غير موزّع" : formatter.exports.formatCurrency(value), TransportReceiptAction: () => null,
  Metric: props => createElement("div", null, props.label, props.value),
});
assert.ok(commandHtml.includes("15,000"));
assert.ok(!commandHtml.includes("11,538.46"), "command center must not present collection share as income");
assert.ok(commandHtml.includes("إجمالي أجور النقل المسجلة"));
assert.ok(!commandHtml.includes(">المنفذ<"));
assert.equal((commandHtml.match(/<th\b/g) ?? []).length, 8);
console.log("PASS full saved vehicle fees: actual two-source mapper/summary, original cash compatibility, signed profit, fleet SQL scope and original vehicle/command-center JSX.");
