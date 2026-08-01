import { NextResponse, type NextRequest } from "next/server";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  db,
  graduationGroupsTable,
  graduationOrdersTable,
} from "@workspace/db";
import { getGraduationMeasurementStatus } from "@/lib/graduation-measurements";
import { getGraduationProductionMeasurementBlock } from "@/server/graduation-measurements";

/**
 * Tailors Portal (بوابة الخياطين) server module.
 *
 * A tailor is a staff member. Orders are "assigned to me" when either
 * `assigned_staff_id` is my staff id, or the order's tailor resource
 * (`production_estimate.tailorAssignment.tailorId` → graduation_resources whose
 * operator_id is my staff id) points at me. Every read/write is scoped by this
 * rule and returns 403 for anything else — changing the URL cannot open an
 * unassigned order. Nothing here touches pricing, payments or accounting.
 *
 * This module never duplicates student/order rows: measurements live on the
 * existing `graduation_orders.measurements` jsonb, and every edit is appended
 * (never overwritten) to an additive `graduation_measurement_history` table.
 */

// Local user shape (mirrors AdminUser) — avoids a runtime import cycle with api.ts.
export type TailorUser = {
  id: number;
  username: string;
  fullName: string;
  role: string;
  permissions: string[];
  isActive: boolean;
};

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}
function error(message: string, status = 400, details?: unknown) {
  return json({ error: message, ...(details ? { details } : {}) }, status);
}

// ---------------------------------------------------------------------------
// Schema guard — additive audit history table (no existing data is touched).
// ---------------------------------------------------------------------------
let historyReady: Promise<void> | null = null;
async function ensureTailoringTables() {
  if (!historyReady) {
    historyReady = db
      .execute(sql`
        CREATE TABLE IF NOT EXISTS graduation_measurement_history (
          id serial PRIMARY KEY,
          graduation_order_id integer NOT NULL REFERENCES graduation_orders(id) ON DELETE CASCADE,
          previous jsonb NOT NULL DEFAULT '{}'::jsonb,
          next jsonb NOT NULL DEFAULT '{}'::jsonb,
          action varchar(40) NOT NULL DEFAULT 'edit',
          changed_by integer,
          changed_by_name text NOT NULL DEFAULT '',
          reason text,
          notes text,
          created_at timestamp NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS graduation_measurement_history_order_idx
          ON graduation_measurement_history(graduation_order_id, created_at DESC);
      `)
      .then(() => undefined)
      .catch((e) => {
        historyReady = null;
        throw e;
      });
  }
  await historyReady;
}

// ---------------------------------------------------------------------------
// Assignment scoping.
// ---------------------------------------------------------------------------
/** Admins get oversight of every order; everyone else is scoped to their own. */
function canSeeAll(user: TailorUser) {
  return (
    user.role === "admin" ||
    ["graduation_manager", "graduation"].some((permission) =>
      user.permissions.includes(permission),
    )
  );
}

/** Portal access grants read-only access to assigned work; mutations require a
 * specific tailoring permission (or a graduation/tailoring management role). */
function hasTailoringPermission(user: TailorUser, permission: string, readOnly = false) {
  if (user.role === "admin") return true;
  if (user.permissions.includes(permission)) return true;
  if (readOnly && user.permissions.includes("tailoring.portal.access")) return true;
  return ["tailoring", "graduation", "graduation_production", "graduation_manager"].some((p) => user.permissions.includes(p));
}

function requireTailoringPermission(user: TailorUser, permission: string, readOnly = false) {
  return hasTailoringPermission(user, permission, readOnly)
    ? null
    : error("ليس لديك صلاحية تنفيذ هذا الإجراء", 403);
}

/** SQL predicate: order is assigned to this tailor (direct or via resource). */
function assignedCondition(userId: number) {
  return or(
    eq(graduationOrdersTable.assignedStaffId, userId),
    sql`(${graduationOrdersTable.productionEstimate} -> 'tailorAssignment' ->> 'tailorId')::int IN (
      SELECT id FROM graduation_resources WHERE resource_type = 'tailor' AND operator_id = ${userId}
    )`,
  );
}

