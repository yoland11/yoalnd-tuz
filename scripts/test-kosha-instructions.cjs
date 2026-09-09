const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
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
assert.equal(typeof api.filterKoshaInstructionAuditTimeline, 'function', 'Staff detail must share the exact instruction authorization boundary');
assert.equal(typeof api.redactKoshaInstructionAuditsFromBookingDetails, 'function', 'Staff booking serializers must expose a tested nested-audit redaction boundary');

// Dashboard cards are a separate server response from the booking list. Keep a
// focused wiring contract here so a UI fixture cannot accidentally hide a
// missing server-side batch enrichment.
const apiSource = fs.readFileSync('src/server/api.ts', 'utf8');
const dashboardStart = apiSource.indexOf('// ── Dashboard ──');
const dashboardEnd = apiSource.indexOf('// ── Bookings list ──', dashboardStart);
assert(dashboardStart >= 0 && dashboardEnd > dashboardStart, 'Staff dashboard route must remain discoverable');
const dashboardRoute = apiSource.slice(dashboardStart, dashboardEnd);
assert.equal(
  (dashboardRoute.match(/koshaInstructionService\.unread/g) || []).length,
  1,
  'Dashboard must issue one batched unread-instruction lookup',
);
assert.match(dashboardRoute, /instructionScopeFromCrewBooking/, 'Dashboard must preserve native/service source identity');
assert.match(dashboardRoute, /unreadInstructionCount/, 'Dashboard cards must receive their unread count');

const nativeCrewFormatterStart = apiSource.indexOf('async function formatKoshaBookingForCrew');
const nativeCrewFormatterEnd = apiSource.indexOf('/**\n * The single source of truth', nativeCrewFormatterStart);
const routedCrewFormatterStart = apiSource.indexOf('async function formatRoutedKoshaServiceBookingForCrew');
const routedCrewFormatterEnd = apiSource.indexOf('async function loadRoutedKoshaServiceBookingDetail', routedCrewFormatterStart);
const nativeDetailLoaderStart = apiSource.indexOf('async function loadKoshaBookingDetail');
const nativeDetailLoaderEnd = apiSource.indexOf('function routedServiceExecutionFields', nativeDetailLoaderStart);
const routedDetailLoaderStart = routedCrewFormatterEnd;
const routedDetailLoaderEnd = apiSource.indexOf('/**\n * Persists execution state', routedDetailLoaderStart);
const listStart = apiSource.indexOf('// ── Bookings list ──');
const listEnd = apiSource.indexOf('// ── Booking detail ──', listStart);
assert(nativeCrewFormatterStart >= 0 && nativeCrewFormatterEnd > nativeCrewFormatterStart, 'Native crew formatter must remain discoverable');
assert(routedCrewFormatterStart >= 0 && routedCrewFormatterEnd > routedCrewFormatterStart, 'Routed crew formatter must remain discoverable');
assert.match(
  apiSource.slice(nativeCrewFormatterStart, nativeCrewFormatterEnd),
  /redactKoshaInstructionAuditsFromBookingDetails/,
  'Native staff rows must redact nested manager-instruction audit snapshots',
);
assert.match(
  apiSource.slice(routedCrewFormatterStart, routedCrewFormatterEnd),
  /redactKoshaInstructionAuditsFromBookingDetails/,
  'Routed staff rows must redact nested manager-instruction audit snapshots',
);
assert.match(apiSource.slice(nativeDetailLoaderStart, nativeDetailLoaderEnd), /formatKoshaBookingForCrew/, 'Native detail must use the redacted crew serializer');
assert.match(apiSource.slice(routedDetailLoaderStart, routedDetailLoaderEnd), /formatRoutedKoshaServiceBookingForCrew/, 'Routed detail must use the redacted crew serializer');
assert.match(dashboardRoute, /getVisibleKoshaBookingsForStaff/, 'Dashboard must consume redacted native/routed crew rows');
assert.match(apiSource.slice(listStart, listEnd), /getVisibleKoshaBookingsForStaff/, 'List must consume redacted native/routed crew rows');

