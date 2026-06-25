"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import {
  adminSessionsTable,
  db,
  staffTable,
} from "@workspace/db";
import {
  upsertDailyCashReconciliation,
  upsertDailyCashReconciliationSchema,
  upsertDailyCashReport,
  upsertDailyCashReportSchema,
  type DailyCashActor,
} from "@/server/daily-cash";

const ADMIN_COOKIE_NAME = "ajn_admin_session";

async function requireAccountingActor(): Promise<DailyCashActor> {
  const token = (await cookies()).get(ADMIN_COOKIE_NAME)?.value;
  if (!token) throw new Error("غير مخول");
  const session = await db.query.adminSessionsTable.findFirst({
    where: and(eq(adminSessionsTable.token, token), gt(adminSessionsTable.expiresAt, new Date())),
  });
  if (!session) throw new Error("غير مخول");
  const user = await db.query.staffTable.findFirst({ where: eq(staffTable.id, session.userId) });
  if (!user || !user.isActive) throw new Error("غير مخول");
  const permissions = Array.isArray(user.permissions) ? user.permissions : [];
  if (user.role !== "admin" && !permissions.includes("accounting")) {
    throw new Error("ليست لديك صلاحية الحسابات");
  }
  return { id: user.id, name: user.fullName || user.username };
}

export async function saveDailyCashReportAction(input: unknown) {
  const parsed = upsertDailyCashReportSchema.parse(input);
  const actor = await requireAccountingActor();
  const row = await upsertDailyCashReport(parsed, actor);
  revalidatePath("/admin/daily-cash-reports");
  revalidatePath("/admin/dashboard");
  return row;
}

export async function saveDailyCashReconciliationAction(input: unknown) {
  const parsed = upsertDailyCashReconciliationSchema.parse(input);
  const actor = await requireAccountingActor();
  const row = await upsertDailyCashReconciliation(parsed, actor);
  revalidatePath("/admin/daily-cash-reconciliation");
  revalidatePath("/admin/dashboard");
  return row;
}