/** Unassigned orders with incomplete measurements are the shared intake queue. */
function pendingMeasurementsCondition() {
  return and(
    isNull(graduationOrdersTable.assignedStaffId),
    sql`coalesce(${graduationOrdersTable.productionEstimate} -> 'tailorAssignment' ->> 'tailorId', '') = ''`,
    sql`not (
      coalesce(${graduationOrdersTable.measurements}->>'status', '') in ('complete', 'needs_review', 'approved')
      or (
        coalesce(nullif(${graduationOrdersTable.measurements}->>'height', ''), '') <> ''
        and coalesce(nullif(${graduationOrdersTable.measurements}->>'shoulder', ''), '') <> ''
        and coalesce(nullif(${graduationOrdersTable.measurements}->>'chest', ''), '') <> ''
        and coalesce(nullif(${graduationOrdersTable.measurements}->>'waist', ''), '') <> ''
        and coalesce(nullif(${graduationOrdersTable.measurements}->>'sleeveLength', ''), '') <> ''
      )
      or (
        ${graduationOrdersTable.measurements}->>'method' = 'ready'
        and coalesce(
          nullif(${graduationOrdersTable.measurements}->>'readySize', ''),
          nullif(${graduationOrdersTable.measurements}->>'standardSize', ''),
          ''
        ) <> ''
      )
    )`,
  );
}

function visibleCondition(user: TailorUser) {
  return or(assignedCondition(user.id), pendingMeasurementsCondition());
}

// ---------------------------------------------------------------------------
// Measurement helpers.
// ---------------------------------------------------------------------------
const MEASUREMENT_NUMERIC_KEYS = [
  "height", "weight", "shoulder", "chest", "waist",
  "sleeveLength", "robeLength", "neck", "capSize",
] as const;
const MEASUREMENT_TEXT_KEYS = [
  "gender", "standardSize", "customSize", "bodyShapeNotes", "tailorNotes",
] as const;
export const TAILOR_MEASUREMENT_STATUSES = [
  "not_started", "partial", "complete", "needs_review", "approved",
] as const;

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Derive a status from the filled fields when the tailor didn't set one. */
function deriveStatus(m: Record<string, unknown>): string {
  if (m.status === "needs_review" || m.status === "approved")
    return m.status;
  return getGraduationMeasurementStatus(m);
}

// ---------------------------------------------------------------------------
// Serialization.
// ---------------------------------------------------------------------------
type OrderRow = typeof graduationOrdersTable.$inferSelect;
type GroupRow = typeof graduationGroupsTable.$inferSelect;

function tailorAssignmentOf(order: OrderRow) {
  return rec(rec(order.productionEstimate).tailorAssignment);
}

function serializeSummary(order: OrderRow, group?: GroupRow | null) {
  const m = rec(order.measurements);
  const assignment = tailorAssignmentOf(order);
  return {
    id: order.id,
    orderNo: order.orderNo,
    studentCode: order.studentCode,
    qrToken: order.qrToken,
    barcodeValue: order.barcodeValue,
    name: order.customerName,
    phone: order.phone,
    phone2: order.phone2 ?? "",
    groupId: order.groupId,
    groupName: group?.title ?? "",
    groupNo: group?.groupNo ?? "",
    university: group?.university ?? String(rec(order.customText).university ?? ""),
    college: group?.college ?? String(rec(order.customText).college ?? ""),
    department: group?.department ?? String(rec(order.customText).department ?? ""),
    graduationYear: group?.graduationYear ?? String(rec(order.customText).graduationYear ?? ""),
    styleKey: order.styleKey,
    productionStage: order.productionStage,
    measurementStatus: deriveStatus(m),
    measurementMethod: (m.method as string) ?? "custom",
    finalSize: (m.standardSize as string) || (m.readySize as string) || (m.customSize as string) || "",
    tailorName: (assignment.tailorName as string) ?? "",
    dueDate: order.dueDate,
    updatedAt: order.updatedAt,
  };
}

function serializeDetail(order: OrderRow, group: GroupRow | null, history: unknown[]) {
  const garment = rec(order.garmentDetails);
  const customText = rec(order.customText);
  return {
    ...serializeSummary(order, group),
    // Garment / design (read-only for the tailor — no pricing exposed).
    packageKey: order.packageKey,
    robe: garment.robe ?? order.styleKey,
    robeModel: garment.robeModel ?? garment.model ?? "",
    sash: garment.sash ?? customText.text ?? "",
    cap: garment.cap ?? "",
    accessories: Array.isArray(order.accessories) ? order.accessories : [],
    colors: rec(order.colors),
    productionNotes: order.notes ?? "",
    measurements: rec(order.measurements),
    photos: Array.isArray(garment.tailorPhotos) ? garment.tailorPhotos : [],
    alterations: Array.isArray(garment.alterations) ? garment.alterations : [],
    notesTiers: rec(garment.notesTiers),
    history,
  };
}

