/** Student self-edit from the tracking link: verification, locks, field rules and audit (no database needed). */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import ts from "typescript";

process.env.AUTH_SECRET = "test-secret-for-student-edit-sessions-0123456789";
const require = createRequire(import.meta.url);
function load(path, overrides = {}) {
  const filename = resolve(path);
  const module = { exports: {} };
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const localRequire = (name) => Object.hasOwn(overrides, name) ? overrides[name]
    : name.startsWith("@/") ? load(resolve("src", `${name.slice(2)}.ts`), overrides)
    : name.startsWith(".") ? load(resolve(dirname(filename), `${name}.ts`), overrides)
    : require(name);
  new Function("require", "module", "exports", output)(localRequire, module, module.exports);
  return module.exports;
}

// ---------------------------------------------------------------- pure rules
const rules = load("src/lib/graduation-student-edit.ts");
assert.deepEqual(rules.studentEditPolicy({}), { enabled: true, until: null }, "groups are open by default");
assert.deepEqual(rules.studentEditPolicy({ studentEdit: { enabled: false, until: "2026-12-01" } }), { enabled: false, until: "2026-12-01" });
assert.equal(rules.studentEditPolicy({ studentEdit: { until: "01/12/2026" } }).until, null, "only ISO days are accepted");
const open = { enabled: true, until: null };
assert.equal(rules.studentEditLock({ productionStage: "approved" }, open).editable, true);
for (const stage of ["fabric_cutting", "tailoring", "printing", "delivered", "sewing"])
  assert.equal(rules.studentEditLock({ productionStage: stage }, open).editable, false, `${stage} is locked`);
assert.equal(rules.studentEditLock({ productionStage: "new", archivedAt: new Date() }, open).editable, false, "archived orders are locked");
assert.equal(rules.studentEditLock({ productionStage: "new" }, { enabled: false, until: null }).editable, false);
// Deadline is the last allowed Iraq day: 2026-12-01 21:00 UTC is already 2026-12-02 in Baghdad.
assert.equal(rules.studentEditLock({ productionStage: "new" }, { enabled: true, until: "2026-12-01" }, new Date("2026-12-01T20:00:00Z")).editable, true);
assert.equal(rules.studentEditLock({ productionStage: "new" }, { enabled: true, until: "2026-12-01" }, new Date("2026-12-01T21:30:00Z")).editable, false);
assert.match(rules.studentEditMeasurements({}, { robeLength: 10 }).error, /بين 80 و250/);
assert.deepEqual(rules.studentEditMeasurements({ robeLength: 140, capSize: 56 }, { robeLength: "150", capSize: "" }).values, { robeLength: 150 });

// ---------------------------------------------------------------- handler
const col = (table) => new Proxy({ name: table }, { get: (target, key) => key in target ? target[key] : `${table}.${String(key)}` });
const tables = { graduationOrdersTable: col("orders"), graduationGroupsTable: col("groups"), entityTimelineTable: col("timeline") };

