import { NextResponse, type NextRequest } from "next/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  entityTimelineTable,
  graduationGroupsTable,
  graduationOrdersTable,
  graduationReceiptsTable,
  staffTable,
} from "@workspace/db";
import { getGraduationMeasurementFilter } from "@/lib/graduation-measurements";
import { normalizePhoneDigits } from "@/lib/phone";
import type { GraduationAdminUser } from "@/server/graduation";
import { receivePayment } from "@/server/graduation-operations";

type RecordMap = Record<string, unknown>;
const paymentInput = z.object({
  orderId: z.coerce.number().int().positive(), amount: z.coerce.number().positive(),
  paymentMethod: z.enum(["cash", "transfer", "card", "other"]).default("cash"),
  receiptNumber: z.string().trim().max(100).optional().default(""),
  receiptImage: z.string().trim().max(4_000_000).optional().default(""),
  occurredAt: z.string().datetime().optional(), notes: z.string().trim().max(1500).optional().default(""),
});
const issueInput = z.object({ orderId: z.coerce.number().int().positive(), type: z.enum(["wrong_size","missing_accessory","name_error","payment","production_delay","delivery","other"]), priority: z.enum(["low","medium","high","urgent"]).default("medium"), notes: z.string().trim().min(3).max(2000), photos: z.array(z.string().max(4_000_000)).max(5).default([]) });

function json(data: unknown, status = 200) { return NextResponse.json(data, { status }); }
function fail(error: string, status = 400) { return json({ error }, status); }
function money(value: unknown) { const n = Number(value ?? 0); return Number.isFinite(n) ? n : 0; }
function has(user: GraduationAdminUser, permission: string) {
  return user.role === "admin" || user.permissions.includes(permission) ||
    (permission !== "representative.portal.access" && user.permissions.includes("representative.portal.access"));
}

let ready: Promise<void> | null = null;
async function ensureRepresentativeTables() {
  if (!ready) ready = db.execute(sql`
    CREATE TABLE IF NOT EXISTS representative_group_assignments (
      id serial PRIMARY KEY, staff_id integer NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
      group_id integer NOT NULL REFERENCES graduation_groups(id) ON DELETE CASCADE,
      is_active boolean NOT NULL DEFAULT true, created_at timestamp NOT NULL DEFAULT now(),
      UNIQUE(staff_id, group_id)
    );
    CREATE TABLE IF NOT EXISTS representative_payment_requests (
      id serial PRIMARY KEY, group_id integer NOT NULL REFERENCES graduation_groups(id) ON DELETE RESTRICT,
      graduation_order_id integer NOT NULL REFERENCES graduation_orders(id) ON DELETE RESTRICT,
      amount numeric(14,2) NOT NULL, payment_method varchar(30) NOT NULL, receipt_number varchar(100),
      receipt_image text, occurred_at timestamp NOT NULL DEFAULT now(), notes text, status varchar(20) NOT NULL DEFAULT 'pending',
      representative_id integer NOT NULL REFERENCES staff(id) ON DELETE RESTRICT, representative_name text NOT NULL DEFAULT '',
      approved_by integer REFERENCES staff(id) ON DELETE SET NULL, approved_at timestamp, rejection_note text,
      posted_payment_id integer REFERENCES graduation_student_payments(id) ON DELETE SET NULL, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS representative_payment_requests_group_idx ON representative_payment_requests(group_id, status);
    CREATE TABLE IF NOT EXISTS representative_custody_handovers (
      id serial PRIMARY KEY, representative_id integer NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
      amount numeric(14,2) NOT NULL, receipt_image text, notes text, status varchar(20) NOT NULL DEFAULT 'pending',
      confirmed_by integer REFERENCES staff(id) ON DELETE SET NULL, confirmed_at timestamp, created_at timestamp NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS representative_issues (
      id serial PRIMARY KEY, group_id integer NOT NULL REFERENCES graduation_groups(id) ON DELETE CASCADE,
      graduation_order_id integer NOT NULL REFERENCES graduation_orders(id) ON DELETE CASCADE,
      type varchar(40) NOT NULL, priority varchar(20) NOT NULL DEFAULT 'medium', status varchar(20) NOT NULL DEFAULT 'open',
      notes text NOT NULL, photos jsonb NOT NULL DEFAULT '[]'::jsonb, reporter_id integer NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
      assigned_to integer REFERENCES staff(id) ON DELETE SET NULL, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
    );
  `).then(() => undefined);
  return ready;
}

