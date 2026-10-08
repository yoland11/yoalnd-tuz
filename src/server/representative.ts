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
import { readRequestBody } from "@/server/request-body";
import { handleGraduationGroupPricing } from "@/server/graduation-group-pricing";
import {
  canAccessRepresentativeGroup,
  classifyRepresentativeScope,
  type RepresentativeScope,
} from "@/lib/representative-group-access";
import { createApiErrorPayload, makeRequestId } from "@/server/write-safety";
import { safeServerError } from "@/server/safe-server-log";
import {
  assignmentDecision,
  representativeStaffIsEligible,
} from "@/lib/representative-assignment-policy";

type RecordMap = Record<string, unknown>;
const paymentInput = z.object({
  orderId: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive(),
  paymentMethod: z.enum(["cash", "transfer", "card", "other"]).default("cash"),
  receiptNumber: z.string().trim().max(100).optional().default(""),
  receiptImage: z.string().trim().max(4_000_000).optional().default(""),
  occurredAt: z.string().datetime().optional(),
  notes: z.string().trim().max(1500).optional().default(""),
});
const issueInput = z.object({
  orderId: z.coerce.number().int().positive(),
  type: z.enum([
    "wrong_size",
    "missing_accessory",
    "name_error",
    "payment",
    "production_delay",
    "delivery",
    "other",
  ]),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  notes: z.string().trim().min(3).max(2000),
  photos: z.array(z.string().max(4_000_000)).max(5).default([]),
});

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}
function money(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}
function has(user: GraduationAdminUser, permission: string) {
  return (
    user.role === "admin" ||
    user.permissions.includes(permission) ||
    (permission !== "representative.portal.access" &&
      user.permissions.includes("representative.portal.access"))
  );
}

let ready: Promise<void> | null = null;
async function ensureRepresentativeTables() {
  if (!ready) ready = db.execute(sql`select 1`).then(() => undefined);
  return ready;
}

async function loadRepresentativeScope(user: GraduationAdminUser): Promise<RepresentativeScope> {
  if (!user.isActive || user.role === "admin" || !user.permissions.includes("representative.portal.access"))
    return classifyRepresentativeScope(user, []);
  const rows = await db.execute(
    sql`SELECT group_id FROM representative_group_assignments WHERE staff_id = ${user.id} AND is_active = true`,
  );
  return classifyRepresentativeScope(user, rows.rows.map((row: any) => Number(row.group_id)));
}
async function requireGroup(scope: RepresentativeScope, groupId: number) {
  if (!canAccessRepresentativeGroup(scope, groupId)) return null;
  return db.query.graduationGroupsTable.findFirst({
    where: eq(graduationGroupsTable.id, groupId),
  });
}
async function timeline(
  user: GraduationAdminUser,
  entityId: number,
  title: string,
  metadata: RecordMap = {},
) {
  await db.insert(entityTimelineTable).values({
    entityType: "graduation_order",
    entityId,
    type: "representative",
    title,
    actorId: user.id,
    actorName: user.fullName || user.username,
    metadata: metadata as any,
  });
}
async function studentRows(groupIds: number[]) {
  if (!groupIds.length) return [];
  const rows = await db
    .select()
    .from(graduationOrdersTable)
    .where(
      and(
        inArray(graduationOrdersTable.groupId, groupIds),
        sql`${graduationOrdersTable.archivedAt} is null`,
      ),
    )
    .orderBy(desc(graduationOrdersTable.createdAt));
  return rows.map((row) => ({
    id: row.id,
    groupId: row.groupId!,
    name: row.customerName,
    phone: row.phone,
    studentCode: row.studentCode || row.orderNo,
    qr: row.qrToken,
    barcode: row.barcodeValue,
    package: row.packageKey || "—",
    robe: row.styleKey,
    accessories: Array.isArray(row.accessories) ? row.accessories : [],
    total: money(row.totalAmount),
    paid: money(row.paidAmount),
    remaining: money(row.remainingAmount),
    paymentStatus: row.paymentStatus,
    measurementStatus: getGraduationMeasurementFilter(row.measurements),
    productionStatus: row.productionStage,
    deliveryStatus:
      (row.delivery as any)?.status ||
      (row.deliveredAt ? "delivered" : "pending"),
    trackingUrl: `/graduation/track/${row.qrToken}`,
  }));
}

