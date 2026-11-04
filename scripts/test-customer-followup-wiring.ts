import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { normalizeRepeatedBookingDetails } from "../src/lib/booking-repeat";

const original = { customerFollowupId: 12, eventType: "حنة", customerId: 7, baseBookingAmount: 150000, departments: ["kosha"] };
const normalized = normalizeRepeatedBookingDetails(original);
assert.equal(normalized.ok, true);
if (!normalized.ok) throw new Error(normalized.message);
assert.equal(normalized.value.customerFollowupId, undefined, "a repeated booking cannot inherit a converted inquiry source");
assert.equal(normalized.value.eventType, original.eventType);
assert.equal(normalized.value.customerId, original.customerId);
assert.equal(normalized.value.baseBookingAmount, original.baseBookingAmount);
assert.equal(original.customerFollowupId, 12, "original metadata is preserved");

const source = readFileSync("src/server/api.ts", "utf8");
assert.match(source, /section === "customer-followups"/);
const ast = ts.createSourceFile("api.ts", source, ts.ScriptTarget.Latest, true);
const adminStart = source.indexOf("async function handleAdmin("), candidates: ts.ArrowFunction[] = [];
const walk = (node: ts.Node) => {
  if (node.getStart(ast) > adminStart && ts.isPropertyAssignment(node) && node.name.getText(ast) === "afterCreate" && ts.isArrowFunction(node.initializer) && node.initializer.getText(ast).includes("syncCentralBookingToPhotography")) candidates.push(node.initializer);
  ts.forEachChild(node, walk);
}; walk(ast);
assert.equal(candidates.length, 1, "only the existing admin booking callback is extended");
const callback = ts.transpileModule(`exports.run=${candidates[0].getText(ast)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
for (const contextKind of ["legacy", "followup", "conflict"]) {
  const calls: Array<{ kind: string; value: any }> = [], tx = { fixture: "original transaction" };
  const conflict = new Error("already converted");
  const sandbox = { exports: {} as any, customFields: contextKind === "legacy" ? {} : { customerFollowupId: 12 }, auth: { id: 4, fullName: "موظف", username: "staff" }, req: { headers: { get: () => null } }, photographySync: undefined, followupActor: (auth: any) => ({ id: auth.id }), CustomerFollowupError: Error,
    completeFollowupConversion: async (executor: unknown, data: unknown) => { assert.equal(executor, tx); calls.push({ kind: "conversion", value: data }); if (contextKind === "conflict") throw conflict; },
    syncCentralBookingToPhotography: async (_id: unknown, _actor: unknown, executor: unknown) => { assert.equal(executor, tx); calls.push({ kind: "photography", value: _id }); },
  };
  vm.runInNewContext(callback, sandbox);
  const booking = { id: 91, customerId: 7 };
  if (contextKind === "conflict") await assert.rejects(() => sandbox.exports.run(tx, booking), error => error === conflict);
  else await sandbox.exports.run(tx, booking);
  assert.deepEqual(calls.map(call => call.kind), contextKind === "legacy" ? ["photography"] : contextKind === "conflict" ? ["conversion"] : ["conversion", "photography"]);
  if (contextKind !== "legacy") assert.deepEqual(JSON.parse(JSON.stringify(calls[0].value)), { actor: { id: 4 }, followupId: 12, customerId: 7, booking: { source: "service", id: 91 } });
}
for (const [file, expected] of [
  ["src/views/admin/index.tsx", "/admin/customer-followups"],
  ["src/views/admin/_layout.tsx", "مركز المتابعة"],
  ["src/views/staff/unified-portal.tsx", "followups"],
  ["src/views/admin/booking-center.tsx", "followupBookingMetadata"],
] as const) assert.ok(readFileSync(file, "utf8").includes(expected), file);
console.log("PASS actual customer followup wiring: original admin transaction callback, exact canonical identity/source, conflict propagation before photography, legacy no-source behavior and repeat provenance isolation");
