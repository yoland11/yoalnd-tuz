/**
 * Academic batches and per-group workspaces for the representatives portal.
 *
 * Every read and write here is scoped on the server: an administrator sees all
 * groups, a representative only the single group assigned to them (resolved by
 * the caller from representative_group_assignments). Financial writes are NOT
 * implemented here — payments keep using the existing pending-request →
 * admin-approval → receivePayment workflow in representative.ts.
 */
import { NextResponse, type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import type { GraduationAdminUser } from "@/server/graduation";
import { canAccessRepresentativeGroup, type RepresentativeScope } from "@/lib/representative-group-access";
import { getGraduationMeasurementFilter } from "@/lib/graduation-measurements";
import { hasDuplicateGroupStudentName } from "@/lib/graduation-group-student-identity";
import {
  GRADUATION_BATCH_SETTING_KEY,
  UNASSIGNED_BATCH,
  batchLabel,
  combineStats,
  compareBatchKeys,
  groupBatchKey,
  isValidBatchKey,
  normalizeBatchKey,
  summarizeStudents,
  type StudentStats,
} from "@/lib/graduation-batches";
import { readRequestBody } from "@/server/request-body";
import { safeServerError } from "@/server/safe-server-log";

type Fail = (message: string, status?: number) => NextResponse;
type Row = Record<string, any>;
type BatchRegistryEntry = { key: string; title?: string; createdAt: string; createdBy: number; createdByName: string };

const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
const money = (value: unknown) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};
const rows = <T = Row>(result: any): T[] => (result?.rows ?? []) as T[];

function has(user: GraduationAdminUser, permission: string) {
  return (
    user.role === "admin" ||
    user.permissions.includes(permission) ||
    (permission !== "representative.portal.access" && user.permissions.includes("representative.portal.access"))
  );
}

function readRegistry(value: unknown): BatchRegistryEntry[] {
  const list = (value as { batches?: unknown })?.batches;
  if (!Array.isArray(list)) return [];
  return list
    .map((entry: any) => ({ ...entry, key: normalizeBatchKey(entry?.key) }))
    .filter((entry: BatchRegistryEntry) => isValidBatchKey(entry.key));
}

/** Visible groups with per-group statistics, aggregated in a single SQL pass. */
async function visibleGroupsWithStats(scope: RepresentativeScope) {
  const groups = rows(await db.execute(scope.kind === "admin"
    ? sql`SELECT g.id, g.group_no, g.title, g.university, g.college, g.department, g.graduation_year, g.status,
            g.representative_name, g.event_date, g.group_credit_amount, g.created_at,
            g.default_configuration->'groupMeta' AS group_meta
          FROM graduation_groups g ORDER BY g.created_at DESC`
    : sql`SELECT g.id, g.group_no, g.title, g.university, g.college, g.department, g.graduation_year, g.status,
            g.representative_name, g.event_date, g.group_credit_amount, g.created_at,
            g.default_configuration->'groupMeta' AS group_meta
          FROM graduation_groups g WHERE g.id = ${scope.kind === "group" ? scope.groupId : -1}`));
  const ids = groups.map((group) => Number(group.id));
  const students = ids.length
    ? rows(await db.execute(sql`
        SELECT o.group_id, o.status, o.production_stage, o.total_amount, o.paid_amount, o.remaining_amount,
          o.delivery, o.delivered_at
        FROM graduation_orders o
        WHERE o.archived_at IS NULL AND o.group_id = ANY(${ids}::int[])`))
    : [];
  const byGroup = new Map<number, Row[]>();
  for (const student of students) {
    const list = byGroup.get(Number(student.group_id)) ?? [];
    list.push(student);
    byGroup.set(Number(student.group_id), list);
  }
  return groups.map((group) => {
    const stats = summarizeStudents((byGroup.get(Number(group.id)) ?? []).map((student) => ({
      status: student.status,
      productionStage: student.production_stage,
      total: money(student.total_amount),
      paid: money(student.paid_amount),
      remaining: money(student.remaining_amount),
      delivery: student.delivery,
      deliveredAt: student.delivered_at,
    })));
    const meta = (group.group_meta ?? {}) as Row;
    return {
      id: Number(group.id),
      groupNo: group.group_no,
      title: group.title,
      university: group.university || "",
      college: group.college || "",
      department: group.department || "",
      graduationYear: group.graduation_year || "",
      batchKey: groupBatchKey(group.graduation_year),
      status: group.status,
      representativeName: group.representative_name || "",
      deliveryDate: meta.deliveryDate || group.event_date || null,
      expectedStudentCount: Number(meta.expectedStudentCount) || null,
      groupCredit: money(group.group_credit_amount),
      stats,
    };
  });
}