function fixture({ order = {}, group = {}, others = [], rateLimited = false, persistImage } = {}) {
  const baseGroup = { id: 8, title: "فيزيائيون", defaultConfiguration: { customText: { sashNamePrefix: "المهندس" } }, ...group };
  const baseOrder = {
    id: 81, qrToken: "t".repeat(64), groupId: 8, customerName: "علي حسين جاسم", phone: "07701234567", phoneLast4: "4567",
    status: "submitted", productionStage: "approved", archivedAt: null, designApprovedAt: null,
    measurements: { robeLength: 140, gender: "male", status: "partial" },
    customText: { text: "المهندس علي حسين", font: "naskh", sashColor: "#182539", embroideryColor: "#D4AF37", sashNamePrefix: "المهندس" },
    colors: { sash: "#182539", embroidery: "#D4AF37" },
    previewAssets: { studentReferences: [{ placement: "cap_top", note: "قديمة", imageUrl: "https://cdn/old.webp", fileName: "old.webp" }] },
    productionEstimate: { tailorAssignment: { tailorName: "خياط الاختبار" } },
    ...order,
  };
  const state = { orders: new Map([[baseOrder.id, baseOrder], ...others.map((item) => [item.id, item])]), group: baseGroup, timeline: [], notices: [], uploads: [], updates: 0 };
  const byWhere = (where) => [...state.orders.values()].find((row) =>
    where.col === "orders.qrToken" ? row.qrToken === where.value : where.col === "orders.id" ? row.id === where.value : false);
  const selection = (rows) => ({ for: async () => rows, then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject) });
  const tx = {
    select: () => ({
      from: (table) => ({
        where: (where) => table.name === "groups"
          ? selection(where.value === state.group.id ? [state.group] : [])
          : where.col === "orders.groupId"
            ? selection([...state.orders.values()].filter((row) => row.groupId === where.value))
            : selection([byWhere(where)].filter(Boolean)),
      }),
    }),
    update: () => ({ set: (values) => ({ where: (where) => ({ returning: async () => {
      const row = byWhere(where);
      Object.assign(row, values);
      state.updates += 1;
      return [row];
    } }) }) }),
    insert: () => ({ values: async (value) => { state.timeline.push(value); } }),
  };
  const db = {
    query: {
      graduationOrdersTable: { findFirst: async ({ where }) => byWhere(where) },
      graduationGroupsTable: { findFirst: async ({ where }) => where.value === state.group.id ? state.group : undefined },
    },
    transaction: async (fn) => fn(tx),
  };
  const mod = load("src/server/graduation-student-edit.ts", {
    "@workspace/db": { db, ...tables },
    "drizzle-orm": { eq: (column, value) => ({ col: column, value }) },
    "@/server/rate-limit": { consumeRateLimit: async () => ({ allowed: !rateLimited, retryAfterSeconds: 600 }) },
  });
  const deps = {
    persistImage: persistImage ?? (async (data) => { state.uploads.push(data); return "https://cdn/new.webp"; }),
    notify: async (input) => { state.notices.push(input); },
    now: () => new Date("2026-10-13T12:00:00Z"),
  };
  const call = (method, action, body, session) => mod.handleStudentSelfEdit(
    new Request(`http://localhost/api/graduation/track/${baseOrder.qrToken}/edit${action ? `/${action}` : ""}`, {
      method,
      headers: { "content-type": "application/json", ...(session ? { "x-student-edit-session": session } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }), baseOrder.qrToken, action, deps);
  const login = async () => (await (await call("POST", "verify", { last4: "4567" })).json()).session;
  return { state, order: baseOrder, call, login, mod };
}

// verification
{
  const { call, login } = fixture();
  assert.equal((await call("POST", "verify", { last4: "1111" })).status, 401, "wrong digits are refused");
  assert.equal((await call("POST", "verify", { last4: "45" })).status, 401);
  const session = await login();
  assert.match(session, /^v1\.81\./, "the right digits open a signed session");
  assert.equal((await call("GET", undefined, null)).status, 401, "editing needs the session");
  assert.equal((await call("GET", undefined, null, `${session}x`)).status, 401, "a tampered session is refused");
  const view = await (await call("GET", undefined, null, session)).json();
  assert.equal(view.lock.editable, true);
  assert.equal(view.student.sashName, "علي حسين", "the student edits only their own part of the sash name");
  assert.equal(view.options.sashNamePrefix, "المهندس");
  assert.ok(!JSON.stringify(view).includes("0770123"), "the edit view never carries the phone");
}
{
  const { call } = fixture({ rateLimited: true });
  assert.equal((await call("POST", "verify", { last4: "4567" })).status, 429, "attempts are limited");
}
{
  const { call, login, order } = fixture();
  const session = await login();
  order.phoneLast4 = "9999";
  order.phone = "07709999999";
  assert.equal((await call("GET", undefined, null, session)).status, 401, "a new phone ends earlier sessions");
}

// field rules
{
  const { call, login, state } = fixture({ others: [{ id: 82, groupId: 8, customerName: "زينب محمد", status: "submitted", archivedAt: null }] });
  const session = await login();
  assert.equal((await call("PATCH", undefined, { customerName: "زينب  محمد" }, session)).status, 409, "another student's name is refused");
  assert.equal((await call("PATCH", undefined, { measurements: { robeLength: 10 } }, session)).status, 400, "measurements keep the form's range");
  assert.equal((await call("PATCH", undefined, { sashName: "المهندس" }, session)).status, 400, "the sash needs the student's own name");
  assert.equal(state.updates, 0, "refused edits write nothing");
  const noChange = await (await call("PATCH", undefined, { sashName: "علي حسين", measurements: { robeLength: "140" } }, session)).json();
  assert.equal(noChange.changed, false, "unchanged values are not an edit");
  assert.equal(state.timeline.length, 0);
}
{
  const { call, login, state, order } = fixture({ order: { designApprovedAt: new Date("2026-10-01") } });
  const session = await login();
  const response = await call("PATCH", undefined, {
    customerName: "علي حسين جاسم الربيعي",
    sashName: "المهندس علي",
    measurements: { robeLength: "150", sleeveLength: "60" },
    references: [{ placement: "cap_top", note: "جديدة", imageData: "data:image/webp;base64,AAAA", fileName: "cap.webp" }, { placement: "sash_back", note: "خلف" }],
  }, session);
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(order.customerName, "علي حسين جاسم الربيعي");
  assert.equal(order.customText.studentName, "علي حسين جاسم الربيعي");
  assert.equal(order.customText.text, "المهندس علي", "the title is printed once");
  assert.equal(order.measurements.robeLength, 150);
  assert.equal(order.measurements.sleeveLength, 60);
  assert.ok(order.measurements.status, "measurement completeness is recomputed");
  assert.deepEqual(order.previewAssets.studentReferences.map((item) => [item.placement, item.note, item.imageUrl]),
    [["cap_top", "جديدة", "https://cdn/new.webp"], ["sash_back", "خلف", undefined]]);
  assert.equal(state.uploads.length, 1);
  assert.equal(order.designApprovedAt, null, "a changed sash needs the design approved again");
  assert.equal(body.designApprovalReset, true);
  assert.equal(state.timeline.length, 1);
  assert.equal(state.timeline[0].type, "student_self_edit");
  assert.equal(state.timeline[0].actorName, "الطالب");
  assert.ok(state.timeline[0].metadata.changes.some((change) => change.field === "customerName" && change.from === "علي حسين جاسم"), "old and new values are kept");
  assert.equal(state.notices.length, 1, "the administration is notified");
  assert.match(state.notices[0].body, /خياط الاختبار: أعد طباعة ورقة القياسات/, "an assigned tailor is told to reprint the sheet");
}
{
  const { call, login } = fixture({ group: { defaultConfiguration: { colors: { sash: "#000000" }, customText: {} } } });
  const session = await login();
  assert.equal((await call("PATCH", undefined, { sashColor: "#ffffff" }, session)).status, 409, "a colour fixed by the group stays fixed");
}
{
  const failure = Object.assign(new Error("الصورة غير صالحة أو حجمها كبير"), { name: "StudentEditImageError", status: 400 });
  const { call, login, state } = fixture({ persistImage: async () => { throw failure; } });
  const session = await login();
  const response = await call("PATCH", undefined, { references: [{ placement: "other", note: "", imageData: "data:text/plain;base64,AAAA" }] }, session);
  assert.equal(response.status, 400, "an invalid photo is reported, not stored");
  assert.match((await response.json()).message, /الصورة غير صالحة/);
  assert.equal(state.updates, 0);
}

// locks
for (const [label, setup] of [
  ["production started", { order: { productionStage: "fabric_cutting" } }],
  ["group closed", { group: { defaultConfiguration: { studentEdit: { enabled: false } } } }],
  ["deadline passed", { group: { defaultConfiguration: { studentEdit: { enabled: true, until: "2026-10-12" } } } }],
]) {
  const { call, login, state } = fixture(setup);
  const session = await login();
  const view = await (await call("GET", undefined, null, session)).json();
  assert.equal(view.lock.editable, false, `${label}: the view says why`);
  const response = await call("PATCH", undefined, { measurements: { robeLength: "150" } }, session);
  assert.equal(response.status, 409, `${label}: edits are refused`);
  assert.equal(state.updates, 0);
}

// group setting: the group's representative or the administration, recorded
{
  function fakeSql(parts, ...values) { return { __sql: true, parts: [...parts], values }; }
  fakeSql.join = (items, separator) => ({ __join: true, items, separator });
  const render = (query) => {
    let statement = "";
    const values = [];
    const walk = (node) => {
      if (node?.__join) return node.items.forEach((item, index) => { if (index) walk(node.separator); walk(item); });
      node.parts.forEach((part, index) => {
        statement += part;
        if (index >= node.values.length) return;
        const value = node.values[index];
        if (value?.__sql || value?.__join) return walk(value);
        values.push(value);
        statement += "?";
      });
    };
    walk(query);
    return { statement: statement.replace(/\s+/g, " ").trim(), values };
  };
  const writes = [];
  const timeline = [];
  const handle = async (query) => {
    const { statement, values } = render(query);
    if (statement.includes("FROM representative_group_assignments")) return { rows: [{ group_id: 8 }] };
    if (statement.startsWith("UPDATE graduation_groups SET default_configuration")) {
      writes.push({ statement, values });
      return { rows: [9, 8].includes(values[1]) ? [{ id: values[1] }] : [] };
    }
    return { rows: [] };
  };
  const db = {
    execute: handle,
    transaction: async (fn) => fn({ execute: handle, insert: () => ({ values: async (value) => { timeline.push(value); } }) }),
    select: () => ({ from: () => Promise.resolve([{ id: 8 }, { id: 9 }]) }),
    query: { graduationGroupsTable: { findFirst: async () => ({ id: 8 }) } },
  };
  const named = Object.fromEntries(["graduationGroupsTable", "graduationOrdersTable", "graduationReceiptsTable", "staffTable", "entityTimelineTable"].map((name) => [name, { name }]));
  const portal = load("src/server/representative.ts", {
    "@workspace/db": { db, ...named },
    "drizzle-orm": { sql: fakeSql, and: (...args) => args, desc: (x) => x, eq: (a, b) => [a, b], inArray: (a, b) => [a, b] },
    "@/server/graduation-group-pricing": { handleGraduationGroupPricing: async () => new Response(null, { status: 204 }) },
    "@/server/graduation-operations": { receivePayment: async () => { throw new Error("not used"); } },
  }).handleRepresentativePortal;
  const rep = { id: 7, username: "rep7", fullName: "ممثل", role: "employee", isActive: true, permissions: ["representative.portal.access"] };
  const admin = { ...rep, id: 1, role: "admin", permissions: [] };
  const patch = (user, groupId, body) => portal(new Request(`http://localhost/api/admin/representative/groups/${groupId}/student-edit`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }), ["groups", String(groupId), "student-edit"], user);
  assert.equal((await patch(rep, 8, { enabled: false })).status, 200, "the group's representative closes editing");
  assert.equal((await patch(rep, 9, { enabled: false })).status, 403, "another group's representative cannot");
  assert.equal((await patch(admin, 9, { enabled: true, until: "2026-12-01" })).status, 200, "the administration sets any group");
  assert.equal((await patch(admin, 9, { enabled: true, until: "1/12/2026" })).status, 400, "only ISO days");
  assert.deepEqual(writes.map((write) => [JSON.parse(write.values[0]), write.values[1]]),
    [[{ enabled: false, until: null }, 8], [{ enabled: true, until: "2026-12-01" }, 9]]);
  assert.deepEqual(timeline.map((entry) => [entry.entityId, entry.type, entry.actorId]), [[8, "student_edit_policy", 7], [9, "student_edit_policy", 1]]);
}