async function groupIdsFor(user: GraduationAdminUser) {
  if (user.role === "admin") return null;
  const rows = await db.execute(sql`SELECT group_id FROM representative_group_assignments WHERE staff_id = ${user.id} AND is_active = true`);
  return rows.rows.map((row: any) => Number(row.group_id)).filter(Boolean);
}
async function requireGroup(user: GraduationAdminUser, groupId: number) {
  const ids = await groupIdsFor(user);
  if (ids && !ids.includes(groupId)) return null;
  return db.query.graduationGroupsTable.findFirst({ where: eq(graduationGroupsTable.id, groupId) });
}
async function timeline(user: GraduationAdminUser, entityId: number, title: string, metadata: RecordMap = {}) {
  await db.insert(entityTimelineTable).values({ entityType: "graduation_order", entityId, type: "representative", title, actorId: user.id, actorName: user.fullName || user.username, metadata: metadata as any });
}
async function studentRows(groupIds: number[]) {
  if (!groupIds.length) return [];
  const rows = await db.select().from(graduationOrdersTable).where(and(inArray(graduationOrdersTable.groupId, groupIds), sql`${graduationOrdersTable.archivedAt} is null`)).orderBy(desc(graduationOrdersTable.createdAt));
  return rows.map((row) => ({ id: row.id, groupId: row.groupId!, name: row.customerName, phone: row.phone, studentCode: row.studentCode || row.orderNo, qr: row.qrToken, barcode: row.barcodeValue, package: row.packageKey || "—", robe: row.styleKey, accessories: Array.isArray(row.accessories) ? row.accessories : [], total: money(row.totalAmount), paid: money(row.paidAmount), remaining: money(row.remainingAmount), paymentStatus: row.paymentStatus, measurementStatus: getGraduationMeasurementFilter(row.measurements), productionStatus: row.productionStage, deliveryStatus: (row.delivery as any)?.status || (row.deliveredAt ? "delivered" : "pending"), trackingUrl: `/graduation/track/${row.qrToken}` }));
}