/** Production stages a tailor may move an approved order through. */
export const TAILOR_PRODUCTION_STAGES = [
  "ready_for_cutting", "cutting", "sewing", "fitting",
  "adjustment", "ironing", "quality_check", "ready",
] as const;

async function loadGroups(ids: number[]) {
  const unique = [...new Set(ids.filter((id): id is number => Number.isFinite(id)))];
  if (!unique.length) return new Map<number, GroupRow>();
  const rows = await db.query.graduationGroupsTable.findMany({
    where: inArray(graduationGroupsTable.id, unique),
  });
  return new Map(rows.map((g) => [g.id, g]));
}

/** Fetch one assigned order or one item in the shared missing-measurements queue. */
async function fetchAssignedOrder(id: number, user: TailorUser) {
  const order = await db.query.graduationOrdersTable.findFirst({
    where: canSeeAll(user)
      ? eq(graduationOrdersTable.id, id)
      : and(eq(graduationOrdersTable.id, id), visibleCondition(user)),
  });
  return order ?? null;
}

// ---------------------------------------------------------------------------
// Shared measurement write helpers (used by single + group-bulk saves).
// ---------------------------------------------------------------------------
function buildNextMeasurements(previous: Record<string, unknown>, body: Record<string, unknown>, user: TailorUser) {
  const incoming: Record<string, unknown> = {};
  for (const key of MEASUREMENT_NUMERIC_KEYS) {
    if (body[key] !== undefined) {
      const raw = body[key];
      incoming[key] = raw === "" || raw === null ? undefined : Number(raw);
    }
  }
  for (const key of MEASUREMENT_TEXT_KEYS) {
    if (body[key] !== undefined) incoming[key] = body[key] === null ? undefined : String(body[key]);
  }
  if (body.method === "ready" || body.method === "custom") incoming.method = body.method;
  if (body.readySize !== undefined) incoming.readySize = body.readySize || undefined;
  const next: Record<string, unknown> = { ...previous, ...incoming };
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  const derivedInput = { ...next };
  delete derivedInput.status;
  next.status = typeof body.status === "string" && (TAILOR_MEASUREMENT_STATUSES as readonly string[]).includes(body.status)
    ? body.status
    : deriveStatus(derivedInput);
  next.updatedByName = user.fullName || user.username;
  next.updatedAt = new Date().toISOString();
  return next;
}

async function persistMeasurements(orderId: number, next: Record<string, unknown>) {
  await db.update(graduationOrdersTable)
    .set({ measurements: next as OrderRow["measurements"], updatedAt: new Date() })
    .where(eq(graduationOrdersTable.id, orderId));
}

async function recordHistory(orderId: number, previous: unknown, next: unknown, action: string, user: TailorUser, reason?: string | null, notes?: string | null) {
  await db.execute(sql`
    INSERT INTO graduation_measurement_history
      (graduation_order_id, previous, next, action, changed_by, changed_by_name, reason, notes)
    VALUES (${orderId}, ${JSON.stringify(previous)}::jsonb, ${JSON.stringify(next)}::jsonb, ${action},
            ${user.id}, ${user.fullName || user.username}, ${reason ?? null}, ${notes ?? null})
  `);
}

/** Managers/admins may approve or return submitted measurements. */
function canApprove(user: TailorUser) {
  return user.role === "admin"
    || ["graduation.approval.manage", "graduation_manager", "graduation"].some((p) => user.permissions.includes(p));
}

/** A group is accessible when it has an assigned or pending measurement order. */
async function canAccessGroup(groupId: number, user: TailorUser) {
  if (canSeeAll(user)) return true;
  const row = await db.query.graduationOrdersTable.findFirst({
    where: and(eq(graduationOrdersTable.groupId, groupId), visibleCondition(user)),
    columns: { id: true },
  });
  return !!row;
}

/**
 * A group page must not widen a tailor's access.  Seeing one assigned student
 * grants access to the group workspace, but not to classmates assigned to a
 * different tailor. Pending, unassigned measurement rows stay available to
 * the authorized tailor intake queue. Managers retain the complete view.
 */
function groupOrdersCondition(groupId: number, user: TailorUser) {
  return canSeeAll(user)
    ? eq(graduationOrdersTable.groupId, groupId)
    : and(eq(graduationOrdersTable.groupId, groupId), visibleCondition(user));
}

