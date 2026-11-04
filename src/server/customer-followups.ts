import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import {
  FOLLOWUP_SERVICES,
  type FollowupActor,
  type FollowupBooking,
  type FollowupCustomer,
  type FollowupEmployee,
  type FollowupList,
  type FollowupRow,
  type FollowupServiceKey,
  type FollowupStatus,
  type FollowupSuggestion,
  type FollowupSummary,
} from "../lib/customer-followups";
import {
  serviceOrderDepartments,
  koshaBookingDepartments,
} from "./booking-departments";
import { suggestedFollowupServices } from "./customer-followups-rules";
import { normalizeIraqiPhone } from "../lib/phone";

export type { FollowupActor } from "../lib/customer-followups";
export interface FollowupExecutor {
  execute(query: SQL): Promise<any>;
}
export interface FollowupDatabase extends FollowupExecutor {
  transaction<T>(run: (tx: FollowupExecutor) => Promise<T>): Promise<T>;
}
export class CustomerFollowupError extends Error {
  public retryable: boolean;
  public existingBooking?: FollowupBooking;
  constructor(
    public status: number,
    public code: string,
    message: string,
    options: { retryable?: boolean; existingBooking?: FollowupBooking } = {},
  ) {
    super(message);
    this.name = "CustomerFollowupError";
    this.retryable = options.retryable ?? false;
    this.existingBooking = options.existingBooking;
  }
}
const fail = (status: number, code: string, message: string): never => {
  throw new CustomerFollowupError(status, code, message);
};
const positive = (value: unknown): number | null =>
  (typeof value === "number" ||
    (typeof value === "string" && /^\d+$/.test(value))) &&
  Number.isSafeInteger(Number(value)) &&
  Number(value) > 0
    ? Number(value)
    : null;
const object = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
const iso = (value: unknown): string => {
  const date = new Date(value as string);
  if (!Number.isFinite(date.getTime()))
    throw new Error("Invalid persisted followup timestamp");
  return date.toISOString();
};
const manager = (actor: FollowupActor) =>
  ["admin", "manager"].includes(actor.role);
const creator = (actor: FollowupActor) =>
  actor.role === "admin" ||
  actor.canCreateCustomer ||
  actor.permissions.includes("customers");
const mine = (actor: FollowupActor, query: URLSearchParams) =>
  !manager(actor) || query.get("scope") === "mine";
const scope = (actor: FollowupActor, query: URLSearchParams) =>
  mine(actor, query) ? sql`f.assigned_staff_id = ${actor.id}` : sql`TRUE`;
const capabilities = (actor: FollowupActor, query: URLSearchParams) => ({
  canManage: manager(actor) && !mine(actor, query),
  canCreate: creator(actor),
  canBook: actor.canBook,
  canCreateCustomer: actor.canCreateCustomer,
  canOpenCustomer: true,
});
async function rows(tx: FollowupExecutor, query: SQL): Promise<any[]> {
  const result = await tx.execute(query);
  if (!Array.isArray(result?.rows))
    throw new Error("Invalid customer followup query response");
  return result.rows;
}
function dbCode(error: unknown): string | undefined {
  const e = error as any;
  return e?.code ?? e?.cause?.code;
}
function storageError(error: unknown): never {
  if (error instanceof CustomerFollowupError) throw error;
  if (["42P01", "42703"].includes(dbCode(error) ?? ""))
    throw new CustomerFollowupError(
      503,
      "FOLLOWUP_SCHEMA_UNAVAILABLE",
      "مركز المتابعة غير متاح حتى تكتمل تهيئة قاعدة البيانات",
      { retryable: true },
    );
  if (["40P01", "40001"].includes(dbCode(error) ?? ""))
    throw new CustomerFollowupError(
      503,
      "FOLLOWUP_RETRY_REQUIRED",
      "تزامن طلب آخر مع الحفظ؛ أعد المحاولة بنفس معرّف الحفظ",
      { retryable: true },
    );
  if (dbCode(error) === "23505")
    throw new CustomerFollowupError(
      409,
      "FOLLOWUP_DUPLICATE",
      "توجد متابعة مفتوحة لهذه الخدمة أو تمت معالجة هذا الطلب مسبقاً",
    );
  throw error;
}
const projection = sql`f.*,c.name AS customer_name,c.full_name AS customer_full_name,c.phone,c.avatar_url,s.full_name,s.department,s.photo_url AS employee_avatar,coalesce(p.contact_blocked,false) AS contact_blocked,
 CASE WHEN f.booking_source='service' THEN (SELECT linked.tracking_code FROM service_orders linked WHERE linked.id=f.booking_id AND linked.customer_id=f.customer_id)
 WHEN f.booking_source='kosha' THEN (SELECT linked.tracking_code FROM kosha_bookings linked WHERE linked.id=f.booking_id AND linked.customer_id=f.customer_id) END AS booking_number`;