export async function handleRepresentativePortal(req: NextRequest, parts: string[], user: GraduationAdminUser): Promise<NextResponse | null> {
  await ensureRepresentativeTables();
  const resource = parts[0] || "dashboard";
  if (!has(user, "representative.portal.access")) return fail("لا تملك صلاحية الدخول إلى بوابة ممثلي الشعب", 403);
  const ids = await groupIdsFor(user);
  if (ids && !ids.length) return fail("لم تُسند إليك أي مجموعة تخرج", 403);
  const groupIds = ids ?? (await db.select({ id: graduationGroupsTable.id }).from(graduationGroupsTable)).map((r) => r.id);

  if (resource === "dashboard" && req.method === "GET") {
    const groups = groupIds.length ? await db.select().from(graduationGroupsTable).where(inArray(graduationGroupsTable.id, groupIds)) : [];
    const students = await studentRows(groupIds);
    const payments = groupIds.length ? await db.execute(sql`SELECT coalesce(sum(amount),0) amount FROM representative_payment_requests WHERE representative_id=${user.id} AND status='approved'`) : { rows: [{ amount: 0 }] } as any;
    const handovers = await db.execute(sql`SELECT coalesce(sum(amount),0) amount FROM representative_custody_handovers WHERE representative_id=${user.id} AND status='confirmed'`);
    const total = students.reduce((s, x) => s + x.total, 0), paid = students.reduce((s, x) => s + x.paid, 0);
    return json({ representative: { id: user.id, name: user.fullName || user.username }, groups, students, stats: { students: students.length, total, paid, remaining: Math.max(0, total - paid), unpaid: students.filter((x) => !x.paid).length, partial: students.filter((x) => x.paid > 0 && x.remaining > 0).length, paidFull: students.filter((x) => !x.remaining).length, incompleteMeasurements: students.filter((x) => x.measurementStatus !== "complete").length, inProduction: students.filter((x) => !["new", "ready", "delivered"].includes(x.productionStatus)).length, ready: students.filter((x) => ["ready", "delivered"].includes(x.productionStatus)).length, collectionProgress: total ? Math.round((paid / total) * 100) : 0, custody: Math.max(0, money((payments.rows[0] as any)?.amount) - money((handovers.rows[0] as any)?.amount)) } });
  }
  if (resource === "assignments") {
    if (user.role !== "admin") return fail("إدارة تعيين الممثلين متاحة للإدارة فقط", 403);
    if (req.method === "GET") {
      const rows = await db.execute(sql`
        SELECT a.id, a.staff_id AS "staffId", a.group_id AS "groupId", a.is_active AS "isActive", a.created_at AS "createdAt",
          s.full_name AS "representativeName", s.username AS "representativeUsername", g.title AS "groupTitle", g.group_no AS "groupNo"
        FROM representative_group_assignments a
        JOIN staff s ON s.id = a.staff_id JOIN graduation_groups g ON g.id = a.group_id
        ORDER BY a.created_at DESC`);
      const [staff, groups] = await Promise.all([
        db.select({ id: staffTable.id, fullName: staffTable.fullName, username: staffTable.username, role: staffTable.role }).from(staffTable).where(eq(staffTable.isActive, true)).orderBy(staffTable.fullName),
        db.select({ id: graduationGroupsTable.id, title: graduationGroupsTable.title, groupNo: graduationGroupsTable.groupNo }).from(graduationGroupsTable).orderBy(desc(graduationGroupsTable.createdAt)),
      ]);
      return json({ items: rows.rows, staff, groups });
    }
    if (req.method === "POST") {
      const parsed = z.object({ staffId: z.coerce.number().int().positive(), groupId: z.coerce.number().int().positive(), isActive: z.boolean().optional().default(true) }).safeParse(await req.json().catch(() => ({})));
      if (!parsed.success) return fail("تحقق من بيانات تعيين ممثل الشعبة");
      const group = await db.query.graduationGroupsTable.findFirst({ where: eq(graduationGroupsTable.id, parsed.data.groupId) });
      if (!group) return fail("مجموعة التخرج غير موجودة", 404);
      const result = await db.execute(sql`
        INSERT INTO representative_group_assignments (staff_id, group_id, is_active)
        VALUES (${parsed.data.staffId}, ${parsed.data.groupId}, ${parsed.data.isActive})
        ON CONFLICT (staff_id, group_id) DO UPDATE SET is_active = EXCLUDED.is_active
        RETURNING *`);
      return json({ assignment: result.rows[0] }, 201);
    }
  }
  if (resource === "students" && req.method === "GET") {
    if (!has(user, "representative.group.view")) return fail("لا تملك صلاحية عرض الطلبة", 403);
    const q = String(req.nextUrl.searchParams.get("search") || "").trim().toLowerCase();
    const rows = await studentRows(groupIds);
    return json({ items: q ? rows.filter((row) => [row.name,row.phone,row.studentCode,row.qr,row.barcode].some((x) => String(x || "").toLowerCase().includes(normalizePhoneDigits(q) || q))) : rows });
  }
  if (resource === "payments" && req.method === "POST") {
    if (!has(user, "representative.payments.create")) return fail("لا تملك صلاحية تسجيل الدفعات", 403);
    const parsed = paymentInput.safeParse(await req.json().catch(() => ({}))); if (!parsed.success) return fail("تحقق من بيانات الدفعة");
    const order = await db.query.graduationOrdersTable.findFirst({ where: eq(graduationOrdersTable.id, parsed.data.orderId) });
    if (!order?.groupId || !(await requireGroup(user, order.groupId))) return fail("غير مخول للوصول إلى هذا الطالب", 403);
    if (parsed.data.amount > money(order.remainingAmount)) return fail("المبلغ أكبر من الرصيد المتبقي", 409);
    const request = (await db.execute(sql`INSERT INTO representative_payment_requests (group_id, graduation_order_id, amount, payment_method, receipt_number, receipt_image, occurred_at, notes, representative_id, representative_name) VALUES (${order.groupId}, ${order.id}, ${String(parsed.data.amount)}, ${parsed.data.paymentMethod}, ${parsed.data.receiptNumber || null}, ${parsed.data.receiptImage || null}, ${parsed.data.occurredAt ? new Date(parsed.data.occurredAt) : new Date()}, ${parsed.data.notes || null}, ${user.id}, ${user.fullName || user.username}) RETURNING *`)).rows[0] as any;
    await timeline(user, order.id, "سجّل ممثل الشعبة مبلغاً بانتظار الاعتماد", { requestId: (request as any).id, amount: parsed.data.amount });
    return json({ request, status: "pending" }, 201);
  }
  if (resource === "payments" && req.method === "GET") {
    const rows = await db.execute(user.role === "admin" ? sql`
      SELECT p.*, o.customer_name AS "studentName", o.student_code AS "studentCode", g.title AS "groupTitle"
      FROM representative_payment_requests p JOIN graduation_orders o ON o.id=p.graduation_order_id JOIN graduation_groups g ON g.id=p.group_id
      ORDER BY p.created_at DESC` : sql`
      SELECT p.*, o.customer_name AS "studentName", o.student_code AS "studentCode", g.title AS "groupTitle"
      FROM representative_payment_requests p JOIN graduation_orders o ON o.id=p.graduation_order_id JOIN graduation_groups g ON g.id=p.group_id
      WHERE p.representative_id=${user.id} ORDER BY p.created_at DESC`);
    return json({ items: rows.rows });
  }
  if (resource === "payments" && parts[1] && parts[2] === "approve" && req.method === "POST") {
    if (user.role !== "admin") return fail("اعتماد الدفعات متاح للإدارة فقط", 403);
    const claimed = await db.execute(sql`UPDATE representative_payment_requests SET status='processing', updated_at=now() WHERE id=${Number(parts[1])} AND status='pending' RETURNING *`);
    const row = claimed.rows[0] as any;
    if (!row) return fail("طلب الدفعة غير متاح للاعتماد", 409);
    const order = await db.query.graduationOrdersTable.findFirst({ where: eq(graduationOrdersTable.id, row.graduation_order_id) });
    if (!order) { await db.execute(sql`UPDATE representative_payment_requests SET status='pending', updated_at=now() WHERE id=${row.id}`); return fail("طلب الطالب غير موجود", 404); }
    const representative: GraduationAdminUser = { ...user, id: Number(row.representative_id), fullName: String(row.representative_name || user.fullName), username: String(row.representative_name || user.username) };
    const result = await receivePayment({ amount: money(row.amount), paymentMethod: row.payment_method, notes: row.notes || "", strategy: "selected", selectedStudentIds: [order.id], idempotencyKey: `representative-request-${row.id}` }, representative, undefined, order.id);
    if ("response" in result && result.response) { await db.execute(sql`UPDATE representative_payment_requests SET status='pending', updated_at=now() WHERE id=${row.id}`); return result.response; }
    const payment = (result as { payments?: any[] }).payments?.[0];
    await db.execute(sql`UPDATE representative_payment_requests SET status='approved', approved_by=${user.id}, approved_at=now(), posted_payment_id=${payment?.id ?? null}, updated_at=now() WHERE id=${row.id}`);
    await timeline(user, order.id, "اعتمدت الإدارة دفعة ممثل الشعبة", { requestId: row.id, paymentId: payment.id });
    return json({ payment, receiptNo: payment?.receiptNo, status: "approved" });
  }
  if (resource === "payments" && parts[1] && parts[2] === "reject" && req.method === "POST") {
    if (user.role !== "admin") return fail("رفض الدفعات متاح للإدارة فقط", 403);
    const note = String((await req.json().catch(() => ({})))?.note || "").slice(0, 1500);
    const result = await db.execute(sql`UPDATE representative_payment_requests SET status='rejected', rejection_note=${note || null}, approved_by=${user.id}, approved_at=now(), updated_at=now() WHERE id=${Number(parts[1])} AND status='pending' RETURNING *`);
    if (!result.rows[0]) return fail("طلب الدفعة غير متاح للرفض", 409);
    return json({ request: result.rows[0], status: "rejected" });
  }
  if (resource === "payments" && parts[1] && parts[2] === "receipt" && req.method === "GET") {
    if (!has(user, "representative.receipts.print")) return fail("لا تملك صلاحية طباعة الوصولات", 403);
    const rows = await db.execute(user.role === "admin" ? sql`
      SELECT p.*, r.receipt_no AS "receiptNo", r.snapshot AS snapshot, o.customer_name AS "studentName", o.student_code AS "studentCode", g.title AS "groupTitle"
      FROM representative_payment_requests p
      JOIN graduation_orders o ON o.id=p.graduation_order_id JOIN graduation_groups g ON g.id=p.group_id
      LEFT JOIN graduation_receipts r ON r.payment_id=p.posted_payment_id
      WHERE p.id=${Number(parts[1])}` : sql`
      SELECT p.*, r.receipt_no AS "receiptNo", r.snapshot AS snapshot, o.customer_name AS "studentName", o.student_code AS "studentCode", g.title AS "groupTitle"
      FROM representative_payment_requests p
      JOIN graduation_orders o ON o.id=p.graduation_order_id JOIN graduation_groups g ON g.id=p.group_id
      LEFT JOIN graduation_receipts r ON r.payment_id=p.posted_payment_id
      WHERE p.id=${Number(parts[1])} AND p.representative_id=${user.id}`);
    const receipt = rows.rows[0];
    if (!receipt || receipt.status !== "approved") return fail("الوصل غير متاح قبل اعتماد الدفعة", 404);
    return json({ receipt });
  }
  if (resource === "custody" && req.method === "POST") {
    const data = await req.json().catch(() => ({})); const value = money(data?.amount); if (value <= 0) return fail("أدخل مبلغ التسليم");
    const handover = (await db.execute(sql`INSERT INTO representative_custody_handovers (representative_id, amount, receipt_image, notes) VALUES (${user.id}, ${String(value)}, ${String(data?.receiptImage || "") || null}, ${String(data?.notes || "") || null}) RETURNING *`)).rows[0] as any;
    return json({ handover }, 201);
  }
  if (resource === "custody" && req.method === "GET") {
    const rows = await db.execute(user.role === "admin" ? sql`SELECT * FROM representative_custody_handovers ORDER BY created_at DESC` : sql`SELECT * FROM representative_custody_handovers WHERE representative_id=${user.id} ORDER BY created_at DESC`);
    return json({ items: rows.rows });
  }
  if (resource === "custody" && parts[1] && parts[2] === "confirm" && req.method === "POST") {
    if (user.role !== "admin") return fail("اعتماد تسليم العهدة متاح للإدارة فقط", 403);
    const result = await db.execute(sql`UPDATE representative_custody_handovers SET status='confirmed', confirmed_by=${user.id}, confirmed_at=now() WHERE id=${Number(parts[1])} AND status='pending' RETURNING *`);
    if (!result.rows[0]) return fail("طلب تسليم العهدة غير متاح للاعتماد", 409);
    return json({ handover: result.rows[0] });
  }
  if (resource === "issues" && req.method === "POST") {
    if (!has(user, "representative.issues.create")) return fail("لا تملك صلاحية الإبلاغ عن مشكلة", 403);
    const parsed = issueInput.safeParse(await req.json().catch(() => ({}))); if (!parsed.success) return fail("تحقق من بيانات المشكلة");
    const order = await db.query.graduationOrdersTable.findFirst({ where: eq(graduationOrdersTable.id, parsed.data.orderId) });
    if (!order?.groupId || !(await requireGroup(user, order.groupId))) return fail("غير مخول للوصول إلى هذا الطالب", 403);
    const issue = (await db.execute(sql`INSERT INTO representative_issues (group_id, graduation_order_id, type, priority, notes, photos, reporter_id) VALUES (${order.groupId}, ${order.id}, ${parsed.data.type}, ${parsed.data.priority}, ${parsed.data.notes}, ${JSON.stringify(parsed.data.photos)}::jsonb, ${user.id}) RETURNING *`)).rows[0] as any;
    await timeline(user, order.id, "أبلغ ممثل الشعبة عن مشكلة", { issueId: (issue as any).id, type: parsed.data.type });
    return json({ issue }, 201);
  }
  if (resource === "reports" && req.method === "GET") {
    if (!has(user, "representative.reports.export")) return fail("لا تملك صلاحية تصدير التقارير", 403);
    return json({ items: await studentRows(groupIds), exportedAt: new Date().toISOString() });
  }
  return fail("المسار غير موجود", 404);
}
