const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const filename = 'src/server/kosha-instructions.ts';
const moduleValue = { exports: {} };
if (fs.existsSync(filename)) {
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module: moduleValue, exports: moduleValue.exports, require, Date, Set, Map, Error, URL }, { filename });
}
const api = moduleValue.exports;
assert.equal(typeof api.createKoshaInstructionService, 'function', 'Instruction service must implement the manager/staff contract');
assert.equal(typeof api.dispatchKoshaInstructionRequest, 'function', 'Instruction routes must share one tested action dispatcher');

const manager = { id: 1, role: 'manager', username: 'manager', permissions: [] };
const employee = { id: 2, role: 'employee', username: 'crew', permissions: ['koshas'] };
const outsider = { ...employee, id: 99 };
const kosha = { source: 'kosha', id: 4, assignedStaff: [{ id: 2, name: 'Crew' }, { id: 3, name: 'Assistant' }] };
const service = { ...kosha, source: 'service' };
let state = { instructions: [], reads: [], events: [], notifications: [] };
let stored = [];
let failEvents = false;
let batchCalls = 0;
const key = (a, b) => a.bookingSource === b.source && a.bookingId === b.id;
const store = {
  async transaction(callback) {
    const before = structuredClone(state);
    try { return await callback(store); } catch (error) { state = before; throw error; }
  },
  async list(scope) { return state.instructions.filter(r => key(r, scope) && !r.archivedAt); },
  async find(scope, id) { return state.instructions.find(r => key(r, scope) && r.id === id && !r.archivedAt); },
  async insert(value) { const row = { ...value, id: state.instructions.length + 1 }; state.instructions.push(row); return row; },
  async update(scope, id, values) { const row = await store.find(scope, id); Object.assign(row, values); return row; },
  async recordEvent(scope, actor, action, instruction, previous) {
    if (failEvents) throw new Error('timeline unavailable');
    state.events.push({ scope, actor, action, instruction: structuredClone(instruction), previous });
  },
  async notify(scope, actor, action, instruction) {
    state.notifications.push(...scope.assignedStaff.map(staff => ({ staffId: staff.id, href: api.instructionBookingHref(scope), action, instructionId: instruction.id })));
  },
  async reads(scope, channel) { return state.reads.filter(r => key(r, scope) && r.channel === channel); },
  async markViewed(scope, actor, channel, viewedAt) {
    let row = state.reads.find(r => key(r, scope) && r.staffId === actor.id && r.channel === channel);
    if (!row) { row = { bookingSource: scope.source, bookingId: scope.id, staffId: actor.id, channel, viewedAt }; state.reads.push(row); }
    else if (viewedAt > row.viewedAt) row.viewedAt = viewedAt;
    return row;
  },
  async unreadCounts(bookings, staffId) {
    batchCalls++;
    return new Map(bookings.map(scope => {
      const read = state.reads.find(r => key(r, scope) && r.staffId === staffId && r.channel === 'manager_instruction');
      return [`${scope.source}:${scope.id}`, state.instructions.filter(r => key(r, scope) && !r.archivedAt && (!read || r.updatedAt > read.viewedAt)).length];
    }));
  },
};
let now = new Date('2026-09-06T09:00:00.000Z');
const app = api.createKoshaInstructionService(store, async (data, folder) => { stored.push({ data, folder }); return '/uploads/one.png'; }, () => new Date(now));
const status = code => error => error.status === code;
(async () => {
  await assert.rejects(() => app.list(kosha, outsider, 'staff'), status(403));
  await assert.rejects(() => app.list({ ...kosha, assignedStaff: [] }, employee, 'staff'), status(403));
  assert.equal((await app.list(kosha, outsider, 'manager')).instructions.length, 0, 'Manager execution reads do not depend on assignment');
  assert.equal((await app.list({ ...kosha, assignedStaff: [] }, manager, 'staff')).instructions.length, 0, 'Authorized supervisors can inspect an unassigned booking');
  await assert.rejects(() => app.create(kosha, employee, { kind: 'note', caption: 'Forbidden' }), status(403));
  await assert.rejects(() => app.create(kosha, manager, { kind: 'note', caption: ' ' }), status(422));
  await assert.rejects(() => app.create(kosha, manager, { kind: 'image', mediaUrl: 'javascript:alert(1)' }), status(422));
  const first = await app.create(kosha, manager, { kind: 'image', mediaUrl: 'data:image/png;base64,aGVsbG8=', caption: 'Placement' });
  assert.equal(first.instruction.mediaUrl, '/uploads/one.png');
  assert.equal(stored.length, 1, 'One image stores bytes exactly once');
  assert.equal(state.instructions.length, 1);
  assert.equal(state.events.length, 1);
  assert.deepEqual(state.notifications.map(n => n.staffId), [2, 3]);
  assert.equal(state.notifications[0].href, '/staff/koshas/booking/4?source=kosha');
  await app.create(service, manager, { kind: 'note', caption: 'Service only' });
  assert.equal(state.notifications[2].href, '/staff/koshas/booking/4?source=service');
  assert.equal((await app.list(kosha, employee, 'staff')).instructions.length, 1);
  assert.equal(state.reads.length, 0, 'GET never marks instructions viewed');
  await assert.rejects(() => app.edit(service, manager, first.instruction.id, { caption: 'cross booking' }), status(404));
  await assert.rejects(() => app.markViewed(kosha, outsider, 'staff', now.toISOString()), status(403));
  await assert.rejects(() => app.markViewed(kosha, employee, 'staff', '2099-01-01T00:00:00.000Z'), status(422));
  const snapshot = await app.list(kosha, employee, 'staff');
  await app.markViewed(kosha, employee, 'staff', snapshot.latestAt);
  assert.equal((await app.list(kosha, employee, 'staff')).unreadCount, 0);
  now = new Date('2026-09-06T09:01:00.000Z');
  const edited = await app.edit(kosha, manager, first.instruction.id, { caption: 'New placement' });
  assert.equal(edited.instruction.revision, 2);
  assert.equal(stored.length, 1, 'Caption edit reuses the same storage object');
  assert.equal(state.events[2].previous.caption, 'Placement', 'Audit retains previous caption');
  await app.markViewed(kosha, employee, 'staff', snapshot.latestAt);
  assert.equal((await app.list(kosha, employee, 'staff')).unreadCount, 1, 'An edit after the rendered snapshot remains unread');
  const receipts = await app.receipts(kosha, manager);
  assert.equal(receipts.staff.length, 2);
  assert.equal(receipts.staff[0].hasViewedLatest, false);
  assert.equal(receipts.staff[1].viewedAt, null);
  await app.markViewed(kosha, manager, 'manager');
  assert.equal(state.reads[1].channel, 'staff_execution');
  assert.equal(state.reads[0].channel, 'manager_instruction');
  const batched = await app.unread([kosha, service], employee);
  assert.equal(batchCalls, 1);
  assert.equal(batched.get('kosha:4'), 1);
  assert.equal(batched.get('service:4'), 1);
  await app.archive(kosha, manager, first.instruction.id);
  assert.equal(state.instructions.length, 2, 'Archive does not delete history');
  assert.equal((await app.list(kosha, employee, 'staff')).instructions.length, 0);
  failEvents = true;
  await assert.rejects(() => app.create(kosha, manager, { kind: 'note', caption: 'Must roll back' }), /timeline unavailable/);
  assert.equal(state.instructions.length, 2, 'Event failure rolls instruction back');
  failEvents = false;
  const broken = api.createKoshaInstructionService({ ...store, list: async () => { throw new Error('database offline'); } }, async () => null);
  await assert.rejects(() => broken.list(kosha, employee, 'staff'), /database offline/, 'Database failure is never converted to empty instructions');

  const routeScope = { ...kosha, id: 8 };
  const created = await api.dispatchKoshaInstructionRequest({ service: app, surface: 'manager', method: 'POST', tail: ['instructions'], scope: routeScope, actor: manager, payload: { kind: 'note', caption: 'Route note' } });
  assert.equal(created.instruction.caption, 'Route note');
  const listed = await api.dispatchKoshaInstructionRequest({ service: app, surface: 'manager', method: 'GET', tail: ['instructions'], scope: routeScope, actor: manager });
  assert.equal(listed.instructions.length, 1);
  const patched = await api.dispatchKoshaInstructionRequest({ service: app, surface: 'manager', method: 'PATCH', tail: ['instructions', String(created.instruction.id)], scope: routeScope, actor: manager, payload: { caption: 'Route edited' } });
  assert.equal(patched.instruction.caption, 'Route edited');
  const receiptList = await api.dispatchKoshaInstructionRequest({ service: app, surface: 'manager', method: 'GET', tail: ['instruction-reads'], scope: routeScope, actor: manager });
  assert.equal(receiptList.staff.length, 2);
  await api.dispatchKoshaInstructionRequest({ service: app, surface: 'manager', method: 'POST', tail: ['execution-viewed'], scope: routeScope, actor: manager });
  const staffView = await api.dispatchKoshaInstructionRequest({ service: app, surface: 'staff', method: 'GET', tail: ['instructions'], scope: routeScope, actor: employee });
  await api.dispatchKoshaInstructionRequest({ service: app, surface: 'staff', method: 'POST', tail: ['instructions', 'viewed'], scope: routeScope, actor: employee, payload: { viewedThrough: staffView.latestAt } });
  assert.equal((await app.list(routeScope, employee, 'staff')).unreadCount, 0);
  await api.dispatchKoshaInstructionRequest({ service: app, surface: 'manager', method: 'POST', tail: ['instructions', String(created.instruction.id), 'archive'], scope: routeScope, actor: manager });
  assert.equal((await app.list(routeScope, employee, 'staff')).instructions.length, 0);
  assert.equal(await api.dispatchKoshaInstructionRequest({ service: app, surface: 'staff', method: 'POST', tail: ['instructions'], scope: routeScope, actor: employee, payload: {} }), null, 'Unsupported route shapes fall through without guessing');
  await assert.rejects(
    () => api.dispatchKoshaInstructionRequest({ service: app, surface: 'manager', method: 'PATCH', tail: ['instructions', '0'], scope: routeScope, actor: manager, payload: { caption: 'bad id' } }),
    error => error.status === 400,
    'Instruction IDs must be positive integers',
  );
  console.log('PASS: Kosha instruction routes, authorization, validation, source isolation, single storage, audit, notifications, revision, archive, read channels/races, batched counts and failure propagation');
})().catch(error => { console.error(error); process.exitCode = 1; });
