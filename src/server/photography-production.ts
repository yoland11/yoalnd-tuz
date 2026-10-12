/**
 * Photography Production Center (مركز إنتاج التصوير).
 *
 * Reuses what already exists: photography bookings are `service_orders`
 * (classified by the canonical detectPhotographyBooking), employees are
 * `staff`, history goes to `entity_timeline` on the booking and alerts use
 * the existing notification helpers passed in by the caller. The only new
 * storage is `photography_production_items` (one row per booking deliverable,
 * UNIQUE(booking_id, kind) so repeated orders never duplicate work).
 *
 * Accounting safety: nothing here reads or writes invoices, payments, Cash Box,
 * inventory or salaries, and production progress never changes the booking's
 * own status.
 */
import { NextResponse, type NextRequest } from "next/server";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { parseShortBookingNumber, shortBookingNumber } from "@/lib/booking-number";
import {
  PRODUCTION_KINDS,
  PRODUCTION_KIND_LABELS,
  PRODUCTION_STATUS_LABELS,
  addDays,
  baghdadToday,
  bookingProgress,
  evaluateProductionTransition,
  isProductionKind,
  isProductionStatus,
  normalizeKinds,
  parseDueDate,
  suggestedKinds,
  tabKinds,
  type ProductionKind,
  type ProductionStatus,
} from "@/lib/photography-production";
import { detectPhotographyBooking } from "@/server/photography-booking-integration";
import { InvalidJsonBodyError, readRequestBody } from "@/server/request-body";
import { safeServerError } from "@/server/safe-server-log";
import { createApiErrorPayload, makeRequestId, type ApiErrorCode } from "@/server/write-safety";

export type ProductionUser = {
  id: number;
  username: string;
  fullName: string;
  role: string;
  permissions: string[];
  isActive: boolean;
};

export type ProductionNotification = {
  audienceType?: "admin" | "staff";
  staffId?: number | null;
  type: string;
  title: string;
  body?: string;
  entityType?: string | null;
  entityId?: number | null;
  href?: string | null;
  metadata?: Record<string, unknown>;
};

export type ProductionDeps = {
  notify: (input: ProductionNotification) => Promise<unknown>;
  notifyOnce: (input: ProductionNotification) => Promise<unknown>;
};

type Row = Record<string, any>;
const rows = <T = Row>(result: any): T[] => (result?.rows ?? []) as T[];

/** Any of these opens the center; the scope inside is decided by productionAccess. */
export const PRODUCTION_ACCESS_PERMISSIONS = [
  "photography",
  "photography.portal.view",
  "photography.status.update",
  "photography.assignment.manage",
  "photography.editing.manage",
  "photography.reports.view",
  "bookings",
  "booking_edit",
] as const;

const SUPERVISOR_ROLES = new Set(["admin", "manager", "main_admin", "super_admin", "main_manager"]);

export function productionAccess(user: Pick<ProductionUser, "role" | "permissions" | "isActive">) {
  const role = String(user.role ?? "").toLowerCase();
  const permissions = new Set(user.permissions ?? []);
  const active = user.isActive !== false;
  const manage =
    active &&
    (SUPERVISOR_ROLES.has(role) ||
      permissions.has("photography.assignment.manage") ||
      permissions.has("photography.editing.manage"));
  const order = manage || (active && (permissions.has("bookings") || permissions.has("booking_edit")));
  const viewAll = order || (active && permissions.has("photography.reports.view"));
  const work =
    viewAll ||
    (active &&
      ["photography", "photography.portal.view", "photography.status.update"].some((permission) =>
        permissions.has(permission),
      ));
  return { manage, order, viewAll, work };
}

export type ProductionAccess = ReturnType<typeof productionAccess>;

function actorName(user: ProductionUser) {
  return user.fullName || user.username || `#${user.id}`;
}

function bookingNumber(id: number, trackingCode?: string | null) {
  return shortBookingNumber("service", id, trackingCode) || `B-${id}`;
}

function isUndefinedTable(error: unknown) {
  const value = error as { code?: unknown; cause?: { code?: unknown } } | null;
  return value?.code === "42P01" || value?.cause?.code === "42P01";
}

