const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const { randomUUID } = require("node:crypto");

// Execute the actual movement form's mutation callbacks, not a second builder.
const source = ts.createSourceFile("operations.tsx", fs.readFileSync("src/views/admin/operations.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let action, request;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "action" && node.initializer?.getText(source).includes('"/admin/assets/action"')) action = node;
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "assetActionRequest") request = node;
  ts.forEachChild(node, visit);
}
visit(source); assert.ok(action);
const javascript = ts.transpileModule(`function setup() {
  let selectedId=10, notes='Fixed stand', cost='20';
  function setNotes(value) { notes=value; } function setCost(value) { cost=value; }
  ${request ? `const ${request.getText(source)};` : ""}
  const ${action.getText(source)};
  return { options:action, getDraft() { return { notes, cost, productId:selectedId }; }, setDraft(input) { if(input.productId!==undefined)selectedId=input.productId; if(input.notes!==undefined)notes=input.notes; if(input.cost!==undefined)cost=input.cost; } };
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
let fail = true;
const calls = [];
const context = {
  crypto: { randomUUID }, useRef: value => ({ current: value }), useMutation: options => options,
  adminFetch: async (url, input) => {
    assert.equal(url, "/admin/assets/action"); calls.push(JSON.parse(input.body));
    if (fail) throw new Error("connection interrupted after submission");
    return { ok: true, status: "active" };
  }, refresh() {}, toast() {}, apiErrorMessage: e => e.message, MOVEMENT_LABELS: {},
};
vm.createContext(context); vm.runInContext(javascript, context);
(async () => {
  const form = context.setup();
  await assert.rejects(() => form.options.mutationFn("repair"), /connection interrupted/);
  assert.equal(typeof calls[0].requestId, "string", "a repair submission must carry a durable request identity");
  assert.ok(calls[0].requestId.length >= 8);
  fail = false;
  const result = await form.options.mutationFn("repair");
  assert.equal(calls[1].requestId, calls[0].requestId, "an unchanged failed draft retries the same operation");
  form.options.onSuccess(result, "repair");
  form.setDraft({ notes: "Fixed stand", cost: "20" });
  await form.options.mutationFn("repair");
  assert.notEqual(calls[2].requestId, calls[0].requestId, "a new repair after success has a fresh identity");
  form.setDraft({ cost: "30" }); await form.options.mutationFn("repair");
  assert.notEqual(calls[3].requestId, calls[2].requestId, "edited repair terms do not reuse a prior key");
  form.setDraft({ productId: 20 }); await form.options.mutationFn("repair");
  assert.notEqual(calls[4].requestId, calls[3].requestId, "another equipment record is a different intent");
  const edited = context.setup();
  const earlier = edited.options.mutationFn("repair");
  edited.setDraft({ notes: "Different repair draft", cost: "50", productId: 20 });
  edited.options.onSuccess(await earlier, "repair");
  assert.equal(edited.getDraft().notes, "Different repair draft", "late success cannot clear a newer equipment draft");
  assert.equal(edited.getDraft().cost, "50");
  console.log("PASS actual movement form callbacks preserve failed repair identity and reset changed/successful intent");
})().catch(cause => { console.error(cause); process.exitCode = 1; });
