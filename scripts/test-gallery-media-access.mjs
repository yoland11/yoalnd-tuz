import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
function compile(source, dependencies = {}) {
  const module = { exports: {} };
  const output = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText;
  new Function("require", "module", "exports", ...Object.keys(dependencies), output)(
    require, module, module.exports, ...Object.values(dependencies));
  return module.exports;
}
const rules = compile(readFileSync("src/server/photography-gallery.ts", "utf8"));
const source = readFileSync("src/server/api.ts", "utf8");
const ast = ts.createSourceFile("api.ts", source, ts.ScriptTarget.Latest, true);
const names = ["handleMedia", "mediaResponseFromValue", "canReadPhotographyGalleryMedia", "privateGalleryResponse", "handleClientGallery", "mediaRoute", "mediaVersion", "publicMediaValue", "isPhotographyManager", "canAccessPhotographyEvent"];
const functions = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
let galleryProducer;
function findGalleryProducer(node) {
  if (ts.isIfStatement(node) && node.expression.getText(ast) === 'resource === "galleries"') galleryProducer = node.getText(ast);
  ts.forEachChild(node, findGalleryProducer);
}
findGalleryProducer(ast);
assert.ok(galleryProducer, "the real staff gallery producer is included in the fixture");
class NextResponse extends Response {
  static redirect(url, status = 302) { return new NextResponse(null, { status, headers: { location: String(url) } }); }
}
const secret = "synthetic-gallery-test-secret-at-least-32-characters";
const password = rules.hashGalleryPassword("test-only-password");
const open = { id: 4, shootId: 14, slug: "synthetic-random-gallery", isActive: true,
  expiresAt: null, passwordHash: null, passwordSalt: null };