/** Flattened row for the group measurement table. */
function serializeGroupRow(order: OrderRow) {
  const m = rec(order.measurements);
  const num = (k: string) => (m[k] === undefined || m[k] === null ? "" : m[k]);
  return {
    id: order.id,
    studentCode: order.studentCode,
    name: order.customerName,
    height: num("height"), weight: num("weight"), shoulder: num("shoulder"),
    sleeveLength: num("sleeveLength"), robeLength: num("robeLength"), capSize: num("capSize"),
    finalSize: (m.standardSize as string) || (m.readySize as string) || (m.customSize as string) || "",
    measurementStatus: deriveStatus(m),
    tailorName: (rec(rec(order.productionEstimate).tailorAssignment).tailorName as string) ?? "",
    updatedAt: m.updatedAt ?? order.updatedAt,
    measurements: m,
  };
}

// Injected notifier (createNotification from api.ts) — avoids an import cycle.
export type TailorNotifier = (input: {
  audienceType?: "admin" | "customer";
  staffId?: number | null;
  type: string;
  title: string;
  body?: string;
  entityType?: string | null;
  entityId?: number | null;
  href?: string | null;
  metadata?: Record<string, unknown>;
}) => Promise<unknown>;

// ---------------------------------------------------------------------------
// Route handler.
// ---------------------------------------------------------------------------
export async function handleTailorPortal(
  req: NextRequest,
  parts: string[],
  user: TailorUser,
  notify?: TailorNotifier,
): Promise<NextResponse | null> {
  await ensureTailoringTables();
  const method = req.method;

  // The router authorizes entry to this module; enforce the fine-grained action
  // server-side here so a read-only tailor cannot mutate an assigned order.
  if (method === "GET") {
    const denied = requireTailoringPermission(user, "tailoring.assigned_orders.view", true);
    if (denied) return denied;
  }
  if (method === "POST") {
    const actionPermissions: Record<string, string> = {
      submit: "tailoring.measurements.submit",
      photos: "tailoring.photos.upload",
      alterations: "tailoring.alterations.manage",
      production: "tailoring.production.update",
      notes: "tailoring.measurements.edit",
    };
    const action = parts[2] ?? "";
    if (action === "measurements" && !hasTailoringPermission(user, "tailoring.measurements.create") && !hasTailoringPermission(user, "tailoring.measurements.edit")) {
      return error("ليس لديك صلاحية تنفيذ هذا الإجراء", 403);
    }
    const permission = actionPermissions[action];
    if (permission) {
      const denied = requireTailoringPermission(user, permission);
      if (denied) return denied;
    }
  }

  // GET /admin/tailoring  — dashboard buckets + assigned orders.
  if (method === "GET" && (!parts[0] || parts[0] === "dashboard")) {
    const orders = await db.query.graduationOrdersTable.findMany({
      where: canSeeAll(user) ? undefined : visibleCondition(user),
      orderBy: [desc(graduationOrdersTable.updatedAt)],
      limit: 1000,
    });
    const groups = await loadGroups(orders.map((o) => o.groupId ?? NaN));
    const summaries = orders.map((o) => serializeSummary(o, o.groupId ? groups.get(o.groupId) : null));
    const today = new Date().toISOString().slice(0, 10);
    const isLate = (s: (typeof summaries)[number]) =>
      s.dueDate && String(s.dueDate) < today && !["ready", "delivered"].includes(s.productionStage);
    const buckets = {
      today: summaries.filter((s) => s.dueDate && String(s.dueDate) === today).length,
      awaiting_measurements: summaries.filter((s) => s.measurementStatus === "not_started").length,
      measurements_partial: summaries.filter((s) => s.measurementStatus === "partial").length,
      measurements_complete: summaries.filter((s) => s.measurementStatus === "complete").length,
      awaiting_approval: summaries.filter((s) => s.measurementStatus === "needs_review").length,
      cutting: summaries.filter((s) => s.productionStage === "cutting").length,
      sewing: summaries.filter((s) => s.productionStage === "sewing").length,
      ready: summaries.filter((s) => s.productionStage === "ready").length,
      late: summaries.filter(isLate).length,
    };
    return json({ buckets, total: summaries.length, orders: summaries.slice(0, 60) });
  }

  // GET /admin/tailoring/orders?search=&bucket=  — filtered assigned orders.
  if (method === "GET" && parts[0] === "orders" && !parts[1]) {
    const search = (req.nextUrl.searchParams.get("search") ?? "").trim().toLowerCase();
    const bucket = req.nextUrl.searchParams.get("bucket") ?? "";
    const orders = await db.query.graduationOrdersTable.findMany({
      where: canSeeAll(user) ? undefined : visibleCondition(user),
      orderBy: [desc(graduationOrdersTable.updatedAt)],
      limit: 1000,
    });
    const groups = await loadGroups(orders.map((o) => o.groupId ?? NaN));
    let summaries = orders.map((o) => serializeSummary(o, o.groupId ? groups.get(o.groupId) : null));
    const today = new Date().toISOString().slice(0, 10);
    if (bucket) {
      const byBucket: Record<string, (s: (typeof summaries)[number]) => boolean> = {
        today: (s) => !!s.dueDate && String(s.dueDate) === today,
        awaiting_measurements: (s) => s.measurementStatus === "not_started",
        measurements_partial: (s) => s.measurementStatus === "partial",
        measurements_complete: (s) => s.measurementStatus === "complete",
        awaiting_approval: (s) => s.measurementStatus === "needs_review",
        cutting: (s) => s.productionStage === "cutting",
        sewing: (s) => s.productionStage === "sewing",
        ready: (s) => s.productionStage === "ready",
        late: (s) => !!s.dueDate && String(s.dueDate) < today && !["ready", "delivered"].includes(s.productionStage),
      };
      const pred = byBucket[bucket];
      if (pred) summaries = summaries.filter(pred);
    }
    if (search) {
      summaries = summaries.filter((s) =>
        [s.name, s.phone, s.phone2, s.studentCode, s.groupNo, s.groupName, s.university, s.college, s.department, s.orderNo, s.qrToken, s.barcodeValue]
          .some((v) => String(v ?? "").toLowerCase().includes(search)),
      );
    }
    return json({ orders: summaries.slice(0, 300), total: summaries.length });
  }

  // GET /admin/tailoring/order/:id  — one student's detail + measurement history.
  if (method === "GET" && parts[0] === "order" && parts[1] && !parts[2]) {
    const id = Number(parts[1]);
    if (!Number.isFinite(id)) return error("معرّف غير صحيح", 400);
    const order = await fetchAssignedOrder(id, user);
    if (!order) return error("هذا الطلب غير مخصص لك", 403);
    const group = order.groupId
      ? (await db.query.graduationGroupsTable.findFirst({ where: eq(graduationGroupsTable.id, order.groupId) })) ?? null
      : null;
    const history = await db.execute(sql`
      SELECT id, previous, next, action, changed_by_name, reason, notes, created_at
      FROM graduation_measurement_history
      WHERE graduation_order_id = ${id}
      ORDER BY created_at DESC LIMIT 50
    `);
    return json({ order: serializeDetail(order, group, (history as any).rows ?? history ?? []) });
  }

  // POST /admin/tailoring/order/:id/measurements  — save partial (all optional).
  if (method === "POST" && parts[0] === "order" && parts[1] && parts[2] === "measurements") {
    const id = Number(parts[1]);
    if (!Number.isFinite(id)) return error("معرّف غير صحيح", 400);
    const order = await fetchAssignedOrder(id, user);
    if (!order) return error("هذا الطلب غير مخصص لك", 403);
    const body = rec(await req.json().catch(() => ({})));
    const previous = rec(order.measurements);
    const next = buildNextMeasurements(previous, body, user);
    await persistMeasurements(id, next);
    await recordHistory(id, previous, next, "edit", user, body.reason ? String(body.reason) : null, body.notes ? String(body.notes) : null);
    return json({ ok: true, measurements: next, status: next.status });
  }

  // POST /admin/tailoring/order/:id/submit  — send measurements for admin approval.
  if (method === "POST" && parts[0] === "order" && parts[1] && parts[2] === "submit") {
    const id = Number(parts[1]);
    if (!Number.isFinite(id)) return error("معرّف غير صحيح", 400);
    const order = await fetchAssignedOrder(id, user);
    if (!order) return error("هذا الطلب غير مخصص لك", 403);
    const previous = rec(order.measurements);
    const next = {
      ...previous,
      status: "needs_review",
      submittedByName: user.fullName || user.username,
      submittedAt: new Date().toISOString(),
    };
    await persistMeasurements(id, next);
    await recordHistory(id, previous, next, "submit", user, "إرسال القياسات للاعتماد");
    // Notify management that measurements are waiting for approval.
    await notify?.({
      audienceType: "admin", type: "graduation_measurements",
      title: "قياسات بانتظار الاعتماد",
      body: `${order.customerName}${order.studentCode ? ` — ${order.studentCode}` : ""}`,
      entityType: "graduation_order", entityId: id, href: "/admin/graduation",
    });
    return json({ ok: true, status: "needs_review" });
  }

  // GET /admin/tailoring/groups — accessible groups with progress counts.
  if (method === "GET" && parts[0] === "groups" && !parts[1]) {
    const orders = await db.query.graduationOrdersTable.findMany({
      where: canSeeAll(user) ? undefined : visibleCondition(user),
      limit: 3000,
    });
    const byGroup = new Map<number, OrderRow[]>();
    for (const o of orders) {
      if (!o.groupId) continue;
      const arr = byGroup.get(o.groupId) ?? [];
      arr.push(o); byGroup.set(o.groupId, arr);
    }
    const groups = await loadGroups([...byGroup.keys()]);
    const list = [...byGroup.entries()].map(([gid, rows]) => {
      const g = groups.get(gid);
      const complete = rows.filter((o) => ["complete", "needs_review", "approved"].includes(deriveStatus(rec(o.measurements)))).length;
      return {
        id: gid, title: g?.title ?? "", groupNo: g?.groupNo ?? "",
        university: g?.university ?? "", department: g?.department ?? "",
        studentCount: rows.length, completeCount: complete,
      };
    }).sort((a, b) => a.title.localeCompare(b.title, "ar"));
    return json({ groups: list });
  }

  // GET /admin/tailoring/group/:id — every student of one group in a table.
  if (method === "GET" && parts[0] === "group" && parts[1] && !parts[2]) {
    const gid = Number(parts[1]);
    if (!Number.isFinite(gid)) return error("معرّف غير صحيح", 400);
    if (!(await canAccessGroup(gid, user))) return error("هذه المجموعة غير مخصصة لك", 403);
    const group = (await db.query.graduationGroupsTable.findFirst({ where: eq(graduationGroupsTable.id, gid) })) ?? null;
    const students = await db.query.graduationOrdersTable.findMany({
      where: groupOrdersCondition(gid, user),
      orderBy: [asc(graduationOrdersTable.studentCode)],
      limit: 1000,
    });
    return json({
      group: group ? { id: group.id, title: group.title, groupNo: group.groupNo, university: group.university, college: group.college, department: group.department, graduationYear: group.graduationYear } : null,
      students: students.map(serializeGroupRow),
    });
  }

  // POST /admin/tailoring/group/:id/measurements — bulk save selected students.
  if (method === "POST" && parts[0] === "group" && parts[1] && parts[2] === "measurements") {
    const gid = Number(parts[1]);
    if (!Number.isFinite(gid)) return error("معرّف غير صحيح", 400);
    if (!(await canAccessGroup(gid, user))) return error("هذه المجموعة غير مخصصة لك", 403);
    const body = rec(await req.json().catch(() => ({})));
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return error("لا توجد صفوف للحفظ", 400);
    // Only orders that actually belong to this group may be written.
    const rows = await db.query.graduationOrdersTable.findMany({
      where: groupOrdersCondition(gid, user),
      columns: { id: true, measurements: true },
      limit: 1000,
    });
    const allowed = new Map(rows.map((r) => [r.id, rec(r.measurements)]));
    let saved = 0;
    for (const raw of items) {
      const item = rec(raw);
      const oid = Number(item.orderId);
      const previous = allowed.get(oid);
      if (!Number.isFinite(oid) || previous === undefined) continue;
      const next = buildNextMeasurements(previous, item, user);
      await persistMeasurements(oid, next);
      await recordHistory(oid, previous, next, "group_edit", user, item.reason ? String(item.reason) : "تعديل جماعي");
      saved += 1;
    }
    return json({ ok: true, saved });
  }

  // GET /admin/tailoring/scan?code=  — resolve a scanned QR/barcode to an order.
  if (method === "GET" && parts[0] === "scan" && !parts[1]) {
    const code = (req.nextUrl.searchParams.get("code") ?? "").trim();
    if (!code) return error("لا يوجد رمز", 400);
    const found = await db.query.graduationOrdersTable.findFirst({
      where: or(
        eq(graduationOrdersTable.qrToken, code),
        eq(graduationOrdersTable.barcodeValue, code),
        eq(graduationOrdersTable.studentCode, code),
      ),
      columns: { id: true },
    });
    if (!found) return error("لا يوجد طالب بهذا الرمز", 404);
    // Enforce the same assignment scope — a scan cannot open an unassigned order.
    if (!(await fetchAssignedOrder(found.id, user))) return error("هذا الطلب غير مخصص لك", 403);
    return json({ orderId: found.id });
  }

  // POST /admin/tailoring/order/:id/photos  — attach an optional tailoring photo.
  if (method === "POST" && parts[0] === "order" && parts[1] && parts[2] === "photos") {
    const id = Number(parts[1]);
    if (!Number.isFinite(id)) return error("معرّف غير صحيح", 400);
    const order = await fetchAssignedOrder(id, user);
    if (!order) return error("هذا الطلب غير مخصص لك", 403);
    const body = rec(await req.json().catch(() => ({})));
    const url = typeof body.dataUrl === "string" ? body.dataUrl : "";
    if (!url) return error("لا توجد صورة", 400);
    const garment = rec(order.garmentDetails);
    const photos = Array.isArray(garment.tailorPhotos) ? garment.tailorPhotos : [];
    photos.push({ type: String(body.type ?? "measurement"), url, at: new Date().toISOString(), byName: user.fullName || user.username });
    await db.update(graduationOrdersTable)
      .set({ garmentDetails: { ...garment, tailorPhotos: photos.slice(-40) } as OrderRow["garmentDetails"], updatedAt: new Date() })
      .where(eq(graduationOrdersTable.id, id));
    return json({ ok: true, photos: photos.slice(-40) });
  }

  // POST /admin/tailoring/order/:id/alterations  — add or update an alteration.
  if (method === "POST" && parts[0] === "order" && parts[1] && parts[2] === "alterations") {
    const id = Number(parts[1]);
    if (!Number.isFinite(id)) return error("معرّف غير صحيح", 400);
    const order = await fetchAssignedOrder(id, user);
    if (!order) return error("هذا الطلب غير مخصص لك", 403);
    const body = rec(await req.json().catch(() => ({})));
    const alt = rec(body.alteration);
    const garment = rec(order.garmentDetails);
    const list: any[] = Array.isArray(garment.alterations) ? garment.alterations : [];
    if (alt.id && list.some((a) => a.id === alt.id)) {
      const idx = list.findIndex((a) => a.id === alt.id);
      list[idx] = { ...list[idx], ...alt };
    } else {
      list.push({ id: alt.id || Date.now(), type: alt.type ?? "other", problem: alt.problem ?? "", requiredChange: alt.requiredChange ?? "", expectedDate: alt.expectedDate ?? null, completedDate: alt.completedDate ?? null, notes: alt.notes ?? "", beforePhoto: alt.beforePhoto ?? null, afterPhoto: alt.afterPhoto ?? null, byName: user.fullName || user.username, createdAt: new Date().toISOString() });
    }
    await db.update(graduationOrdersTable)
      .set({ garmentDetails: { ...garment, alterations: list } as OrderRow["garmentDetails"], updatedAt: new Date() })
      .where(eq(graduationOrdersTable.id, id));
    return json({ ok: true, alterations: list });
  }

  // POST /admin/tailoring/order/:id/production  — tailor moves a production stage.
  if (method === "POST" && parts[0] === "order" && parts[1] && parts[2] === "production") {
    const id = Number(parts[1]);
    if (!Number.isFinite(id)) return error("معرّف غير صحيح", 400);
    const order = await fetchAssignedOrder(id, user);
    if (!order) return error("هذا الطلب غير مخصص لك", 403);
    const body = rec(await req.json().catch(() => ({})));
    const action = String(body.action ?? "");
    let nextStage = order.productionStage;
    if (action === "mark_ready") nextStage = "ready";
    else if (action === "set_stage" && typeof body.stage === "string" && (TAILOR_PRODUCTION_STAGES as readonly string[]).includes(body.stage)) nextStage = body.stage;
    const previous = order.productionStage;
    const measurementBlock = await getGraduationProductionMeasurementBlock(
      order,
      nextStage,
    );
    if (measurementBlock) {
      await notify?.({
        audienceType: "admin",
        type: "graduation_production_measurements_blocked",
        title: "تعذر بدء الإنتاج قبل استكمال القياسات",
        body: `${order.orderNo} - ${order.customerName}`,
        entityType: "graduation_order",
        entityId: id,
        href: "/admin/graduation/orders",
        metadata: {
          attemptedStage: nextStage,
          measurementStatus: measurementBlock.measurementStatus,
          attemptedBy: user.id,
        },
      });
      return error("يجب إكمال القياسات قبل بدء مرحلة القص والخياطة.", 409);
    }
    if (nextStage !== previous) {
      await db.update(graduationOrdersTable)
        .set({ productionStage: nextStage, updatedAt: new Date() })
        .where(eq(graduationOrdersTable.id, id));
    }
    // Log every action (start / pause / issue / material / stage) on the timeline.
    await db.execute(sql`
      INSERT INTO graduation_production_events
        (graduation_order_id, stage, previous_stage, scan_type, notes, employee_id, employee_name)
      VALUES (${id}, ${nextStage}, ${previous}, ${"tailor_" + (action || "update")}, ${body.notes ? String(body.notes) : null},
              ${user.id}, ${user.fullName || user.username})
    `);
    // Escalate issues / material requests / readiness to management.
    if (["issue", "material", "mark_ready"].includes(action)) {
      const titles: Record<string, string> = {
        issue: "الخياط أبلغ عن مشكلة", material: "طلب مواد من الخياط", mark_ready: "قطعة جاهزة",
      };
      await notify?.({
        audienceType: "admin", type: "graduation_production",
        title: titles[action] ?? "تحديث إنتاج",
        body: `${order.customerName}${body.notes ? ` — ${body.notes}` : ""}`,
        entityType: "graduation_order", entityId: id, href: "/admin/graduation",
      });
    }
    return json({ ok: true, productionStage: nextStage });
  }

  // POST /admin/tailoring/order/:id/notes  — tiered tailor notes (internal never
  // reaches the student; the student portal simply doesn't read these fields).
  if (method === "POST" && parts[0] === "order" && parts[1] && parts[2] === "notes") {
    const id = Number(parts[1]);
    if (!Number.isFinite(id)) return error("معرّف غير صحيح", 400);
    const order = await fetchAssignedOrder(id, user);
    if (!order) return error("هذا الطلب غير مخصص لك", 403);
    const tiers = rec(rec(await req.json().catch(() => ({}))).notes);
    const garment = rec(order.garmentDetails);
    const notesTiers = {
      internal: String(tiers.internal ?? ""), admin: String(tiers.admin ?? ""),
      rep: String(tiers.rep ?? ""), warning: String(tiers.warning ?? ""),
    };
    await db.update(graduationOrdersTable)
      .set({ garmentDetails: { ...garment, notesTiers } as OrderRow["garmentDetails"], updatedAt: new Date() })
      .where(eq(graduationOrdersTable.id, id));
    return json({ ok: true, notesTiers });
  }

  // POST /admin/tailoring/order/:id/review  — manager approves / returns for correction.
  if (method === "POST" && parts[0] === "order" && parts[1] && parts[2] === "review") {
    if (!canApprove(user)) return error("لا تملك صلاحية اعتماد القياسات", 403);
    const id = Number(parts[1]);
    if (!Number.isFinite(id)) return error("معرّف غير صحيح", 400);
    const order = await db.query.graduationOrdersTable.findFirst({ where: eq(graduationOrdersTable.id, id) });
    if (!order) return error("الطلب غير موجود", 404);
    const body = rec(await req.json().catch(() => ({})));
    const decision = String(body.decision ?? "");
    if (!["approve", "return"].includes(decision)) return error("قرار غير صحيح", 400);
    const previous = rec(order.measurements);
    const status = decision === "approve" ? "approved" : "partial";
    const next = {
      ...previous,
      status,
      adminReview: { decision, note: body.note ? String(body.note) : "", byName: user.fullName || user.username, at: new Date().toISOString() },
    };
    await persistMeasurements(id, next);
    await recordHistory(id, previous, next, "review", user, decision === "approve" ? "اعتماد القياسات" : "إعادة للتصحيح", body.note ? String(body.note) : null);
    // Notify the assigned tailor of the decision.
    if (order.assignedStaffId) {
      await notify?.({
        staffId: order.assignedStaffId, type: "graduation_measurements",
        title: decision === "approve" ? "اعتُمدت قياساتك" : "أُعيدت قياساتك للتصحيح",
        body: `${order.customerName}${body.note ? ` — ${body.note}` : ""}`,
        entityType: "graduation_order", entityId: id, href: `/staff/tailors/order/${id}`,
      });
    }
    return json({ ok: true, status });
  }

  return null;
}
