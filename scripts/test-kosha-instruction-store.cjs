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
  if (/insert into "kosha_booking_channel_reads"/i.test(sql))
    return { rows: [{ staff_id: 1, viewed_at: new Date('2026-09-06T09:59:00Z') }], rowCount: 1 };
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
const store = output.exports.createKoshaInstructionStore(db);
const scope = { id: 42, source: 'service', assignedStaff: [{ id: 2, name: 'Crew' }] };
const actor = { id: 1, username: 'manager', role: 'admin', permissions: [] };
const instruction = { id: 9, kind: 'note', revision: 2, caption: 'New note', mediaUrl: null, updatedAt: new Date('2026-09-06T10:00:00Z') };
(async () => {
  await store.list(scope);
  assert.match(queries.at(-1).sql, /booking_source.*=.*booking_id.*=.*archived_at.*is null/i);
  assert.deepEqual(queries.at(-1).params, ['service', 42]);
  await store.find(scope, 9);
  assert.match(queries.at(-1).sql, /for update/i, 'Edits must serialize on the current revision');
  assert.deepEqual(queries.at(-1).params.slice(0, 3), ['service', 42, 9]);
  await store.reads(scope, 'manager_instruction');
  assert.match(queries.at(-1).sql, /booking_source.*=.*booking_id.*=.*channel/i);
  assert.deepEqual(queries.at(-1).params, ['service', 42, 'manager_instruction']);
  await store.markViewed(scope, actor, 'staff_execution', new Date('2026-09-06T09:59:00Z'));
  assert.match(queries.at(-1).sql, /on conflict.*booking_source.*booking_id.*staff_id.*channel.*do update/is);
  assert.match(queries.at(-1).sql, /greatest\(.*viewed_at.*excluded\.viewed_at/i);
  await store.unreadCounts([scope, { ...scope, source: 'kosha' }], 2);
  assert.match(queries.at(-1).sql, /jsonb_to_recordset/);
  assert.match(queries.at(-1).sql, /manager_instruction/);
  assert.match(queries.at(-1).sql, /updated_at.*>.*viewed_at/i);
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
