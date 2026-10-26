import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {sql} from "drizzle-orm";
import {PgDialect} from "drizzle-orm/pg-core";
import {PARTNERSHIP_POSTING_TYPES,resolvePartnershipFinancialEffect,partnershipCashPredicate,partnershipOperatingPredicate,partnershipIncomePredicate} from "../src/server/vehicle-partnership/financial-classification";
const source=readFileSync("src/server/master-cash-box.ts","utf8"),tree=ts.createSourceFile("finance.ts",source,ts.ScriptTarget.Latest,true);
const names=["isBalanceSheetTransfer","cashMovementPresentation","balanceSheetTransferSql","cashImpactSql"];
const nodes=names.map(name=>tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name));
assert.ok(nodes.every(Boolean),"every aggregate must have an explicit cash predicate independent of operating classification");
const table=Object.fromEntries(["sourceType","transactionType"].map(key=>[key,sql.raw(`f.${key}`)]));
const code=ts.transpileModule(nodes.map(n=>n!.getText(tree)).join("\n")+"\n({isBalanceSheetTransfer,cashMovementPresentation,balanceSheetTransferSql,cashImpactSql})",{compilerOptions:{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022}}).outputText;
const api=vm.runInNewContext(code,{sql,financialTransactionsTable:table,resolvePartnershipFinancialEffect,partnershipCashPredicate,partnershipOperatingPredicate});
for(const [type,rule] of Object.entries(PARTNERSHIP_POSTING_TYPES)){
 for(const reversal of [false,true]){
  const row={sourceType:rule.sourceType,transactionType:reversal?`${type}_reversal`:type,sourceEvent:reversal?"reversal":rule.sourceEvent,direction:reversal?(rule.direction==="revenue"?"expense":"revenue"):rule.direction,reversedTransactionId:reversal?22:null};
  const effect=resolvePartnershipFinancialEffect(row)!;const display=api.cashMovementPresentation(row);
  assert.equal(api.isBalanceSheetTransfer(row),effect.operating==="none");
  assert.equal(display.cashDirection,effect.cash==="none"?"noncash":effect.cash==="in"?"inflow":"outflow");
  if(effect.cash==="none")assert.equal(display.cashDirectionLabel,"غير نقدي");
 }
}
assert.equal(api.cashMovementPresentation({sourceType:"sales_invoice",transactionType:"payment",direction:"revenue"}).cashDirection,"inflow");
assert.equal(api.isBalanceSheetTransfer({sourceType:"company_loan",transactionType:"company_loan_received"}),true);
const dialect=new PgDialect();assert.ok(dialect.sqlToQuery(api.cashImpactSql()).params.includes("vehicle_partnership_settlement"));
assert.ok(dialect.sqlToQuery(api.balanceSheetTransferSql()).params.includes("vp_partner_operating_advance"));
const trendQueries:ts.TaggedTemplateExpression[]=[];
function findTrend(node:ts.Node){if(ts.isTaggedTemplateExpression(node)&&node.tag.getText(tree)==="sql"&&node.template.getText(tree).includes("SELECT to_char(transaction_date"))trendQueries.push(node);ts.forEachChild(node,findTrend);}
findTrend(tree);assert.equal(trendQueries.length,1,"inspect the actual dashboard monthly trend query");
const trendCode=ts.transpileModule(`const trend=${trendQueries[0].getText(tree)};trend;`,{compilerOptions:{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022}}).outputText;
const trendQuery=dialect.sqlToQuery(vm.runInNewContext(trendCode,{sql,today:"2026-10-25",balanceSheetTransferSql:api.balanceSheetTransferSql}));
assert.ok(trendQuery.params.includes("vp_partner_operating_advance"),"monthly trend must use the shared operating classifier: noncash attribution/capital/internal entitlement are not company operating revenue/expense");
assert.equal((source.match(/cashNet: sql<number>`/g)||[]).length,2);
for(const match of source.matchAll(/cashNet: sql<number>`([^`]+)`/g))assert.ok(match[1].includes("cashImpactSql()"),"reversal/recalculation cash totals exclude noncash sources");
assert.ok(readFileSync("src/server/daily-cash.ts","utf8").includes("partnershipOperatingPredicate("));
// Revenue-only readers must not treat a reversal of an operating cost as sales.
for(const [file,needle,count] of [
 ["src/server/event-brain.ts","FROM financial_transactions WHERE approval_status",1],
 ["src/server/employee-performance.ts","financial_transactions",2],
 ["src/server/hr-intelligence.ts","as today from financial_transactions",1],
 ["src/server/api.ts","AS total_paid",1],
] as const){
 const content=readFileSync(file,"utf8"),ast=ts.createSourceFile(file,content,ts.ScriptTarget.Latest,true),queries:ts.TaggedTemplateExpression[]=[];
 const walk=(node:ts.Node)=>{if(ts.isTaggedTemplateExpression(node)&&node.tag.getText(ast)==="sql"&&node.template.getText(ast).includes(needle)&&node.template.getText(ast).includes("partnershipIncomePredicate("))queries.push(node);ts.forEachChild(node,walk);};walk(ast);
 assert.equal(queries.length,count,`${file}: each actual income query needs income-only classification, including cost reversals`);
 for(const query of queries){
  const js=ts.transpileModule(`${query.getText(ast)};`,{compilerOptions:{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022}}).outputText;
  const actual=dialect.sqlToQuery(vm.runInNewContext(js,{sql,partnershipIncomePredicate,period:"2026-10",from:"2026-10-01",to:"2026-10-31",trunc:"month",back:"12 months",staffFilter:sql``}));
  assert.ok(actual.params.includes("vehicle_partnership_")&&actual.params.includes("vp_"),`${file}: exact feature namespaces excluded by actual generated SQL`);
  assert.ok(!actual.params.includes("vp_driver_accrual_reversal"),"income-only guard must not allow cost reversals as sales");
 }
}
const health=readFileSync("src/server/integration-health.ts","utf8"),healthTree=ts.createSourceFile("health.ts",health,ts.ScriptTarget.Latest,true);
const drift=healthTree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==="computeCashboxDrift");
assert.ok(drift?.getText(healthTree).includes("partnershipCashPredicate("),"cash reconciliation excludes noncash memos, including noncash operating costs");
const dashboard=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==="getMasterCashDashboard")!;
let revenueAggregates=0;
const checkNet=(node:ts.Node)=>{if(ts.isPropertyAssignment(node)&&node.name.getText(tree)==="revenue"&&ts.isTaggedTemplateExpression(node.initializer)){
 revenueAggregates++;const actual=node.initializer.getText(tree);
 assert.ok(actual.includes("not like '%_reversal'")&&actual.includes("then -"),"every dashboard operating revenue aggregate nets reversals instead of treating cost reversal as income");
}ts.forEachChild(node,checkNet);};checkNet(dashboard);assert.equal(revenueAggregates,3);
assert.match(readFileSync("src/server/api.ts","utf8"),/row\.direction === "revenue" && \(resolvePartnershipFinancialEffect\(row\)\?\.cash \?\? "in"\) === "in"/,"noncash attribution must not send a fake customer payment notification");
console.log("PASS shared financial presentation/aggregate contracts: noncash separate from P&L, payouts/capital not expenses/revenue, cash rebuild/reversal predicates, daily/command-center classification and payment-notification guard.");
