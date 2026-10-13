import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import {
  db,
  entityTimelineTable,
  graduationGroupsTable,
  graduationOrdersTable,
} from "@workspace/db";
import { hasDuplicateGroupStudentName } from "@/lib/graduation-group-student-identity";
import { withGraduationMeasurementStatus } from "@/lib/graduation-measurements";
import { cleanStudentSashName, combineGroupSashName } from "@/lib/graduation-sash-name";
import {
  MEASUREMENTS,
  STUDENT_REFERENCE_PLACEMENTS,
  resolveGroupSashPolicy,
} from "@/lib/graduation-student-flow";
import {
  STUDENT_EDIT_FIELD_LABELS,
  studentEditInputSchema,
  studentEditLock,
  studentEditMeasurements,
  studentEditPolicy,
  type StudentEditPolicy,
} from "@/lib/graduation-student-edit";
import { consumeRateLimit } from "@/server/rate-limit";
import { readRequestBody } from "@/server/request-body";
import { safeServerError } from "@/server/safe-server-log";
import { createApiErrorPayload, makeRequestId, type ApiErrorCode } from "@/server/write-safety";

/**
 * Student self-edit from the tracking link (/graduation/track/:token/edit).
 * The secret link plus the last 4 digits of the registered phone open a
 * 30-minute signed session; edits stop once production starts or when the
 * group closes them. Price-affecting choices (package, fabric) are not here.
 */

export class StudentEditImageError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "StudentEditImageError";
  }
}

function isImageError(cause: unknown): cause is StudentEditImageError {
  return cause instanceof StudentEditImageError ||
    (cause instanceof Error && cause.name === "StudentEditImageError" && typeof (cause as { status?: unknown }).status === "number");
}

export type StudentEditDeps = {
  /** Validates and stores one photo (data URL) and returns its public URL; throws StudentEditImageError. */
  persistImage: (dataUrl: string) => Promise<string>;
  notify: (input: {
    type: string;
    title: string;
    body?: string;
    entityId?: number;
    href?: string;
    metadata?: Record<string, unknown>;
  }) => Promise<unknown>;
  now?: () => Date;
};

export const STUDENT_EDIT_SESSION_HEADER = "x-student-edit-session";
const SESSION_MINUTES = 30;
const OPEN_POLICY: StudentEditPolicy = { enabled: true, until: null };

type Row = Record<string, any>;
const record = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};

function secret() {
  const value = process.env.AUTH_SECRET || process.env.SESSION_SECRET || process.env.NEXTAUTH_SECRET;
  if (!value || value.length < 32) throw new Error("AUTH_SECRET or SESSION_SECRET (32+ characters) is required");
  return value;
}

function sign(payload: string) {
  return createHmac("sha256", secret()).update(`graduation-student-edit:${payload}`).digest("hex");
}

