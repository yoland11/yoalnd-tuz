import { NextResponse, type NextRequest } from "next/server";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import {
  db,
  graduationGroupsTable,
  graduationOrdersTable,
} from "@workspace/db";

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
  return user.role === "admin";
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
  if (typeof m.status === "string" && (TAILOR_MEASUREMENT_STATUSES as readonly string[]).includes(m.status))
    return m.status;
  if (m.method === "ready" && m.readySize) return "complete";
  const filled = MEASUREMENT_NUMERIC_KEYS.filter(
    (k) => m[k] !== undefined && m[k] !== "" && m[k] !== null,
  );
  if (filled.length === 0) return "not_started";
  if (filled.length < 5) return "partial";
  return "complete";
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
    history,
  };
}

async function loadGroups(ids: number[]) {
  const unique = [...new Set(ids.filter((id): id is number => Number.isFinite(id)))];
  if (!unique.length) return new Map<number, GroupRow>();
  const rows = await db.query.graduationGroupsTable.findMany({
    where: inArray(graduationGroupsTable.id, unique),
  });
  return new Map(rows.map((g) => [g.id, g]));
}

/** Fetch one order enforcing the assignment scope (null → not visible → 403). */
async function fetchAssignedOrder(id: number, user: TailorUser) {
  const order = await db.query.graduationOrdersTable.findFirst({
    where: canSeeAll(user)
      ? eq(graduationOrdersTable.id, id)
      : and(eq(graduationOrdersTable.id, id), assignedCondition(user.id)),
  });
  return order ?? null;
}

// ---------------------------------------------------------------------------
// Route handler.
// ---------------------------------------------------------------------------
export async function handleTailorPortal(
  req: NextRequest,
  parts: string[],
  user: TailorUser,
): Promise<NextResponse | null> {
  await ensureTailoringTables();
  const method = req.method;

  // GET /admin/tailoring  — dashboard buckets + assigned orders.
  if (method === "GET" && (!parts[0] || parts[0] === "dashboard")) {
    const orders = await db.query.graduationOrdersTable.findMany({
      where: canSeeAll(user) ? undefined : assignedCondition(user.id),
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
      where: canSeeAll(user) ? undefined : assignedCondition(user.id),
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
    // Drop keys explicitly cleared.
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    next.status = typeof body.status === "string" && (TAILOR_MEASUREMENT_STATUSES as readonly string[]).includes(body.status)
      ? body.status
      : deriveStatus(next);
    next.updatedByName = user.fullName || user.username;
    next.updatedAt = new Date().toISOString();

    await db.update(graduationOrdersTable)
      .set({ measurements: next as OrderRow["measurements"], updatedAt: new Date() })
      .where(eq(graduationOrdersTable.id, id));
    await db.execute(sql`
      INSERT INTO graduation_measurement_history
        (graduation_order_id, previous, next, action, changed_by, changed_by_name, reason, notes)
      VALUES (${id}, ${JSON.stringify(previous)}::jsonb, ${JSON.stringify(next)}::jsonb, 'edit',
              ${user.id}, ${user.fullName || user.username},
              ${body.reason ? String(body.reason) : null}, ${body.notes ? String(body.notes) : null})
    `);
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
    await db.update(graduationOrdersTable)
      .set({ measurements: next as OrderRow["measurements"], updatedAt: new Date() })
      .where(eq(graduationOrdersTable.id, id));
    await db.execute(sql`
      INSERT INTO graduation_measurement_history
        (graduation_order_id, previous, next, action, changed_by, changed_by_name, reason)
      VALUES (${id}, ${JSON.stringify(previous)}::jsonb, ${JSON.stringify(next)}::jsonb, 'submit',
              ${user.id}, ${user.fullName || user.username}, 'إرسال القياسات للاعتماد')
    `);
    return json({ ok: true, status: "needs_review" });
  }

  return null;
}
