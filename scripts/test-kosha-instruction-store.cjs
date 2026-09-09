const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const schema = require(path.resolve('lib/db/src/schema/index.ts'));
const { drizzle } = require('drizzle-orm/node-postgres');
const queries = [];
let databaseFailure = false;
const client = { async query(query, params) {
  if (databaseFailure) throw new Error('offline');
  const sql = typeof query === 'string' ? query : query.text;
  queries.push({ sql, params });
  if (/insert into "kosha_instruction_booking_versions"/i.test(sql))
    return { rows: [[7]], rowCount: 1 };
  if (/insert into "kosha_booking_channel_reads"/i.test(sql))
    return { rows: [[1, new Date('2026-09-06T09:59:00Z'), 6]], rowCount: 1 };
  return { rows: [], rowCount: 0 };
} };
const db = drizzle(client);
const filename = 'src/server/kosha-instruction-store.ts';
const output = { exports: {} };
if (fs.existsSync(filename)) {
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module: output, exports: output.exports, Date, Map, JSON,
    require: name => name === '@workspace/db' ? { db, ...schema } : name === './kosha-instructions' ? require(path.resolve('src/server/kosha-instructions.ts')) : require(name),
  }, { filename });
}
assert.equal(typeof output.exports.createKoshaInstructionStore, 'function', 'Store must emit scoped instruction/read queries');
assert.equal(typeof output.exports.mergeRoutedKoshaCustomFields, 'function', 'Routed execution writers must share an atomic merge contract');
assert.equal(typeof output.exports.routedKoshaCustomFieldsSql, 'function', 'Routed execution writers must emit atomic JSONB updates');
const store = output.exports.createKoshaInstructionStore(db);
const scope = { id: 42, source: 'service', assignedStaff: [{ id: 2, name: 'Crew' }] };
const actor = { id: 1, username: 'manager', role: 'admin', permissions: [] };
const instruction = { id: 9, kind: 'note', revision: 2, caption: 'New note', mediaUrl: null, updatedAt: new Date('2026-09-06T10:00:00Z') };
(async () => {
  const instructionAudit = { id: 'instruction-9-2', type: 'instruction_edited', meta: { previous: { caption: 'Old note' }, current: { caption: 'New note' } } };
  const stageAudit = { id: 'stage-42-1', type: 'stage', toStage: 'executed' };
  const interleaved = output.exports.mergeRoutedKoshaCustomFields(
    { bookingCenterServices: [{ type: 'kosha' }], koshaPortalTimeline: [instructionAudit], koshaPortalMedia: [{ id: 'existing-media' }] },
    { executionStage: 'executed', koshaPortalTimeline: [], koshaPortalMedia: [] },
    { timeline: [stageAudit], media: [{ id: 'new-media' }] },
  );
  assert.deepEqual(JSON.parse(JSON.stringify(interleaved.koshaPortalTimeline)), [instructionAudit, stageAudit], 'A stale staff stage write cannot erase an interleaved instruction audit');
  assert.equal(interleaved.koshaPortalTimeline[0].meta.previous.caption, 'Old note', 'Instruction previous-caption audit survives the interleaving');
  assert.deepEqual(JSON.parse(JSON.stringify(interleaved.koshaPortalMedia)), [{ id: 'existing-media' }, { id: 'new-media' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(interleaved.bookingCenterServices)), [{ type: 'kosha' }]);
  const staleAdminEdit = output.exports.mergeRoutedKoshaCustomFields(
    { koshaPortalTimeline: [instructionAudit], koshaPortalMedia: [{ id: 'existing-media' }], brideName: 'Before' },
    { koshaPortalTimeline: [], koshaPortalMedia: [], brideName: 'After' },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(staleAdminEdit)),
    { koshaPortalTimeline: [instructionAudit], koshaPortalMedia: [{ id: 'existing-media' }], brideName: 'After' },
    'A stale routed admin edit preserves the current instruction audit and media arrays',
  );
  await db.update(schema.serviceOrdersTable).set({
    customFields: output.exports.routedKoshaCustomFieldsSql(
      schema.serviceOrdersTable.customFields,
      { executionStage: 'executed', koshaPortalTimeline: [], koshaPortalMedia: [] },
      { timeline: [stageAudit], media: [{ id: 'new-media' }] },
    ),
  }).returning();
  const atomic = queries.at(-1);
  assert.match(atomic.sql, /custom_fields.*koshaPortalTimeline.*custom_fields.*koshaPortalTimeline/is, 'Timeline append reads the current database value');
  assert.match(atomic.sql, /custom_fields.*koshaPortalMedia.*custom_fields.*koshaPortalMedia/is, 'Media append reads the current database value');
  assert.ok(atomic.params.includes(JSON.stringify({ executionStage: 'executed' })), 'Stale arrays are stripped from the scalar patch');
  assert.ok(atomic.params.includes(JSON.stringify([stageAudit])));
  await db.update(schema.serviceOrdersTable).set({
    customFields: output.exports.routedKoshaCustomFieldsSql(
      schema.serviceOrdersTable.customFields,
      { customerName: 'Scalar only', koshaPortalTimeline: [], koshaPortalMedia: [] },
    ),
  }).returning();
  const scalarOnly = queries.at(-1);
  assert.doesNotMatch(scalarOnly.sql, /jsonb_set/i, 'An empty admin append preserves current JSON without creating portal arrays on unrelated service orders');
  assert.ok(scalarOnly.params.includes(JSON.stringify({ customerName: 'Scalar only' })), 'Admin scalar patch strips stale portal arrays');

  const apiSource = fs.readFileSync('src/server/api.ts', 'utf8');
  const routedEdit = apiSource.slice(apiSource.indexOf('async function updateRoutedKoshaServiceBooking'), apiSource.indexOf('function productSharedStockId'));
  const operationsSave = apiSource.slice(apiSource.indexOf('async function saveBookingOperations'), apiSource.indexOf('async function stampBookingSoundDepartment'));
  const soundStamp = apiSource.slice(apiSource.indexOf('async function stampBookingSoundDepartment'), apiSource.indexOf('async function bookingOperationProducts'));
  const assignmentSave = apiSource.slice(apiSource.indexOf('if (resource === "staff-assignment")'), apiSource.indexOf('if (resource === "catalog")'));
  const serviceOrdersStart = apiSource.indexOf('if (section === "service-orders")');
  const serviceOrderPatch = apiSource.slice(
    apiSource.indexOf('if (method === "PATCH" && parts[2])', serviceOrdersStart),
    apiSource.indexOf('if (section === "orders")', serviceOrdersStart),
  );
  const photographySource = fs.readFileSync('src/server/photography-booking-integration.ts', 'utf8');
  const collections = apiSource.slice(apiSource.indexOf('async function handleCollections'), apiSource.indexOf('async function handleCollections') + 6400);
  const photographyEventStart = apiSource.indexOf('validationError("staff.photography.events.update"');
  const photographyEventEdit = apiSource.slice(photographyEventStart, apiSource.indexOf('return json(await formatPhotographyEvent(updated))', photographyEventStart));
  for (const [name, source] of [
    ['routed manager edit', routedEdit],
    ['booking operations', operationsSave],
    ['sound department stamp', soundStamp],
    ['staff assignment', assignmentSave],
    ['service-order edit', serviceOrderPatch],
    ['collection payment-method update', collections],
    ['photography event edit', photographyEventEdit],
    ['central booking photography synchronization', photographySource.slice(photographySource.indexOf('export async function syncCentralBookingToPhotography'), photographySource.indexOf('const CENTRAL_STATUS_BY_STAGE'))],
    ['photography stage synchronization', photographySource.slice(photographySource.indexOf('export async function syncPhotographyStageToCentralBooking'), photographySource.indexOf('export async function findPhotographerConflict'))],
  ]) {
    assert.match(source, /routedKoshaCustomFieldsSql\(/, `${name} must merge stale customFields against the current database row`);
  }

  // Every direct service-order JSON replacement must use the preservation
  // expression. This AST contract catches a new writer outside the known routes.
  for (const [filename, source] of [['api.ts', apiSource], ['photography-booking-integration.ts', photographySource]]) {
    const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'set' && /\.update\(serviceOrdersTable\)$/.test(node.expression.expression.getText(tree))) {
        let values = node.arguments[0];
        if (ts.isAsExpression(values)) values = values.expression;
        if (ts.isObjectLiteralExpression(values)) {
          const customFields = values.properties.find(property => property.name?.getText(tree) === 'customFields');
          if (customFields) assert.match(customFields.getText(tree), /routedKoshaCustomFieldsSql\(/, `${filename}:${tree.getLineAndCharacterOfPosition(node.pos).line + 1} service-order JSON write must preserve reserved arrays`);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
  }

  for (const [writer, stalePatch] of [
    ['collections', { paymentMethod: 'transfer' }],
    ['photography event', { assignedPhotographerId: 12, photographyWorkflowStatus: 'shooting' }],
    ['central photography sync', { departments: ['kosha', 'photography'], photographyPortal: { shootId: 8 } }],
    ['photography stage sync', { photographyWorkflowStatus: 'completed', photographyCustomerStatus: 'ready' }],
  ]) {
    const current = { koshaPortalTimeline: [instructionAudit, stageAudit], koshaPortalMedia: [{ id: 'interleaved-photo' }], unrelated: 'keep' };
    const patch = { ...stalePatch, koshaPortalTimeline: [], koshaPortalMedia: [] };
    const merged = output.exports.mergeRoutedKoshaCustomFields(current, patch);
    assert.deepEqual(JSON.parse(JSON.stringify(merged)), { ...current, ...stalePatch }, `${writer} cannot erase manager audit/staff media written after its read`);
    await db.update(schema.serviceOrdersTable).set({ customFields: output.exports.routedKoshaCustomFieldsSql(schema.serviceOrdersTable.customFields, patch) }).returning();
    assert.match(queries.at(-1).sql, /coalesce\("service_orders"\."custom_fields", '\{\}'::jsonb\) \|\|/i, `${writer} must merge at the database row boundary`);
    assert.ok(queries.at(-1).params.includes(JSON.stringify(stalePatch)), `${writer} must not replay stale reserved arrays in SQL parameters`);
  }

  await store.list(scope);
  assert.match(queries.at(-1).sql, /booking_source.*=.*booking_id.*=.*archived_at.*is null/i);
  assert.deepEqual(queries.at(-1).params, ['service', 42]);
  await store.find(scope, 9);
  assert.match(queries.at(-1).sql, /for update/i, 'Edits must serialize on the current revision');
  assert.deepEqual(queries.at(-1).params.slice(0, 3), ['service', 42, 9]);
  await store.reads(scope, 'manager_instruction');
  assert.match(queries.at(-1).sql, /booking_source.*=.*booking_id.*=.*channel/i);
  assert.deepEqual(queries.at(-1).params, ['service', 42, 'manager_instruction']);
  assert.match(queries.at(-1).sql, /viewed_version/i, 'Instruction reads return the monotonic cursor');
  const allocatedVersion = await store.nextVersion(scope);
  assert.equal(allocatedVersion, 7);
  assert.match(queries.at(-1).sql, /insert into "kosha_instruction_booking_versions".*on conflict.*current_version.*\+.*1/is, 'Booking cursor allocation serializes through one atomic upsert');
  const currentVersion = await store.currentVersion(scope);
  assert.equal(currentVersion, 0);
  assert.match(queries.at(-1).sql, /kosha_instruction_booking_versions.*booking_source.*booking_id/is, 'Future acknowledgements are bounded by the committed booking cursor');
  await store.markViewed(scope, actor, 'manager_instruction', new Date('2026-09-06T09:59:00Z'), 6);
  assert.match(queries.at(-1).sql, /on conflict.*booking_source.*booking_id.*staff_id.*channel.*do update/is);
  assert.match(queries.at(-1).sql, /greatest\(.*viewed_at.*excluded\.viewed_at/i);
  assert.match(queries.at(-1).sql, /greatest\(.*viewed_version.*excluded\.viewed_version/i, 'Read cursor is monotonic independently of timestamp order');
  await store.unreadCounts([scope, { ...scope, source: 'kosha' }], 2);
  assert.match(queries.at(-1).sql, /jsonb_to_recordset/);
  assert.match(queries.at(-1).sql, /manager_instruction/);
  assert.match(queries.at(-1).sql, /booking_version.*>.*viewed_version/i);
  assert.doesNotMatch(queries.at(-1).sql, /i\.updated_at.*>.*r\.viewed_at/i, 'Unread calculation cannot depend on wall-clock ordering');
  assert.deepEqual(JSON.parse(queries.at(-1).params[0]), [{ id: 42, source: 'service' }, { id: 42, source: 'kosha' }]);
  await store.recordEvent(scope, actor, 'edited', instruction, { ...instruction, revision: 1, caption: 'Old note' });
  assert.match(queries.at(-1).sql, /jsonb_set/);
  assert.match(queries.at(-1).sql, /koshaPortalTimeline/);
  const event = queries.at(-1).params.map(p => typeof p === 'string' && p.startsWith('[{') ? JSON.parse(p)[0] : null).find(Boolean);
  assert.equal(event.meta.previous.caption, 'Old note');
  await store.notify(scope, actor, 'edited', instruction);
  const notification = queries.at(-1);
  assert.match(notification.sql, /insert into "kosha_staff_notifications"/);
  assert.ok(notification.params.includes('/staff/koshas/booking/42?source=service'));
  assert.ok(!notification.params.includes(42), 'Routed service notification must not set native booking foreign key');
  databaseFailure = true;
  await assert.rejects(() => store.list(scope), error => error.cause?.message === 'offline' || error.message === 'offline');
  console.log('PASS: Real Drizzle SQL source scoping, active filtering, row locks, batched unread, atomic routed timeline append, safe notification FK and failure propagation');
})().catch(error => { console.error(error); process.exitCode = 1; });