const joins = sql`FROM customer_followups f JOIN customers c ON c.id=f.customer_id JOIN staff s ON s.id=f.assigned_staff_id LEFT JOIN customer_followup_contact_preferences p ON p.customer_id=f.customer_id`;
function customerName(
  name: unknown,
  fullName: unknown,
  phone: unknown,
): string {
  return (
    [fullName, name, phone]
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .find(Boolean) ?? ""
  );
}
/** Read-only matching: keep canonical phone/customer records untouched. */
function customerSearch(query: string): SQL {
  const normalized = normalizeIraqiPhone(query);
  const phoneVariants = normalized
    ? [normalized, `0${normalized.slice(3)}`, `00${normalized}`]
    : [];
  return sql`(c.name ILIKE ${`%${query}%`} OR c.full_name ILIKE ${`%${query}%`} OR c.phone ILIKE ${`%${query}%`}
    ${
      phoneVariants.length
        ? sql`OR regexp_replace(translate(c.phone,'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),'[^0-9]','','g') IN (${sql.join(
            phoneVariants.map((value) => sql`${value}`),
            sql`,`,
          )})`
        : sql``
    })`;
}
function bookingRef(
  source: unknown,
  id: unknown,
  number?: unknown,
): FollowupBooking | null {
  if (source !== "service" && source !== "kosha") return null;
  const value = positive(id);
  return value
    ? {
        source,
        id: value,
        number: String(number || `#${value}`),
        href: `/admin/bookings/${source}/${value}`,
      }
    : null;
}
function view(row: any): FollowupRow {
  return {
    id: Number(row.id),
    customer: {
      id: Number(row.customer_id),
      name: customerName(row.customer_name, row.customer_full_name, row.phone),
      phone: String(row.phone ?? ""),
      avatarUrl: row.avatar_url ?? null,
    },
    serviceKey: row.service_key,
    followupAt: iso(row.followup_at),
    status: row.status,
    employee: {
      id: Number(row.assigned_staff_id),
      fullName: String(row.full_name ?? ""),
      department: row.department ?? null,
      avatarUrl: row.employee_avatar ?? null,
    },
    note: String(row.note ?? ""),
    completedAt: row.completed_at ? iso(row.completed_at) : null,
    version: Number(row.version),
    contactBlocked: row.contact_blocked === true,
    booking: bookingRef(row.booking_source, row.booking_id, row.booking_number),
    createdAt: iso(row.created_at),
  };
}
async function readOne(
  tx: FollowupExecutor,
  actor: FollowupActor,
  query: URLSearchParams,
  id: number,
  lock = false,
): Promise<any> {
  const [row] = await rows(
    tx,
    sql`SELECT ${projection} ${joins} WHERE f.id=${id} AND ${scope(actor, query)} AND c.status IS DISTINCT FROM 'deleted' ${lock ? sql`FOR UPDATE OF f` : sql``}`,
  );
  if (!row)
    fail(
      404,
      "FOLLOWUP_NOT_FOUND",
      "المتابعة غير موجودة أو ليست ضمن المتابعات المعيّنة لك",
    );
  return row;
}
async function validateActor(tx: FollowupExecutor, actor: FollowupActor) {
  const [staff] = await rows(
    tx,
    sql`SELECT id FROM staff WHERE id=${actor.id} AND is_active=true FOR SHARE`,
  );
  if (!staff) fail(403, "FOLLOWUP_ACTOR_INACTIVE", "حساب الموظف غير فعال");
}
function parseService(value: unknown): FollowupServiceKey {
  if (!FOLLOWUP_SERVICES.some((item) => item.key === value))
    return fail(422, "INVALID_SERVICE", "اختر الخدمة المطلوبة");
  return value as FollowupServiceKey;
}
function parseDate(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !==
      value.slice(0, 10)
  )
    return fail(
      422,
      "INVALID_FOLLOWUP_DATE",
      "حدد موعد متابعة صحيحاً مع المنطقة الزمنية",
    );
  return new Date(value).toISOString();
}
function note(value: unknown): string {
  if (value == null) return "";
  if (typeof value !== "string" || value.length > 4000)
    return fail(422, "INVALID_NOTE", "الملاحظة يجب أن تكون نصاً حتى 4000 حرف");
  return value.trim();
}
function token(value: unknown, actor: FollowupActor): string {
  if (
    typeof value !== "string" ||
    value.length < 8 ||
    value.length > 100 ||
    !/^[-\w.:]+$/.test(value)
  )
    return fail(422, "INVALID_IDEMPOTENCY_KEY", "معرّف محاولة الحفظ غير صالح");
  return `request:${actor.id}:${createHash("sha256").update(value).digest("hex")}`;
}
function stable(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
const hash = (value: unknown) =>
  createHash("sha256").update(stable(value)).digest("hex");
async function lockRequest(tx: FollowupExecutor, key: string) {
  await rows(
    tx,
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`customer-followup:${key}`},0))`,
  );
}
async function replay(
  tx: FollowupExecutor,
  key: string,
  payloadHash: string,
  followupId?: number,
): Promise<any | null> {
  const [event] = await rows(
    tx,
    sql`SELECT payload_hash,result,followup_id FROM customer_followup_events WHERE request_token=${key}`,
  );
  if (!event) return null;
  if (
    event.payload_hash !== payloadHash ||
    (followupId != null && Number(event.followup_id) !== followupId)
  )
    fail(
      409,
      "IDEMPOTENCY_CONFLICT",
      "استُخدم معرّف الحفظ لطلب مختلف؛ أعد المحاولة بمعرّف جديد",
    );
  return event.result;
}
async function event(
  tx: FollowupExecutor,
  actor: FollowupActor,
  id: number,
  action: string,
  key: string,
  payloadHash: string,
  result: unknown,
) {
  await rows(
    tx,
    sql`INSERT INTO customer_followup_events (followup_id,actor_id,action,request_token,payload_hash,result) VALUES (${id},${actor.id},${action},${key},${payloadHash},${JSON.stringify(result)}::jsonb) RETURNING id`,
  );
}
async function lockCustomer(tx: FollowupExecutor, id: number) {
  const [customer] = await rows(
    tx,
    sql`SELECT id FROM customers WHERE id=${id} AND status IS DISTINCT FROM 'deleted' FOR UPDATE`,
  );
  if (!customer)
    fail(422, "CUSTOMER_UNAVAILABLE", "العميل غير موجود أو غير متاح");
}
async function assignee(
  tx: FollowupExecutor,
  actor: FollowupActor,
  query: URLSearchParams,
  value: unknown,
): Promise<number> {
  const id = positive(value);
  if (!id) fail(422, "INVALID_ASSIGNEE", "اختر الموظف المسؤول");
  if (mine(actor, query) && id !== actor.id)
    fail(403, "ASSIGNMENT_FORBIDDEN", "يمكنك إنشاء متابعة معيّنة لك فقط");
  const [staff] = await rows(
    tx,
    sql`SELECT id FROM staff WHERE id=${id} AND is_active=true FOR SHARE`,
  );
  if (!staff) fail(422, "ASSIGNEE_INACTIVE", "الموظف المختار غير فعال");
  return id!;
}
async function consent(
  tx: FollowupExecutor,
  customerId: number,
): Promise<boolean> {
  const [preference] = await rows(
    tx,
    sql`SELECT contact_blocked FROM customer_followup_contact_preferences WHERE customer_id=${customerId}`,
  );
  return preference?.contact_blocked === true;
}
function filters(actor: FollowupActor, query: URLSearchParams): SQL {
  const conditions: SQL[] = [
      scope(actor, query),
      sql`c.status IS DISTINCT FROM 'deleted'`,
    ],
    q = String(query.get("q") ?? "")
      .trim()
      .slice(0, 160),
    service = query.get("serviceKey"),
    status = query.get("status"),
    employee = query.get("employeeId");
  if (q) conditions.push(customerSearch(q));
  if (service && service !== "all")
    conditions.push(sql`f.service_key=${parseService(service)}`);
  if (status && status !== "all") {
    if (
      !["interested", "waiting", "converted", "uninterested"].includes(status)
    )
      fail(422, "INVALID_STATUS", "حالة المتابعة غير صحيحة");
    conditions.push(sql`f.status=${status}`);
  }
  if (employee && employee !== "all") {
    const id = positive(employee);
    if (!id) fail(422, "INVALID_EMPLOYEE_FILTER", "مرشح الموظف غير صالح");
    conditions.push(sql`f.assigned_staff_id=${id}`);
  }
  return sql.join(conditions, sql` AND `);
}
const dueEligible = sql`f.completed_at IS NULL AND f.status IN ('interested','waiting') AND NOT coalesce(p.contact_blocked,false)`;
const today = sql`(now() AT TIME ZONE 'Asia/Baghdad')::date`;
const dueDay = sql`(f.followup_at AT TIME ZONE 'Asia/Baghdad')::date`;
function bucket(value: string | null): SQL {
  if (!value || value === "all") return sql`TRUE`;
  if (value === "converted") return sql`f.status='converted'`;
  if (value === "completed") return sql`f.completed_at IS NOT NULL`;
  if (!["today", "overdue", "upcoming"].includes(value))
    return fail(422, "INVALID_BUCKET", "مرشح الموعد غير صالح");
  return sql`${dueEligible} AND ${dueDay} ${value === "today" ? sql`=` : value === "overdue" ? sql`<` : sql`>`} ${today}`;
}
async function summary(
  tx: FollowupExecutor,
  actor: FollowupActor,
  query: URLSearchParams,
): Promise<FollowupSummary> {
  const [data] = await rows(
    tx,
    sql`SELECT count(*)::int AS total,count(*) FILTER (WHERE f.completed_at IS NOT NULL)::int AS completed,
 count(*) FILTER (WHERE ${dueEligible} AND ${dueDay}=${today})::int AS today,count(*) FILTER (WHERE ${dueEligible} AND ${dueDay}<${today})::int AS overdue,count(*) FILTER (WHERE ${dueEligible} AND ${dueDay}>${today})::int AS upcoming,
 count(DISTINCT (f.booking_source,f.booking_id)) FILTER (WHERE f.status='converted' AND f.booking_id IS NOT NULL)::int AS converted ${joins} WHERE ${filters(actor, query)}`,
  );
  if (!data) throw new Error("Missing customer followup summary response");
  return Object.fromEntries(
    ["today", "overdue", "upcoming", "converted", "total", "completed"].map(
      (key) => [key, Number(data[key])],
    ),
  ) as unknown as FollowupSummary;
}

async function suggestions(
  tx: FollowupExecutor,
  actor: FollowupActor,
  query: URLSearchParams,
  customerId?: number,
): Promise<FollowupSuggestion[]> {
  const q = String(query.get("q") ?? "")
      .trim()
      .slice(0, 160),
    employee = positive(query.get("employeeId")),
    restrict = mine(actor, query) || employee != null;
  if (mine(actor, query) && employee != null && employee !== actor.id)
    return [];
  const cohort = sql`c.status IS DISTINCT FROM 'deleted' AND NOT EXISTS (SELECT 1 FROM customer_followup_contact_preferences p WHERE p.customer_id=c.id AND p.contact_blocked=true)
    ${customerId ? sql`AND c.id=${customerId}` : sql``} ${q ? sql`AND ${customerSearch(q)}` : sql``}
    ${restrict ? sql`AND EXISTS (SELECT 1 FROM customer_followups owned WHERE owned.customer_id=c.id AND owned.assigned_staff_id=${mine(actor, query) ? actor.id : employee})` : sql``}`;
  // A bounded cohort of canonical bookings; no calendar truncation or inferred phone identity.
  const sources = await rows(
    tx,
    sql`SELECT * FROM (
    (SELECT 'service' AS source,b.id,b.customer_id,c.name,c.full_name,c.phone,c.avatar_url,b.tracking_code AS number,b.created_at,b.custom_fields AS fields,
      coalesce(nullif(btrim(b.custom_fields->>'eventType'),''),nullif(btrim(b.custom_fields->>'eventName'),'')) AS event_type,s.type AS service_type,false AS photography_linked
      FROM service_orders b JOIN customers c ON c.id=b.customer_id JOIN services s ON s.id=b.service_id WHERE ${cohort} AND b.archived_at IS NULL AND lower(b.status) NOT IN ('cancelled','canceled','archived','rejected','deleted') ORDER BY b.created_at DESC,b.id DESC LIMIT 40)
    UNION ALL
    (SELECT 'kosha' AS source,b.id,b.customer_id,c.name,c.full_name,c.phone,c.avatar_url,b.tracking_code AS number,b.created_at,b.booking_details AS fields,b.event_type,'kosha' AS service_type,false AS photography_linked
      FROM kosha_bookings b JOIN customers c ON c.id=b.customer_id WHERE ${cohort} AND b.archived_at IS NULL AND lower(b.status) NOT IN ('cancelled','canceled','archived','rejected','deleted') ORDER BY b.created_at DESC,b.id DESC LIMIT 40)
    UNION ALL
    (SELECT 'graduation' AS source,b.id,b.customer_id,c.name,c.full_name,c.phone,c.avatar_url,NULL::text AS number,b.created_at,b.extras AS fields,'graduation' AS event_type,'graduation' AS service_type,
      coalesce(b.extras->'photography'->>'serviceOrderId','')<>'' AS photography_linked FROM graduation_orders b JOIN customers c ON c.id=b.customer_id WHERE ${cohort} AND b.archived_at IS NULL AND lower(b.status) NOT IN ('cancelled','canceled','archived','rejected','deleted') ORDER BY b.created_at DESC,b.id DESC LIMIT 40)
    UNION ALL
    (SELECT 'inquiry' AS source,b.id,b.customer_id,c.name,c.full_name,c.phone,c.avatar_url,NULL::text AS number,b.created_at,'{}'::jsonb AS fields,NULL::text AS event_type,'other' AS service_type,false AS photography_linked
      FROM customer_followups b JOIN customers c ON c.id=b.customer_id WHERE ${cohort} AND ${mine(actor, query) ? sql`b.assigned_staff_id=${actor.id}` : positive(query.get("employeeId")) ? sql`b.assigned_staff_id=${positive(query.get("employeeId"))}` : sql`TRUE`} AND b.service_key='other' AND b.status IN ('interested','waiting') AND b.completed_at IS NULL ORDER BY b.created_at DESC,b.id DESC LIMIT 40)
  ) source_candidates ORDER BY created_at DESC,id DESC LIMIT 120`,
  );
  const candidates: FollowupSuggestion[] = [];
  for (const source of sources) {
    const fields = object(source.fields),
      departments =
        source.source === "kosha"
          ? koshaBookingDepartments(fields)
          : source.source === "graduation"
            ? ["graduation"]
            : serviceOrderDepartments(fields, { type: source.service_type });
    for (const key of suggestedFollowupServices({
      eventType: source.event_type,
      departments,
      fields,
      photographyLinked: source.photography_linked === true,
      inquiry: source.source === "inquiry",
    })) {
      const filter = query.get("serviceKey");
      if (filter && filter !== "all" && filter !== key) continue;
      if (
        query.get("status") &&
        !["all", "interested", "waiting"].includes(query.get("status")!)
      )
        continue;
      candidates.push({
        key: `${source.source}:${source.id}:${key}`,
        customer: {
          id: Number(source.customer_id),
          name: customerName(source.name, source.full_name, source.phone),
          phone: String(source.phone),
          avatarUrl: source.avatar_url ?? null,
        },
        serviceKey: key,
        reason:
          source.source === "inquiry"
            ? "استفسار عميل يحتاج تأكيد الحجز"
            : `متابعة مقترحة حسب مناسبة ${String(source.event_type)}`,
        sourceBooking: bookingRef(source.source, source.id, source.number),
      });
    }
  }
  if (!candidates.length) return [];
  const eligible = await rows(
    tx,
    sql`SELECT v.key FROM (VALUES ${sql.join(
      candidates.map(
        (item) =>
          sql`(${item.key}::text,${item.customer.id}::integer,${item.serviceKey}::text)`,
      ),
      sql`,`,
    )}) v(key,customer_id,service_key)
    WHERE NOT EXISTS (SELECT 1 FROM customer_followups f WHERE f.suggestion_key=v.key OR f.customer_id=v.customer_id AND f.service_key=v.service_key AND (f.status IN ('uninterested','converted') OR f.completed_at IS NULL AND f.status IN ('interested','waiting')))
    AND NOT EXISTS (SELECT 1 FROM customer_followup_contact_preferences p WHERE p.customer_id=v.customer_id AND p.contact_blocked=true)`,
  );
  const allowed = new Set(eligible.map((item) => item.key)),
    pairs = new Set<string>();
  return candidates
    .filter((item) => {
      const pair = `${item.customer.id}:${item.serviceKey}`;
      if (!allowed.has(item.key) || pairs.has(pair)) return false;
      pairs.add(pair);
      return true;
    })
    .slice(0, customerId ? 120 : 12);
}
async function options(
  tx: FollowupExecutor,
  actor: FollowupActor,
  query: URLSearchParams,
): Promise<{ customers: FollowupCustomer[]; employees: FollowupEmployee[] }> {
  if (!creator(actor))
    fail(
      403,
      "FOLLOWUP_CREATE_FORBIDDEN",
      "ليس لديك صلاحية البحث العام عن العملاء أو إنشاء متابعة",
    );
  const q = String(query.get("q") ?? "")
    .trim()
    .slice(0, 160);
  const customerRows = await rows(
    tx,
    sql`SELECT c.id,c.name,c.full_name,c.phone,c.avatar_url FROM customers c WHERE c.status IS DISTINCT FROM 'deleted' ${q ? sql`AND ${customerSearch(q)}` : sql``} ORDER BY coalesce(nullif(btrim(c.full_name),''),nullif(btrim(c.name),''),c.phone),c.id LIMIT 30`,
  );
  const staffRows = await rows(
    tx,
    sql`SELECT id,full_name,department,photo_url FROM staff WHERE is_active=true ${mine(actor, query) ? sql`AND id=${actor.id}` : sql``} ORDER BY full_name,id LIMIT 200`,
  );
  return {
    customers: customerRows.map((c) => ({
      id: Number(c.id),
      name: customerName(c.name, c.full_name, c.phone),
      phone: String(c.phone),
      avatarUrl: c.avatar_url ?? null,
    })),
    employees: staffRows.map((s) => ({
      id: Number(s.id),
      fullName: String(s.full_name),
      department: s.department,
      avatarUrl: s.photo_url ?? null,
    })),
  };
}
async function canonicalBooking(
  tx: FollowupExecutor,
  ref: unknown,
  customerId: number,
  createdAt: unknown,
): Promise<FollowupBooking> {
  const value = object(ref),
    id = positive(value.id);
  if (!id || !["service", "kosha"].includes(value.source))
    return fail(422, "INVALID_BOOKING", "حدد مرجع حجز أصلي صحيح");
  const [booking] = await rows(
    tx,
    value.source === "service"
      ? sql`SELECT id,customer_id,tracking_code,created_at,status FROM service_orders WHERE id=${id} AND archived_at IS NULL FOR SHARE`
      : sql`SELECT id,customer_id,tracking_code,created_at,status FROM kosha_bookings WHERE id=${id} AND archived_at IS NULL FOR SHARE`,
  );
  if (
    !booking ||
    ["cancelled", "canceled", "archived", "rejected", "deleted"].includes(
      String(booking.status).toLowerCase(),
    )
  )
    return fail(
      422,
      "BOOKING_UNAVAILABLE",
      "الحجز غير موجود أو غير صالح للربط",
    );
  if (Number(booking.customer_id) !== customerId)
    return fail(
      409,
      "CUSTOMER_MISMATCH",
      "الحجز لا يعود إلى العميل الأصلي لهذه المتابعة",
    );
  if (
    new Date(booking.created_at).getTime() <
    new Date(createdAt as string).getTime()
  )
    return fail(
      422,
      "BOOKING_PREDATES_FOLLOWUP",
      "الحجز أقدم من المتابعة ولا يثبت تحويلها",
    );
  return bookingRef(value.source, id, booking.tracking_code)!;
}
async function convert(
  tx: FollowupExecutor,
  actor: FollowupActor,
  row: any,
  customerId: number,
  ref: unknown,
): Promise<FollowupRow> {
  if (!actor.canBook)
    fail(403, "BOOKING_FORBIDDEN", "ليس لديك صلاحية ربط الحجز");
  if (Number(row.customer_id) !== customerId)
    fail(409, "CUSTOMER_MISMATCH", "يجب استخدام العميل الأصلي للمتابعة");
  assertOpenConversionSource(row);
  const booking = await canonicalBooking(tx, ref, customerId, row.created_at);
  const changed = await rows(
    tx,
    sql`UPDATE customer_followups SET booking_source=${booking.source},booking_id=${booking.id},status='converted',version=version+1,updated_at=now() WHERE id=${Number(row.id)} RETURNING id`,
  );
  if (changed.length !== 1)
    throw new Error("Followup conversion did not update its source");
  return {
    ...view({
      ...row,
      status: "converted",
      booking_source: booking.source,
      booking_id: booking.id,
      version: Number(row.version) + 1,
    }),
    booking,
  };
}

function assertOpenConversionSource(row: any): void {
  if (row.status === "converted" || row.booking_id) {
    const existing = bookingRef(
      row.booking_source,
      row.booking_id,
      row.booking_number,
    );
    throw new CustomerFollowupError(
      409,
      "FOLLOWUP_ALREADY_CONVERTED",
      "تم تحويل هذه المتابعة إلى حجز سابقاً",
      { existingBooking: existing ?? undefined },
    );
  }
  if (row.status === "uninterested" || row.completed_at || row.contact_blocked)
    fail(409, "FOLLOWUP_CLOSED", "المتابعة مغلقة أو أوقف العميل التواصل");
}

/** Existing admin booking transaction only; never upsert/normalize the source customer. */
export async function resolveFollowupBookingCustomer(
  tx: FollowupExecutor,
  input: { actor: FollowupActor; followupId: unknown; phone: string },
): Promise<{ id: number }> {
  try {
    const id = typeof input.followupId === "number" ? positive(input.followupId) : null;
    if (!id) return fail(422, "INVALID_FOLLOWUP", "مرجع المتابعة غير صالح");
    if (!input.actor.canBook) fail(403, "BOOKING_FORBIDDEN", "ليس لديك صلاحية ربط الحجز");
    await validateActor(tx, input.actor);
    const peek = await readOne(tx, input.actor, new URLSearchParams(), id);
    await lockCustomer(tx, Number(peek.customer_id));
    const row = await readOne(tx, input.actor, new URLSearchParams(), id, true);
    assertOpenConversionSource(row);
    const [customer] = await rows(tx, sql`SELECT id,phone FROM customers WHERE id=${Number(row.customer_id)} AND status IS DISTINCT FROM 'deleted' FOR SHARE`);
    if (!customer) return fail(404, "CUSTOMER_UNAVAILABLE", "العميل الأصلي غير متاح");
    const currentPhone = normalizeIraqiPhone(String(customer.phone ?? ""));
    if (!currentPhone || currentPhone !== normalizeIraqiPhone(input.phone))
      fail(409, "CUSTOMER_PHONE_CHANGED", "تغيّر رقم العميل؛ أعد فتح المتابعة لتحميل بياناته الحالية");
    return { id: Number(customer.id) };
  } catch (error) {
    return storageError(error);
  }
}

/** Called only inside the original admin booking's afterCreate transaction. */
export async function completeFollowupConversion(
  tx: FollowupExecutor,
  input: {
    actor: FollowupActor;
    followupId: number;
    customerId: number;
    booking: { source: "service"; id: number };
  },
): Promise<{ followup: FollowupRow }> {
  try {
    const id = positive(input.followupId);
    if (!id) return fail(422, "INVALID_FOLLOWUP", "مرجع المتابعة غير صالح");
    await validateActor(tx, input.actor);
    const peek = await readOne(tx, input.actor, new URLSearchParams(), id);
    await lockCustomer(tx, Number(peek.customer_id));
    const row = await readOne(tx, input.actor, new URLSearchParams(), id, true);
    await assignee(
      tx,
      input.actor,
      new URLSearchParams(),
      Number(row.assigned_staff_id),
    );
    const followup = await convert(
        tx,
        input.actor,
        row,
        input.customerId,
        input.booking,
      ),
      result = { followup };
    await event(
      tx,
      input.actor,
      id,
      "booking_conversion",
      `booking:${input.booking.source}:${input.booking.id}`,
      hash(input.booking),
      result,
    );
    return result;
  } catch (error) {
    return storageError(error);
  }
}

async function create(
  db: FollowupDatabase,
  actor: FollowupActor,
  query: URLSearchParams,
  body: Record<string, any>,
) {
  if (!creator(actor))
    fail(403, "FOLLOWUP_CREATE_FORBIDDEN", "ليس لديك صلاحية إنشاء متابعة عامة");
  const customerId = positive(body.customerId);
  if (!customerId) fail(422, "INVALID_CUSTOMER", "اختر العميل الأصلي");
  const serviceKey = parseService(body.serviceKey),
    followupAt = parseDate(body.followupAt),
    text = note(body.note),
    key = token(body.idempotencyKey, actor);
  if (
    body.suggestionKey != null &&
    (typeof body.suggestionKey !== "string" || body.suggestionKey.length > 160)
  )
    fail(422, "INVALID_SUGGESTION", "مرجع الاقتراح غير صالح");
  const fingerprint = hash({
    customerId,
    serviceKey,
    followupAt,
    note: text,
    assignedStaffId: body.assignedStaffId,
    suggestionKey: body.suggestionKey ?? null,
    sourceBooking: body.sourceBooking ?? null,
  });
  return db.transaction(async (tx) => {
    await validateActor(tx, actor);
    await lockRequest(tx, key);
    const prior = await replay(tx, key, fingerprint);
    if (prior) {
      await readOne(tx, actor, query, prior.followup.id);
      return { status: 200, data: prior };
    }
    await lockCustomer(tx, customerId!);
    const assigned = await assignee(tx, actor, query, body.assignedStaffId);
    if (await consent(tx, customerId!))
      fail(
        409,
        "CONTACT_BLOCKED",
        "أوقف العميل التواصل؛ يلزم استعادته صراحةً من المدير",
      );
    let source: FollowupBooking | null = null;
    if (body.suggestionKey) {
      const candidate = (await suggestions(tx, actor, query, customerId!)).find(
        (item) =>
          item.key === body.suggestionKey && item.serviceKey === serviceKey,
      );
      if (!candidate)
        fail(
          409,
          "SUGGESTION_UNAVAILABLE",
          "لم يعد هذا الاقتراح متاحاً؛ حدّث القائمة",
        );
      source = candidate!.sourceBooking;
      if (
        body.sourceBooking &&
        (source?.source !== body.sourceBooking.source ||
          source?.id !== body.sourceBooking.id)
      )
        fail(
          422,
          "INVALID_SUGGESTION_SOURCE",
          "مصدر الاقتراح لا يطابق الحجز الأصلي",
        );
    } else if (body.sourceBooking)
      fail(
        422,
        "INVALID_SUGGESTION_SOURCE",
        "مصدر الحجز يحتاج اقتراحاً أصلياً صالحاً",
      );
    const [saved] = await rows(
      tx,
      sql`INSERT INTO customer_followups (customer_id,service_key,assigned_staff_id,followup_at,note,created_by,create_token,payload_hash,suggestion_key,source_booking_source,source_booking_id)
      VALUES (${customerId},${serviceKey},${assigned},${followupAt}::timestamptz,${text},${actor.id},${key},${fingerprint},${body.suggestionKey ?? null},${source?.source ?? null},${source?.id ?? null}) RETURNING id`,
    );
    if (!saved) throw new Error("Followup insert returned no source");
    const result = {
      followup: view(await readOne(tx, actor, query, Number(saved.id))),
    };
    await event(
      tx,
      actor,
      Number(saved.id),
      "create",
      key,
      fingerprint,
      result,
    );
    return { status: 201, data: result };
  });
}
async function action(
  db: FollowupDatabase,
  actor: FollowupActor,
  query: URLSearchParams,
  id: number,
  body: Record<string, any>,
) {
  const supported = [
    "assign",
    "complete",
    "postpone",
    "status",
    "link_booking",
    "stop_contact",
    "resume_contact",
  ];
  if (!supported.includes(body.action))
    fail(422, "INVALID_ACTION", "إجراء المتابعة غير صالح");
  if (body.action === "assign" && !capabilities(actor, query).canManage)
    fail(
      403,
      "ASSIGNMENT_FORBIDDEN",
      "تعيين المتابعات للموظفين يحتاج صلاحية المدير",
    );
  const expected = positive(body.expectedVersion);
  if (!expected) fail(422, "INVALID_VERSION", "إصدار المتابعة غير صالح");
  const key = token(body.idempotencyKey, actor),
    fingerprint = hash({ id, ...body });
  return db.transaction(async (tx) => {
    await validateActor(tx, actor);
    await lockRequest(tx, key);
    const peek = await readOne(tx, actor, query, id);
    const prior = await replay(tx, key, fingerprint, id);
    if (prior) return { status: 200, data: prior };
    await lockCustomer(tx, Number(peek.customer_id));
    const row = await readOne(tx, actor, query, id, true);
    if (Number(row.version) !== expected)
      fail(409, "STALE_VERSION", "تغيرت المتابعة؛ حدّثها قبل المحاولة مجدداً");
    if (body.action !== "assign")
      await assignee(tx, actor, query, Number(row.assigned_staff_id));
    let followup: FollowupRow, nextFollowup: FollowupRow | undefined;
    if (body.action === "assign") {
      const assigned = await assignee(tx, actor, query, body.assignedStaffId);
      const changed = await rows(
        tx,
        sql`UPDATE customer_followups SET assigned_staff_id=${assigned},version=version+1,updated_at=now() WHERE id=${id} RETURNING id`,
      );
      if (changed.length !== 1)
        throw new Error("Followup assignment did not update its source");
      followup = view(await readOne(tx, actor, query, id));
    } else if (body.action === "link_booking")
      followup = await convert(
        tx,
        actor,
        row,
        Number(row.customer_id),
        body.booking,
      );
    else {
      const text =
        body.note === undefined ? String(row.note ?? "") : note(body.note);
      let status: FollowupStatus = row.status,
        completed = row.completed_at ? iso(row.completed_at) : null,
        date = iso(row.followup_at);
      if (body.action === "stop_contact" || body.action === "resume_contact") {
        if (
          body.action === "resume_contact" &&
          (!manager(actor) || body.confirmResume !== true)
        )
          fail(
            403,
            "CONTACT_RESUME_CONFIRMATION_REQUIRED",
            "استعادة التواصل تحتاج تأكيد المدير صراحةً",
          );
        const blocked = body.action === "stop_contact";
        await rows(
          tx,
          sql`INSERT INTO customer_followup_contact_preferences (customer_id,contact_blocked,actor_id) VALUES (${Number(row.customer_id)},${blocked},${actor.id}) ON CONFLICT (customer_id) DO UPDATE SET contact_blocked=EXCLUDED.contact_blocked,actor_id=EXCLUDED.actor_id,version=customer_followup_contact_preferences.version+1,updated_at=now() RETURNING customer_id`,
        );
        row.contact_blocked = blocked;
      } else {
        if (row.status === "converted")
          fail(
            409,
            "FOLLOWUP_ALREADY_CONVERTED",
            "هذه المتابعة مرتبطة بحجز ولا يمكن تعديل استفسارها",
          );
        if (body.action === "status") {
          if (!["interested", "waiting", "uninterested"].includes(body.status))
            fail(
              422,
              "CONVERSION_REQUIRES_BOOKING",
              "التحويل يحتاج ربط حجز أصلي؛ اختر حالة استفسار صحيحة",
            );
          status = body.status;
        }
        if (body.action === "postpone") {
          if (row.completed_at || row.status === "uninterested")
            fail(409, "FOLLOWUP_CLOSED", "لا يمكن تأجيل متابعة مغلقة");
          date = parseDate(body.followupAt);
        }
        if (body.action === "complete") {
          if (row.completed_at || row.status === "uninterested")
            fail(409, "FOLLOWUP_CLOSED", "المتابعة مكتملة أو غير مهتمة بالفعل");
          completed = new Date().toISOString();
        }
      }
      const changed = await rows(
        tx,
        sql`UPDATE customer_followups SET status=${status},completed_at=${completed}::timestamptz,followup_at=${date}::timestamptz,note=${text},version=version+1,updated_at=now() WHERE id=${id} RETURNING id`,
      );
      if (changed.length !== 1)
        throw new Error("Followup action did not update its source");
      followup = view({
        ...row,
        status,
        completed_at: completed,
        followup_at: date,
        note: text,
        version: Number(row.version) + 1,
      });
      if (body.nextFollowupAt != null) {
        if (body.action !== "complete")
          fail(
            422,
            "INVALID_NEXT_FOLLOWUP",
            "الموعد التالي متاح عند إكمال المتابعة فقط",
          );
        if (row.contact_blocked || (await consent(tx, Number(row.customer_id))))
          fail(
            409,
            "CONTACT_BLOCKED",
            "أوقف العميل التواصل؛ لا يمكن جدولة متابعة جديدة",
          );
        const nextAt = parseDate(body.nextFollowupAt);
        if (Date.parse(nextAt) <= Date.now())
          fail(
            422,
            "INVALID_NEXT_DATE",
            "المتابعة التالية يجب أن تكون بموعد مستقبلي",
          );
        const [next] = await rows(
          tx,
          sql`INSERT INTO customer_followups (customer_id,service_key,assigned_staff_id,followup_at,note,status,parent_id,created_by,create_token,payload_hash) VALUES (${Number(row.customer_id)},${row.service_key},${Number(row.assigned_staff_id)},${nextAt}::timestamptz,${text},'waiting',${id},${actor.id},${`${key}:next`},${fingerprint}) RETURNING id`,
        );
        if (!next) throw new Error("Next followup insert returned no source");
        nextFollowup = view(await readOne(tx, actor, query, Number(next.id)));
      }
    }
    const result = { followup, ...(nextFollowup ? { nextFollowup } : {}) };
    await event(tx, actor, id, body.action, key, fingerprint, result);
    return { status: 200, data: result };
  });
}
export async function handleCustomerFollowupRequest(
  db: FollowupDatabase,
  actor: FollowupActor,
  request: {
    method: string;
    parts: string[];
    query: URLSearchParams;
    readBody: () => Promise<unknown>;
  },
): Promise<{ status: number; data: unknown }> {
  try {
    if (!positive(actor.id))
      return fail(401, "UNAUTHENTICATED", "يلزم تسجيل الدخول");
    const { method, parts, query } = request;
    if (method === "GET" && parts.length === 1 && parts[0] === "summary")
      return {
        status: 200,
        data: { summary: await summary(db, actor, query) },
      };
    if (method === "GET" && parts.length === 1 && parts[0] === "options")
      return { status: 200, data: await options(db, actor, query) };
    if (method === "GET" && parts.length === 1 && parts[0] === "employees") {
      if (!capabilities(actor, query).canManage) fail(403, "ASSIGNMENT_FORBIDDEN", "مرشح الموظفين متاح للمدير فقط");
      const employees = await rows(db, sql`SELECT s.id,s.full_name,s.department,s.photo_url FROM staff s WHERE EXISTS (SELECT 1 FROM customer_followups f WHERE f.assigned_staff_id=s.id) ORDER BY s.full_name,s.id LIMIT 200`);
      return { status: 200, data: { employees: employees.map(employee => ({ id: Number(employee.id), fullName: String(employee.full_name), department: employee.department, avatarUrl: employee.photo_url ?? null })) } };
    }
    if (method === "GET" && !parts.length) {
      const page = Math.max(
          1,
          Math.min(100000, Number.parseInt(query.get("page") ?? "1", 10) || 1),
        ),
        pageSize = Math.max(
          1,
          Math.min(
            50,
            Number.parseInt(query.get("pageSize") ?? "20", 10) || 20,
          ),
        ),
        where = sql`${filters(actor, query)} AND ${bucket(query.get("bucket"))}`;
      const data = await rows(
          db,
          sql`SELECT ${projection} ${joins} WHERE ${where} ORDER BY f.followup_at,f.id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
        ),
        [count] = await rows(
          db,
          sql`SELECT count(*)::int AS total ${joins} WHERE ${where}`,
        );
      if (!count) throw new Error("Missing followup count response");
      const result: FollowupList = {
        rows: data.map(view),
        summary: await summary(db, actor, query),
        suggestions: await suggestions(db, actor, query),
        page,
        pageSize,
        total: Number(count.total),
        capabilities: capabilities(actor, query),
      };
      return { status: 200, data: result };
    }
    const id = positive(parts[0]);
    if (
      method === "GET" &&
      id &&
      parts.length === 2 &&
      parts[1] === "assignees"
    ) {
      if (!capabilities(actor, query).canManage)
        fail(403, "ASSIGNMENT_FORBIDDEN", "قائمة التعيين متاحة للمدير فقط");
      await readOne(db, actor, query, id);
      const employees = await rows(
        db,
        sql`SELECT id,full_name,department,photo_url FROM staff WHERE is_active=true ORDER BY full_name,id LIMIT 200`,
      );
      return {
        status: 200,
        data: {
          employees: employees.map((employee) => ({
            id: Number(employee.id),
            fullName: String(employee.full_name),
            department: employee.department,
            avatarUrl: employee.photo_url ?? null,
          })),
        },
      };
    }
    if (
      method === "GET" &&
      id &&
      (parts.length === 1 || (parts.length === 2 && parts[1] === "customer"))
    ) {
      const row = view(await readOne(db, actor, query, id));
      return {
        status: 200,
        data:
          parts[1] === "customer"
            ? { customer: row.customer }
            : { followup: row },
      };
    }
    if (method === "POST" && !parts.length) {
      const body = await request.readBody();
      if (!body || typeof body !== "object" || Array.isArray(body))
        return fail(422, "INVALID_BODY", "بيانات الطلب غير صالحة");
      return await create(db, actor, query, body as Record<string, any>);
    }
    if (
      method === "POST" &&
      id &&
      parts.length === 2 &&
      parts[1] === "actions"
    ) {
      const body = await request.readBody();
      if (!body || typeof body !== "object" || Array.isArray(body))
        return fail(422, "INVALID_BODY", "بيانات الطلب غير صالحة");
      return await action(db, actor, query, id, body as Record<string, any>);
    }
    return fail(404, "FOLLOWUP_ROUTE_NOT_FOUND", "مسار المتابعة غير موجود");
  } catch (error) {
    return storageError(error);
  }
}