// wiring
const graduation = readFileSync("src/server/graduation.ts", "utf8");
assert.match(graduation, /parts\[3\] === "edit"[\s\S]{0,200}handleStudentSelfEdit\(req, parts\[2\], parts\[4\]/, "the tracking link routes /edit to the self-edit handler");
assert.ok(graduation.indexOf('parts[3] === "edit"') < graduation.indexOf('method === "GET" && resource === "track" && parts[2]'), "the edit route is matched before the tracking view");
assert.match(graduation, /function trackOrder\(row: any\) \{\s*return \{ \.\.\.publicOrder\(row\), phone: null, phone2: null \};/, "the tracking response never carries the phone");
assert.match(graduation, /order: trackOrder\(order\),/);
const representative = readFileSync("src/server/representative.ts", "utf8");
const policyRoute = representative.slice(representative.indexOf('parts[2] === "student-edit"'), representative.indexOf("const workspace = await handleRepresentativeWorkspace"));
assert.match(policyRoute, /canAccessRepresentativeGroup\(scope, groupId\)/, "only the group's representative or the administration changes the setting");
assert.match(policyRoute, /jsonb_set\(COALESCE\(default_configuration, '\{\}'::jsonb\), '\{studentEdit\}'/);
assert.match(policyRoute, /entityTimelineTable/, "changes to the setting are recorded");
console.log("Graduation student self-edit checks passed.");