async function batchesOverview(scope: RepresentativeScope) {
  const groups = await visibleGroupsWithStats(scope);
  const registry = scope.kind === "admin"
    ? readRegistry(rows(await db.execute(sql`SELECT value FROM settings WHERE key = ${GRADUATION_BATCH_SETTING_KEY}`))[0]?.value)
    : [];
  const keys = new Set<string>(groups.map((group) => group.batchKey));
  // Empty batches created by the administrator are listed for administrators only.
  for (const entry of registry) keys.add(entry.key);
  const batches = [...keys].sort(compareBatchKeys).map((key) => {
    const members = groups.filter((group) => group.batchKey === key);
    const entry = registry.find((item) => item.key === key);
    return {
      key,
      label: entry?.title || batchLabel(key),
      groups: members.length,
      universities: new Set(members.map((group) => group.university).filter(Boolean)).size,
      stats: combineStats(members.map((group) => group.stats)),
      registered: Boolean(entry),
    };
  });
  return {
    kind: scope.kind,
    batches,
    groups,
    global: scope.kind === "admin" ? combineStats(groups.map((group) => group.stats)) : null,
  };
}

async function groupWorkspace(groupId: number, scope: RepresentativeScope, user: GraduationAdminUser) {
  const group = rows(await db.execute(sql`
    SELECT g.id, g.group_no, g.join_token, g.title, g.university, g.college, g.department, g.graduation_year,
      g.status, g.representative_name, g.representative_phone, g.event_date, g.group_credit_amount,
      g.default_configuration, g.created_at
    FROM graduation_groups g WHERE g.id = ${groupId}`))[0];
  if (!group) return null;
  const students = rows(await db.execute(sql`
    SELECT o.id, o.order_no, o.student_code, o.qr_token, o.barcode_value, o.receipt_no, o.customer_name, o.phone,
      o.status, o.production_stage, o.style_key, o.package_key, o.measurements, o.colors, o.fabric, o.custom_text,
      o.accessories, o.extras, o.total_amount, o.paid_amount, o.remaining_amount, o.payment_status, o.delivery,
      o.delivered_at, o.ready_at, o.due_date, o.notes, o.created_at
    FROM graduation_orders o
    WHERE o.group_id = ${groupId} AND o.archived_at IS NULL
    ORDER BY o.customer_name`)).map((row) => ({
      id: Number(row.id),
      orderNo: row.order_no,
      studentCode: row.student_code || row.order_no,
      qr: row.qr_token,
      barcode: row.barcode_value,
      receiptNo: row.receipt_no,
      name: row.customer_name,
      phone: row.phone,
      status: row.status,
      productionStage: row.production_stage,
      styleKey: row.style_key,
      packageKey: row.package_key,
      measurements: row.measurements ?? {},
      measurementStatus: getGraduationMeasurementFilter(row.measurements),
      colors: row.colors ?? {},
      fabric: row.fabric ?? {},
      customText: row.custom_text ?? {},
      accessories: Array.isArray(row.accessories) ? row.accessories : [],
      extras: row.extras ?? {},
      total: money(row.total_amount),
      paid: money(row.paid_amount),
      remaining: money(row.remaining_amount),
      paymentStatus: row.payment_status,
      delivery: row.delivery ?? {},
      deliveredAt: row.delivered_at,
      readyAt: row.ready_at,
      dueDate: row.due_date,
      notes: row.notes,
      createdAt: row.created_at,
      trackingUrl: `/graduation/track/${row.qr_token}`,
    }));
  // Posted payments: tied to this group's students, or unallocated group credit.
  const posted = rows(await db.execute(sql`
    SELECT p.id, p.graduation_order_id, p.amount, p.payment_method, p.allocation_strategy, p.notes,
      p.received_by_name, p.created_at, o.customer_name, o.student_code, r.receipt_no, r.snapshot
    FROM graduation_student_payments p
    LEFT JOIN graduation_orders o ON o.id = p.graduation_order_id
    LEFT JOIN LATERAL (
      SELECT receipt_no, snapshot FROM graduation_receipts WHERE payment_id = p.id ORDER BY id DESC LIMIT 1
    ) r ON true
    WHERE (p.graduation_order_id IS NOT NULL AND o.group_id = ${groupId})
       OR (p.graduation_order_id IS NULL AND p.group_id = ${groupId})
    ORDER BY p.created_at DESC`)).map((row) => ({
      id: Number(row.id),
      orderId: row.graduation_order_id ? Number(row.graduation_order_id) : null,
      studentName: row.customer_name || "رصيد المجموعة",
      studentCode: row.student_code || "",
      amount: money(row.amount),
      paymentMethod: row.payment_method,
      allocation: row.allocation_strategy,
      notes: row.notes,
      receivedBy: row.received_by_name,
      receiptNo: row.receipt_no || null,
      snapshot: row.snapshot ?? null,
      createdAt: row.created_at,
    }));
  const requests = rows(await db.execute(scope.kind === "admin"
    ? sql`SELECT p.id, p.group_id, p.graduation_order_id, p.amount, p.payment_method, p.receipt_number, p.occurred_at, p.notes,
            p.status, p.representative_id, p.representative_name, p.approved_at, p.rejection_note, p.posted_payment_id, p.created_at,
            (p.receipt_image IS NOT NULL) AS has_receipt_image,
            r.receipt_no AS "receiptNo", o.customer_name AS "studentName", o.student_code AS "studentCode"
          FROM representative_payment_requests p JOIN graduation_orders o ON o.id = p.graduation_order_id
          LEFT JOIN graduation_receipts r ON r.payment_id = p.posted_payment_id
          WHERE p.group_id = ${groupId} ORDER BY p.created_at DESC`
    : sql`SELECT p.id, p.group_id, p.graduation_order_id, p.amount, p.payment_method, p.receipt_number, p.occurred_at, p.notes,
            p.status, p.representative_id, p.representative_name, p.approved_at, p.rejection_note, p.posted_payment_id, p.created_at,
            (p.receipt_image IS NOT NULL) AS has_receipt_image,
            r.receipt_no AS "receiptNo", o.customer_name AS "studentName", o.student_code AS "studentCode"
          FROM representative_payment_requests p JOIN graduation_orders o ON o.id = p.graduation_order_id
          LEFT JOIN graduation_receipts r ON r.payment_id = p.posted_payment_id
          WHERE p.group_id = ${groupId} AND p.representative_id = ${user.id} ORDER BY p.created_at DESC`));
  const config = (group.default_configuration ?? {}) as Row;
  const meta = (config.groupMeta ?? {}) as Row;
  const batchKey = groupBatchKey(group.graduation_year);
  return {
    group: {
      id: Number(group.id),
      groupNo: group.group_no,
      title: group.title,
      university: group.university || "",
      college: group.college || "",
      department: group.department || "",
      graduationYear: group.graduation_year || "",
      batchKey,
      batchLabel: batchLabel(batchKey),
      status: group.status,
      representativeName: group.representative_name || "",
      representativePhone: group.representative_phone || "",
      deliveryDate: meta.deliveryDate || group.event_date || null,
      expectedStudentCount: Number(meta.expectedStudentCount) || null,
      groupCredit: money(group.group_credit_amount),
      joinUrl: `/graduation?group=${group.join_token}`,
      defaultConfiguration: config,
    },
    stats: summarizeStudents(students),
    students,
    payments: { posted, requests },
    permissions: {
      admin: scope.kind === "admin",
      recordPayment: has(user, "representative.payments.create"),
      manageStudents: has(user, "representative.students.manage"),
      printReceipts: has(user, "representative.receipts.print"),
      exportReports: has(user, "representative.reports.export"),
    },
  };
}