// A missing local Playwright installation is expected in lightweight developer
// environments. The browser fixture must fail with an actionable setup command,
// rather than an opaque module-resolution error.
const browserPrerequisite = spawnSync(
  process.execPath,
  ['scripts/test-kosha-staff-instructions-browser.mjs'],
  {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, AJN_BROWSER_RUNTIME: undefined, AJN_BROWSER_ORIGIN: undefined },
  },
);
assert.equal(browserPrerequisite.status, 2, 'Browser fixture reports a missing runtime as a prerequisite failure');
assert.match(browserPrerequisite.stderr, /Resolve-Path 'C:\\path\\to\\playwright-enabled-project\\package\.json'/, 'Browser fixture explains how to point AJN_BROWSER_RUNTIME at a Playwright-enabled project manifest');
assert.match(browserPrerequisite.stderr, /AJN_BROWSER_ORIGIN/, 'Browser fixture documents the optional running-app origin override');

const manager = { id: 1, role: 'manager', username: 'manager', permissions: [] };
const employee = { id: 2, role: 'employee', username: 'crew', permissions: ['koshas'] };
const outsider = { ...employee, id: 99 };
const kosha = { source: 'kosha', id: 4, assignedStaff: [{ id: 2, name: 'Crew' }, { id: 3, name: 'Assistant' }] };
const service = { ...kosha, source: 'service' };
const instructionAuditTimeline = [
  { id: 'instruction-created', type: 'instruction_created', note: 'Private caption', meta: { current: { caption: 'Private caption', mediaUrl: '/uploads/private.webp' } } },
  { id: 'instruction-edited', type: 'instruction_edited', note: 'Edited private caption', meta: { previous: { caption: 'Private caption', mediaUrl: '/uploads/private.webp' }, current: { caption: 'Edited private caption', mediaUrl: '/uploads/private-v2.webp' } } },
  { id: 'instruction-archived', type: 'instruction_archived', note: 'Archived private caption', meta: { previous: { caption: 'Edited private caption', mediaUrl: '/uploads/private-v2.webp' }, current: { caption: 'Edited private caption', mediaUrl: '/uploads/private-v2.webp' } } },
  { id: 'staff-stage', type: 'stage_changed', note: 'Visible execution note' },
];
const bookingDetailsWithInstructionAudit = {
  koshaPortalTimeline: instructionAuditTimeline,
  koshaPortalMedia: [{ url: '/uploads/execution-proof.webp', purpose: 'stage-proof' }],
  bookingCenterServices: [{ type: 'kosha' }],
};
const redactedBookingDetails = api.redactKoshaInstructionAuditsFromBookingDetails(bookingDetailsWithInstructionAudit);
assert.deepEqual(
  JSON.parse(JSON.stringify(redactedBookingDetails)),
  {
    koshaPortalTimeline: [instructionAuditTimeline.at(-1)],
    koshaPortalMedia: bookingDetailsWithInstructionAudit.koshaPortalMedia,
    bookingCenterServices: bookingDetailsWithInstructionAudit.bookingCenterServices,
  },
  'Generic staff bookingDetails retain execution data but never contain manager instruction captions or media snapshots',
);
assert.equal(bookingDetailsWithInstructionAudit.koshaPortalTimeline.length, 4, 'Staff redaction must not mutate persisted booking details');
assert.deepEqual(
  JSON.parse(JSON.stringify(api.filterKoshaInstructionAuditTimeline({ ...kosha, assignedStaff: [] }, employee, instructionAuditTimeline))),
  [instructionAuditTimeline.at(-1)],
  'An ordinary employee viewing an unassigned native booking cannot receive manager instruction audit snapshots',
);
assert.deepEqual(
  JSON.parse(JSON.stringify(api.filterKoshaInstructionAuditTimeline({ ...service, assignedStaff: [] }, employee, instructionAuditTimeline))),
  [instructionAuditTimeline.at(-1)],
  'An ordinary employee viewing an unassigned routed booking cannot receive manager instruction audit snapshots',
);
assert.deepEqual(
  JSON.parse(JSON.stringify(api.filterKoshaInstructionAuditTimeline({ ...kosha, assignedStaff: [] }, manager, instructionAuditTimeline))),
  instructionAuditTimeline,
  'Supervisors retain manager instruction audit history on unassigned bookings',
);
assert.deepEqual(
  JSON.parse(JSON.stringify(api.filterKoshaInstructionAuditTimeline(kosha, employee, instructionAuditTimeline))),
  instructionAuditTimeline,
  'Exactly assigned staff retain manager instruction audit history',
);
let state = { instructions: [], reads: [], events: [], notifications: [], bookingVersions: {} };
let stored = [];
let failEvents = false;
let batchCalls = 0;
const key = (a, b) => a.bookingSource === b.source && a.bookingId === b.id;
const store = {
  async transaction(callback) {
    const before = structuredClone(state);
    try { return await callback(store); } catch (error) { state = before; throw error; }
  },
  async nextVersion(scope) {
    const identity = `${scope.source}:${scope.id}`;
    state.bookingVersions[identity] = (state.bookingVersions[identity] ?? 0) + 1;
    return state.bookingVersions[identity];
  },
  async currentVersion(scope) { return state.bookingVersions[`${scope.source}:${scope.id}`] ?? 0; },
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
  async markViewed(scope, actor, channel, viewedAt, viewedVersion) {
    let row = state.reads.find(r => key(r, scope) && r.staffId === actor.id && r.channel === channel);
    if (!row) { row = { bookingSource: scope.source, bookingId: scope.id, staffId: actor.id, channel, viewedAt, viewedVersion }; state.reads.push(row); }
    else {
      if (viewedAt > row.viewedAt) row.viewedAt = viewedAt;
      if (viewedVersion > row.viewedVersion) row.viewedVersion = viewedVersion;
    }
    return row;
  },
  async unreadCounts(bookings, staffId) {
    batchCalls++;
    return new Map(bookings.map(scope => {
      const read = state.reads.find(r => key(r, scope) && r.staffId === staffId && r.channel === 'manager_instruction');
      return [`${scope.source}:${scope.id}`, state.instructions.filter(r => key(r, scope) && !r.archivedAt && r.bookingVersion > (read?.viewedVersion ?? 0)).length];
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
  assert.equal(first.instruction.bookingVersion, 1, 'The first instruction mutation receives booking cursor one');
  assert.equal(state.events.length, 1);
  assert.deepEqual(state.notifications.map(n => n.staffId), [2, 3]);
  assert.equal(state.notifications[0].href, '/staff/koshas/booking/4?source=kosha');
  await app.create(service, manager, { kind: 'note', caption: 'Service only' });
  assert.equal(state.notifications[2].href, '/staff/koshas/booking/4?source=service');
  assert.equal((await app.list(kosha, employee, 'staff')).instructions.length, 1);
  assert.equal(state.reads.length, 0, 'GET never marks instructions viewed');
  await assert.rejects(() => app.edit(service, manager, first.instruction.id, { caption: 'cross booking' }), status(404));
  await assert.rejects(() => app.markViewed(kosha, outsider, 'staff', now.toISOString(), 1), status(403));
  await assert.rejects(() => app.markViewed(kosha, employee, 'staff', '2099-01-01T00:00:00.000Z', 1), status(422));
  const snapshot = await app.list(kosha, employee, 'staff');
  assert.equal(snapshot.latestVersion, 1);
  await app.markViewed(kosha, employee, 'staff', snapshot.latestAt, snapshot.latestVersion);
  assert.equal((await app.list(kosha, employee, 'staff')).unreadCount, 0);
  now = new Date('2026-09-06T09:01:00.000Z');
  const edited = await app.edit(kosha, manager, first.instruction.id, { caption: 'New placement' });
  assert.equal(edited.instruction.revision, 2);
  assert.equal(stored.length, 1, 'Caption edit reuses the same storage object');
  assert.equal(state.events[2].previous.caption, 'Placement', 'Audit retains previous caption');
  assert.equal(edited.instruction.bookingVersion, 2, 'Edits advance the booking cursor');
  await app.markViewed(kosha, employee, 'staff', snapshot.latestAt, snapshot.latestVersion);
  assert.equal((await app.list(kosha, employee, 'staff')).unreadCount, 1, 'An edit after the rendered snapshot remains unread');
  const receipts = await app.receipts(kosha, manager);
  assert.equal(receipts.staff.length, 2);
  assert.equal(receipts.staff[0].hasViewedLatest, false);
  assert.equal(receipts.staff[1].viewedAt, null);
  const executionSnapshot = '2026-09-06T09:00:30.000Z';
  await api.dispatchKoshaInstructionRequest({ service: app, surface: 'manager', method: 'POST', tail: ['execution-viewed'], scope: kosha, actor: manager, payload: { viewedThrough: executionSnapshot } });
  assert.equal(state.reads[1].channel, 'staff_execution');
  assert.equal(state.reads[1].viewedAt.toISOString(), executionSnapshot, 'Manager review records the rendered snapshot, not request completion time');
  assert.equal(new Date('2026-09-06T09:00:45.000Z') > state.reads[1].viewedAt, true, 'A concurrent staff upload after the snapshot remains unread');
  assert.equal(state.reads[0].channel, 'manager_instruction');
  await assert.rejects(
    () => api.dispatchKoshaInstructionRequest({ service: app, surface: 'manager', method: 'POST', tail: ['execution-viewed'], scope: kosha, actor: manager, payload: { viewedThrough: '2099-01-01T00:00:00.000Z' } }),
    status(422),
  );
  await assert.rejects(
    () => api.dispatchKoshaInstructionRequest({ service: app, surface: 'manager', method: 'POST', tail: ['execution-viewed'], scope: kosha, actor: manager, payload: {} }),
    status(422),
  );
  const raceScope = { ...kosha, id: 404 };
  now = new Date('2026-09-06T10:00:00.000Z');
  await app.create(raceScope, manager, { kind: 'note', caption: 'Committed first' });
  const raceSnapshot = await app.list(raceScope, employee, 'staff');
  await app.markViewed(raceScope, employee, 'staff', raceSnapshot.latestAt, raceSnapshot.latestVersion);
  now = new Date('2026-09-06T09:00:00.000Z');
  const committedLater = await app.create(raceScope, manager, { kind: 'note', caption: 'Committed later with an older timestamp' });
  assert.equal(committedLater.instruction.bookingVersion, 2);
  assert.equal((await app.list(raceScope, employee, 'staff')).unreadCount, 1, 'A later cursor remains unread even when its timestamp sorts before the acknowledgement');
  await assert.rejects(() => app.markViewed(raceScope, employee, 'staff', raceSnapshot.latestAt, 99), status(422));
  now = new Date('2026-09-06T11:00:00.000Z');

  const batched = await app.unread([kosha, service], employee);
  assert.equal(batchCalls, 1);
  assert.equal(batched.get('kosha:4'), 1);
  assert.equal(batched.get('service:4'), 1);
  const instructionRowsBeforeArchive = state.instructions.length;
  await app.archive(kosha, manager, first.instruction.id);
  assert.equal(state.instructions.length, instructionRowsBeforeArchive, 'Archive does not delete history');
  assert.equal((await app.list(kosha, employee, 'staff')).instructions.length, 0);
  failEvents = true;
  await assert.rejects(() => app.create(kosha, manager, { kind: 'note', caption: 'Must roll back' }), /timeline unavailable/);
  assert.equal(state.instructions.length, instructionRowsBeforeArchive, 'Event failure rolls instruction back');
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
  await api.dispatchKoshaInstructionRequest({ service: app, surface: 'manager', method: 'POST', tail: ['execution-viewed'], scope: routeScope, actor: manager, payload: { viewedThrough: '2026-09-06T09:00:30.000Z' } });
  const staffView = await api.dispatchKoshaInstructionRequest({ service: app, surface: 'staff', method: 'GET', tail: ['instructions'], scope: routeScope, actor: employee });
  await assert.rejects(
    () => api.dispatchKoshaInstructionRequest({ service: app, surface: 'staff', method: 'POST', tail: ['instructions', 'viewed'], scope: routeScope, actor: employee, payload: { viewedThrough: staffView.latestAt } }),
    status(422),
    'Staff acknowledgement requires the rendered monotonic cursor',
  );
  await api.dispatchKoshaInstructionRequest({ service: app, surface: 'staff', method: 'POST', tail: ['instructions', 'viewed'], scope: routeScope, actor: employee, payload: { viewedThrough: staffView.latestAt, viewedVersion: staffView.latestVersion } });
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
