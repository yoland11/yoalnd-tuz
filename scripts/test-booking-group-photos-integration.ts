/**
 * Original group-photo handler against real, isolated PostgreSQL and a loopback
 * private-object HTTP fixture. This is NOT a live Supabase or Production test.
 * Requires the shared fail-closed TEST_DATABASE_URL guard; --strict rejects skips.
 * Every database row and local object belongs to this exact run.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import vm from "node:vm";
import ts from "typescript";
// @ts-expect-error shared .mjs guard without type declarations
import { assertSafeTestDatabase } from "./lib/test-database-guard.mjs";

let target: { url: string; database: string };
try {
  target = assertSafeTestDatabase(process.env);
} catch (cause) {
  console.log("SKIPPED booking group photos integration: separately verified TEST database and write flags unavailable (not reported as PASS).");
  if (process.argv.includes("--strict")) console.error(cause instanceof Error ? cause.message : String(cause));
  process.exit(process.argv.includes("--strict") ? 2 : 0);
}
// No application database module is imported until this separate target is safe.
process.env.DATABASE_URL = target!.url;
const { db, pool, serviceOrdersTable, photographyUploadsTable, photographyEventsTable, staffTable } = await import("@workspace/db");
const { sql, eq, and, desc, inArray } = await import("drizzle-orm");
const { NextRequest, NextResponse } = await import("next/server");
const { z } = await import("zod");
const { createApiErrorPayload, makeRequestId } = await import("../src/server/write-safety");
const { readRequestBody } = await import("../src/server/request-body");

const run = `gphoto-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
const bucket = "ajn-group-photo-test";
const storageKey = `local-only-${run}`;
const objects = new Map<string, Buffer>();
const requests: Array<{ method: string; path: string }> = [];
let failStorage: ((method: string, path: string) => number | undefined) | undefined;
const server = createServer(async (req, res) => {
  try {
    const path = req.url || "";
    const method = req.method || "GET";
    requests.push({ method, path });
    if (req.headers.apikey !== storageKey || req.headers.authorization !== `Bearer ${storageKey}`) {
      res.writeHead(401).end("private fixture requires authentication"); return;
    }
    if (!path.startsWith(`/storage/v1/object/${bucket}/bookings/group-photos/`)) {
      res.writeHead(400).end("fixture refuses an unrelated object path"); return;
    }
    const failure = failStorage?.(method, path);
    if (failure) { res.writeHead(failure).end("controlled storage failure"); return; }
    if (method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      if (objects.has(path)) { res.writeHead(409).end("already stored"); return; }
      assert.equal(req.headers["x-upsert"], "false", "existing private bytes may not be replaced");
      objects.set(path, Buffer.concat(chunks));
      res.writeHead(200, { "content-type": "application/json" }).end("{}"); return;
    }
    if (method === "GET") {
      const bytes = objects.get(path);
      if (!bytes) { res.writeHead(404).end("missing"); return; }
      res.writeHead(200, { "content-type": "image/png" }).end(bytes); return;
    }
    res.writeHead(405).end("unsupported");
  } catch (cause) {
    res.writeHead(500).end(cause instanceof Error ? cause.message : String(cause));
  }
});
await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
const storageOrigin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const privateFetch: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  assert.equal(url.origin, storageOrigin, "test must never contact Production or real Supabase storage");
  return fetch(input, init);
};

const source = ts.createSourceFile("api.ts", readFileSync("src/server/api.ts", "utf8"), ts.ScriptTarget.Latest, true);
function declaration(name: string): ts.FunctionDeclaration {
  const node = source.statements.find((item): item is ts.FunctionDeclaration => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert.ok(node, `original ${name} handler/helper must exist`);
  return node;
}
function groupBranch(name: string): string {
  const fn = declaration(name);
  const node = fn.body!.statements.find((item): item is ts.IfStatement => ts.isIfStatement(item) && item.expression.getText(source) === 'resource === "group-photos"');
  assert.ok(node, `original ${name} group-photo delegation must exist`);
  return node.getText(source);
}
const helpers = ["json", "error", "validationError", "body", "int", "bodyFromBuffer", "imageMimeFromBytes", "storageExtension", "isPhotographyManager", "canAccessPhotographyEvent", "bookingGroupPhotoJson", "handleBookingGroupPhotos"];
const code = helpers.map((name) => declaration(name).getText(source)).join("\n") + `
async function adminEntry(req, id, auth, write, photoId, action) {
 const resource="group-photos", source="service", parts=["admin","booking-operations",source,String(id),resource,photoId===undefined?undefined:String(photoId),action];
 const can=()=>write;
 ${groupBranch("handleBookingOperations")}
}
async function staffEntry(req, id, auth, manager, photoId, action, crewEventIds=new Set()) {
 const resource="group-photos", ref=String(id), parts=["staff","photography",resource,ref,photoId===undefined?undefined:String(photoId),action];
 ${groupBranch("handlePhotographyStaffPortal")}
}`;
const audits: Array<{ action: string; entityType: string; entityId: number; metadata: any }> = [];
const context: any = vm.createContext({
  db, sql, eq, and, desc, inArray, serviceOrdersTable, photographyUploadsTable, photographyEventsTable, staffTable,
  z, Buffer, NextResponse, Headers, URLSearchParams, createHash, createApiErrorPayload, makeRequestId, readRequestBody,
  BOOKING_GROUP_PHOTO_BUCKET: bucket, STORAGE_URL: storageOrigin, STORAGE_SERVICE_KEY: storageKey, fetch: privateFetch,
  logAdminActivity: async (_req: unknown, action: string, entityType: string, entityId: number, metadata: any) => { audits.push({ action, entityType, entityId, metadata }); },
  console,
});
vm.runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);

type Actor = { id: number; username: string; fullName: string; role: string; permissions: string[] };
const staffIds: number[] = [], bookingIds: number[] = [];
let serviceId: number | undefined;
const one = async (query: any) => ((await db.execute(query)) as any).rows[0];
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6SioAAAAASUVORK5CYII=", "base64");
const image = (label: string) => Buffer.concat([png, Buffer.from(`${run}:${label}`)]);
const req = (method: string, payload?: FormData | Record<string, unknown>, query = "") => new NextRequest(`http://ajn-test.invalid/group-photos${query}`, {
  method, ...(payload instanceof FormData ? { body: payload } : payload ? { body: JSON.stringify(payload), headers: { "content-type": "application/json" } } : {}),
});
function upload(bytes: Buffer, note = "", thumb?: Buffer, declaredMime = "image/png") {
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(bytes)], { type: declaredMime }), `${run}.png`);
  form.set("note", note);
  if (thumb) form.set("thumbnail", new Blob([new Uint8Array(thumb)], { type: "image/png" }), "thumb.png");
  return req("POST", form);
}
const jsonOf = async (response: Response, status = 200) => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };
const invoke = (portal: boolean, request: any, actor: Actor, bookingId: number, photoId?: number, action?: string, write = true) => portal
  ? context.staffEntry(request, bookingId, actor, context.isPhotographyManager(actor), photoId, action)
  : context.adminEntry(request, bookingId, actor, write, photoId, action);

try {
  const staff = async (label: string, role: string): Promise<Actor> => {
    const username = `${run}-${label}`;
    const row = await one(sql`INSERT INTO staff(username,password_hash,full_name,role,permissions) VALUES(${username},'unused-test-hash',${username},${role},'[]'::jsonb) RETURNING id`);
    staffIds.push(Number(row.id));
    return { id: Number(row.id), username, fullName: username, role, permissions: [] };
  };
  const owner = await staff("owner", "photography"), other = await staff("other", "photography"), manager = await staff("manager", "manager");
  serviceId = Number((await one(sql`INSERT INTO services(name,name_ar,type) VALUES(${run},${run},'photography') RETURNING id`)).id);
  for (const label of ["first", "second"]) {
    bookingIds.push(Number((await one(sql`INSERT INTO service_orders(service_id,customer_name,phone,event_date,tracking_code,total_amount,deposit_amount,remaining_amount,custom_fields) VALUES(${serviceId},${`${run}-${label}`},'07700000001','2032-06-12',${`${run}-${label}`},50000,20000,30000,${JSON.stringify({ testRun: run })}::jsonb) RETURNING id`)).id));
  }
  const [bookingId, otherBooking] = bookingIds;
  await db.execute(sql`INSERT INTO photography_events(client_token,booking_id,groom_name,event_date,assigned_staff_id,assigned_staff_name) VALUES(${run},${bookingId},${run},'2032-06-12',${owner.id},${owner.fullName})`);
  const [reference] = await db.insert(photographyUploadsTable).values({ bookingId, kind: "reference", fileUrl: "private", fileName: `${run}-reference.png`, storagePath: `${run}/reference.png`, mimeType: "image/png", uploadedBy: owner.id, metadata: { note: "reference must survive" } }).returning();
  const originalBooking = await db.query.serviceOrdersTable.findFirst({ where: eq(serviceOrdersTable.id, bookingId) });

  const initial = await jsonOf(await invoke(true, req("GET"), owner, bookingId));
  assert.deepEqual(initial.data, [], "reference images must not become group photos");
  const noAccess = await invoke(true, req("GET"), other, bookingId);
  await jsonOf(noAccess, 403);
  const bytes = image("original"), thumb = image("thumbnail");
  const created = await jsonOf(await invoke(true, upload(bytes, "  ملاحظة أولى  ", thumb), owner, bookingId), 201);
  const photoId = created.data.id;
  assert.equal(created.data.note, "ملاحظة أولى");
  assert.equal(created.data.uploadedBy, owner.id);
  assert.equal(created.data.uploadedByName, owner.fullName);
  assert.match(created.data.url, new RegExp(`^/api/staff/photography/group-photos/${bookingId}/${photoId}/file$`));
  assert.equal(created.data.thumbnailUrl, `${created.data.url}?size=thumb`);
  const row = await db.query.photographyUploadsTable.findFirst({ where: eq(photographyUploadsTable.id, photoId) });
  assert.equal(row?.fileUrl, "private");
  assert.equal(row?.accessLevel, "team");
  assert.equal(row?.metadata.checksum, createHash("sha256").update(bytes).digest("hex"));
  const objectKey = `/storage/v1/object/${bucket}/${row!.storagePath}`;
  assert.deepEqual(objects.get(objectKey), bytes, "original image bytes survive unchanged");
  assert.deepEqual(objects.get(`/storage/v1/object/${bucket}/${row!.metadata.thumbnailPath}`), thumb);
  const beforeRetry = requests.length;
  const duplicate = await jsonOf(await invoke(false, upload(bytes), manager, bookingId));
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.data.id, photoId);
  assert.equal(requests.length, beforeRetry, "sequential retry may not upload another object");
  const parallelBytes = image("concurrent");
  const concurrent = await Promise.all(Array.from({ length: 4 }, () => invoke(true, upload(parallelBytes), owner, bookingId)));
  const parallel = await Promise.all(concurrent.map(async (response) => jsonOf(response, response.status === 201 ? 201 : 200)));
  assert.equal(new Set(parallel.map((item) => item.data.id)).size, 1, "PostgreSQL advisory lock prevents duplicate rows under concurrent retry");
  const allRows = await db.query.photographyUploadsTable.findMany({ where: and(eq(photographyUploadsTable.bookingId, bookingId), eq(photographyUploadsTable.kind, "group_photo")) });
  assert.equal(allRows.length, 2);

  for (const portal of [false, true]) {
    const list = await jsonOf(await invoke(portal, req("GET"), portal ? owner : manager, bookingId));
    assert.deepEqual(list.data.map((item: any) => item.id).sort(), allRows.map((item) => item.id).sort());
    assert.equal(list.data.find((item: any) => item.id === photoId).uploadedByName, owner.fullName);
    assert.ok(list.data.every((item: any) => item.url.startsWith(portal ? "/api/staff/photography/" : "/api/admin/booking-operations/")));
  }
  await jsonOf(await invoke(false, req("PATCH", { note: "ملاحظة محدثة" }), manager, bookingId, photoId));
  const updatedList = await jsonOf(await invoke(true, req("GET"), owner, bookingId));
  assert.equal(updatedList.data.find((item: any) => item.id === photoId).note, "ملاحظة محدثة");
  const nonOwnerList = await jsonOf(await context.handleBookingGroupPhotos(req("GET"), bookingId, other, true, "/test", undefined, undefined, true));
  assert.equal(nonOwnerList.data.find((item: any) => item.id === photoId).canEdit, false);
  await jsonOf(await context.handleBookingGroupPhotos(req("PATCH", { note: "forbidden" }), bookingId, other, true, "/test", photoId, undefined, true), 403);
  await jsonOf(await context.handleBookingGroupPhotos(req("DELETE"), bookingId, other, true, "/test", photoId, undefined, true), 403);
  await jsonOf(await invoke(false, req("PATCH", { note: "forbidden" }), manager, bookingId, photoId, undefined, false), 403);
  await jsonOf(await invoke(false, req("PATCH", { note: "x".repeat(1001) }), manager, bookingId, photoId), 400);
  await jsonOf(await invoke(false, req("GET"), manager, otherBooking, photoId, "file"), 404);
  await jsonOf(await invoke(false, req("GET"), manager, bookingId, reference.id, "file"), 404);

  const full = await invoke(true, req("GET"), owner, bookingId, photoId, "file");
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("cache-control"), "private, no-store");
  assert.equal(full.headers.get("x-content-type-options"), "nosniff");
  assert.equal(full.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), bytes);
  const small = await invoke(false, req("GET", undefined, "?size=thumb"), manager, bookingId, photoId, "file");
  assert.deepEqual(Buffer.from(await small.arrayBuffer()), thumb);
  assert.equal((await fetch(`${storageOrigin}${objectKey}`)).status, 401, "storage fixture enforces private object authentication");
  const [badPath] = await db.insert(photographyUploadsTable).values({ bookingId, kind: "group_photo", fileUrl: "private", storagePath: `bookings/group-photos/${otherBooking}/unrelated.png`, uploadedBy: owner.id }).returning();
  const beforeBadPath = requests.length;
  await jsonOf(await invoke(false, req("GET"), manager, bookingId, badPath.id, "file"), 409);
  assert.equal(requests.length, beforeBadPath, "cross-booking object path is refused before storage access");
  failStorage = (method) => method === "GET" ? 500 : undefined;
  await jsonOf(await invoke(false, req("GET"), manager, bookingId, photoId, "file"), 502);
  failStorage = undefined;

  const rejectsUpload = async (request: any, status: number) => {
    const before = requests.length;
    await jsonOf(await invoke(true, request, owner, bookingId), status);
    assert.equal(requests.length, before, "invalid input may not reach private storage");
  };
  await rejectsUpload(req("POST", new FormData()), 422);
  await rejectsUpload(upload(Buffer.alloc(12)), 413);
  await rejectsUpload(upload(Buffer.alloc(8 * 1024 * 1024 + 1)), 413);
  await rejectsUpload(upload(Buffer.alloc(64, 0x3c), "", undefined, "image/jpeg"), 415);
  await rejectsUpload(upload(image("invalid-thumb"), "", Buffer.alloc(512 * 1024 + 1)), 413);
  await rejectsUpload(upload(image("invalid-thumb-bytes"), "", Buffer.alloc(64)), 415);
  const failedOriginal = image("failed-storage"), failedOriginalHash = createHash("sha256").update(failedOriginal).digest("hex");
  failStorage = (method) => method === "POST" ? 500 : undefined;
  await jsonOf(await invoke(true, upload(failedOriginal), owner, bookingId), 503);
  assert.ok(!objects.has(`/storage/v1/object/${bucket}/bookings/group-photos/${bookingId}/${failedOriginalHash}.png`));
  const failedThumbOriginal = image("failed-thumbnail"), failedThumb = image("failed-thumbnail-small");
  failStorage = (method, path) => method === "POST" && path.includes("-thumb.") ? 500 : undefined;
  await jsonOf(await invoke(true, upload(failedThumbOriginal, "", failedThumb), owner, bookingId), 503);
  failStorage = undefined;
  assert.equal((await db.query.photographyUploadsTable.findMany({ where: and(eq(photographyUploadsTable.bookingId, bookingId), eq(photographyUploadsTable.kind, "group_photo")) })).length, 3, "storage failure creates no photo database record");
  const recoveredOriginal = await jsonOf(await invoke(true, upload(failedOriginal), owner, bookingId), 201);
  const recoveredThumbnail = await jsonOf(await invoke(true, upload(failedThumbOriginal, "", failedThumb), owner, bookingId), 201);
  assert.notEqual(recoveredOriginal.data.id, recoveredThumbnail.data.id);
  assert.ok(recoveredThumbnail.data.thumbnailUrl, "retry recovers the thumbnail after original object already exists");
  const recoveredThumbnailResponse = await invoke(false, req("GET", undefined, "?size=thumb"), manager, bookingId, recoveredThumbnail.data.id, "file");
  assert.deepEqual(Buffer.from(await recoveredThumbnailResponse.arrayBuffer()), failedThumb);
  await jsonOf(await invoke(false, req("PUT"), manager, bookingId, photoId), 405);

  await jsonOf(await invoke(true, req("DELETE"), owner, bookingId, photoId));
  assert.equal(await db.query.photographyUploadsTable.findFirst({ where: eq(photographyUploadsTable.id, photoId) }), undefined);
  await jsonOf(await invoke(false, req("GET"), manager, bookingId, photoId, "file"), 404);
  const concurrentId = parallel[0].data.id;
  await jsonOf(await invoke(true, req("DELETE"), manager, bookingId, concurrentId));
  const afterDelete = await jsonOf(await invoke(true, req("GET"), owner, bookingId));
  assert.ok(!afterDelete.data.some((item: any) => item.id === photoId || item.id === concurrentId));
  const referenceAfter = await db.query.photographyUploadsTable.findFirst({ where: eq(photographyUploadsTable.id, reference.id) });
  assert.equal(referenceAfter?.metadata.note, "reference must survive");
  const bookingAfter = await db.query.serviceOrdersTable.findFirst({ where: eq(serviceOrdersTable.id, bookingId) });
  assert.deepEqual(bookingAfter, originalBooking, "photo actions must preserve booking identity, finances, selections and workflow");
  for (const action of ["booking_group_photo_uploaded", "booking_group_photo_note_updated", "booking_group_photo_removed"]) assert.ok(audits.some((item) => item.action === action && item.entityType === "service_order" && item.entityId === bookingId));
  console.log("PASS original group-photo handler: real PostgreSQL uploads/thumbnail metadata, concurrent retries, shared admin/staff records, note/delete permissions, private file proxy, validation, storage errors, preserved references and original booking.");
  console.log("LIMITATION: private object HTTP storage and audit capture are controlled local fixtures; live Supabase/RLS and session authentication are not asserted by this test.");
} finally {
  failStorage = undefined;
  try {
    if (bookingIds.length) {
      // These IDs were returned only by this exact run's inserts; no broad cleanup.
      await db.delete(photographyUploadsTable).where(inArray(photographyUploadsTable.bookingId, bookingIds));
      await db.delete(photographyEventsTable).where(and(inArray(photographyEventsTable.bookingId, bookingIds), eq(photographyEventsTable.clientToken, run)));
      await db.execute(sql`DELETE FROM service_orders WHERE id IN (${sql.join(bookingIds.map((id) => sql`${id}`), sql`,`)}) AND custom_fields->>'testRun' = ${run}`);
    }
    if (serviceId) await db.execute(sql`DELETE FROM services WHERE id=${serviceId} AND name=${run}`);
    if (staffIds.length) await db.execute(sql`DELETE FROM staff WHERE id IN (${sql.join(staffIds.map((id) => sql`${id}`), sql`,`)}) AND username LIKE ${`${run}-%`}`);
  } finally {
    objects.clear();
    await pool.end();
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeAllConnections();
    await closed;
  }
}
