import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync("src/server/api.ts", "utf8"), ast = ts.createSourceFile("api.ts", source, ts.ScriptTarget.Latest, true);
const handle = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "handleApi") as ts.FunctionDeclaration;
const prefix = handle.body!.statements.filter(ts.isVariableStatement).map(node => node.getText(ast)).join("\n");
const attempt = handle.body!.statements.find(ts.isTryStatement)!;
const bootstrap = attempt.tryBlock.statements.find(node => ts.isExpressionStatement(node) && ts.isAwaitExpression(node.expression) && node.expression.expression.getText(ast).startsWith("Promise.all("))!;
assert.ok(bootstrap);
const js = ts.transpileModule(`exports.run=async(req,rawParts)=>{${prefix}\n${bootstrap.getText(ast)}}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
for (const method of ["GET", "POST"]) {
  for (const path of [["admin", "customer-followups"], ["admin", "customer-followups", "summary"], ["admin", "customer-followups", "17", "actions"], ["admin", "service-orders"]]) {
    const calls: string[] = [], sandbox: any = { exports: {} };
    for (const name of new Set(bootstrap.getText(ast).match(/\bensure\w+/g))) sandbox[name] = async () => { calls.push(name); };
    vm.runInNewContext(js, sandbox);
    await sandbox.exports.run({ method, headers: { get: () => null } }, path);
    if (path[1] === "customer-followups") assert.deepEqual(calls, [], "followup-only persistence must not run customer, payment, cashbox, staff or product bootstrap");
    else assert.ok(calls.includes("ensurePaymentWorkflowColumns"), "ordinary original service-order behavior is untouched");
  }
}
assert.match(handle.getText(ast), /if \(!isAdminAuth && !isHealthCheck\) await assertCurrentSchema\(\)/, "core schema validation remains enforced");
const admin = source.slice(source.indexOf("async function handleAdmin("));
assert.match(admin, /section === "customer-followups"[\s\S]{0,100}getAdminUser\(req\)/, "feature routes retain original active-session authentication");
console.log("PASS actual API bootstrap predicates: followup GET/actions never trigger unrelated financial/customer/schema backfills; ordinary bookings, schema revision and authentication remain intact");