function sameText(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function phoneLast4Of(order: { phoneLast4?: unknown; phone?: unknown }) {
  const stored = String(order.phoneLast4 ?? "").replace(/\D/g, "");
  if (stored.length === 4) return stored;
  const digits = String(order.phone ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : "";
}

/** Bound to the order, its link and its phone: a new phone or link ends old sessions. */
export function issueStudentEditSession(order: { id: number; qrToken: string; phoneLast4?: unknown; phone?: unknown }, now: Date) {
  const expires = now.getTime() + SESSION_MINUTES * 60 * 1000;
  const payload = `${order.id}.${expires.toString(36)}`;
  return {
    session: `v1.${payload}.${sign(`${payload}.${order.qrToken}.${phoneLast4Of(order)}`)}`,
    expiresAt: new Date(expires).toISOString(),
  };
}

export function isStudentEditSessionValid(
  value: string | null,
  order: { id: number; qrToken: string; phoneLast4?: unknown; phone?: unknown },
  now: Date,
) {
  const [version, id, expires, signature] = String(value ?? "").split(".");
  if (version !== "v1" || Number(id) !== order.id || !expires || !signature) return false;
  if (!(parseInt(expires, 36) > now.getTime())) return false;
  return sameText(signature, sign(`${id}.${expires}.${order.qrToken}.${phoneLast4Of(order)}`));
}

function sashPrefix(configuration: Row) {
  const customText = record(configuration.customText);
  return typeof customText.sashNamePrefix === "string" ? customText.sashNamePrefix : "";
}

type StoredReference = { placement: string; note: string; imageUrl?: string; fileName?: string };

function storedReferences(previewAssets: unknown): StoredReference[] {
  const assets = record(previewAssets);
  const list = Array.isArray(assets.studentReferences)
    ? assets.studentReferences
    : assets.studentReference ? [assets.studentReference] : [];
  return list.map(record).filter((item) => typeof item.placement === "string").map((item) => ({
    placement: String(item.placement),
    note: String(item.note ?? ""),
    ...(item.imageUrl ? { imageUrl: String(item.imageUrl), fileName: String(item.fileName ?? "") } : {}),
  }));
}

/** What the tracking page needs to edit: never the phone, never prices. */
export function studentEditView(order: Row, group: Row | null, now: Date) {
  const configuration = record(group?.defaultConfiguration);
  const policy = group ? studentEditPolicy(configuration) : OPEN_POLICY;
  const prefix = sashPrefix(configuration);
  const sashPolicy = group ? resolveGroupSashPolicy(configuration) : null;
  const custom = record(order.customText);
  const measurements = record(order.measurements);
  const colors = record(order.colors);
  const references = storedReferences(order.previewAssets);
  return {
    lock: studentEditLock(order, policy, now),
    student: {
      customerName: String(order.customerName ?? ""),
      gender: measurements.gender === "female" ? "female" : "male",
      size: String(measurements.suggestedSize ?? measurements.readySize ?? ""),
      measurements: Object.fromEntries(MEASUREMENTS.map(([key]) => [key, measurements[key] ?? ""])),
      sashName: cleanStudentSashName(custom.text ?? "", prefix),
      font: String(custom.font ?? "naskh"),
      sashColor: String(custom.sashColor ?? colors.sash ?? "#182539"),
      embroideryColor: String(custom.embroideryColor ?? colors.embroidery ?? "#D4AF37"),
      references: STUDENT_REFERENCE_PLACEMENTS.map(({ key }) => {
        const saved = references.find((item) => item.placement === key);
        return { placement: key, note: saved?.note ?? "", imageUrl: saved?.imageUrl ?? "" };
      }),
    },
    options: {
      sashNamePrefix: prefix,
      sashColorEditable: !sashPolicy?.sashColor,
      embroideryColorEditable: !sashPolicy?.embroideryColor,
    },
    designApproved: Boolean(order.designApprovedAt),
  };
}

type Change = { field: string; label: string; from?: unknown; to?: unknown };

export async function handleStudentSelfEdit(
  req: NextRequest,
  token: string,
  action: string | undefined,
  deps: StudentEditDeps,
): Promise<NextResponse> {
  const requestId = makeRequestId(req.headers.get("x-request-id"));
  const now = deps.now?.() ?? new Date();
  const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "x-request-id": requestId } });
  const fail = (message: string, status: number, code?: ApiErrorCode) => NextResponse.json(
    createApiErrorPayload({ message, status, requestId, ...(code ? { code } : {}) }),
    { status, headers: { "x-request-id": requestId } },
  );
  const findOrder = () => db.query.graduationOrdersTable.findFirst({ where: eq(graduationOrdersTable.qrToken, token) });
  const findGroup = async (groupId: number | null | undefined) => groupId
    ? (await db.query.graduationGroupsTable.findFirst({ where: eq(graduationGroupsTable.id, groupId) })) ?? null
    : null;

  try {
    if (req.method === "POST" && action === "verify") {
      const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0]?.trim() || "unknown";
      const [byLink, byIp] = await Promise.all([
        consumeRateLimit({ action: "graduation-student-edit-verify", keyParts: [token], limit: 5, windowMs: 15 * 60 * 1000 }),
        consumeRateLimit({ action: "graduation-student-edit-verify-ip", keyParts: [ip], limit: 30, windowMs: 15 * 60 * 1000 }),
      ]);
      if (!byLink.allowed || !byIp.allowed) {
        const minutes = Math.ceil(Math.max(byLink.retryAfterSeconds, byIp.retryAfterSeconds) / 60);
        return fail(`محاولات كثيرة؛ حاول بعد ${minutes} دقيقة`, 429, "RATE_LIMITED");
      }
      const order = await findOrder();
      if (!order) return fail("طلب التخرج غير موجود", 404);
      const expected = phoneLast4Of(order);
      if (!expected) return fail("لا يوجد رقم هاتف مسجل لهذا الطلب؛ تواصل مع ممثل المجموعة", 409);
      const given = String((await readRequestBody(req))?.last4 ?? "").replace(/\D/g, "");
      if (given.length !== 4 || !sameText(given, expected))
        return fail("آخر 4 أرقام من رقم الهاتف غير صحيحة", 401, "AUTH_REQUIRED");
      return json(issueStudentEditSession(order, now));
    }

    if (!action && (req.method === "GET" || req.method === "PATCH")) {
      const current = await findOrder();
      if (!current) return fail("طلب التخرج غير موجود", 404);
      if (!isStudentEditSessionValid(req.headers.get(STUDENT_EDIT_SESSION_HEADER), current, now))
        return fail("انتهت جلسة التعديل؛ أدخل آخر 4 أرقام من رقم هاتفك من جديد", 401, "AUTH_REQUIRED");
      if (req.method === "GET") return json(studentEditView(current, await findGroup(current.groupId), now));

      const parsed = studentEditInputSchema.safeParse(await readRequestBody(req));
      if (!parsed.success)
        return fail(parsed.error.issues[0]?.message || "تحقق من البيانات المدخلة", 400, "VALIDATION_ERROR");
      const input = parsed.data;

      // Photos are stored before the transaction: network uploads never hold row locks.
      const uploads = new Map<string, { url: string; fileName: string }>();
      for (const reference of input.references ?? []) {
        if (!reference.imageData) continue;
        try {
          uploads.set(reference.placement, { url: await deps.persistImage(reference.imageData), fileName: reference.fileName || "" });
        } catch (cause) {
          if (isImageError(cause)) return fail(cause.message, cause.status);
          throw cause;
        }
      }

      const result = await db.transaction(async (tx) => {
        const [group] = current.groupId
          ? await tx.select().from(graduationGroupsTable).where(eq(graduationGroupsTable.id, current.groupId)).for("update")
          : [null];
        const [order] = await tx.select().from(graduationOrdersTable).where(eq(graduationOrdersTable.id, current.id)).for("update");
        if (!order || order.qrToken !== token) return { status: 404, message: "طلب التخرج غير موجود" };
        const configuration = record(group?.defaultConfiguration);
        const lock = studentEditLock(order, group ? studentEditPolicy(configuration) : OPEN_POLICY, now);
        if (!lock.editable) return { status: 409, message: lock.reason };

        const changes: Change[] = [];
        const note = (field: string, from?: unknown, to?: unknown) =>
          changes.push({ field, label: STUDENT_EDIT_FIELD_LABELS[field] ?? field, ...(from !== undefined || to !== undefined ? { from, to } : {}) });
        const update: Row = {};

        const name = input.customerName?.replace(/\s+/g, " ");
        if (name && name !== order.customerName) {
          if (group) {
            const students = await tx.select({
              id: graduationOrdersTable.id,
              customerName: graduationOrdersTable.customerName,
              status: graduationOrdersTable.status,
              archivedAt: graduationOrdersTable.archivedAt,
            }).from(graduationOrdersTable).where(eq(graduationOrdersTable.groupId, group.id));
            if (hasDuplicateGroupStudentName(name, students, order.id))
              return { status: 409, message: "هذا الاسم مسجل لطالب آخر في المجموعة؛ اكتب اسمك الكامل" };
          }
          update.customerName = name;
          note("customerName", order.customerName, name);
        }

        const measurements = record(order.measurements);
        const changesBeforeMeasurements = changes.length;
        let nextMeasurements: Row = measurements;
        if (input.measurements) {
          const checked = studentEditMeasurements(measurements, input.measurements);
          if ("error" in checked) return { status: 400, message: checked.error };
          nextMeasurements = checked.values;
        }
        if (input.gender && input.gender !== measurements.gender) nextMeasurements = { ...nextMeasurements, gender: input.gender };
        if (input.size !== undefined && input.size !== String(measurements.suggestedSize ?? measurements.readySize ?? "")) {
          const { suggestedSize: _s, readySize: _r, method: _m, ...rest } = nextMeasurements;
          nextMeasurements = input.size ? { ...rest, suggestedSize: input.size, method: "ready", readySize: input.size } : rest;
        }
        for (const field of [...MEASUREMENTS.map(([key]) => key), "gender"])
          if (String(nextMeasurements[field] ?? "") !== String(measurements[field] ?? "")) note(field, measurements[field] ?? null, nextMeasurements[field] ?? null);
        if (String(nextMeasurements.suggestedSize ?? "") !== String(measurements.suggestedSize ?? measurements.readySize ?? ""))
          note("size", measurements.suggestedSize ?? measurements.readySize ?? null, nextMeasurements.suggestedSize ?? null);
        if (changes.length > changesBeforeMeasurements) {
          update.measurements = withGraduationMeasurementStatus(nextMeasurements);
          if (nextMeasurements.gender !== measurements.gender)
            update.studentProfile = { ...record(order.studentProfile), gender: nextMeasurements.gender };
        }

        const custom = record(order.customText);
        const colors = record(order.colors);
        const prefix = sashPrefix(configuration);
        const sashPolicy = group ? resolveGroupSashPolicy(configuration) : null;
        const nextCustom: Row = { ...custom, ...(update.customerName ? { studentName: update.customerName } : {}) };
        const nextColors: Row = { ...colors };
        let designChanged = false;
        if (input.sashName !== undefined) {
          const own = cleanStudentSashName(input.sashName, prefix);
          if (!own) return { status: 400, message: prefix ? "اكتب اسمك على الوشاح (اسمك فقط، والكنية تُضاف تلقائياً)" : "اكتب الاسم على الوشاح" };
          const text = group ? combineGroupSashName(prefix, own) : own;
          if (text !== String(custom.text ?? "")) {
            nextCustom.text = text;
            note("sashName", custom.text ?? "", text);
            designChanged = true;
          }
        }
        if (input.font && input.font !== custom.font) {
          nextCustom.font = input.font;
          note("font", custom.font ?? null, input.font);
          designChanged = true;
        }
        const currentSash = String(custom.sashColor ?? colors.sash ?? "");
        if (input.sashColor && input.sashColor.toLowerCase() !== currentSash.toLowerCase()) {
          if (sashPolicy?.sashColor) return { status: 409, message: "لون الوشاح محدد من المجموعة ولا يمكن تغييره" };
          nextCustom.sashColor = input.sashColor;
          nextColors.sash = input.sashColor;
          note("sashColor", currentSash || null, input.sashColor);
          designChanged = true;
        }
        const currentEmbroidery = String(custom.embroideryColor ?? colors.embroidery ?? "");
        if (input.embroideryColor && input.embroideryColor.toLowerCase() !== currentEmbroidery.toLowerCase()) {
          if (sashPolicy?.embroideryColor) return { status: 409, message: "لون التطريز محدد من المجموعة ولا يمكن تغييره" };
          nextCustom.embroideryColor = input.embroideryColor;
          nextCustom.color = input.embroideryColor;
          nextColors.embroidery = input.embroideryColor;
          note("embroideryColor", currentEmbroidery || null, input.embroideryColor);
          designChanged = true;
        }
        if (JSON.stringify(nextCustom) !== JSON.stringify(custom)) update.customText = nextCustom;
        if (JSON.stringify(nextColors) !== JSON.stringify(colors)) update.colors = nextColors;

        if (input.references) {
          const saved = storedReferences(order.previewAssets);
          const next = STUDENT_REFERENCE_PLACEMENTS.flatMap(({ key }): StoredReference[] => {
            const incoming = input.references!.find((item) => item.placement === key);
            const existing = saved.find((item) => item.placement === key);
            if (!incoming) return existing ? [existing] : [];
            const upload = uploads.get(key);
            const imageUrl = upload?.url ?? (incoming.removeImage ? "" : existing?.imageUrl ?? "");
            if (!imageUrl && !incoming.note) return [];
            return [{
              placement: key,
              note: incoming.note,
              ...(imageUrl ? { imageUrl, fileName: upload ? upload.fileName : existing?.fileName ?? "" } : {}),
            }];
          });
          if (JSON.stringify(next) !== JSON.stringify(saved)) {
            const { studentReference: _legacy, ...assets } = record(order.previewAssets);
            update.previewAssets = { ...assets, studentReferences: next };
            note("references");
          }
        }

        if (!changes.length) return { order, changes, designApprovalReset: false };
        const designApprovalReset = designChanged && Boolean(order.designApprovedAt);
        if (designApprovalReset) update.designApprovedAt = null;
        update.updatedAt = new Date();
        const [saved] = await tx.update(graduationOrdersTable).set(update).where(eq(graduationOrdersTable.id, order.id)).returning();
        await tx.insert(entityTimelineTable).values({
          entityType: "graduation_order",
          entityId: order.id,
          type: "student_self_edit",
          title: "عدّل الطالب بياناته من رابط المتابعة",
          body: [...new Set(changes.map((change) => change.label))].join("، ") + (designApprovalReset ? " — يلزم اعتماد التصميم من جديد" : ""),
          actorId: null,
          actorName: "الطالب",
          metadata: { changes, designApprovalReset, requestId },
        });
        return { order: saved, changes, designApprovalReset };
      });
      if ("status" in result && typeof result.status === "number")
        return fail(result.message ?? "تعذر حفظ التعديل", result.status, result.status === 409 ? "CONFLICT" : undefined);
      const { order, changes, designApprovalReset } = result as { order: Row; changes: Change[]; designApprovalReset: boolean };
      const group = await findGroup(order.groupId);
      if (changes.length) {
        const labels = [...new Set(changes.map((change) => change.label))].join("، ");
        const tailor = record(record(order.productionEstimate).tailorAssignment);
        const measured = changes.some((change) => MEASUREMENTS.some(([key]) => key === change.field));
        await deps.notify({
          type: "graduation_student_self_edit",
          title: "طالب عدّل بياناته",
          body: `${order.customerName}${group?.title ? ` · ${group.title}` : ""} · ${labels}${measured && tailor.tailorName ? ` · الخياط ${tailor.tailorName}: أعد طباعة ورقة القياسات` : ""}`,
          entityId: order.id,
          href: "/admin/graduation/orders",
          metadata: { changes: changes.map((change) => change.field), groupId: order.groupId ?? null, designApprovalReset },
        }).catch((cause) => console.error("graduation student self-edit notification failed", { requestId, orderId: order.id, ...safeServerError(cause) }));
      }
      return json({
        changed: changes.length > 0,
        changes: [...new Set(changes.map((change) => change.label))],
        designApprovalReset,
        view: studentEditView(order, group, now),
      });
    }
    return fail("المسار غير موجود", 404);
  } catch (cause) {
    console.error("graduation student self-edit failed", { requestId, action: action ?? req.method, ...safeServerError(cause) });
    return fail("تعذر إكمال التعديل؛ حاول مجدداً", 500, "DATABASE_ERROR");
  }
}
