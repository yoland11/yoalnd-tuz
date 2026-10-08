import { NextResponse, type NextRequest } from "next/server";
import { eq, or, sql } from "drizzle-orm";
import { adminActivityLogsTable, db, entityTimelineTable, graduationGroupsTable } from "@workspace/db";
import { validateGroupSashPricing } from "@/lib/graduation-group-pricing";
import { canManageGraduationGroupPricing } from "@/lib/graduation-group-pricing-access";
import { classifyRepresentativeScope, canAccessRepresentativeGroup } from "@/lib/representative-group-access";
import type { GraduationAdminUser } from "@/server/graduation";
import { InvalidJsonBodyError, readRequestBody, RequestBodyTooLargeError } from "@/server/request-body";
import { createApiErrorPayload, makeRequestId } from "@/server/write-safety";
import { safeServerError } from "@/server/safe-server-log";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

// Existing authenticated admin/representative handlers supply the identity.
// The public registration token is a locator, never an authorization credential.
export async function handleGraduationGroupPricing(
  req: NextRequest, identifier: string, user: GraduationAdminUser, representative = false,
): Promise<NextResponse> {
  const requestId = makeRequestId();
  const fail = (message: string, status: number) => NextResponse.json(createApiErrorPayload({
    message, status, requestId, ...(status >= 500 ? { code: "DATABASE_ERROR" as const } : {}),
  }), { status, headers: { "x-request-id": requestId } });
  if (!["GET", "PUT"].includes(req.method)) return fail("طريقة الطلب غير مدعومة", 405);
  if (!representative && !canManageGraduationGroupPricing(user)) return fail("تعديل سعر الدفعة يتطلب صلاحية تسعير التخرج", 403);
  try {
    const payload = req.method === "PUT" ? await readRequestBody(req) : undefined;
    if (req.method === "PUT" && (!payload || !Object.hasOwn(payload, "sashPricing")))
      return fail("حدد أسعار أنواع الوشاح", 400);
    const result = await db.transaction(async (tx) => {
      const [group] = await tx.select().from(graduationGroupsTable).where(or(
        eq(graduationGroupsTable.id, /^\d+$/.test(identifier) ? Number(identifier) : -1),
        eq(graduationGroupsTable.joinToken, identifier),
        eq(graduationGroupsTable.groupNo, identifier.toUpperCase()),
      )).for("update");
      if (!group) return { status: 404, message: "المجموعة غير موجودة" };
      if (representative && user.role !== "admin") {
        const assignments = await tx.execute(sql`
          SELECT group_id FROM representative_group_assignments
          WHERE staff_id = ${user.id} AND is_active = true FOR SHARE
        `);
        const scope = classifyRepresentativeScope(user, assignments.rows.map((row) => Number(row.group_id)));
        if (!canAccessRepresentativeGroup(scope, group.id))
          return { status: 403, message: "لا تملك صلاحية تسعير هذه المجموعة" };
      }
      if (req.method === "GET") return { group: { id: group.id, title: group.title, defaultConfiguration: group.defaultConfiguration } };
      if (group.status !== "open") return { status: 409, message: "تعديل الأسعار متاح للمجموعات المفتوحة فقط" };
      const configuration = record(group.defaultConfiguration);
      const validation = validateGroupSashPricing(payload.sashPricing, configuration);
      if (!validation.success) return { status: 400, message: validation.error };
      const previous = configuration.sashPricing ?? null;
      const next = { ...configuration, sashPricing: validation.pricing };
      const [saved] = await tx.update(graduationGroupsTable)
        .set({ defaultConfiguration: next, updatedAt: new Date() })
        .where(eq(graduationGroupsTable.id, group.id)).returning();
      const metadata = { previous, current: validation.pricing, appliesTo: "new_orders_only" };
      await tx.insert(entityTimelineTable).values({ entityType: "graduation_group", entityId: group.id,
        type: "group_sash_pricing_updated", title: "تم تحديث أسعار الطلبة حسب نوع الوشاح",
        actorId: user.id, actorName: user.fullName || user.username, metadata });
      await tx.insert(adminActivityLogsTable).values({ staffId: user.id, userName: user.fullName || user.username,
        action: "graduation_group_sash_pricing_updated", entityType: "graduation_group", entityId: group.id, metadata });
      return { group: { id: saved.id, title: saved.title, defaultConfiguration: saved.defaultConfiguration } };
    });
    if (result.status !== undefined) return fail(result.message, result.status);
    return NextResponse.json(result);
  } catch (cause) {
    if (cause instanceof InvalidJsonBodyError) return fail("صيغة بيانات الأسعار غير صحيحة", 400);
    if (cause instanceof RequestBodyTooLargeError) return fail("حجم الطلب أكبر من المسموح", 413);
    console.error("graduation group pricing update failed", { requestId, actorId: user.id, ...safeServerError(cause) });
    return fail("تعذر تحميل أو حفظ أسعار المجموعة؛ حاول مجدداً", 500);
  }
}
