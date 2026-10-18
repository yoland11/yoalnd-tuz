const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const source = ts.createSourceFile('api.ts', fs.readFileSync('src/server/api.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const found = {};
function visit(node) {
  if (ts.isIfStatement(node) && node.expression.getText(source) === 'section === "asset-links"') found.admin = node;
  if (ts.isIfStatement(node) && node.expression.getText(source) === 'action === "assets"' && node.getText(source).includes('const entityType = "photography"')) found.photo = node;
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'shootEquipmentPayload') found.shoot = node;
  ts.forEachChild(node, visit);
}
visit(source);
const cases = [
  { kind: 'admin', note: 'إخراج · service #7' },
  { kind: 'photo', note: 'إخراج · photography #7' },
  { kind: 'shoot', note: 'إخراج · تصوير ميداني #7' },
];
async function read(test, custody) {
  assert.ok(found[test.kind]);
  const fixtures = {
    productsTable: [{ id: 9, name: 'Camera', nameAr: 'كاميرا', images: [] }],
    assetPassportsTable: [], assetProfilesTable: [], warehousesTable: [], equipmentCustodyTable: custody,
  };
  const context = {
    exports: {}, section: 'asset-links', action: 'assets', method: 'GET', order: { id: 7 },
    auth: { id: 1, role: 'admin', isActive: true, permissions: [] },
    requireAnyPermission: async () => ({ id: 1 }), isResponse: () => false,
    ensureAssetLinksTable: async () => {}, photographyStaffName: () => 'موظف', int: Number,
    sql: (chunks, ...values) => chunks.reduce((text, part, index) => text + part + String(values[index] ?? ''), ''),
    db: {
      execute: async () => ({ rows: [{ id: 5, product_id: 9 }] }),
      query: Object.fromEntries(Object.entries(fixtures).map(([name, values]) => [name, { findMany: async () => values }])),
    },
    ...Object.fromEntries(Object.keys(fixtures).map(name => [name, { id: 'id', productId: 'productId', status: 'status' }])),
    eq: (...args) => args, and: (...args) => args, inArray: (...args) => args,
    publicMediaList: () => [], assetHealthScore: () => 100, assetMetadataObject: value => value ?? {},
    json: value => value, error: (message, status) => { throw new Error(`${status}: ${message}`); },
  };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(fs.readFileSync('src/server/custody-source-safety.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  const text = test.kind === 'shoot' ? found.shoot.getText(source) : `async function run(req) { ${found[test.kind].getText(source)} }`;
  vm.runInContext(ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const result = test.kind === 'shoot' ? await context.shootEquipmentPayload(7) : await context.run({ nextUrl: { searchParams: new URLSearchParams({ entityType: 'service', entityId: '7' }) } });
  return test.kind === 'shoot' ? result[0] : result.assets[0];
}
(async () => {
  for (const test of cases) {
    const original = { id: 41, productId: 9, status: 'issued', staffId: 2, notes: test.note };
    assert.equal((await read(test, [original])).custodyId, 41, `${test.kind} read DTO exposes the original issue from its own source`);
    assert.equal((await read(test, [{ ...original, notes: 'إخراج · other #8' }])).custodyId, null, 'foreign issue ID is not exposed');
    assert.equal((await read(test, [original, { ...original, id: 42 }])).custodyId, null, 'ambiguous duplicate issues require review');
    assert.equal((await read(test, [])).custodyId, null, 'unissued asset has no invented issue identity');
  }
  console.log('PASS actual linked admin, photography order and shoot read DTOs expose only a unique source-owned custody ID');
})().catch(cause => { console.error(cause); process.exitCode = 1; });