export async function handleRepresentativePortal(
  req: NextRequest,
  parts: string[],
  user: GraduationAdminUser,
): Promise<NextResponse | null> {
  const requestId = makeRequestId(req.headers.get("x-request-id"));
  const fail = (message: string, status = 400) => NextResponse.json(
    createApiErrorPayload({ message, status, requestId, ...(status >= 500 ? { code: "DATABASE_ERROR" as const } : {}) }),
    { status, headers: { "x-request-id": requestId } },
  );
  if (parts[0] === "groups" && parts[1] && parts[2] === "sash-pricing" && !parts[3])
    return handleGraduationGroupPricing(req, parts[1], user, true);
  const resource = parts[0] || "dashboard";
  let scope: RepresentativeScope;
  try {
    await ensureRepresentativeTables();
    scope = await loadRepresentativeScope(user);
  } catch (cause) {
    console.error("representative group scope lookup failed", { requestId, actorId: user.id, ...safeServerError(cause) });
    return fail("تعذر التحقق من صلاحية المجموعة؛ حاول مجدداً", 500);
  }
  if (scope.kind === "denied") {
    const reason = {
      inactive: "الحساب غير مفعّل",
      permission: "لا تملك صلاحية الدخول إلى بوابة ممثلي الشعب",
      missing: "لم تُسند إليك أي مجموعة تخرج؛ تواصل مع الإدارة",
      ambiguous: "حسابك مرتبط بأكثر من مجموعة؛ اطلب من الإدارة تصحيح التعيين",
    }[scope.reason];
    return fail(reason, 403);
  }
  if (resource === "scope" && req.method === "GET") {
    if (scope.kind === "admin") return json({ kind: "admin", group: null });
    try {
      const group = await db.query.graduationGroupsTable.findFirst({
        columns: { id: true, title: true, groupNo: true },
        where: eq(graduationGroupsTable.id, scope.groupId),
      });
      if (!group) return fail("المجموعة المسندة غير موجودة؛ تواصل مع الإدارة", 404);
      return json({ kind: "group", group });
    } catch (cause) {
      console.error("representative group header lookup failed", { requestId, actorId: user.id, ...safeServerError(cause) });
      return fail("تعذر تحميل المجموعة؛ حاول مجدداً", 500);
    }
  }
  const groupIds =
    scope.kind === "group" ? [scope.groupId] :
    (
      await db
        .select({ id: graduationGroupsTable.id })
        .from(graduationGroupsTable)
    ).map((r) => r.id);

  if (resource === "dashboard" && req.method === "GET") {
    const groups = groupIds.length
      ? await db
          .select()
          .from(graduationGroupsTable)
          .where(inArray(graduationGroupsTable.id, groupIds))
      : [];
    const students = await studentRows(groupIds);
    const payments = groupIds.length
      ? await db.execute(
          sql`SELECT coalesce(sum(amount),0) amount FROM representative_payment_requests WHERE representative_id=${user.id} AND status='approved'`,
        )
      : ({ rows: [{ amount: 0 }] } as any);
    const handovers = await db.execute(
      sql`SELECT coalesce(sum(amount),0) amount FROM representative_custody_handovers WHERE representative_id=${user.id} AND status='confirmed'`,
    );
    const total = students.reduce((s, x) => s + x.total, 0),
      paid = students.reduce((s, x) => s + x.paid, 0);
    return json({
      representative: { id: user.id, name: user.fullName || user.username },
      groups,
      students,
      stats: {
        students: students.length,
        total,
        paid,
        remaining: Math.max(0, total - paid),
        unpaid: students.filter((x) => !x.paid).length,
        partial: students.filter((x) => x.paid > 0 && x.remaining > 0).length,
        paidFull: students.filter((x) => !x.remaining).length,
        incompleteMeasurements: students.filter(
          (x) => x.measurementStatus !== "complete",
        ).length,
        inProduction: students.filter(
          (x) => !["new", "ready", "delivered"].includes(x.productionStatus),
        ).length,
        ready: students.filter((x) =>
          ["ready", "delivered"].includes(x.productionStatus),
        ).length,
        collectionProgress: total ? Math.round((paid / total) * 100) : 0,
        custody: Math.max(
          0,
          money((payments.rows[0] as any)?.amount) -
            money((handovers.rows[0] as any)?.amount),
        ),
      },
    });
  }
  if (resource === "assignments") {
    if (user.role !== "admin")
      return fail("إدارة تعيين الممثلين متاحة للإدارة فقط", 403);
    if (req.method === "GET") {
      const rows = await db.execute(sql`
        SELECT a.id, a.staff_id AS "staffId", a.group_id AS "groupId", a.is_active AS "isActive", a.created_at AS "createdAt",
          s.full_name AS "representativeName", s.username AS "representativeUsername", g.title AS "groupTitle", g.group_no AS "groupNo"
        FROM representative_group_assignments a
        JOIN staff s ON s.id = a.staff_id JOIN graduation_groups g ON g.id = a.group_id
        ORDER BY a.created_at DESC`);
      const [staff, groups] = await Promise.all([
        db
          .select({
            id: staffTable.id,
            fullName: staffTable.fullName,
            username: staffTable.username,
            role: staffTable.role,
            permissions: staffTable.permissions,
            isActive: staffTable.isActive,
          })
          .from(staffTable)
          .where(eq(staffTable.isActive, true))
          .orderBy(staffTable.fullName),
        db
          .select({
            id: graduationGroupsTable.id,
            title: graduationGroupsTable.title,
            groupNo: graduationGroupsTable.groupNo,
          })
          .from(graduationGroupsTable)
          .orderBy(desc(graduationGroupsTable.createdAt)),
      ]);
      return json({ items: rows.rows, staff: staff.filter(representativeStaffIsEligible), groups });
    }
    if (req.method === "POST") {
      const parsed = z
        .object({
          staffId: z.coerce.number().int().positive(),
          groupId: z.coerce.number().int().positive(),
          isActive: z.boolean().optional().default(true),
          resolveAmbiguous: z.boolean().optional().default(false),
        })
        .safeParse(await readRequestBody(req));
      if (!parsed.success) return fail("تحقق من بيانات تعيين ممثل الشعبة");
      try {
        const result = await db.transaction(async (tx) => {
          const [staff] = await tx.select().from(staffTable)
            .where(eq(staffTable.id, parsed.data.staffId)).for("update");
          if (!staff) return { status: 404, message: "حساب الموظف غير موجود" };
          if (!representativeStaffIsEligible(staff))
            return { status: 403, message: "اختر حساب موظف مفعّلاً لديه صلاحية بوابة الممثلين" };
          const [group] = await tx.select({ id: graduationGroupsTable.id })
            .from(graduationGroupsTable).where(eq(graduationGroupsTable.id, parsed.data.groupId));
          if (!group) return { status: 404, message: "مجموعة التخرج غير موجودة" };
          const current = await tx.execute(sql`
            SELECT group_id FROM representative_group_assignments
            WHERE staff_id = ${staff.id} AND is_active = true FOR UPDATE`);
          const financial = await tx.execute(sql`
            SELECT EXISTS(SELECT 1 FROM representative_payment_requests WHERE representative_id = ${staff.id}) AS "hasPayments",
              EXISTS(SELECT 1 FROM representative_custody_handovers WHERE representative_id = ${staff.id}) AS "hasCustody"`);
          const history = financial.rows[0] as { hasPayments?: boolean; hasCustody?: boolean } | undefined;
          const financiallyBound = Boolean(history?.hasPayments || history?.hasCustody);
          if (!parsed.data.isActive) {
            if (financiallyBound)
              return { status: 409, message: "لا يمكن تعطيل مجموعة ممثل لديه دفعات أو تسليم عهدة سابق" };
            const disabled = await tx.execute(sql`
              UPDATE representative_group_assignments SET is_active = false
              WHERE staff_id = ${staff.id} AND group_id = ${group.id} AND is_active = true
              RETURNING *`);
            return disabled.rows[0]
              ? { assignment: disabled.rows[0] }
              : { status: 404, message: "التعيين النشط غير موجود" };
          }
          let historicalGroupIds: number[] = [];
          let paymentGroupIds: number[] = [];
          if (financiallyBound && current.rows.length === 0) {
            const [allAssignments, paymentGroups] = await Promise.all([
              tx.execute(sql`SELECT group_id FROM representative_group_assignments WHERE staff_id = ${staff.id}`),
              tx.execute(sql`SELECT DISTINCT group_id FROM representative_payment_requests WHERE representative_id = ${staff.id}`),
            ]);
            historicalGroupIds = [...new Set(allAssignments.rows.map((row) => Number(row.group_id)))];
            paymentGroupIds = [...new Set(paymentGroups.rows.map((row) => Number(row.group_id)))];
          }
          const decision = assignmentDecision({
            currentActiveGroupIds: current.rows.map((row) => Number(row.group_id)),
            targetGroupId: group.id,
            hasPaymentRequests: Boolean(history?.hasPayments),
            hasCustodyHandovers: Boolean(history?.hasCustody),
            resolveAmbiguous: parsed.data.resolveAmbiguous,
            historicalGroupIds,
            paymentGroupIds,
          });
          if (decision === "ambiguous")
            return { status: 409, message: "للموظف أكثر من مجموعة نشطة؛ راجع التعيينات وأكّد التصحيح" };
          if (decision === "financiallyLocked")
            return { status: 409, message: "لا يمكن تغيير مجموعة ممثل لديه دفعات أو تسليم عهدة سابق" };
          if (decision === "same") {
            const existing = await tx.execute(sql`
              SELECT * FROM representative_group_assignments
              WHERE staff_id = ${staff.id} AND group_id = ${group.id} AND is_active = true`);
            return { assignment: existing.rows[0] };
          }
          if (decision === "replace") await tx.execute(sql`
            UPDATE representative_group_assignments SET is_active = false
            WHERE staff_id = ${staff.id} AND is_active = true`);
          const saved = await tx.execute(sql`
            INSERT INTO representative_group_assignments (staff_id, group_id, is_active)
            VALUES (${staff.id}, ${group.id}, true)
            ON CONFLICT (staff_id, group_id) DO UPDATE SET is_active = true
            RETURNING *`);
          return { assignment: saved.rows[0] };
        });
        if ("status" in result && typeof result.status === "number")
          return fail(result.message ?? "تعذر حفظ تعيين الممثل", result.status);
        return json(result, 201);
      } catch (cause) {
        console.error("representative assignment save failed", { requestId, actorId: user.id, staffId: parsed.data.staffId, ...safeServerError(cause) });
        return fail("تعذر حفظ تعيين الممثل؛ حاول مجدداً", 500);
      }
    }
  }
  if (resource === "students" && req.method === "GET") {
    if (!has(user, "representative.group.view"))
      return fail("لا تملك صلاحية عرض الطلبة", 403);
    const q = String(req.nextUrl.searchParams.get("search") || "")
      .trim()
      .toLowerCase();
    const rows = await studentRows(groupIds);
    return json({
      items: q
        ? rows.filter((row) =>
            [row.name, row.phone, row.studentCode, row.qr, row.barcode].some(
              (x) =>
                String(x || "")
                  .toLowerCase()
                  .includes(normalizePhoneDigits(q) || q),
            ),
          )
        : rows,
    });
  }
  if (resource === "payments" && req.method === "POST") {
    if (!has(user, "representative.payments.create"))
      return fail("لا تملك صلاحية تسجيل الدفعات", 403);
    const parsed = paymentInput.safeParse(await readRequestBody(req));
    if (!parsed.success) return fail("تحقق من بيانات الدفعة");
    try {
      const result = await db.transaction(async (tx) => {
        const [staff] = await tx.select({ id: staffTable.id }).from(staffTable)
          .where(eq(staffTable.id, user.id)).for("update");
        if (!staff) return { status: 403, message: "حساب الممثل غير متاح" };
        let currentScope: RepresentativeScope = scope;
        if (scope.kind !== "admin") {
          const assignments = await tx.execute(sql`
            SELECT group_id FROM representative_group_assignments
            WHERE staff_id = ${user.id} AND is_active = true`);
          currentScope = classifyRepresentativeScope(user, assignments.rows.map((row) => Number(row.group_id)));
          if (currentScope.kind !== "group" || currentScope.groupId !== scope.groupId)
            return { status: 409, message: "تغيّر تعيين المجموعة؛ أعد فتح البوابة قبل تسجيل الدفعة" };
        }
        const order = await tx.query.graduationOrdersTable.findFirst({
          where: eq(graduationOrdersTable.id, parsed.data.orderId),
        });
        if (!order?.groupId || !canAccessRepresentativeGroup(currentScope, order.groupId))
          return { status: 403, message: "غير مخول للوصول إلى هذا الطالب" };
        const group = await tx.query.graduationGroupsTable.findFirst({
          where: eq(graduationGroupsTable.id, order.groupId),
        });
        if (!group) return { status: 403, message: "غير مخول للوصول إلى هذا الطالب" };
        if (parsed.data.amount > money(order.remainingAmount))
          return { status: 409, message: "المبلغ أكبر من الرصيد المتبقي" };
        const request = (await tx.execute(sql`
          INSERT INTO representative_payment_requests
            (group_id, graduation_order_id, amount, payment_method, receipt_number, receipt_image,
             occurred_at, notes, representative_id, representative_name)
          VALUES (${order.groupId}, ${order.id}, ${String(parsed.data.amount)}, ${parsed.data.paymentMethod},
            ${parsed.data.receiptNumber || null}, ${parsed.data.receiptImage || null},
            ${parsed.data.occurredAt ? new Date(parsed.data.occurredAt) : new Date()},
            ${parsed.data.notes || null}, ${user.id}, ${user.fullName || user.username}) RETURNING *
        `)).rows[0] as any;
        await tx.insert(entityTimelineTable).values({
          entityType: "graduation_order", entityId: order.id, type: "representative",
          title: "سجّل ممثل الشعبة مبلغاً بانتظار الاعتماد", actorId: user.id,
          actorName: user.fullName || user.username,
          metadata: { requestId: request.id, amount: parsed.data.amount },
        });
        return { request };
      });
      if ("status" in result && typeof result.status === "number")
        return fail(result.message ?? "تعذر تسجيل الدفعة", result.status);
      return json({ request: result.request, status: "pending" }, 201);
    } catch (cause) {
      console.error("representative payment request failed", { requestId, actorId: user.id, orderId: parsed.data.orderId, ...safeServerError(cause) });
      return fail("تعذر تسجيل الدفعة؛ حاول مجدداً", 500);
    }
  }
  if (resource === "payments" && parts.length === 1 && req.method === "GET") {
    const rows = await db.execute(
      scope.kind === "admin"
        ? sql`
      SELECT p.*, r.receipt_no AS "receiptNo", o.customer_name AS "studentName", o.student_code AS "studentCode", g.title AS "groupTitle"
      FROM representative_payment_requests p JOIN graduation_orders o ON o.id=p.graduation_order_id JOIN graduation_groups g ON g.id=p.group_id
      LEFT JOIN graduation_receipts r ON r.payment_id=p.posted_payment_id
      ORDER BY p.created_at DESC`
        : sql`
      SELECT p.*, r.receipt_no AS "receiptNo", o.customer_name AS "studentName", o.student_code AS "studentCode", g.title AS "groupTitle"
      FROM representative_payment_requests p JOIN graduation_orders o ON o.id=p.graduation_order_id JOIN graduation_groups g ON g.id=p.group_id
      LEFT JOIN graduation_receipts r ON r.payment_id=p.posted_payment_id
      WHERE p.representative_id=${user.id} AND p.group_id=${scope.kind === "group" ? scope.groupId : -1}
      ORDER BY p.created_at DESC`,
    );
    return json({ items: rows.rows });
  }
  if (
    resource === "payments" &&
    parts[1] &&
    parts[2] === "approve" &&
    req.method === "POST"
  ) {
    if (user.role !== "admin")
      return fail("اعتماد الدفعات متاح للإدارة فقط", 403);
    const claimed = await db.execute(
      sql`UPDATE representative_payment_requests SET status='processing', updated_at=now() WHERE id=${Number(parts[1])} AND status='pending' RETURNING *`,
    );
    const row = claimed.rows[0] as any;
    if (!row) return fail("طلب الدفعة غير متاح للاعتماد", 409);
    const order = await db.query.graduationOrdersTable.findFirst({
      where: eq(graduationOrdersTable.id, row.graduation_order_id),
    });
    if (!order) {
      await db.execute(
        sql`UPDATE representative_payment_requests SET status='pending', updated_at=now() WHERE id=${row.id}`,
      );
      return fail("طلب الطالب غير موجود", 404);
    }
    const representative: GraduationAdminUser = {
      ...user,
      id: Number(row.representative_id),
      fullName: String(row.representative_name || user.fullName),
      username: String(row.representative_name || user.username),
    };
    const result = await receivePayment(
      {
        amount: money(row.amount),
        paymentMethod: row.payment_method,
        notes: row.notes || "",
        strategy: "selected",
        selectedStudentIds: [order.id],
        idempotencyKey: `representative-request-${row.id}`,
      },
      representative,
      undefined,
      order.id,
    );
    if ("response" in result && result.response) {
      await db.execute(
        sql`UPDATE representative_payment_requests SET status='pending', updated_at=now() WHERE id=${row.id}`,
      );
      return result.response;
    }
    const payment = (result as { payments?: any[] }).payments?.[0];
    await db.execute(
      sql`UPDATE representative_payment_requests SET status='approved', approved_by=${user.id}, approved_at=now(), posted_payment_id=${payment?.id ?? null}, updated_at=now() WHERE id=${row.id}`,
    );
    await timeline(user, order.id, "اعتمدت الإدارة دفعة ممثل الشعبة", {
      requestId: row.id,
      paymentId: payment.id,
    });
    return json({ payment, receiptNo: payment?.receiptNo, status: "approved" });
  }
  if (
    resource === "payments" &&
    parts[1] &&
    parts[2] === "reject" &&
    req.method === "POST"
  ) {
    if (user.role !== "admin") return fail("رفض الدفعات متاح للإدارة فقط", 403);
    const note = String((await readRequestBody(req))?.note || "").slice(
      0,
      1500,
    );
    const result = await db.execute(
      sql`UPDATE representative_payment_requests SET status='rejected', rejection_note=${note || null}, approved_by=${user.id}, approved_at=now(), updated_at=now() WHERE id=${Number(parts[1])} AND status='pending' RETURNING *`,
    );
    if (!result.rows[0]) return fail("طلب الدفعة غير متاح للرفض", 409);
    return json({ request: result.rows[0], status: "rejected" });
  }
  if (
    resource === "payments" &&
    parts[1] &&
    parts[2] === "receipt" &&
    req.method === "GET"
  ) {
    if (!has(user, "representative.receipts.print"))
      return fail("لا تملك صلاحية طباعة الوصولات", 403);
    const rows = await db.execute(
      scope.kind === "admin"
        ? sql`
      SELECT p.*, r.receipt_no AS "receiptNo", r.snapshot AS snapshot, o.customer_name AS "studentName", o.student_code AS "studentCode", g.title AS "groupTitle"
      FROM representative_payment_requests p
      JOIN graduation_orders o ON o.id=p.graduation_order_id JOIN graduation_groups g ON g.id=p.group_id
      LEFT JOIN graduation_receipts r ON r.payment_id=p.posted_payment_id
      WHERE p.id=${Number(parts[1])}`
        : sql`
      SELECT p.*, r.receipt_no AS "receiptNo", r.snapshot AS snapshot, o.customer_name AS "studentName", o.student_code AS "studentCode", g.title AS "groupTitle"
      FROM representative_payment_requests p
      JOIN graduation_orders o ON o.id=p.graduation_order_id JOIN graduation_groups g ON g.id=p.group_id
      LEFT JOIN graduation_receipts r ON r.payment_id=p.posted_payment_id
      WHERE p.id=${Number(parts[1])} AND p.representative_id=${user.id}
        AND p.group_id=${scope.kind === "group" ? scope.groupId : -1}`,
    );
    const receipt = rows.rows[0];
    if (
      !receipt ||
      receipt.status !== "approved" ||
      !receipt.receiptNo ||
      !receipt.snapshot
    )
      return fail("الوصل غير متاح قبل اعتماد الدفعة", 404);
    return json({ receipt });
  }
  if (resource === "custody" && req.method === "POST") {
    const data = await readRequestBody(req);
    const value = money(data?.amount);
    if (value <= 0) return fail("أدخل مبلغ التسليم");
    try {
      const result = await db.transaction(async (tx) => {
        const [staff] = await tx.select({ id: staffTable.id }).from(staffTable)
          .where(eq(staffTable.id, user.id)).for("update");
        if (!staff) return { status: 403, message: "حساب الممثل غير متاح" };
        if (scope.kind !== "admin") {
          const assignments = await tx.execute(sql`
            SELECT group_id FROM representative_group_assignments
            WHERE staff_id = ${user.id} AND is_active = true`);
          const currentScope = classifyRepresentativeScope(user, assignments.rows.map((row) => Number(row.group_id)));
          if (currentScope.kind !== "group" || currentScope.groupId !== scope.groupId)
            return { status: 409, message: "تغيّر تعيين المجموعة؛ أعد فتح البوابة قبل تسليم العهدة" };
        }
        const handover = (await tx.execute(sql`
          INSERT INTO representative_custody_handovers
            (representative_id, amount, receipt_image, notes)
          VALUES (${user.id}, ${String(value)}, ${String(data?.receiptImage || "") || null},
            ${String(data?.notes || "") || null}) RETURNING *
        `)).rows[0];
        return { handover };
      });
      if ("status" in result && typeof result.status === "number")
        return fail(result.message ?? "تعذر تسجيل التسليم", result.status);
      return json({ handover: result.handover }, 201);
    } catch (cause) {
      console.error("representative custody handover failed", { requestId, actorId: user.id, ...safeServerError(cause) });
      return fail("تعذر تسجيل التسليم؛ حاول مجدداً", 500);
    }
  }
  if (resource === "custody" && req.method === "GET") {
    const rows = await db.execute(
      user.role === "admin"
        ? sql`SELECT * FROM representative_custody_handovers ORDER BY created_at DESC`
        : sql`SELECT * FROM representative_custody_handovers WHERE representative_id=${user.id} ORDER BY created_at DESC`,
    );
    return json({ items: rows.rows });
  }
  if (
    resource === "custody" &&
    parts[1] &&
    parts[2] === "confirm" &&
    req.method === "POST"
  ) {
    if (user.role !== "admin")
      return fail("اعتماد تسليم العهدة متاح للإدارة فقط", 403);
    const result = await db.execute(
      sql`UPDATE representative_custody_handovers SET status='confirmed', confirmed_by=${user.id}, confirmed_at=now() WHERE id=${Number(parts[1])} AND status='pending' RETURNING *`,
    );
    if (!result.rows[0]) return fail("طلب تسليم العهدة غير متاح للاعتماد", 409);
    return json({ handover: result.rows[0] });
  }
  if (resource === "issues" && req.method === "POST") {
    if (!has(user, "representative.issues.create"))
      return fail("لا تملك صلاحية الإبلاغ عن مشكلة", 403);
    const parsed = issueInput.safeParse(await readRequestBody(req));
    if (!parsed.success) return fail("تحقق من بيانات المشكلة");
    const order = await db.query.graduationOrdersTable.findFirst({
      where: eq(graduationOrdersTable.id, parsed.data.orderId),
    });
    if (!order?.groupId || !(await requireGroup(scope, order.groupId)))
      return fail("غير مخول للوصول إلى هذا الطالب", 403);
    const issue = (
      await db.execute(
        sql`INSERT INTO representative_issues (group_id, graduation_order_id, type, priority, notes, photos, reporter_id) VALUES (${order.groupId}, ${order.id}, ${parsed.data.type}, ${parsed.data.priority}, ${parsed.data.notes}, ${JSON.stringify(parsed.data.photos)}::jsonb, ${user.id}) RETURNING *`,
      )
    ).rows[0] as any;
    await timeline(user, order.id, "أبلغ ممثل الشعبة عن مشكلة", {
      issueId: (issue as any).id,
      type: parsed.data.type,
    });
    return json({ issue }, 201);
  }
  if (resource === "reports" && req.method === "GET") {
    if (!has(user, "representative.reports.export"))
      return fail("لا تملك صلاحية تصدير التقارير", 403);
    return json({
      items: await studentRows(groupIds),
      exportedAt: new Date().toISOString(),
    });
  }
  return fail("المسار غير موجود", 404);
}
