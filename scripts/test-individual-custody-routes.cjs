const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { sql } = require('drizzle-orm');
const { PgDialect } = require('drizzle-orm/pg-core');

// Exercise the actual route and transaction adapter without importing the
// application/database singleton. Only external database IO is controlled.
const source = ts.createSourceFile('api.ts', fs.readFileSync('src/server/api.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const names = ['handleEnterpriseAdmin', 'handleIndividualCustodyAdmin', 'runIndividualCustody', 'logCustodyAudit', 'individualCustodyErrorResponse'];
const declarations = source.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text));
const javascript = ts.transpileModule(declarations.map(n => n.getText(source)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const dialect = new PgDialect();
const safetyContext = { exports: {}, console };
vm.createContext(safetyContext);
vm.runInContext(ts.transpileModule(fs.readFileSync('src/server/write-safety.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, safetyContext);
class IndividualCustodyError extends Error {
  constructor(message, status = 422, code = 'CUSTODY_INVALID') { super(message); this.status = status; this.code = code; }
}
const auth = { id: 4, username: 'operator', fullName: 'موظف', isActive: true, role: 'staff', permissions: [] };
const product = { id: 10, name: 'Stand', nameAr: 'ستاند', costPrice: '25000', isActive: true };
const staff = { id: 8, fullName: 'أحمد', username: 'ahmed', isActive: true };
const row = { id: 12, productId: 10, staffId: 8, quantity: 1, status: 'issued', notes: null };
let payload, input, events, state, returned, changed, failAudit, failEngine, engineCalls;
const globalQuery = {
  productsTable: { findFirst: async () => product },
  staffTable: { findFirst: async () => staff },
  assetProfilesTable: { findFirst: async () => ({ status: 'active' }) },
  equipmentCustodyTable: { findFirst: async () => returned ? { ...row, status: 'returned' } : row },
};
const tx = {
  execute: async statement => {
    const query = dialect.sqlToQuery(statement);
    assert.match(query.sql, /insert into employee_custody_audit/);
    events.push('audit');
    if (failAudit) throw new Error('audit unavailable');
    state.auditDraft++;
    return { rows: [] };
  },
};
const db = {
  query: globalQuery,
  transaction: async work => {
    events.push('begin');
    state.draft = 0; state.auditDraft = 0;
    try {
      const result = await work(tx);
      state.committed += state.draft; state.audits += state.auditDraft;
      events.push('commit');
      return result;
    } catch (cause) { events.push('rollback'); throw cause; }
  },
  insert: () => ({ values: () => ({ returning: async () => { events.push('unsafe-global-write'); return [row]; } }) }),
  update: () => ({ set: () => ({ where: () => ({ returning: async () => [row] }) }) }),
  execute: async () => { events.push('unsafe-global-audit'); return { rows: [] }; },
};
const context = {
  db, sql, IndividualCustodyError,
  productsTable: { id: 'id' }, staffTable: { id: 'id' }, equipmentCustodyTable: { id: 'id' },
  assetProfilesTable: { productId: 'productId', id: 'id' }, assetPassportsTable: { productId: 'productId' },
  eq: (...args) => args, int: value => Number(value), nullableText: value => value == null ? null : String(value).trim() || null,
  optionalPositiveId: value => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null,
  hasPermission: (user, permission) => user.isActive && (user.role === 'admin' || user.permissions.includes(permission)),
  requireAnyPermission: async () => auth, isResponse: () => false,
  ensureEnterprisePhase5Tables: async () => { events.push('preflight'); },
  ensureAdminExtensionsTables: async () => { events.push('preflight'); },
  ensureCustodyGroupTables: async () => { events.push('preflight'); },
  body: async () => payload,
  persistMediaValue: async () => { events.push('media'); return '/signature.png'; },
  quantityProfilesFor: async executor => { assert.ok(executor === db || executor === tx); return new Map(); },
  executeIndividualCustody: async (executor, request, deps) => {
    assert.equal(executor, tx, 'custody executor must receive the transaction, never global db');
    events.push('engine'); engineCalls++; input = request;
    assert.equal(await deps.isQuantityTracked(tx, 10), false);
    if (failEngine) throw failEngine instanceof Error ? failEngine : new IndividualCustodyError('القطعة بعهدة أخرى', 409, 'CUSTODY_CONFLICT');
    if (changed) {
      state.draft++;
      await deps.audit(tx, { productId: 10, staffId: 8, action: 'checkout', previous: {}, next: { custodyId: 12 }, source: request.source, custodyId: 12 });
    }
    return { row: returned ? { ...row, status: 'returned' } : row, product: { id: 10, name: 'ستاند', costPrice: '25000' }, staffName: 'أحمد', changed, problem: 'none', repairCost: 0 };
  },
  assetChecklistFor: () => [{ label: 'فحص' }], erpActorFromAdmin: user => user,
  recordEnterpriseMutation: async () => { events.push('event'); },
  addEntityTimeline: async () => { events.push('timeline'); },
  createNotification: async () => { events.push('notification'); },
  makeRequestId: () => 'request-test',
  createApiErrorPayload: safetyContext.exports.createApiErrorPayload,
  json: (data, status = 200, headers) => ({ data, status, headers }),
  error: (message, status) => ({ data: { message }, status }),
  console: { warn() {}, error() {} },
};
vm.createContext(context); vm.runInContext(javascript, context);
function reset() {
  payload = { productId: 10, staffId: 8, quantity: 1, checklistConfirmed: true };
  events = []; state = { committed: 0, audits: 0 }; input = null;
  returned = false; changed = true; failAudit = false; failEngine = false; engineCalls = 0;
}
function request(method) { return { method, headers: new Headers(), nextUrl: { pathname: '/api/admin/enterprise/custody' } }; }
(async () => {
  reset(); failEngine = true;
  await assert.rejects(() => context.handleEnterpriseAdmin(request('POST'), ['custody']), cause => cause.status === 409,
    'a conflicting checkout must reach the locked custody executor, not write a second custody');
  assert.equal(state.committed, 0); assert.equal(state.audits, 0);
  assert.ok(!events.includes('event') && !events.includes('notification'));

  reset(); payload.signature = 'image';
  const issue = await context.handleEnterpriseAdmin(request('POST'), ['custody']);
  assert.equal(issue.status, 201); assert.equal(issue.data.id, 12);
  assert.equal(input.source.kind, 'standalone'); assert.equal(input.staffId, 8);
  assert.equal(input.signatureUrl, '/signature.png'); assert.equal(input.checklist.confirmed, true);
  assert.equal(state.committed, 1); assert.equal(state.audits, 1);
  assert.ok(events.indexOf('media') < events.indexOf('begin'));
  assert.ok(events.indexOf('audit') < events.indexOf('commit'));
  assert.ok(events.indexOf('commit') < events.indexOf('event'));
  assert.ok(!events.includes('unsafe-global-write') && !events.includes('unsafe-global-audit'));

  reset(); returned = true; changed = false;
  const replay = await context.handleEnterpriseAdmin(request('PATCH'), ['custody', '12']);
  assert.equal(replay.status, 200); assert.equal(replay.data.status, 'returned');
  assert.equal(engineCalls, 1, 'closed-ID replay must still validate its source and use the product lock');
  assert.equal(input.custodyId, 12); assert.equal(state.committed, 0);
  assert.ok(!events.includes('event') && !events.includes('timeline'));

  reset(); failAudit = true;
  await assert.rejects(() => context.handleEnterpriseAdmin(request('POST'), ['custody']), /audit unavailable/);
  assert.equal(state.committed, 0); assert.equal(state.audits, 0);
  assert.ok(events.includes('rollback')); assert.ok(!events.includes('notification'));

  reset();
  await context.runIndividualCustody(auth, { mode: 'return', productId: 10, actorId: 999, source: { kind: 'standalone' }, canRecordDamage: true, canApproveLoss: true });
  assert.equal(input.actorId, 4, 'actor identity comes from the authenticated session');
  assert.equal(input.canRecordDamage, false); assert.equal(input.canApproveLoss, false);
  assert.ok(events.lastIndexOf('preflight') < events.indexOf('begin'), 'global schema preflights must not run inside the pool transaction');

  reset(); failEngine = new IndividualCustodyError('فحص المعدات مطلوب', 422, 'CUSTODY_CHECKLIST_REQUIRED');
  const checklist = await context.handleEnterpriseAdmin(request('POST'), ['custody']);
  assert.equal(checklist.status, 422); assert.equal(checklist.data.success, false);
  assert.equal(checklist.data.code, 'VALIDATION_ERROR'); assert.equal(checklist.data.requiresChecklist, true);
  assert.equal(checklist.data.checklist.length, 1); assert.equal(checklist.data.requestId, checklist.headers['x-request-id']);
  assert.equal(state.committed, 0); assert.ok(!events.includes('notification'));

  const denied = context.individualCustodyErrorResponse(request('POST'), new IndividualCustodyError('لا تملك الصلاحية', 403));
  assert.equal(denied.status, 403); assert.equal(denied.data.code, 'PERMISSION_DENIED');
  const locked = context.individualCustodyErrorResponse(request('POST'), new IndividualCustodyError('موقوف', 423));
  assert.equal(locked.status, 423); assert.equal(locked.data.code, 'CONFLICT');
  console.log('PASS actual individual custody admin route: transaction, atomic audit, source-aware replay, server capabilities, rollback and post-commit effects');
})().catch(cause => { console.error(cause); process.exitCode = 1; });
