import { NextResponse, type NextRequest } from "next/server";
import { desc, eq, sql } from "drizzle-orm";
import {
  db,
  photographyShootCrewTable,
  photographyShootEventsTable,
  photographyShootsTable,
} from "@workspace/db";

/**
 * Photographer work approval workflow (بوابة المصورين).
 *
 * Adds a manager-approval + edit-lock + version-history layer on top of the
 * existing photography shoot (the photographer's work record). Additive only —
 * two new tables, no changes to `photography_shoots`, no other departments
 * touched. Statuses:
 *   draft → saved → pending(بانتظار اعتماد المدير)
 *         → modified_pending(تم التعديل — بانتظار الاعتماد)
 *         → approved(معتمد — مقفول) | returned(مطلوب تعديل)
 * Approval locks the record; a manager return unlocks it with a correction note.
 * Every save/submit/approve/return is snapshotted into photography_work_versions
 * (previous versions are never deleted) and logged to the shoot timeline.
 */

export type PhotoUser = {
  id: number;
  username: string;
  fullName: string;
  role: string;
  permissions: string[];
  isActive: boolean;
};
export type PhotoNotifier = (input: {
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

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}
function error(message: string, status = 400) {
  return json({ error: message }, status);
}
function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export const PHOTO_APPROVAL_STATUSES = [
  "draft", "saved", "pending", "modified_pending", "approved", "returned",
] as const;

let ready: Promise<void> | null = null;
export async function ensurePhotographyApprovalTables() {
  if (!ready) {
    ready = db.execute(sql`
      CREATE TABLE IF NOT EXISTS photography_shoot_approvals (
        id serial PRIMARY KEY,
        shoot_id integer NOT NULL UNIQUE REFERENCES photography_shoots(id) ON DELETE CASCADE,
        status varchar(30) NOT NULL DEFAULT 'draft',
        locked boolean NOT NULL DEFAULT false,
        manager_note text,
        last_edited_by integer, last_edited_by_name text NOT NULL DEFAULT '', last_edited_at timestamp,
        submitted_by integer, submitted_at timestamp,
        approved_by integer, approved_by_name text NOT NULL DEFAULT '', approved_at timestamp,
        returned_by integer, returned_at timestamp,
        created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS photography_work_versions (
        id serial PRIMARY KEY,
        shoot_id integer NOT NULL REFERENCES photography_shoots(id) ON DELETE CASCADE,
        version integer NOT NULL,
        change_type varchar(30) NOT NULL DEFAULT 'edit',
        snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
        edited_by integer, edited_by_name text NOT NULL DEFAULT '', note text,
        created_at timestamp NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS photography_work_versions_shoot_idx ON photography_work_versions(shoot_id, version DESC);
    `).then(() => undefined).catch((e) => { ready = null; throw e; });
  }
  await ready;
}

/** Managers/admins may approve or return photographer work. */
export function canApprovePhotography(user: PhotoUser) {
  return user.role === "admin"
    || ["photography.assignment.manage", "photography.delivery.confirm", "photography", "staff"].some((p) => user.permissions.includes(p));
}

async function loadApproval(shootId: number) {
  const rows = await db.execute(sql`SELECT * FROM photography_shoot_approvals WHERE shoot_id = ${shootId} LIMIT 1`);
  return ((rows as any).rows ?? rows ?? [])[0] ?? null;
}

/** True when a manager has approved and the record is locked. */
export async function isShootLocked(shootId: number): Promise<boolean> {
  await ensurePhotographyApprovalTables();
  const row = await loadApproval(shootId);
  return !!row && row.status === "approved" && (row.locked === true || row.locked === "t" || row.locked === 1);
}

async function nextVersion(shootId: number): Promise<number> {
  const rows = await db.execute(sql`SELECT COALESCE(MAX(version),0)+1 AS n FROM photography_work_versions WHERE shoot_id = ${shootId}`);
  return Number(((rows as any).rows ?? rows ?? [])[0]?.n ?? 1);
}

async function recordVersion(shootId: number, changeType: string, snapshot: unknown, user: PhotoUser, note?: string | null) {
  const v = await nextVersion(shootId);
  await db.execute(sql`
    INSERT INTO photography_work_versions (shoot_id, version, change_type, snapshot, edited_by, edited_by_name, note)
    VALUES (${shootId}, ${v}, ${changeType}, ${JSON.stringify(snapshot ?? {})}::jsonb, ${user.id}, ${user.fullName || user.username}, ${note ?? null})
  `);
}

/** Timeline audit entry on the shoot itself. */
async function audit(shootId: number, type: string, note: string, user: PhotoUser) {
  await db.insert(photographyShootEventsTable).values({
    shootId, staffId: user.id, staffName: user.fullName || user.username, type, note,
  });
}

async function upsertApproval(shootId: number, fields: Record<string, unknown>, user: PhotoUser) {
  const existing = await loadApproval(shootId);
  const now = new Date();
  if (!existing) {
    await db.execute(sql`
      INSERT INTO photography_shoot_approvals (shoot_id, status, locked, manager_note, last_edited_by, last_edited_by_name, last_edited_at,
        submitted_by, submitted_at, approved_by, approved_by_name, approved_at, returned_by, returned_at)
      VALUES (${shootId}, ${String(fields.status ?? "draft")}, ${Boolean(fields.locked ?? false)}, ${(fields.managerNote as string) ?? null},
        ${user.id}, ${user.fullName || user.username}, ${now},
        ${(fields.submittedBy as number) ?? null}, ${(fields.submittedAt as Date) ?? null},
        ${(fields.approvedBy as number) ?? null}, ${(fields.approvedByName as string) ?? null}, ${(fields.approvedAt as Date) ?? null},
        ${(fields.returnedBy as number) ?? null}, ${(fields.returnedAt as Date) ?? null})
    `);
    return;
  }
  // Build a partial UPDATE for provided fields only.
  const sets = [sql`updated_at = ${now}`, sql`last_edited_by = ${user.id}`, sql`last_edited_by_name = ${user.fullName || user.username}`, sql`last_edited_at = ${now}`];
  if (fields.status !== undefined) sets.push(sql`status = ${String(fields.status)}`);
  if (fields.locked !== undefined) sets.push(sql`locked = ${Boolean(fields.locked)}`);
  if (fields.managerNote !== undefined) sets.push(sql`manager_note = ${(fields.managerNote as string) ?? null}`);
  if (fields.submittedBy !== undefined) sets.push(sql`submitted_by = ${(fields.submittedBy as number) ?? null}`);
  if (fields.submittedAt !== undefined) sets.push(sql`submitted_at = ${(fields.submittedAt as Date) ?? null}`);
  if (fields.approvedBy !== undefined) sets.push(sql`approved_by = ${(fields.approvedBy as number) ?? null}`);
  if (fields.approvedByName !== undefined) sets.push(sql`approved_by_name = ${(fields.approvedByName as string) ?? null}`);
  if (fields.approvedAt !== undefined) sets.push(sql`approved_at = ${(fields.approvedAt as Date) ?? null}`);
  if (fields.returnedBy !== undefined) sets.push(sql`returned_by = ${(fields.returnedBy as number) ?? null}`);
  if (fields.returnedAt !== undefined) sets.push(sql`returned_at = ${(fields.returnedAt as Date) ?? null}`);
  await db.execute(sql`UPDATE photography_shoot_approvals SET ${sql.join(sets, sql`, `)} WHERE shoot_id = ${shootId}`);
}

/** Snapshot of the shoot's editable work state (for version history). */
async function shootSnapshot(shootId: number) {
  const shoot = await db.query.photographyShootsTable.findFirst({ where: eq(photographyShootsTable.id, shootId) });
  if (!shoot) return {};
  return { stage: shoot.stage, notes: shoot.notes, checklist: shoot.checklist, venue: shoot.venue, eventTime: shoot.eventTime };
}

async function photographerStaffId(shootId: number): Promise<number | null> {
  const approval = await loadApproval(shootId);
  if (approval?.submitted_by) return Number(approval.submitted_by);
  if (approval?.last_edited_by) return Number(approval.last_edited_by);
  const lead = await db.query.photographyShootCrewTable.findFirst({
    where: eq(photographyShootCrewTable.shootId, shootId),
    orderBy: [desc(photographyShootCrewTable.isLead)],
  });
  return lead?.staffId ?? null;
}

/**
 * Called by the existing shoot edit endpoints after a content change: if the
 * work is already awaiting approval, an edit resets it to "modified — pending"
 * and re-notifies the manager. A locked (approved) shoot never reaches here —
 * the caller blocks it first.
 */
export async function onShootEdited(shootId: number, user: PhotoUser, notify?: PhotoNotifier) {
  await ensurePhotographyApprovalTables();
  const approval = await loadApproval(shootId);
  if (!approval) return;
  await recordVersion(shootId, "edit", await shootSnapshot(shootId), user);
  if (approval.status === "pending" || approval.status === "modified_pending") {
    await upsertApproval(shootId, { status: "modified_pending" }, user);
    await audit(shootId, "work_modified", "تم التعديل بعد الإرسال — بانتظار إعادة الاعتماد", user);
    await notify?.({
      audienceType: "admin", type: "photography_work_modified",
      title: "تم تعديل عمل بانتظار الاعتماد", body: user.fullName || user.username,
      entityType: "photography_shoot", entityId: shootId, href: "/staff/photography",
    });
  }
}

// ---------------------------------------------------------------------------
// Route handler — dispatched from the shoots block after the shoot is resolved.
// ---------------------------------------------------------------------------
export async function handlePhotographyApproval(
  req: NextRequest,
  shootId: number,
  subAction: string | undefined,
  user: PhotoUser,
  notify?: PhotoNotifier,
): Promise<NextResponse> {
  await ensurePhotographyApprovalTables();
  const method = req.method;

  if (method === "GET") {
    const approval = (await loadApproval(shootId)) ?? { status: "draft", locked: false };
    const versionsRes = await db.execute(sql`
      SELECT id, version, change_type, edited_by_name, note, created_at
      FROM photography_work_versions WHERE shoot_id = ${shootId} ORDER BY version DESC LIMIT 50
    `);
    return json({ approval, versions: (versionsRes as any).rows ?? versionsRes ?? [] });
  }

  const body = rec(await req.json().catch(() => ({})));

  // Save draft / save changes.
  if (method === "POST" && (subAction === "save" || !subAction)) {
    if (await isShootLocked(shootId)) return error("تم اعتماد العمل ولا يمكن تعديله", 403);
    const mode = body.mode === "draft" ? "draft" : "changes";
    const work = rec(body.work);
    // Persist the editable work fields we own on the shoot.
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (work.notes !== undefined) patch.notes = work.notes === null ? null : String(work.notes);
    if (work.checklist !== undefined && typeof work.checklist === "object") patch.checklist = work.checklist;
    if (Object.keys(patch).length > 1) {
      await db.update(photographyShootsTable).set(patch).where(eq(photographyShootsTable.id, shootId));
    }
    const current = await loadApproval(shootId);
    const wasPending = current && (current.status === "pending" || current.status === "modified_pending");
    const snapshot = { ...(await shootSnapshot(shootId)), work };
    await recordVersion(shootId, mode === "draft" ? "draft" : "save", snapshot, user);
    const status = wasPending ? "modified_pending" : mode === "draft" ? "draft" : "saved";
    await upsertApproval(shootId, { status }, user);
    await audit(shootId, "work_saved", mode === "draft" ? "حفظ مسودة" : "حفظ التغييرات", user);
    if (wasPending) {
      await notify?.({
        audienceType: "admin", type: "photography_work_modified",
        title: "تم تعديل عمل بانتظار الاعتماد", body: user.fullName || user.username,
        entityType: "photography_shoot", entityId: shootId, href: "/staff/photography",
      });
    }
    return json({ ok: true, status });
  }

  // Submit for manager approval.
  if (method === "POST" && subAction === "submit") {
    if (await isShootLocked(shootId)) return error("تم اعتماد العمل ولا يمكن تعديله", 403);
    await recordVersion(shootId, "submit", await shootSnapshot(shootId), user);
    await upsertApproval(shootId, { status: "pending", submittedBy: user.id, submittedAt: new Date() }, user);
    await audit(shootId, "work_submitted", "إرسال للاعتماد", user);
    await notify?.({
      audienceType: "admin", type: "photography_work_submitted",
      title: "عمل مصوّر بانتظار الاعتماد", body: user.fullName || user.username,
      entityType: "photography_shoot", entityId: shootId, href: "/staff/photography",
    });
    return json({ ok: true, status: "pending" });
  }

  // Manager: approve → lock.
  if (method === "POST" && subAction === "approve") {
    if (!canApprovePhotography(user)) return error("لا تملك صلاحية اعتماد العمل", 403);
    await recordVersion(shootId, "approve", await shootSnapshot(shootId), user, body.note ? String(body.note) : null);
    await upsertApproval(shootId, {
      status: "approved", locked: true, approvedBy: user.id, approvedByName: user.fullName || user.username,
      approvedAt: new Date(), managerNote: body.note ? String(body.note) : null,
    }, user);
    await audit(shootId, "work_approved", "اعتماد العمل", user);
    const staffId = await photographerStaffId(shootId);
    if (staffId) await notify?.({ staffId, type: "photography_work_approved", title: "تم اعتماد عملك", body: "لا يمكن التعديل بعد الآن", entityType: "photography_shoot", entityId: shootId, href: "/staff/photography" });
    return json({ ok: true, status: "approved" });
  }

  // Manager: return for correction (requires a note) → unlock.
  if (method === "POST" && subAction === "return") {
    if (!canApprovePhotography(user)) return error("لا تملك صلاحية إرجاع العمل", 403);
    const note = body.note ? String(body.note).trim() : "";
    if (!note) return error("ملاحظة التصحيح مطلوبة", 400);
    await recordVersion(shootId, "return", await shootSnapshot(shootId), user, note);
    await upsertApproval(shootId, { status: "returned", locked: false, managerNote: note, returnedBy: user.id, returnedAt: new Date() }, user);
    await audit(shootId, "work_returned", `إرجاع للتعديل: ${note}`, user);
    const staffId = await photographerStaffId(shootId);
    if (staffId) await notify?.({ staffId, type: "photography_work_returned", title: "أُرجع عملك للتعديل", body: note, entityType: "photography_shoot", entityId: shootId, href: "/staff/photography" });
    return json({ ok: true, status: "returned" });
  }

  return error("الإجراء غير مدعوم", 405);
}
