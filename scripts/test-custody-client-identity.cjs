const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');

// Execute the real client event handlers, replacing only their network boundary.
// A changed/omitted custodyId must fail even when the product/source stay equal.
function tree(path) { return ts.createSourceFile(path, fs.readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); }
function namedFunction(source, name) {
  let found;
  function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node; ts.forEachChild(node, visit); }
  visit(source); assert.ok(found, `${name} handler exists`); return found.getText(source);
}
function compile(code, values) {
  const context = vm.createContext(values);
  vm.runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText, context);
  return context;
}
(async () => {
  const asset = { productId: 9, custodyId: 41, name: 'كاميرا' };
  const sent = [];
  const linked = compile(namedFunction(tree('src/views/admin/linked-assets-panel.tsx'), 'confirmReturn'), {
    returnFor: asset, problem: 'none', note: '', cost: '', managerApproval: false,
    entityType: 'photography', entityId: 7, setBusy() {}, setReturnFor() {}, flash() {},
    apiErrorMessage: e => e.message, load: async () => {}, adminFetch: async (_url, request) => sent.push(JSON.parse(request.body)),
  });
  await linked.confirmReturn();
  assert.equal(sent[0]?.custodyId, 41, 'admin return preserves the displayed original issue');

  const photographer = compile(namedFunction(tree('src/views/staff/photography/index.tsx'), 'confirmReturn'), {
    ret: { asset, problem: 'none', note: '', cost: '', approval: false }, setRet() {},
    op: async payload => { sent.push(payload); return true; },
  });
  await photographer.confirmReturn();
  assert.equal(sent[1]?.custodyId, 41, 'photographer order return preserves its issue snapshot');
  const workspace = tree('src/views/admin/booking-operations-workspace.tsx');
  let workspaceReturn;
  function findWorkspace(node) {
    if (ts.isCallExpression(node) && node.expression.getText(workspace) === 'mutation.mutate' && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) {
      const mode = node.arguments[0].properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(workspace) === 'mode');
      if (mode && ts.isStringLiteral(mode.initializer) && mode.initializer.text === 'return') workspaceReturn = node;
    }
    ts.forEachChild(node, findWorkspace);
  }
  findWorkspace(workspace); assert.ok(workspaceReturn);
  const workspaceHandler = compile(`function run() { ${workspaceReturn.getText(workspace)}; }`, {
    returning: { ...asset, quantity: 1 }, returnForm: { problem: 'none', description: '', estimatedCost: '', managerApproval: false }, mutation: { mutate: payload => sent.push(payload) },
  });
  workspaceHandler.run();
  assert.equal(sent.at(-1).custodyId, 41, 'booking workspace carries the original fixed/individual issue');
  const staffSource = tree('src/views/staff/booking-detail.tsx');
  let resolved;
  const scan = compile(namedFunction(staffSource, 'onDetect'), {
    busy: false, pending: null, mode: 'return', id: 7, source: 'kosha',
    setBusy() {}, setMsg() {}, setProblem() {}, setNote() {}, setCost() {}, setManagerApproval() {},
    setPending: value => { resolved = value; }, staffApi: { scanAsset: async () => ({ ...asset, checkedOut: true, assetCode: 'AJN-A000009' }) },
  });
  await scan.onDetect('AJN-A000009');
  assert.equal(resolved.custodyId, 41, 'staff scanner keeps the issue returned by server resolve');
  const crew = compile(namedFunction(staffSource, 'confirm'), {
    pending: resolved, mode: 'return', id: 7, source: 'kosha', problem: 'none', note: '', cost: '', managerApproval: false,
    setBusy() {}, setMsg() {}, setPending() {}, load: async () => {}, staffApi: { scanAsset: async (_id, payload) => sent.push(payload) },
  });
  await crew.confirm();
  assert.equal(sent.at(-1).custodyId, 41, 'Kosha staff scanner return sends the displayed original issue');

  const shoots = tree('src/views/staff/photography/shoots.tsx');
  const returns = [];
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(shoots) === 'operate' && ts.isObjectLiteralExpression(node.arguments[0])) {
      const mode = node.arguments[0].properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(shoots) === 'mode');
      if (mode && ts.isStringLiteral(mode.initializer) && mode.initializer.text === 'return') returns.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(shoots); assert.equal(returns.length, 2, 'shoot normal and damaged return handlers are exercised');
  for (const call of returns) {
    const context = compile(`async function run() { return ${call.getText(shoots)}; }`, { asset, note: 'تلف', operate: async payload => sent.push(payload) });
    await context.run();
    assert.equal(sent.at(-1).custodyId, 41, 'shoot returns retain the original issue identity');
  }
  console.log('PASS actual admin, photographer and field-shoot return handlers preserve original custody identity');
})().catch(cause => { console.error(cause); process.exitCode = 1; });
