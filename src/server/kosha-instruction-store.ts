import { db, koshaManagerInstructionsTable as instructions, koshaBookingChannelReadsTable as reads, koshaBookingEventsTable, koshaStaffNotificationsTable, serviceOrdersTable, type KoshaManagerInstruction } from "@workspace/db";
import { and, desc, eq, isNull, sql, type SQLWrapper } from "drizzle-orm";
import { instructionBookingHref, KoshaInstructionError, type InstructionScope, type InstructionStore } from "./kosha-instructions";

type Connection = Pick<typeof db, "select" | "insert" | "update" | "execute">;
const identity = (scope: InstructionScope) => and(eq(instructions.bookingSource, scope.source), eq(instructions.bookingId, scope.id), isNull(instructions.archivedAt));
const snapshot = (instruction: KoshaManagerInstruction | null) => instruction ? { id: instruction.id, kind: instruction.kind, caption: instruction.caption, mediaUrl: instruction.mediaUrl, revision: instruction.revision, archivedAt: instruction.archivedAt } : null;

type RoutedKoshaAppend = {
  timeline?: Array<Record<string, unknown>>;
  media?: Array<Record<string, unknown>>;
};

export function mergeRoutedKoshaCustomFields(
  current: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown>,
  append: RoutedKoshaAppend = {},
) {
  const {
    koshaPortalTimeline: _staleTimeline,
    koshaPortalMedia: _staleMedia,
    ...safePatch
  } = patch;
  const timeline = Array.isArray(current?.koshaPortalTimeline)
    ? current.koshaPortalTimeline
    : [];
  const media = Array.isArray(current?.koshaPortalMedia)
    ? current.koshaPortalMedia
    : [];
  return {
    ...(current ?? {}),
    ...safePatch,
    koshaPortalTimeline: [...timeline, ...(append.timeline ?? [])],
    koshaPortalMedia: [...media, ...(append.media ?? [])],
  };
}

export function routedKoshaCustomFieldsSql(
  column: SQLWrapper,
  patch: Record<string, unknown>,
  append: RoutedKoshaAppend = {},
) {
  const normalized = mergeRoutedKoshaCustomFields({}, patch);
  const {
    koshaPortalTimeline: _timeline,
    koshaPortalMedia: _media,
    ...safePatch
  } = normalized;
  const timeline = JSON.stringify(append.timeline ?? []);
  const media = JSON.stringify(append.media ?? []);
  return sql`jsonb_set(
    jsonb_set(
      coalesce(${column}, '{}'::jsonb) || ${JSON.stringify(safePatch)}::jsonb,
      '{koshaPortalMedia}',
      (case when jsonb_typeof(${column}->'koshaPortalMedia')='array' then ${column}->'koshaPortalMedia' else '[]'::jsonb end) || ${media}::jsonb,
      true
    ),
    '{koshaPortalTimeline}',
    (case when jsonb_typeof(${column}->'koshaPortalTimeline')='array' then ${column}->'koshaPortalTimeline' else '[]'::jsonb end) || ${timeline}::jsonb,
    true
  )`;
}

export function createKoshaInstructionStore(connection: Connection = db): InstructionStore {
  return {
    transaction: work => db.transaction(tx => work(createKoshaInstructionStore(tx))),
    list: scope => connection.select().from(instructions).where(identity(scope)).orderBy(desc(instructions.updatedAt), desc(instructions.id)),
    async find(scope, id) {
      const [row] = await connection.select().from(instructions).where(and(identity(scope), eq(instructions.id, id))).limit(1).for("update");
      return row;
    },
    async insert(value) {
      const [row] = await connection.insert(instructions).values(value).returning();
      if (!row) throw new Error("Instruction insert returned no row");
      return row;
    },
    async update(scope, id, values) {
      const [row] = await connection.update(instructions).set(values).where(and(identity(scope), eq(instructions.id, id))).returning();
      if (!row) throw new KoshaInstructionError(404, "التعليمات غير موجودة في هذا الحجز");
      return row;
    },
    async recordEvent(scope, actor, action, instruction, previous) {
      const event = {
        staffId: actor.id, staffName: actor.fullName || actor.username,
        type: `instruction_${action}`, note: instruction.caption,
        meta: { instructionId: instruction.id, bookingSource: scope.source, revision: instruction.revision, previous: snapshot(previous), current: snapshot(instruction) },
      };
      if (scope.source === "kosha") {
        await connection.insert(koshaBookingEventsTable).values({ ...event, bookingId: scope.id, createdAt: instruction.updatedAt });
      } else {
        await connection.update(serviceOrdersTable).set({
          customFields: routedKoshaCustomFieldsSql(
            serviceOrdersTable.customFields,
            {},
            { timeline: [{ ...event, id: `instruction-${instruction.id}-${instruction.revision}`, createdAt: instruction.updatedAt.toISOString() }] },
          ),
        }).where(and(eq(serviceOrdersTable.id, scope.id), isNull(serviceOrdersTable.archivedAt)));
      }
    },
    async notify(scope, actor, action, instruction) {
      if (!scope.assignedStaff.length) return;
      await connection.insert(koshaStaffNotificationsTable).values(scope.assignedStaff.map(staff => ({
        staffId: staff.id, audience: "staff", type: `instruction_${action}`,
        title: action === "archived" ? "أرشفة تعليمات الإدارة" : action === "edited" ? "تحديث تعليمات الإدارة" : "تعليمات جديدة من الإدارة",
        body: `${actor.fullName || actor.username}: ${instruction.caption || "صورة مرجعية"}`,
        href: instructionBookingHref(scope),
        // This FK references native bookings only. The source-aware href is the
        // authoritative service-booking identity for routed notifications.
        bookingId: scope.source === "kosha" ? scope.id : null,
      })));
    },
    reads: (scope, channel) => connection.select({ staffId: reads.staffId, viewedAt: reads.viewedAt }).from(reads).where(and(eq(reads.bookingSource, scope.source), eq(reads.bookingId, scope.id), eq(reads.channel, channel))),
    async markViewed(scope, actor, channel, viewedAt) {
      const [row] = await connection.insert(reads).values({ bookingSource: scope.source, bookingId: scope.id, staffId: actor.id, channel, viewedAt }).onConflictDoUpdate({
        target: [reads.bookingSource, reads.bookingId, reads.staffId, reads.channel],
        set: { viewedAt: sql`greatest(${reads.viewedAt}, excluded.viewed_at)`, updatedAt: sql`now()` },
      }).returning({ staffId: reads.staffId, viewedAt: reads.viewedAt });
      if (!row) throw new Error("Instruction view upsert returned no row");
      return row;
    },
    async unreadCounts(bookings, staffId) {
      if (!bookings.length) return new Map();
      const wanted = JSON.stringify(bookings.map(({ id, source }) => ({ id, source })));
      const result = await connection.execute(sql`with wanted as (
        select distinct id, source from jsonb_to_recordset(${wanted}::jsonb) as x(id int, source text)
      ) select w.id, w.source, count(i.id)::int as unread_count from wanted w
        left join kosha_booking_channel_reads r on r.booking_id=w.id and r.booking_source=w.source and r.staff_id=${staffId} and r.channel='manager_instruction'
        left join kosha_manager_instructions i on i.booking_id=w.id and i.booking_source=w.source and i.archived_at is null and (r.viewed_at is null or i.updated_at > r.viewed_at)
        group by w.id,w.source`);
      return new Map((result.rows as Array<{ id: number; source: string; unread_count: number }>).map(row => [`${row.source}:${row.id}`, Number(row.unread_count)]));
    },
  };
}