const createBatchInput = z.object({
  key: z.string().trim().min(4).max(10),
  title: z.string().trim().max(60).optional().default(""),
});
const assignBatchInput = z.object({ key: z.string().trim().min(4).max(10), confirm: z.literal(true) });
const editStudentInput = z.object({
  customerName: z.string().trim().min(3).max(160).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export async function handleRepresentativeWorkspace(
  req: NextRequest,
  parts: string[],
  user: GraduationAdminUser,
  scope: RepresentativeScope,
  fail: Fail,
  requestId: string,
): Promise<NextResponse | null> {
  const [resource, id, sub, subId] = parts;
  const isBatches = resource === "batches" && !id;
  const isGroupRoute = resource === "groups" && id && ["workspace", "batch", "students"].includes(String(sub));
  if (!isBatches && !isGroupRoute) return null;
  if (scope.kind !== "admin" && !has(user, "representative.group.view"))
    return fail("لا تملك صلاحية عرض بيانات المجموعة", 403);

  try {
    // ---------------------------------------------------------- batches
    if (isBatches && req.method === "GET") return json(await batchesOverview(scope));

    if (isBatches && req.method === "POST") {
      if (scope.kind !== "admin") return fail("إنشاء وجبة التخرج متاح للإدارة فقط", 403);
      const parsed = createBatchInput.safeParse(await readRequestBody(req));
      if (!parsed.success) return fail("أدخل سنة الوجبة بصيغة 2027 أو 2026-2027");
      const key = normalizeBatchKey(parsed.data.key);
      if (!isValidBatchKey(key)) return fail("أدخل سنة الوجبة بصيغة 2027 أو 2026-2027");
      const result = await db.transaction(async (tx) => {
        await tx.execute(sql`
          INSERT INTO settings (key, value, updated_at)
          VALUES (${GRADUATION_BATCH_SETTING_KEY}, ${JSON.stringify({ batches: [] })}::jsonb, now())
          ON CONFLICT (key) DO NOTHING`);
        const current = rows(await tx.execute(sql`
          SELECT value FROM settings WHERE key = ${GRADUATION_BATCH_SETTING_KEY} FOR UPDATE`))[0];
        const registry = readRegistry(current?.value);
        const usedByGroups = rows(await tx.execute(sql`
          SELECT graduation_year FROM graduation_groups WHERE graduation_year IS NOT NULL`))
          .some((group) => normalizeBatchKey(group.graduation_year) === key);
        if (registry.some((entry) => entry.key === key) || usedByGroups)
          return { status: 409, message: `${batchLabel(key)} موجودة مسبقاً` };
        const entry: BatchRegistryEntry = {
          key,
          ...(parsed.data.title ? { title: parsed.data.title } : {}),
          createdAt: new Date().toISOString(),
          createdBy: user.id,
          createdByName: user.fullName || user.username,
        };
        await tx.execute(sql`
          UPDATE settings SET value = ${JSON.stringify({ batches: [...registry, entry] })}::jsonb, updated_at = now()
          WHERE key = ${GRADUATION_BATCH_SETTING_KEY}`);
        return { entry };
      });
      if ("status" in result) return fail(result.message ?? "تعذر إنشاء الوجبة", result.status);
      return json({ batch: { key: result.entry.key, label: result.entry.title || batchLabel(result.entry.key) } }, 201);
    }

    // ---------------------------------------------------------- one group
    const groupId = Number(id);
    if (!Number.isInteger(groupId) || groupId <= 0) return fail("رقم المجموعة غير صحيح");
    if (!canAccessRepresentativeGroup(scope, groupId)) return fail("غير مخول للوصول إلى هذه المجموعة", 403);

    if (sub === "workspace" && !subId && req.method === "GET") {
      const workspace = await groupWorkspace(groupId, scope, user);
      return workspace ? json(workspace) : fail("مجموعة التخرج غير موجودة", 404);
    }

    if (sub === "batch" && !subId && req.method === "PATCH") {
      if (scope.kind !== "admin") return fail("تحديد وجبة المجموعة متاح للإدارة فقط", 403);
      const parsed = assignBatchInput.safeParse(await readRequestBody(req));
      const key = normalizeBatchKey(parsed.success ? parsed.data.key : "");
      if (!parsed.success || !isValidBatchKey(key)) return fail("اختر وجبة صحيحة وأكّد التحديد");
      const result = await db.transaction(async (tx) => {
        const group = rows(await tx.execute(sql`
          SELECT id, graduation_year FROM graduation_groups WHERE id = ${groupId} FOR UPDATE`))[0];
        if (!group) return { status: 404, message: "مجموعة التخرج غير موجودة" };
        // Historical groups are only ever assigned explicitly, never re-labelled.
        if (normalizeBatchKey(group.graduation_year))
          return { status: 409, message: "هذه المجموعة مرتبطة بوجبة مسبقاً؛ لا يمكن تغيير وجبتها من البوابة" };
        await tx.execute(sql`
          UPDATE graduation_groups SET graduation_year = ${key}, updated_at = now() WHERE id = ${groupId}`);
        await tx.execute(sql`
          INSERT INTO entity_timeline (entity_type, entity_id, type, title, actor_id, actor_name, metadata)
          VALUES ('graduation_group', ${groupId}, 'batch_assigned', ${`تم ربط المجموعة بـ ${batchLabel(key)}`},
            ${user.id}, ${user.fullName || user.username}, ${JSON.stringify({ batchKey: key, previous: null })}::jsonb)`);
        return { key };
      });
      if ("status" in result) return fail(result.message ?? "تعذر تحديد الوجبة", result.status);
      return json({ groupId, batchKey: result.key, label: batchLabel(result.key) });
    }

    if (sub === "students" && subId && !parts[4] && req.method === "PATCH") {
      if (!has(user, "representative.students.manage")) return fail("لا تملك صلاحية تعديل بيانات الطلبة", 403);
      const orderId = Number(subId);
      const parsed = editStudentInput.safeParse(await readRequestBody(req));
      if (!Number.isInteger(orderId) || orderId <= 0 || !parsed.success) return fail("تحقق من بيانات الطالب");
      if (parsed.data.customerName === undefined && parsed.data.notes === undefined) return fail("لا توجد تعديلات للحفظ");
      const result = await db.transaction(async (tx) => {
        // Same lock as student registration so name uniqueness cannot race.
        const group = rows(await tx.execute(sql`SELECT id FROM graduation_groups WHERE id = ${groupId} FOR UPDATE`))[0];
        if (!group) return { status: 404, message: "مجموعة التخرج غير موجودة" };
        const order = rows(await tx.execute(sql`
          SELECT id, group_id, customer_name, notes, status, archived_at FROM graduation_orders
          WHERE id = ${orderId} FOR UPDATE`))[0];
        if (!order || Number(order.group_id) !== groupId || order.archived_at)
          return { status: 404, message: "الطالب غير موجود في هذه المجموعة" };
        if (order.status === "cancelled") return { status: 409, message: "لا يمكن تعديل طلب ملغي" };
        const name = parsed.data.customerName ?? order.customer_name;
        if (parsed.data.customerName !== undefined) {
          const classmates = rows(await tx.execute(sql`
            SELECT id, customer_name, status, archived_at FROM graduation_orders WHERE group_id = ${groupId}`))
            .map((row) => ({ id: Number(row.id), customerName: row.customer_name, status: row.status, archivedAt: row.archived_at }));
          if (hasDuplicateGroupStudentName(name, classmates, orderId))
            return { status: 409, message: "اسم الطالب مسجل مسبقاً في هذه المجموعة؛ أدخل الاسم الكامل الصحيح" };
        }
        const notes = parsed.data.notes === undefined ? order.notes : parsed.data.notes || null;
        await tx.execute(sql`
          UPDATE graduation_orders SET customer_name = ${name}, notes = ${notes}, updated_at = now() WHERE id = ${orderId}`);
        await tx.execute(sql`
          INSERT INTO entity_timeline (entity_type, entity_id, type, title, actor_id, actor_name, metadata)
          VALUES ('graduation_order', ${orderId}, 'representative', 'عدّل ممثل الشعبة بيانات الطالب',
            ${user.id}, ${user.fullName || user.username},
            ${JSON.stringify({ before: { customerName: order.customer_name, notes: order.notes }, after: { customerName: name, notes } })}::jsonb)`);
        return { student: { id: orderId, name, notes } };
      });
      if ("status" in result) return fail(result.message ?? "تعذر حفظ بيانات الطالب", result.status);
      return json(result);
    }

    return fail("المسار غير موجود", 404);
  } catch (cause) {
    console.error("representative workspace request failed", { requestId, actorId: user.id, parts, ...safeServerError(cause) });
    return fail("تعذر إكمال الطلب؛ حاول مجدداً", 500);
  }
}

export type BatchesOverview = Awaited<ReturnType<typeof batchesOverview>>;
export type GroupWorkspace = NonNullable<Awaited<ReturnType<typeof groupWorkspace>>>;
export type { StudentStats };
export { UNASSIGNED_BATCH };
