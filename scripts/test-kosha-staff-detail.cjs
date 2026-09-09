const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');

const source = fs.readFileSync('src/server/api.ts', 'utf8');
const tree = ts.createSourceFile('api.ts', source, ts.ScriptTarget.Latest, true);
const declaration = name => {
  const node = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert(node, `Missing production function ${name}`);
  return node;
};
const compile = text => ts.transpileModule(text, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loadModule = filename => {
  const output = { exports: {} };
  vm.runInNewContext(compile(fs.readFileSync(filename, 'utf8')), {
    module: output, exports: output.exports, require, Date, Set, Map, Error, URL,
  }, { filename });
  return output.exports;
};
const instructions = loadModule('src/server/kosha-instructions.ts');
const operations = loadModule('src/server/kosha-operations.ts');
const stageRoute = declaration('handleStaffPortal').body.statements.find(node =>
  ts.isIfStatement(node) && /action === "stage"/.test(node.expression.getText(tree)),
);
assert(stageRoute, 'Stage response branch must be exercised from the real API');
const detailRoutes = [
  ['GET', /!action && method === "GET"/],
  ['stage', /action === "stage"/],
  ['media', /action === "media"/],
  ['delivery', /action === "delivery"/],
];
for (const [name, expression] of detailRoutes) {
  let route;
  const find = node => {
    if (route) return;
    if (ts.isIfStatement(node) && expression.test(node.expression.getText(tree))) route = node;
    ts.forEachChild(node, find);
  };
  find(declaration('handleStaffPortal'));
  assert(route, `Missing ${name} detail response branch`);
  const responseSource = route.getText(tree);
  assert.match(responseSource, /loadKoshaBookingDetail\(id, auth\)/, `${name} native detail responses must use the assignment-aware loader`);
  assert.match(responseSource, /loadRoutedKoshaServiceBookingDetail\([\s\S]*?auth[\s\S]*?\)/, `${name} routed detail responses must use the assignment-aware loader`);
}
const functions = [
  'instructionScopeFromCrewBooking', 'formatKoshaBookingForCrew',
  'formatRoutedKoshaServiceBookingForCrew', 'loadKoshaBookingDetail',
  'loadRoutedKoshaServiceBookingDetail', 'routedServiceExecutionFields',
  'crewStageToBookingOperation', 'syncedCrewStage',
].map(name => declaration(name).getText(tree)).join('\n');
const executable = compile(`${functions}
async function runStage(req, auth) {
  const resource = 'bookings', id = 4, action = 'stage', method = 'POST';
  ${stageRoute.getText(tree)}
}`);
const audit = [
  { id: 'private-create', type: 'instruction_created', note: 'Private caption', meta: { current: { mediaUrl: '/uploads/private.webp' } } },
  { id: 'private-edit', type: 'instruction_edited', meta: { previous: { caption: 'Private caption' }, current: { caption: 'Edited caption' } } },
  { id: 'private-archive', type: 'instruction_archived', meta: { previous: { mediaUrl: '/uploads/private.webp' } } },
  { id: 'crew-note', type: 'note', note: 'Visible execution note' },
].map(event => ({ ...event, createdAt: '2026-09-09T09:00:00.000Z' }));
const plain = value => JSON.parse(JSON.stringify(value));

async function runCase(bookingSource, actor, assignment, outcome) {
  const fromStage = outcome === 'idempotent' ? 'ready' : 'preparing';
  let fields = { executionStage: fromStage, assignedStaffIds: assignment, koshaPortalTimeline: structuredClone(audit), koshaPortalMedia: [{ url: '/uploads/execution.webp' }], bookingCenterServices: [{ type: 'kosha' }] };
  let row = { id: 4, executionStage: fromStage, assignedStaffId: assignment[0] ?? null, bookingDetails: fields, customFields: fields, customerName: 'Customer' };
  let events = structuredClone(audit);
  const nativeTable = { id: 'native-id', executionStage: 'native-stage' };
  const serviceTable = { id: 'service-id', customFields: 'fields' };
  const eventTable = { bookingId: 'event-booking-id', createdAt: 'event-created-at' };
  let written = false;
  const db = {
    query: {
      koshaBookingsTable: { findFirst: async () => row },
      koshaBookingEventsTable: { findMany: async () => events },
      koshaMediaTable: { findMany: async () => [] },
      koshaDeliveryReportsTable: { findFirst: async () => undefined },
      koshaPaymentRequestsTable: { findMany: async () => [] },
    },
    transaction: async work => work(db),
    update(table) {
      return { set(patch) { return { where() { return { async returning() {
        written = true;
        if (outcome === 'concurrent-retry') {
          fields = { ...fields, executionStage: 'ready' };
          row = { ...row, executionStage: 'ready', bookingDetails: fields, customFields: fields };
          return [];
        }
        if (table === serviceTable) {
          // SQL preservation is independently exercised against real Drizzle in
          // test-kosha-instruction-store.cjs. Keep the stored fixture here intact.
          fields = { ...fields, ...patch.customFields.patch, koshaPortalTimeline: [...fields.koshaPortalTimeline, ...patch.customFields.append.timeline] };
          row = { ...row, ...patch, customFields: fields };
        } else {
          row = { ...row, ...patch };
        }
        return [row];
      } }; } }; } };
    },
    insert(table) {
      assert.equal(table, eventTable);
      return { values(value) {
        const event = { ...value, id: 'stage-new', createdAt: new Date() };
        events.push(event);
        return { returning: async () => [event] };
      } };
    },
  };
  const context = vm.createContext({
    ...instructions, ...operations, db, Date, Map, Set, Number, String, Boolean, JSON,
    koshaBookingsTable: nativeTable, serviceOrdersTable: serviceTable,
    koshaBookingEventsTable: eventTable, koshaMediaTable: {}, koshaDeliveryReportsTable: {}, koshaPaymentRequestsTable: {},
    eq: () => ({}), and: () => ({}), asc: () => ({}), desc: () => ({}), sql: () => ({}),
    formatKoshaBooking: async booking => ({ ...booking, source: 'kosha' }),
    formatRoutedKoshaServiceBooking: async order => ({ ...order, source: 'service', bookingDetails: { ...order.customFields, routedBookingSource: 'service_order' } }),
    bookingAssignedStaff: details => ({ ids: details.assignedStaffIds ?? [] }),
    crewBucket: () => 'today', baghdadToday: () => '2026-09-09', koshaBookingSetup: async () => ({}),
    body: async () => ({ toStage: 'ready' }),
    koshaSourceHint: () => bookingSource,
    authorizeKoshaPortalBooking: async () => ({ resolved: bookingSource === 'kosha' ? { kind: 'kosha', native: row } : { kind: 'service', routed: { order: row, service: {} } } }),
    findRoutedKoshaServiceBooking: async () => ({ order: row, service: {} }),
    persistRoutedKoshaServiceMedia: async () => [],
    routedKoshaCustomFieldsSql: (_, patch, append) => ({ patch, append }),
    json: payload => plain(payload), error: (message, status) => ({ error: message, status }),
    logAdminActivity: async () => {}, addKoshaNotification: async () => {}, createNotification: async () => {},
    KOSHA_EXECUTION_STAGES: operations.KOSHA_STAGES,
  });
  vm.runInContext(executable, context, { filename: 'api.ts:staff-stage-and-detail' });
  const response = await context.runStage({ nextUrl: new URL(`https://test.invalid/?source=${bookingSource}`), headers: new Headers() }, actor);
  assert(!response.error, `${bookingSource} ${outcome}: ${JSON.stringify(response)}`);
  assert.equal(written, outcome !== 'idempotent', `${outcome} must exercise the intended mutation branch`);
  const authorized = ['admin', 'manager'].includes(actor.role) || assignment.includes(actor.id);
  const prefix = `${bookingSource}/${actor.role}/${assignment.length ? 'assigned' : 'unassigned'}/${outcome}`;
  for (const [location, timeline] of [
    ['timeline', response.timeline],
    ['bookingDetails', response.booking.bookingDetails.koshaPortalTimeline],
  ]) {
    assert.deepEqual(timeline.filter(event => event.type.startsWith('instruction_')), authorized ? plain(audit.slice(0, 3)) : [], `${prefix}: ${location} must enforce assignment/supervisor instruction authorization`);
    assert(timeline.some(event => event.id === 'crew-note'), `${prefix}: ordinary execution events survive`);
  }
  assert.equal(response.booking.executionStage, 'ready');
  assert.deepEqual(response.booking.bookingDetails.koshaPortalMedia, [{ url: '/uploads/execution.webp' }]);
  if (bookingSource === 'service') assert.equal(response.booking.bookingDetails.routedBookingSource, 'service_order', 'Response filtering preserves normalized routing metadata');
  assert.equal(fields.koshaPortalTimeline.filter(event => event.type.startsWith('instruction_')).length, 3, 'Response redaction cannot mutate stored audits');
}

(async () => {
  for (const source of ['kosha', 'service']) {
    for (const [actor, assignment] of [
      [{ id: 2, role: 'employee', username: 'crew', permissions: ['koshas'] }, []],
      [{ id: 2, role: 'employee', username: 'crew', permissions: ['koshas'] }, [2]],
      [{ id: 1, role: 'manager', username: 'manager', permissions: [] }, []],
      [{ id: 1, role: 'admin', username: 'admin', permissions: [] }, []],
    ]) {
      for (const outcome of ['idempotent', 'success', 'concurrent-retry']) await runCase(source, actor, assignment, outcome);
    }
  }
  console.log('PASS: 24 real native/routed stage response cases protect top-level/nested audits across idempotency, success, concurrent retry, assignment and supervisor access');
})().catch(error => { console.error(error); process.exitCode = 1; });