function fixture(gallery = open, user = null, value = "data:image/png;base64,dGVzdA==", options = {}) {
  const state = { upgrades: 0, fetches: 0 };
  const item = { id: 9, galleryId: 4, previewImage: value };
  function matches(expression, row) {
    const actual = row[String(expression.column).split(".").at(-1)];
    if (expression.op === "eq") return actual === expression.value;
    if (expression.op === "ne") return actual != null && actual !== expression.value;
    if (expression.op === "null") return actual == null;
    if (expression.op === "and") return expression.conditions.every((condition) => matches(condition, row));
    if (expression.op === "or") return expression.conditions.some((condition) => matches(condition, row));
    throw new Error(`Unknown fixture SQL predicate: ${expression.op}`);
  }
  const tables = Object.fromEntries(["photographyGalleryItemsTable", "photographyGalleriesTable", "photographyShootsTable",
    "photographyEventsTable", "photographyShootCrewTable"].map((name) => [name, new Proxy({}, { get: (_, key) => `${name}.${String(key)}` })]));
  const db = { query: {
    photographyGalleryItemsTable: { findFirst: async () => item, findMany: async () => [item] },
    photographyGalleriesTable: { findFirst: async () => gallery },
    photographyShootsTable: { findFirst: async () => ({ id: 14, eventId: 15 }) },
    photographyEventsTable: { findFirst: async () => ({ id: 15, assignedStaffId: 7 }) },
    photographyShootCrewTable: { findFirst: async ({ where }) => {
      const row = { shootId: 14, staffId: user?.id, assignmentStatus: Object.hasOwn(options, "crewStatus") ? options.crewStatus : "assigned" };
      return options.crew && matches(where, row) ? row : null;
    } },
  }, execute: async () => ({ rows: [] }), update: () => ({ set: () => ({ where: async () => {} }) }), insert: () => ({ values: async () => {} }) };
  const dependency = { ...rules, ...tables, db, NextResponse, Buffer, STORAGE_URL: options.storage ? "https://storage.example.test" : "", STORAGE_SERVICE_KEY: options.storage ? "synthetic-service-key" : "", STORAGE_BUCKET: "test",
    MEDIA_CACHE_HEADER: "public, max-age=31536000, immutable", ensurePhotographyGalleryTables: async () => {},
    int: (value) => Number.parseInt(value, 10), eq: (column, value) => ({ op: "eq", column, value }), and: (...conditions) => ({ op: "and", conditions }),
    asc: (value) => value, sql: (...args) => args,
    photographyGalleryEventsTable: {}, body: async (request) => request.json(),
    json: (payload, status = 200, headers = {}) => new NextResponse(JSON.stringify(payload), { status, headers }),
    ne: (column, value) => ({ op: "ne", column, value }), or: (...conditions) => ({ op: "or", conditions }), isNull: (column) => ({ op: "null", column }),
    error: (message, status) => new NextResponse(JSON.stringify({ error: message }), { status }),
    sessionSecret: () => secret, getAdminUser: async () => user,
    getPhotographyEventByRef: async () => ({ id: 15, assignedStaffId: 7 }),
    ensureShootRow: async () => ({ id: 14, eventId: 15 }), baseUrlFromReq: () => "https://local.test",
    hasPermission: (actor, perm) => actor?.isActive && (actor.role === "admin" || actor.permissions.includes(perm)),
    fetch: async () => { state.fetches++; return new Response("synthetic-storage-bytes", { headers: { "content-type": "image/png" } }); },
    isDataUrl: (value) => value.startsWith("data:"), parseDataUrl: () => ({ mime: "image/png", bytes: Buffer.from("test") }),
    bodyFromBuffer: (bytes) => bytes,
    upgradeStoredMedia: async (_kind, _id, value) => { state.upgrades++; return value; },
  };
  const handlers = compile(`${functions.map((node) => node.getText(ast)).join("\n")}\nexports.handleMedia = handleMedia; exports.handleClientGallery = handleClientGallery; exports.publicMediaValue = publicMediaValue;
    exports.staffListing = async function(req, auth) { const resource = "galleries", ref = "15", method = "GET", action = undefined, crewEventIds = new Set([15]); ${galleryProducer} };`, dependency);
  return { state, item, publicMediaValue: handlers.publicMediaValue,
    staffListing: () => handlers.staffListing({ method: "GET", nextUrl: new URL("https://local.test/api/staff/photography/galleries/15") }, user),
    listing: (password) => handlers.handleClientGallery({ method: password ? "POST" : "GET", json: async () => ({ password }), nextUrl: new URL(`https://local.test/api/photo-gallery/${gallery.slug}`) }, ["photo-gallery", gallery.slug]),
    call: (query = "") => handlers.handleMedia({ method: "GET", nextUrl: new URL(`https://local.test/api/media/photography-gallery/9${query}`) }, ["media", "photography-gallery", "9"]) };
}
assert.equal((await fixture().call()).status, 401, "a serial preview ID must not reveal a gallery image");
assert.equal((await fixture().call("?gallery=wrong")).status, 401, "an unrelated slug grants no access");
for (const [gallery, expected] of [[{ ...open, isActive: false }, 403], [{ ...open, expiresAt: new Date(0) }, 410]]) {
  assert.equal((await fixture(gallery).call(`?gallery=${open.slug}`)).status, expected);
}
const locked = { ...open, passwordHash: password.hash, passwordSalt: password.salt };
assert.equal((await fixture(locked).call(`?gallery=${open.slug}`)).status, 401, "slug alone cannot unlock a password gallery");
const token = rules.createGalleryPreviewToken(locked, 9, secret);
const query = `?gallery=${open.slug}&access=${encodeURIComponent(token)}`;
const unlocked = fixture(locked);
const response = await unlocked.call(query);
assert.equal(response.status, 200, "authorized listing capability displays the real preview");
assert.equal(await response.text(), "test");
assert.match(response.headers.get("cache-control"), /private.*no-store/);
assert.equal(unlocked.state.upgrades, 0, "private preview reads must not migrate stored media");
assert.equal((await fixture({ ...locked, isActive: false }).call(query)).status, 403, "disabling invalidates an existing preview URL");
assert.equal((await fixture({ ...locked, expiresAt: new Date(0) }).call(query)).status, 410, "expiry invalidates an existing preview URL");
assert.equal((await fixture({ ...locked, passwordHash: "changed" }).call(query)).status, 401, "password changes revoke old preview capabilities");
assert.equal((await fixture(locked).call(query.replace("gallery=", "gallery=wrong"))).status, 401);
assert.equal((await fixture(locked).call(`${query}tampered`)).status, 401);
for (const [gallery, expected] of [[{ ...open, isActive: false }, 403], [{ ...open, expiresAt: new Date(0) }, 410], [locked, 401]]) {
  const denied = await fixture(gallery).listing();
  assert.equal(denied.status, expected);
  assert.equal((await denied.json()).items, undefined, "denied listings expose neither preview URLs nor grants");
}
const listed = fixture(locked, null, "https://legacy.example.test/preview.png");
const listing = await listed.listing("test-only-password");
assert.equal(listing.status, 200);
assert.match(listing.headers.get("cache-control"), /private.*no-store/);
const listedUrl = new URL((await listing.json()).items[0].previewImage, "https://local.test");
assert.equal(listedUrl.pathname, "/api/media/photography-gallery/9", "remote stored previews also use the protected route");
assert.ok(!listedUrl.href.includes("test-only-password"), "preview URLs do not expose the gallery password");
assert.equal((await listed.call(listedUrl.search)).status, 302, "the actual unlocked listing grants access to its preview");
assert.match(listed.publicMediaValue("photography-gallery", listed.item, listed.item.previewImage), /^\/api\/media\/photography-gallery\/9/, "staff listings also proxy remote previews");
const staff = { id: 7, isActive: true, role: "employee", permissions: ["photography"] };
assert.equal((await fixture({ ...locked, isActive: false }, staff).call()).status, 200, "assigned authenticated staff retain gallery management previews");
assert.equal((await fixture(locked, { ...staff, id: 8 }).call()).status, 401, "unassigned staff cannot bypass the gallery");
assert.equal((await fixture(locked, { ...staff, id: 8 }, undefined, { crew: true }).call()).status, 200, "assigned crew retain access");
for (const crewStatus of ["revoked", "rejected"]) {
  const removed = fixture(locked, { ...staff, id: 8 }, undefined, { crew: true, crewStatus });
  assert.equal((await removed.call()).status, 401, `${crewStatus} crew cannot read a private preview`);
  assert.equal((await removed.staffListing()).status, 403, `${crewStatus} crew cannot use the gallery producer even if old portal scoping includes the event`);
}
for (const crewStatus of [null, "assigned", "accepted"]) {
  const activeCrew = fixture(locked, { ...staff, id: 8 }, undefined, { crew: true, crewStatus });
  assert.equal((await activeCrew.call()).status, 200, "valid/legacy crew preview access is preserved");
  assert.equal((await activeCrew.staffListing()).status, 200, "valid/legacy crew gallery access is preserved");
}
assert.equal((await fixture(locked, { ...staff, id: 8, role: "manager" }).call()).status, 200, "photography managers retain access");
assert.equal((await fixture(locked, { ...staff, permissions: [] }).call()).status, 401, "event assignment alone does not replace photography permission");
const remote = await fixture(locked, null, "https://legacy.example.test/preview.png").call(query);
assert.equal(remote.status, 302);
assert.match(remote.headers.get("cache-control"), /private.*no-store/);
const storage = fixture(locked, null, "https://storage.example.test/storage/v1/object/public/test/synthetic.png", { storage: true });
assert.equal((await storage.call()).status, 401);
assert.equal(storage.state.fetches, 0, "unauthorized requests never fetch a private storage object");
const storageResponse = await storage.call(query);
assert.equal(storageResponse.status, 200);
assert.equal(await storageResponse.text(), "synthetic-storage-bytes");
assert.match(storageResponse.headers.get("cache-control"), /private.*no-store/, "private bytes never inherit the shared public media cache header");
assert.equal(storage.state.fetches, 1);
assert.equal(rules.verifyGalleryPreviewToken(locked, 10, token, secret), false, "capabilities are bound to the item");
assert.equal(rules.verifyGalleryPreviewToken({ ...locked, id: 5 }, 9, token, secret), false, "capabilities are bound to the parent gallery");
assert.equal(rules.verifyGalleryPreviewToken(locked, 9, token, secret, Date.now() + 2 * 86400_000), false, "preview grants expire");
console.log("Gallery media access: PASS (synthetic fixtures; no database or media network requests)");