function isUniqueViolation(error: unknown) {
  const value = error as { code?: unknown; cause?: { code?: unknown } } | null;
  return value?.code === "23505" || value?.cause?.code === "23505";
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

// ------------------------------------------------------------------ filters

export type ProductionFilters = {
  kinds: ProductionKind[];
  status: ProductionStatus | "overdue" | null;
  quick: "overdue" | "due_today" | "unassigned" | "waiting_files" | null;
  assignee: number | "unassigned" | null;
  q: string;
  eventFrom: string | null;
  eventTo: string | null;
  dueFrom: string | null;
  dueTo: string | null;
  completion: "complete" | "incomplete" | null;
  bookingId: number | null;
  mine: boolean;
  page: number;
  pageSize: number;
  today: string;
};

const positiveInt = (value: unknown) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export function parseProductionFilters(
  params: URLSearchParams,
  access: ProductionAccess,
  options: { defaultPageSize: number; maxPageSize: number },
  today = baghdadToday(),
): ProductionFilters {
  const status = params.get("status");
  const quick = params.get("quick");
  const assignee = params.get("assignee");
  const completion = params.get("completion");
  const date = (key: string) => parseDueDate(params.get(key) || undefined) ?? null;
  const kindParam = params.get("kind");
  const kinds = isProductionKind(kindParam) ? [kindParam] : tabKinds(params.get("tab") ?? "all");
  const pageSize = Math.min(options.maxPageSize, positiveInt(params.get("pageSize")) ?? options.defaultPageSize);
  return {
    kinds,
    status: status === "overdue" || isProductionStatus(status) ? status : null,
    quick: ["overdue", "due_today", "unassigned", "waiting_files"].includes(String(quick))
      ? (quick as ProductionFilters["quick"])
      : null,
    assignee: assignee === "unassigned" ? "unassigned" : positiveInt(assignee),
    q: String(params.get("q") ?? "").trim().slice(0, 80),
    eventFrom: date("eventFrom"),
    eventTo: date("eventTo"),
    dueFrom: date("dueFrom"),
    dueTo: date("dueTo"),
    completion: completion === "complete" || completion === "incomplete" ? completion : null,
    bookingId: positiveInt(params.get("booking")),
    // Employees without a wider permission only ever see their own work.
    mine: !access.viewAll || params.get("mine") === "1",
    page: positiveInt(params.get("page")) ?? 1,
    pageSize,
    today,
  };
}

/** Scope + search conditions. Summary cards use only these. */
function baseConditions(filters: ProductionFilters, userId: number): SQL[] {
  const conditions: SQL[] = [sql`so.archived_at is null`, sql`coalesce(so.status, '') <> 'cancelled'`];
  if (filters.kinds.length < PRODUCTION_KINDS.length)
    conditions.push(sql`i.kind in (${sql.join(filters.kinds.map((kind) => sql`${kind}::text`), sql`, `)})`);
  if (filters.mine) conditions.push(sql`i.assignee_staff_id = ${userId}::int`);
  if (filters.bookingId) conditions.push(sql`i.booking_id = ${filters.bookingId}::int`);
  if (filters.assignee === "unassigned") conditions.push(sql`i.assignee_staff_id is null`);
  else if (filters.assignee) conditions.push(sql`i.assignee_staff_id = ${filters.assignee}::int`);
  if (filters.q) {
    const like = `%${escapeLike(filters.q)}%`;
    const digits = filters.q.replace(/[^0-9٠-٩]/g, "").replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
    const parsed = parseShortBookingNumber(filters.q);
    const id = parsed?.source === "service" ? parsed.id : /^\d{1,7}$/.test(filters.q) ? Number(filters.q) : null;
    conditions.push(sql`(
      so.customer_name ilike ${like}::text
      or so.tracking_code ilike ${like}::text
      ${digits.length >= 4 ? sql`or regexp_replace(coalesce(so.phone, ''), '[^0-9]', '', 'g') like ${`%${digits}%`}::text` : sql``}
      ${id ? sql`or so.id = ${id}::int` : sql``}
    )`);
  }
  if (filters.eventFrom) conditions.push(sql`left(so.event_date, 10) >= ${filters.eventFrom}::text`);
  if (filters.eventTo) conditions.push(sql`left(so.event_date, 10) <= ${filters.eventTo}::text`);
  if (filters.dueFrom) conditions.push(sql`i.due_date >= ${filters.dueFrom}::date`);
  if (filters.dueTo) conditions.push(sql`i.due_date <= ${filters.dueTo}::date`);
  return conditions;
}

/** Status / quick / completion narrowing used by the board and the table. */
function listConditions(filters: ProductionFilters, userId: number): SQL[] {
  const conditions = baseConditions(filters, userId);
  const today = filters.today;
  if (filters.status === "overdue" || filters.quick === "overdue")
    conditions.push(sql`i.status <> 'completed' and i.due_date < ${today}::date`);
  else if (filters.status) conditions.push(sql`i.status = ${filters.status}::text`);
  if (filters.quick === "due_today") conditions.push(sql`i.status <> 'completed' and i.due_date = ${today}::date`);
  if (filters.quick === "unassigned") conditions.push(sql`i.assignee_staff_id is null and i.status <> 'completed'`);
  if (filters.quick === "waiting_files") conditions.push(sql`i.status = 'waiting_files'`);
  if (filters.completion === "complete")
    conditions.push(sql`not exists (select 1 from photography_production_items x where x.booking_id = i.booking_id and x.status <> 'completed')`);
  if (filters.completion === "incomplete")
    conditions.push(sql`exists (select 1 from photography_production_items x where x.booking_id = i.booking_id and x.status <> 'completed')`);
  return conditions;
}

const whereOf = (conditions: SQL[]) => sql.join(conditions, sql` and `);

const ITEM_COLUMNS = sql`
  i.id, i.booking_id, i.kind, i.status, i.assignee_staff_id,
  coalesce(nullif(st.full_name, ''), st.username, i.assignee_name) as assignee_name,
  st.photo_url as assignee_photo_url,
  to_char(i.due_date, 'YYYY-MM-DD') as due_date, i.notes,
  i.started_at, i.completed_at, i.status_changed_at, i.status_changed_by_name,
  i.created_by_name, i.created_at, i.updated_at`;

const BOOKING_COLUMNS = sql`
  so.tracking_code, so.customer_name, so.phone, left(so.event_date, 10) as event_date,
  so.status as booking_status,
  coalesce(nullif(so.custom_fields->>'eventType', ''), nullif(s.name_ar, ''), s.name) as event_type,
  coalesce(nullif(so.custom_fields->>'hallName', ''), so.event_location) as hall`;

function mapItem(row: Row) {
  return {
    id: Number(row.id),
    bookingId: Number(row.booking_id),
    kind: String(row.kind) as ProductionKind,
    status: String(row.status) as ProductionStatus,
    assigneeStaffId: row.assignee_staff_id == null ? null : Number(row.assignee_staff_id),
    assigneeName: row.assignee_name ?? null,
    assigneePhotoUrl: row.assignee_photo_url ?? null,
    dueDate: row.due_date ?? null,
    notes: row.notes ?? null,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
    statusChangedAt: row.status_changed_at ?? null,
    statusChangedByName: row.status_changed_by_name ?? null,
    createdByName: row.created_by_name ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

function mapBookingRef(row: Row, id: number) {
  return {
    id,
    number: bookingNumber(id, row.tracking_code),
    customerName: row.customer_name ?? "",
    phone: row.phone ?? "",
    eventDate: row.event_date ?? null,
    eventType: row.event_type ?? null,
    hall: row.hall ?? null,
    status: row.booking_status ?? null,
  };
}

async function summaryFor(filters: ProductionFilters, userId: number) {
  const [row] = rows(
    await db.execute(sql`
      select
        count(*)::int as total,
        count(*) filter (where i.status = 'remaining')::int as remaining,
        count(*) filter (where i.status = 'in_progress')::int as in_progress,
        count(*) filter (where i.status = 'waiting_files')::int as waiting_files,
        count(*) filter (where i.status = 'completed')::int as completed,
        count(*) filter (where i.status <> 'completed' and i.due_date < ${filters.today}::date)::int as overdue,
        count(*) filter (where i.status <> 'completed' and i.due_date = ${filters.today}::date)::int as due_today,
        count(*) filter (where i.status <> 'completed' and i.assignee_staff_id is null)::int as unassigned,
        count(distinct i.booking_id)::int as bookings,
        count(distinct i.booking_id) filter (where i.status <> 'completed')::int as incomplete_bookings
      from photography_production_items i
      join service_orders so on so.id = i.booking_id
      where ${whereOf(baseConditions(filters, userId))}
    `),
  );
  const bookings = Number(row?.bookings ?? 0);
  const incomplete = Number(row?.incomplete_bookings ?? 0);
  return {
    bookings: { total: bookings, complete: bookings - incomplete, incomplete },
    items: {
      total: Number(row?.total ?? 0),
      remaining: Number(row?.remaining ?? 0),
      inProgress: Number(row?.in_progress ?? 0),
      waitingFiles: Number(row?.waiting_files ?? 0),
      completed: Number(row?.completed ?? 0),
      overdue: Number(row?.overdue ?? 0),
      dueToday: Number(row?.due_today ?? 0),
      unassigned: Number(row?.unassigned ?? 0),
    },
  };
}

async function boardPage(filters: ProductionFilters, userId: number) {
  const where = whereOf(listConditions(filters, userId));
  const offset = (filters.page - 1) * filters.pageSize;
  const [countRow] = rows(
    await db.execute(sql`
      select count(*)::int as total
      from photography_production_items i
      join service_orders so on so.id = i.booking_id
      where ${where}
    `),
  );
  const list = rows(
    await db.execute(sql`
      select ${ITEM_COLUMNS}, ${BOOKING_COLUMNS}
      from photography_production_items i
      join service_orders so on so.id = i.booking_id
      left join services s on s.id = so.service_id
      left join staff st on st.id = i.assignee_staff_id
      where ${where}
      order by case when i.status = 'completed' then 1 else 0 end, i.due_date asc nulls last, i.id desc
      limit ${filters.pageSize}::int offset ${offset}::int
    `),
  );
  return {
    total: Number(countRow?.total ?? 0),
    items: list.map((row) => ({ ...mapItem(row), booking: mapBookingRef(row, Number(row.booking_id)) })),
  };
}

async function bookingsPage(filters: ProductionFilters, userId: number) {
  const where = whereOf(listConditions(filters, userId));
  const offset = (filters.page - 1) * filters.pageSize;
  const [countRow] = rows(
    await db.execute(sql`
      select count(distinct i.booking_id)::int as total
      from photography_production_items i
      join service_orders so on so.id = i.booking_id
      where ${where}
    `),
  );
  const list = rows(
    await db.execute(sql`
      with matched as (
        select i.booking_id,
          min(i.due_date) filter (where i.status <> 'completed') as next_due
        from photography_production_items i
        join service_orders so on so.id = i.booking_id
        where ${where}
        group by i.booking_id
      )
      select so.id as booking_id, ${BOOKING_COLUMNS},
        to_char(m.next_due, 'YYYY-MM-DD') as next_due,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', x.id, 'kind', x.kind, 'status', x.status,
            'dueDate', to_char(x.due_date, 'YYYY-MM-DD'),
            'assigneeStaffId', x.assignee_staff_id,
            'assigneeName', coalesce(nullif(xs.full_name, ''), xs.username, x.assignee_name)
          ) order by array_position(array['video', 'photos', 'album', 'printing']::text[], x.kind::text))
          from photography_production_items x
          left join staff xs on xs.id = x.assignee_staff_id
          where x.booking_id = so.id
            ${filters.mine ? sql`and x.assignee_staff_id = ${userId}::int` : sql``}
        ), '[]'::jsonb) as items
      from matched m
      join service_orders so on so.id = m.booking_id
      left join services s on s.id = so.service_id
      order by m.next_due asc nulls last, so.id desc
      limit ${filters.pageSize}::int offset ${offset}::int
    `),
  );
  return {
    total: Number(countRow?.total ?? 0),
    rows: list.map((row) => {
      const items = (Array.isArray(row.items) ? row.items : []).map((item: Row) => ({
        id: Number(item.id),
        kind: String(item.kind) as ProductionKind,
        status: String(item.status) as ProductionStatus,
        dueDate: item.dueDate ?? null,
        assigneeStaffId: item.assigneeStaffId == null ? null : Number(item.assigneeStaffId),
        assigneeName: item.assigneeName ?? null,
      }));
      return {
        booking: mapBookingRef(row, Number(row.booking_id)),
        items,
        nextDue: row.next_due ?? null,
        assignees: [...new Set(items.map((item: Row) => item.assigneeName).filter(Boolean))],
        progress: bookingProgress(items),
      };
    }),
  };
}

async function loadBookingItems(bookingId: number, mineUserId: number | null) {
  return rows(
    await db.execute(sql`
      select ${ITEM_COLUMNS}
      from photography_production_items i
      left join staff st on st.id = i.assignee_staff_id
      where i.booking_id = ${bookingId}::int
        ${mineUserId ? sql`and i.assignee_staff_id = ${mineUserId}::int` : sql``}
      order by array_position(array['video', 'photos', 'album', 'printing']::text[], i.kind::text)
    `),
  ).map(mapItem);
}

async function loadBooking(bookingId: number) {
  const [row] = rows(
    await db.execute(sql`
      select so.id as booking_id, ${BOOKING_COLUMNS}, so.archived_at,
        jsonb_build_object(
          'photographyKinds', so.custom_fields->'photographyKinds',
          'photographyServiceKind', so.custom_fields->'photographyServiceKind',
          'photoSessionDelivery', so.custom_fields->'photoSessionDelivery',
          'eventTime', so.custom_fields->'eventTime'
        ) as fields
      from service_orders so
      left join services s on s.id = so.service_id
      where so.id = ${bookingId}::int
    `),
  );
  return row ?? null;
}

type Executor = Pick<typeof db, "execute">;

async function addHistory(
  executor: Executor,
  input: { bookingId: number; user: ProductionUser; title: string; body?: string | null; metadata: Record<string, unknown> },
) {
  await executor.execute(sql`
    insert into entity_timeline (entity_type, entity_id, type, title, body, actor_id, actor_name, metadata)
    values ('service_order', ${input.bookingId}::int, 'photography_production', ${input.title}::text,
      ${input.body ?? null}::text, ${input.user.id}::int, ${actorName(input.user)}::text, ${JSON.stringify(input.metadata)}::jsonb)
  `);
}

async function activeStaff(ids: number[]) {
  if (!ids.length) return new Map<number, string>();
  const list = rows(
    await db.execute(sql`
      select id, coalesce(nullif(full_name, ''), username) as name
      from staff
      where is_active = true and id in (${sql.join(ids.map((id) => sql`${id}::int`), sql`, `)})
    `),
  );
  return new Map(list.map((row) => [Number(row.id), String(row.name)]));
}

// ------------------------------------------------------------------ inputs

const orderInput = z.object({
  kinds: z.array(z.string()).min(1).max(PRODUCTION_KINDS.length),
  items: z
    .record(
      z.string(),
      z.object({
        assigneeStaffId: z.number().int().positive().nullable().optional(),
        dueDate: z.string().nullable().optional(),
      }),
    )
    .optional(),
  notes: z.string().trim().max(1000).optional(),
});

const updateInput = z.object({
  status: z.string().optional(),
  expectedStatus: z.string().optional(),
  assigneeStaffId: z.number().int().positive().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  reason: z.string().trim().max(500).optional(),
});

class ProductionRefusal extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: ApiErrorCode,
  ) {
    super(message);
  }
}

// ------------------------------------------------------------------ handler

export async function handlePhotographyProduction(
  req: NextRequest,
  parts: string[],
  user: ProductionUser,
  deps: ProductionDeps,
): Promise<NextResponse> {
  const requestId = makeRequestId(req.headers.get("x-request-id"));
  const respond = (data: unknown, status = 200) =>
    NextResponse.json(data, { status, headers: { "x-request-id": requestId } });
  const fail = (message: string, status = 400, code?: ApiErrorCode) =>
    respond(createApiErrorPayload({ requestId, status, code, message }), status);

  const access = productionAccess(user);
  if (!access.work) return fail("ليس لديك صلاحية مركز إنتاج التصوير", 403);
  const resource = parts[2] ?? "board";
  const method = req.method;

  try {
    if (method === "GET" && (resource === "board" || resource === "bookings")) {
      const params = req.nextUrl.searchParams;
      const filters = parseProductionFilters(params, access, resource === "board"
        ? { defaultPageSize: 200, maxPageSize: 300 }
        : { defaultPageSize: 25, maxPageSize: 100 });
      const [summary, page] = await Promise.all([
        summaryFor(filters, user.id),
        resource === "board" ? boardPage(filters, user.id) : bookingsPage(filters, user.id),
      ]);
      return respond({
        ...page,
        summary,
        page: filters.page,
        pageSize: filters.pageSize,
        today: filters.today,
        scope: filters.mine ? "mine" : "all",
        permissions: { canManage: access.manage, canOrder: access.order, canViewAll: access.viewAll },
        meId: user.id,
      });
    }

    if (method === "GET" && resource === "staff") {
      if (!access.order) return fail("تعيين الموظفين متاح للإدارة فقط", 403);
      const list = rows(
        await db.execute(sql`
          select id, coalesce(nullif(full_name, ''), username) as name, job_title, department, photo_url,
            (
              (coalesce(department, '') || ' ' || coalesce(job_title, '')) ~* '(photo|video|edit|montage|print|album|تصوير|مصور|فيديو|مونتاج|طباعة|ألبوم|البوم)'
              or exists (select 1 from jsonb_array_elements_text(case when jsonb_typeof(permissions) = 'array' then permissions else '[]'::jsonb end) p where p like 'photography%')
            ) as photography
          from staff
          where is_active = true
          order by photography desc, name asc
        `),
      );
      return respond({
        staff: list.map((row) => ({
          id: Number(row.id),
          name: String(row.name),
          jobTitle: row.job_title ?? null,
          department: row.department ?? null,
          photoUrl: row.photo_url ?? null,
          photography: row.photography === true,
        })),
      });
    }

    if (resource === "booking") {
      const bookingId = positiveInt(parts[3]);
      if (!bookingId) return fail("رقم الحجز غير صحيح", 400, "VALIDATION_ERROR");

      if (method === "GET" && !parts[4]) {
        const booking = await loadBooking(bookingId);
        if (!booking) return fail("الحجز غير موجود", 404);
        const mineUserId = access.viewAll ? null : user.id;
        const items = await loadBookingItems(bookingId, mineUserId);
        if (mineUserId && !items.length) return fail("لا توجد أعمال إنتاج مسندة إليك في هذا الحجز", 403);
        const detection = await detectPhotographyBooking(bookingId);
        const history = rows(
          await db.execute(sql`
            select id, title, body, actor_name, metadata, created_at
            from entity_timeline
            where entity_type = 'service_order' and entity_id = ${bookingId}::int and type = 'photography_production'
              ${mineUserId ? sql`and (metadata->>'itemId')::int in (${sql.join(items.map((item) => sql`${item.id}::int`), sql`, `)})` : sql``}
            order by created_at desc, id desc
            limit 100
          `),
        ).map((row) => ({
          id: Number(row.id),
          title: row.title,
          body: row.body ?? null,
          actorName: row.actor_name ?? "",
          metadata: row.metadata ?? {},
          createdAt: row.created_at,
        }));
        return respond({
          booking: {
            ...mapBookingRef(booking, bookingId),
            archived: Boolean(booking.archived_at),
            eventTime: booking.fields?.eventTime ?? null,
          },
          eligible: { isPhotography: detection.isPhotography, reasons: detection.reasons },
          suggestedKinds: suggestedKinds(booking.fields),
          items,
          progress: bookingProgress(items),
          history,
          today: baghdadToday(),
          permissions: { canManage: access.manage, canOrder: access.order, canViewAll: access.viewAll },
          meId: user.id,
        });
      }

      if (method === "POST" && parts[4] === "order") {
        if (!access.order) return fail("إرسال الحجز للإنتاج يتطلب صلاحية الحجوزات أو إدارة التصوير", 403);
        const parsed = orderInput.safeParse(await readRequestBody(req));
        if (!parsed.success) return fail("اختر عملاً واحداً على الأقل للإرسال للإنتاج", 422, "VALIDATION_ERROR");
        const kinds = normalizeKinds(parsed.data.kinds);
        if (!kinds.length) return fail("اختر عملاً واحداً على الأقل للإرسال للإنتاج", 422, "VALIDATION_ERROR");
        const booking = await loadBooking(bookingId);
        if (!booking) return fail("الحجز غير موجود", 404);
        if (booking.archived_at || booking.booking_status === "cancelled")
          return fail("لا يمكن إرسال حجز ملغي أو مؤرشف للإنتاج", 409, "BOOKING_INVALID");
        const detection = await detectPhotographyBooking(bookingId);
        if (!detection.isPhotography) return fail("أمر الإنتاج متاح لحجوزات التصوير فقط", 422, "BOOKING_INVALID");

        const plan = kinds.map((kind) => {
          const entry = parsed.data.items?.[kind] ?? {};
          const dueDate = parseDueDate(entry.dueDate ?? null);
          return { kind, assigneeStaffId: entry.assigneeStaffId ?? null, dueDate };
        });
        if (plan.some((entry) => entry.dueDate === undefined))
          return fail("تاريخ التسليم غير صحيح", 422, "VALIDATION_ERROR");
        const staff = await activeStaff([...new Set(plan.map((entry) => entry.assigneeStaffId).filter((id): id is number => Boolean(id)))]);
        if (plan.some((entry) => entry.assigneeStaffId && !staff.has(entry.assigneeStaffId)))
          return fail("الموظف المحدد غير موجود أو غير فعال", 422, "VALIDATION_ERROR");
        const notes = parsed.data.notes?.trim() || null;
        const number = bookingNumber(bookingId, booking.tracking_code);

        // ON CONFLICT on UNIQUE(booking_id, kind): repeated clicks or a second
        // order never duplicate an item and never overwrite existing work.
        const created = await db.transaction(async (tx) => {
          const inserted: Array<{ id: number; kind: ProductionKind; assigneeStaffId: number | null }> = [];
          for (const entry of plan) {
            const [row] = rows(
              await tx.execute(sql`
                insert into photography_production_items
                  (booking_id, kind, status, assignee_staff_id, assignee_name, due_date, notes,
                   status_changed_by, status_changed_by_name, created_by, created_by_name)
                values (${bookingId}::int, ${entry.kind}::text, 'remaining', ${entry.assigneeStaffId}::int,
                  ${entry.assigneeStaffId ? (staff.get(entry.assigneeStaffId) ?? null) : null}::text,
                  ${entry.dueDate ?? null}::date, ${notes}::text,
                  ${user.id}::int, ${actorName(user)}::text, ${user.id}::int, ${actorName(user)}::text)
                on conflict (booking_id, kind) do nothing
                returning id
              `),
            );
            if (!row) continue;
            inserted.push({ id: Number(row.id), kind: entry.kind, assigneeStaffId: entry.assigneeStaffId });
            await addHistory(tx, {
              bookingId,
              user,
              title: `أمر إنتاج: ${PRODUCTION_KIND_LABELS[entry.kind]}`,
              body: [
                entry.assigneeStaffId ? `الموظف: ${staff.get(entry.assigneeStaffId)}` : "بدون موظف",
                entry.dueDate ? `التسليم: ${entry.dueDate}` : null,
              ].filter(Boolean).join(" · "),
              metadata: { itemId: Number(row.id), kind: entry.kind, action: "created", to: "remaining", assigneeStaffId: entry.assigneeStaffId, dueDate: entry.dueDate ?? null },
            });
          }
          return inserted;
        });

        for (const item of created.filter((entry) => entry.assigneeStaffId)) {
          await deps
            .notify({
              audienceType: "staff",
              staffId: item.assigneeStaffId,
              type: "photography_production_assigned",
              title: "تم تكليفك بعمل إنتاج",
              body: `${PRODUCTION_KIND_LABELS[item.kind]} · ${booking.customer_name ?? ""} · ${number}`,
              entityType: "photography_production_item",
              entityId: item.id,
              href: "/staff/photography/production",
              metadata: { bookingId, kind: item.kind },
            })
            .catch((error) =>
              console.warn("[photography-production] assignment notification failed", { requestId, itemId: item.id, ...safeServerError(error) }),
            );
        }
        const items = await loadBookingItems(bookingId, null);
        const createdKinds = created.map((entry) => entry.kind);
        return respond(
          {
            created: createdKinds,
            existing: kinds.filter((kind) => !createdKinds.includes(kind)),
            items,
            progress: bookingProgress(items),
          },
          created.length ? 201 : 200,
        );
      }
      return fail("الإجراء غير مدعوم", 405);
    }

    if (resource === "items" && method === "PATCH") {
      const itemId = positiveInt(parts[3]);
      if (!itemId) return fail("رقم العمل غير صحيح", 400, "VALIDATION_ERROR");
      const parsed = updateInput.safeParse(await readRequestBody(req));
      if (!parsed.success) return fail("بيانات التحديث غير صحيحة", 422, "VALIDATION_ERROR");
      const input = parsed.data;
      const wantsStatus = input.status !== undefined;
      const wantsAssignee = input.assigneeStaffId !== undefined;
      const wantsDue = input.dueDate !== undefined;
      const wantsNotes = input.notes !== undefined;
      if (!wantsStatus && !wantsAssignee && !wantsDue && !wantsNotes)
        return fail("لا يوجد تغيير لحفظه", 422, "VALIDATION_ERROR");
      if ((wantsAssignee || wantsDue) && !access.manage)
        return fail("تغيير الموظف أو موعد التسليم يتطلب صلاحية مدير التصوير", 403);
      const dueDate = wantsDue ? parseDueDate(input.dueDate) : undefined;
      if (wantsDue && dueDate === undefined) return fail("تاريخ التسليم غير صحيح", 422, "VALIDATION_ERROR");
      const staff = wantsAssignee && input.assigneeStaffId ? await activeStaff([input.assigneeStaffId]) : new Map<number, string>();
      if (wantsAssignee && input.assigneeStaffId && !staff.has(input.assigneeStaffId))
        return fail("الموظف المحدد غير موجود أو غير فعال", 422, "VALIDATION_ERROR");

      const outcome = await db.transaction(async (tx) => {
        const [current] = rows(
          await tx.execute(sql`
            select i.*, to_char(i.due_date, 'YYYY-MM-DD') as due_text,
              so.customer_name, so.tracking_code
            from photography_production_items i
            join service_orders so on so.id = i.booking_id
            where i.id = ${itemId}::int
            for update of i
          `),
        );
        if (!current) throw new ProductionRefusal("عمل الإنتاج غير موجود", 404);
        const isAssignee = current.assignee_staff_id != null && Number(current.assignee_staff_id) === user.id;
        if (!access.manage && !isAssignee) throw new ProductionRefusal("لا يمكنك تعديل عمل غير مسند إليك", 403);
        if (input.expectedStatus && input.expectedStatus !== current.status)
          throw new ProductionRefusal("تغيّرت حالة العمل من مستخدم آخر — حدّث الصفحة ثم أعد المحاولة", 409, "STALE_DATA");

        const sets: SQL[] = [];
        const history: Array<{ title: string; body?: string | null; metadata: Record<string, unknown> }> = [];
        const kind = String(current.kind) as ProductionKind;
        const kindLabel = PRODUCTION_KIND_LABELS[kind] ?? kind;
        let newAssignee: number | null | undefined;
        let completedNow = false;

        if (wantsStatus && input.status !== current.status) {
          const decision = evaluateProductionTransition({
            from: String(current.status),
            to: input.status,
            canManage: access.manage,
            isAssignee,
            reason: input.reason,
          });
          if (!decision.ok) throw new ProductionRefusal(decision.reason, decision.status);
          const to = input.status as ProductionStatus;
          sets.push(
            sql`status = ${to}::text`,
            sql`status_changed_at = now()`,
            sql`status_changed_by = ${user.id}::int`,
            sql`status_changed_by_name = ${actorName(user)}::text`,
            to === "completed" ? sql`completed_at = now()` : sql`completed_at = null`,
          );
          if (to === "in_progress" || to === "completed") sets.push(sql`started_at = coalesce(started_at, now())`);
          completedNow = to === "completed";
          history.push({
            title: `${kindLabel}: ${PRODUCTION_STATUS_LABELS[current.status as ProductionStatus] ?? current.status} ← ${PRODUCTION_STATUS_LABELS[to]}`,
            body: decision.reopen ? `إعادة فتح: ${input.reason}` : input.reason || null,
            metadata: { itemId, kind, action: decision.reopen ? "reopened" : "status", from: current.status, to },
          });
        } else if (wantsStatus && !wantsAssignee && !wantsDue && !wantsNotes) {
          throw new ProductionRefusal("العمل بهذه الحالة مسبقاً", 409, "CONFLICT");
        }

        if (wantsAssignee) {
          const next = input.assigneeStaffId ?? null;
          const previous = current.assignee_staff_id == null ? null : Number(current.assignee_staff_id);
          if (next !== previous) {
            newAssignee = next;
            sets.push(sql`assignee_staff_id = ${next}::int`, sql`assignee_name = ${next ? (staff.get(next) ?? null) : null}::text`);
            history.push({
              title: `${kindLabel}: ${next ? `تعيين ${staff.get(next)}` : "إلغاء تعيين الموظف"}`,
              body: current.assignee_name ? `السابق: ${current.assignee_name}` : null,
              metadata: { itemId, kind, action: "assignee", from: previous, to: next },
            });
          }
        }

        if (wantsDue && dueDate !== (current.due_text ?? null)) {
          sets.push(sql`due_date = ${dueDate ?? null}::date`);
          history.push({
            title: `${kindLabel}: موعد التسليم ${dueDate ?? "بدون موعد"}`,
            body: current.due_text ? `السابق: ${current.due_text}` : null,
            metadata: { itemId, kind, action: "due_date", from: current.due_text ?? null, to: dueDate ?? null },
          });
        }

        if (wantsNotes) {
          const notes = input.notes?.trim() || null;
          if (notes !== (current.notes ?? null)) {
            sets.push(sql`notes = ${notes}::text`);
            history.push({ title: `${kindLabel}: تحديث الملاحظات`, body: notes, metadata: { itemId, kind, action: "notes" } });
          }
        }

        if (!sets.length) return { changed: false as const, bookingId: Number(current.booking_id) };
        await tx.execute(sql`
          update photography_production_items
          set ${sql.join([...sets, sql`updated_at = now()`], sql`, `)}
          where id = ${itemId}::int
        `);
        for (const entry of history) await addHistory(tx, { bookingId: Number(current.booking_id), user, ...entry });
        return {
          changed: true as const,
          bookingId: Number(current.booking_id),
          kind,
          newAssignee,
          completedNow,
          customerName: current.customer_name ?? "",
          number: bookingNumber(Number(current.booking_id), current.tracking_code),
        };
      });

      const items = await loadBookingItems(outcome.bookingId, null);
      const progress = bookingProgress(items);
      if (outcome.changed) {
        const label = PRODUCTION_KIND_LABELS[outcome.kind];
        const notifications: ProductionNotification[] = [];
        if (outcome.newAssignee)
          notifications.push({
            audienceType: "staff",
            staffId: outcome.newAssignee,
            type: "photography_production_assigned",
            title: "تم تكليفك بعمل إنتاج",
            body: `${label} · ${outcome.customerName} · ${outcome.number}`,
            entityType: "photography_production_item",
            entityId: itemId,
            href: "/staff/photography/production",
            metadata: { bookingId: outcome.bookingId, kind: outcome.kind },
          });
        for (const notification of notifications)
          await deps.notify(notification).catch((error) =>
            console.warn("[photography-production] notification failed", { requestId, itemId, ...safeServerError(error) }),
          );
        if (outcome.completedNow && progress.complete)
          await deps
            .notifyOnce({
              type: "photography_production_complete",
              title: "اكتمل إنتاج الحجز",
              body: `${outcome.customerName} · ${outcome.number} — جميع الأعمال المطلوبة مكتملة`,
              entityType: "service_order",
              entityId: outcome.bookingId,
              href: `/admin/photography-production?booking=${outcome.bookingId}`,
              metadata: { kinds: items.map((item) => item.kind) },
            })
            .catch((error) =>
              console.warn("[photography-production] completion notification failed", { requestId, bookingId: outcome.bookingId, ...safeServerError(error) }),
            );
      }
      const item = items.find((entry) => entry.id === itemId) ?? null;
      return respond({ changed: outcome.changed, item, items: access.manage ? items : items.filter((entry) => entry.assigneeStaffId === user.id), progress });
    }

    return fail("المسار غير موجود", 404);
  } catch (error) {
    if (error instanceof ProductionRefusal) return fail(error.message, error.status, error.code);
    if (error instanceof InvalidJsonBodyError) return fail("بيانات الطلب غير صالحة", 400, "VALIDATION_ERROR");
    if (isUndefinedTable(error)) {
      console.error("[photography-production] table missing", { requestId, resource, ...safeServerError(error) });
      return fail(
        "مركز الإنتاج غير مفعّل على قاعدة البيانات بعد — يلزم تطبيق الترحيل 0123_photography_production_items",
        503,
        "DATABASE_ERROR",
      );
    }
    if (isUniqueViolation(error)) return fail("العمل موجود مسبقاً لهذا الحجز", 409, "DUPLICATE");
    console.error("[photography-production] request failed", { requestId, method, resource, ...safeServerError(error) });
    return fail("تعذر تنفيذ عملية مركز الإنتاج", 500, "DATABASE_ERROR");
  }
}

// ------------------------------------------------------------------ alerts

export type ProductionDeadlineAlert = {
  itemId: number;
  bookingId: number;
  kind: ProductionKind;
  dueDate: string;
  overdue: boolean;
  assigneeStaffId: number | null;
  customerName: string;
  number: string;
};

/** Unfinished items due today/tomorrow (near) or before today (overdue), for the daily sweep. */
export async function productionDeadlineAlerts(today = baghdadToday()): Promise<ProductionDeadlineAlert[]> {
  const list = rows(
    await db.execute(sql`
      select i.id, i.booking_id, i.kind, to_char(i.due_date, 'YYYY-MM-DD') as due_date, i.assignee_staff_id,
        so.customer_name, so.tracking_code
      from photography_production_items i
      join service_orders so on so.id = i.booking_id
      where i.status <> 'completed' and i.due_date is not null
        and i.due_date <= ${addDays(today, 1)}::date
        and so.archived_at is null and coalesce(so.status, '') <> 'cancelled'
      order by i.due_date asc, i.id asc
      limit 300
    `),
  );
  return list.map((row) => ({
    itemId: Number(row.id),
    bookingId: Number(row.booking_id),
    kind: String(row.kind) as ProductionKind,
    dueDate: String(row.due_date),
    overdue: String(row.due_date) < today,
    assigneeStaffId: row.assignee_staff_id == null ? null : Number(row.assignee_staff_id),
    customerName: row.customer_name ?? "",
    number: bookingNumber(Number(row.booking_id), row.tracking_code),
  }));
}
