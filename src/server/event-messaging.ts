import { createHash, randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import {
  CustomerFollowupError,
  type FollowupDatabase,
  type FollowupExecutor,
  type FollowupActor,
} from "./customer-followups";
import {
  MESSAGE_TEMPLATES,
  messageValues,
  renderEventMessage,
  uniqueRecipients,
  nextDeliveryStatus,
  type MessageRecipient,
  type MessageTemplateKey,
  type DeliveryStatus,
} from "../lib/event-messaging";
import { normalizeIraqiPhone } from "../lib/phone";
import {
  approvedTemplateSnapshot,
  liveMetaTemplates,
  renderMetaTemplate,
  sendMetaTemplate,
  MetaMessagingError,
  type ApprovedMetaTemplate,
} from "./event-messaging-provider";
import { getBookingFinancialSummary } from "./booking-finance";
import { followupOccasion } from "./customer-followups-rules";

const fail = (status: number, code: string, message: string): never => {
  throw new CustomerFollowupError(status, code, message);
};
function stable(value: any): string {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + stable(value[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export const digest = (value: unknown): string =>
  createHash("sha256").update(stable(value)).digest("hex");
export async function messageRows(
  tx: FollowupExecutor,
  query: SQL,
): Promise<any[]> {
  const r = await tx.execute(query);
  if (!Array.isArray(r?.rows))
    throw new Error("Invalid event messaging database response");
  return r.rows;
}
const isManager = (actor: FollowupActor) =>
  ["admin", "manager"].includes(actor.role);
const permitted = (actor: FollowupActor) =>
  actor.role === "admin" || actor.permissions.includes("whatsapp");
const graduationAccess = (actor: FollowupActor) =>
  actor.role === "admin" ||
  actor.permissions.includes("graduation") ||
  actor.permissions.includes("graduation.view");
async function checkActor(
  tx: FollowupExecutor,
  actor: FollowupActor,
  managerOnly = false,
) {
  if (!permitted(actor) || (managerOnly && !isManager(actor)))
    fail(
      403,
      "CAMPAIGN_FORBIDDEN",
      "هذه العملية تحتاج صلاحية واتساب وموافقة مدير مخوّل",
    );
  const [active] = await messageRows(
    tx,
    sql`SELECT id,role,permissions FROM staff WHERE id=${actor.id} AND is_active=true FOR SHARE`,
  );
  if (!active) fail(403, "ACTOR_INACTIVE", "حساب الموظف غير فعال");
  if (
    active.role !== actor.role ||
    actor.permissions.some((p) => !active.permissions?.includes(p))
  )
    fail(
      403,
      "ACTOR_PERMISSIONS_CHANGED",
      "تغيّرت صلاحيات الحساب؛ حدّث الجلسة",
    );
  // The session cannot retain permissions revoked since it was issued.
  if (
    active.role !== "admin" &&
    (!Array.isArray(active.permissions) ||
      !active.permissions.includes("whatsapp"))
  )
    fail(403, "CAMPAIGN_PERMISSION_REVOKED", "صلاحية واتساب لم تعد متاحة");
  if (managerOnly && !["admin", "manager"].includes(active.role))
    fail(403, "MANAGER_REQUIRED", "اعتماد الحملة متاح للمدير فقط");
}
const id = (v: unknown) =>
  Number.isSafeInteger(Number(v)) && Number(v) > 0
    ? Number(v)
    : fail(422, "INVALID_ID", "معرّف غير صالح");
const txt = (v: unknown, max = 200) =>
  typeof v === "string" && v.trim() && v.length <= max
    ? v.trim()
    : fail(422, "INVALID_TEXT", "أدخل نصاً صحيحاً ضمن الحد المسموح");
const sourceKey = (
  key: unknown,
): { kind: MessageRecipient["kind"]; id: number } => {
  if (
    typeof key !== "string" ||
    !/^(customer|group|graduation):[1-9]\d*$/.test(key)
  )
    return fail(422, "INVALID_RECIPIENT", "اختر مستلماً من السجلات الأصلية");
  const [kind, value] = key.split(":");
  return { kind: kind as MessageRecipient["kind"], id: id(value) };
};
const activeOrder = sql`o.archived_at IS NULL AND lower(o.status) NOT IN ('cancelled','canceled','deleted','archived','rejected')`;
const safeDate = (value: any) =>
  value instanceof Date
    ? value.toISOString().slice(0, 10)
    : value
      ? String(value).slice(0, 16)
      : "";

/** Canonical parties only. No arbitrary phone/address or user supplied student payloads. */
export async function recipientSource(
  tx: FollowupExecutor,
  actor: FollowupActor,
  key: string,
): Promise<MessageRecipient> {
  const ref = sourceKey(key);
  let row: any;
  if (ref.kind === "customer") {
    [row] = await messageRows(
      tx,
      sql`SELECT c.id,coalesce(nullif(c.full_name,''),c.name) AS name,c.phone,b.*
      FROM customers c LEFT JOIN LATERAL (SELECT * FROM (
        SELECT 'service' AS booking_source,b.id AS booking_id,b.tracking_code AS reference,b.status,b.custom_fields->>'eventType' AS category,b.event_date AS date,coalesce(nullif(s.name_ar,''),s.name) AS services,
          CASE WHEN s.type='photography' AND coalesce(b.custom_fields->>'photographyAssignmentPending','false')<>'true' THEN b.event_date END AS "photographyDate",b.created_at
          FROM service_orders b JOIN services s ON s.id=b.service_id WHERE b.customer_id=c.id AND b.archived_at IS NULL AND lower(b.status) NOT IN ('deleted','cancelled','canceled','archived')
        UNION ALL
        SELECT 'kosha' AS booking_source,b.id AS booking_id,b.tracking_code AS reference,b.status,b.event_type AS category,b.event_date AS date,'الكوشة' AS services,NULL::text AS "photographyDate",b.created_at
          FROM kosha_bookings b WHERE b.customer_id=c.id AND b.archived_at IS NULL AND lower(b.status) NOT IN ('deleted','cancelled','canceled','archived')
        ) linked ORDER BY created_at DESC,booking_id DESC LIMIT 1) b ON true WHERE c.id=${ref.id} AND c.status IS DISTINCT FROM 'deleted'
      AND ${isManager(actor) ? sql`TRUE` : sql`EXISTS(SELECT 1 FROM customer_followups f WHERE f.customer_id=c.id AND f.assigned_staff_id=${actor.id})`}`,
    );
    if (row?.booking_id && isManager(actor)) {
      const financial = await getBookingFinancialSummary(
        row.booking_source,
        Number(row.booking_id),
        tx,
      );
      if (!financial)
        fail(
          409,
          "BOOKING_FINANCE_UNAVAILABLE",
          "لم يعد المصدر المالي للحجز متاحاً؛ حدّث القائمة",
        );
      row.remaining = String(financial!.remaining);
      row.paymentStatus = financial!.paymentStatus;
    }
  } else {
    if (!graduationAccess(actor) || !isManager(actor))
      fail(
        403,
        "GRADUATION_RECIPIENT_FORBIDDEN",
        "قوائم التخرج متاحة للمدير المخوّل بالتخرج فقط",
      );
    if (ref.kind === "group") {
      [row] = await messageRows(
        tx,
        sql`SELECT g.id,g.representative_name AS name,g.representative_phone AS phone,g.title AS "group",g.university,g.department,g.event_date AS date,g.group_no AS reference,g.status,
        a.students::text,a.remaining::text,a.services,a."photographyDate",a."deliveryDate",
        CASE WHEN a.students=0 THEN 'غير محدد' WHEN a.remaining=0 THEN 'مدفوع' WHEN a.paid=0 THEN 'غير مدفوع' ELSE 'مدفوع جزئياً' END AS "paymentStatus"
        FROM graduation_groups g LEFT JOIN LATERAL(SELECT count(*)::int AS students,coalesce(sum(o.remaining_amount),0) AS remaining,coalesce(sum(o.paid_amount),0) AS paid,
          string_agg(DISTINCT nullif(concat_ws('، ',o.garment_details->>'robeType',o.garment_details->>'sashType',o.garment_details->>'capType',o.style_key,CASE WHEN o.extras->'photography'->>'serviceOrderId' IS NOT NULL THEN 'تصوير' END,(SELECT string_agg(DISTINCT i.product_name,'، ') FROM graduation_order_items i WHERE i.graduation_order_id=o.id)),''),'، ') AS services,
          string_agg(DISTINCT o.due_date::text,'، ') AS "deliveryDate",
          string_agg(DISTINCT (SELECT p.event_date FROM service_orders p WHERE p.id::text=o.extras->'photography'->>'serviceOrderId' AND p.archived_at IS NULL AND lower(p.status) NOT IN ('cancelled','canceled','deleted') AND coalesce(p.custom_fields->>'photographyAssignmentPending','false')<>'true'),'، ') AS "photographyDate"
          FROM graduation_orders o WHERE o.group_id=g.id AND ${activeOrder}) a ON true
        WHERE g.id=${ref.id} AND lower(g.status) NOT IN ('deleted','cancelled','canceled','archived')`,
      );
    } else {
      [row] = await messageRows(
        tx,
        sql`SELECT o.id,o.customer_name AS name,o.phone,o.order_no AS reference,o.status,o.production_stage AS production,o.remaining_amount::text AS remaining,o.payment_status AS "paymentStatus",
        o.due_date AS date,o.due_date::text AS "deliveryDate",coalesce(o.student_profile->>'university','') AS university,coalesce(o.student_profile->>'department','') AS department,
        (SELECT p.event_date FROM service_orders p WHERE p.id::text=o.extras->'photography'->>'serviceOrderId' AND p.archived_at IS NULL AND lower(p.status) NOT IN ('cancelled','canceled','deleted') AND coalesce(p.custom_fields->>'photographyAssignmentPending','false')<>'true') AS "photographyDate",
        concat_ws('، ',o.garment_details->>'robeType',o.garment_details->>'sashType',o.garment_details->>'capType',nullif(o.style_key,''),nullif(o.package_key,''),CASE WHEN coalesce(o.extras->'photography'->>'serviceOrderId','')<>'' THEN 'تصوير' END,
          (SELECT string_agg(DISTINCT i.product_name,'، ') FROM graduation_order_items i WHERE i.graduation_order_id=o.id)) AS services
        FROM graduation_orders o WHERE o.id=${ref.id} AND ${activeOrder}`,
      );
    }
  }
  if (!row)
    fail(
      404,
      "RECIPIENT_UNAVAILABLE",
      "المستلم غير متاح ضمن صلاحياتك أو أُلغي سجله",
    );
  const phone =
    normalizeIraqiPhone(row.phone) ??
    fail(422, "RECIPIENT_PHONE_INVALID", "رقم المستلم الأصلي غير صالح");
  const [preference] = await messageRows(
    tx,
    sql`SELECT coalesce(bool_or(p.blocked),false) AS blocked,coalesce(bool_or(p.opted_in AND p.recipient_key=${key}),false) AS consent,
    EXISTS(SELECT 1 FROM customer_followup_contact_preferences x JOIN customers c ON c.id=x.customer_id WHERE x.contact_blocked=true AND right(regexp_replace(translate(c.phone,'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),'[^0-9]','','g'),10)=${phone.slice(-10)}) AS customer_blocked
    FROM event_message_consents p WHERE p.phone=${phone}`,
  );
  if (!preference) throw new Error("Missing recipient consent projection");
  const occasion = followupOccasion(row.category);
  const category = occasion
    ? {
        engagement: "خطوبة",
        henna: "حنة",
        wedding: "زفاف",
        graduation: "تخرج",
      }[occasion]
    : ["marriage_contract", "عقد قران"].includes(row.category)
      ? "عقد قران"
      : String(row.category || "مناسبة");
  return {
    key,
    kind: ref.kind,
    id: ref.id,
    name: String(row.name || ""),
    phone,
    category: ref.kind === "customer" ? category : "تخرج",
    details: Object.fromEntries(
      [
        "group",
        "university",
        "department",
        "students",
        "date",
        "photographyDate",
        "deliveryDate",
        "services",
        "reference",
        "status",
        "remaining",
        "paymentStatus",
        "production",
      ].map((k) => [
        k,
        k === "date" ? safeDate(row[k]) : row[k] == null ? "" : String(row[k]),
      ]),
    ),
    blocked:
      preference.blocked === true || preference.customer_blocked === true,
    consent: preference.consent === true,
  };
}

async function recipientList(
  tx: FollowupExecutor,
  actor: FollowupActor,
  query: URLSearchParams,
) {
  if (query.get("filter") === "pending" && !isManager(actor))
    fail(403, "FINANCIAL_FILTER_FORBIDDEN", "تصفية المبالغ متاحة للمدير فقط");
  const kind = query.get("kind") || "customer";
  const q = (query.get("q") || "").trim().slice(0, 100);
  const page = Math.max(
    1,
    Math.min(10000, parseInt(query.get("page") || "1") || 1),
  );
  const limit = 30,
    offset = (page - 1) * limit;
  let keys: any[];
  if (kind === "customer")
    keys = await messageRows(
      tx,
      sql`SELECT 'customer:'||c.id AS key FROM customers c WHERE c.status IS DISTINCT FROM 'deleted' AND (c.name ILIKE ${"%" + q + "%"} OR c.full_name ILIKE ${"%" + q + "%"} OR c.phone ILIKE ${"%" + q + "%"})
    AND ${isManager(actor) ? sql`TRUE` : sql`EXISTS(SELECT 1 FROM customer_followups f WHERE f.customer_id=c.id AND f.assigned_staff_id=${actor.id})`} ORDER BY c.id DESC LIMIT ${limit + 1} OFFSET ${offset}`,
    );
  else {
    if (!graduationAccess(actor) || !isManager(actor))
      fail(
        403,
        "GRADUATION_RECIPIENT_FORBIDDEN",
        "ليست لديك صلاحية عرض مستلمي التخرج",
      );
    if (kind === "group")
      keys = await messageRows(
        tx,
        sql`SELECT 'group:'||g.id AS key FROM graduation_groups g WHERE lower(g.status) NOT IN ('deleted','cancelled','canceled','archived') AND (g.title ILIKE ${"%" + q + "%"} OR g.representative_name ILIKE ${"%" + q + "%"} OR g.representative_phone ILIKE ${"%" + q + "%"}) ORDER BY g.id DESC LIMIT ${limit + 1} OFFSET ${offset}`,
      );
    else if (kind === "graduation")
      keys = await messageRows(
        tx,
        sql`SELECT 'graduation:'||o.id AS key FROM graduation_orders o WHERE ${activeOrder} AND (o.customer_name ILIKE ${"%" + q + "%"} OR o.phone ILIKE ${"%" + q + "%"} OR o.order_no ILIKE ${"%" + q + "%"}) ORDER BY o.id DESC LIMIT ${limit + 1} OFFSET ${offset}`,
      );
    else return fail(422, "INVALID_RECIPIENT_KIND", "نوع مستلم غير صالح");
  }
  const recipients: MessageRecipient[] = [];
  const invalid: any[] = [];
  for (const k of keys.slice(0, limit)) {
    try {
      recipients.push(await recipientSource(tx, actor, k.key));
    } catch (e) {
      if (
        e instanceof CustomerFollowupError &&
        e.code === "RECIPIENT_PHONE_INVALID"
      )
        invalid.push({ key: k.key, reason: e.message });
      else throw e;
    }
  }
  const filter = query.get("filter");
  return {
    recipients: recipients.filter((r) =>
      filter === "pending"
        ? Number(r.details.remaining) > 0
        : filter === "upcoming"
          ? Boolean(r.details.date) &&
            r.details.date.slice(0, 10) >= new Date().toISOString().slice(0, 10)
          : filter === "incomplete"
            ? !["delivered", "completed", "complete"].includes(r.details.status)
            : filter && filter !== "all"
              ? r.category === filter
              : true,
    ),
    invalid,
    page,
    hasMore: keys.length > limit,
  };
}
async function preview(
  tx: FollowupExecutor,
  actor: FollowupActor,
  body: any,
  provider?: ApprovedMetaTemplate,
) {
  if (body.templateKey === "payment" && !isManager(actor))
    fail(403, "PAYMENT_MESSAGE_FORBIDDEN", "تذكيرات المبالغ تحتاج صلاحية مدير");
  if (
    !Array.isArray(body.recipientKeys) ||
    !body.recipientKeys.length ||
    body.recipientKeys.length > 100
  )
    fail(422, "RECIPIENT_LIMIT", "اختر من 1 إلى 100 مستلم للحملة");
  if (!MESSAGE_TEMPLATES.some((t) => t.key === body.templateKey))
    fail(422, "TEMPLATE_INVALID", "اختر قالب رسالة");
  const original: MessageRecipient[] = [];
  for (const key of [...new Set(body.recipientKeys)] as string[])
    original.push(await recipientSource(tx, actor, key));
  const recipients = uniqueRecipients(original);
  if (recipients.some((r) => r.blocked))
    fail(409, "CONTACT_BLOCKED", "أحد المستلمين أوقف التواصل؛ أزله من الحملة");
  if (
    (body.channel === "meta" || body.templateKey === "offers") &&
    recipients.some((r) => !r.consent)
  )
    fail(
      409,
      "CONSENT_REQUIRED",
      "الإرسال الرسمي والعروض يحتاجان موافقة موثقة لكل مستلم ورقمه الحالي",
    );
  const items = recipients.map((r) => ({
    recipient: r,
    message: provider
      ? renderMetaTemplate(provider, messageValues(r))
      : renderEventMessage(body.templateKey, r),
  }));
  return {
    recipients: items,
    previewHash: digest(items),
    duplicatesRemoved: original.length - recipients.length,
  };
}
const campaignScope = (actor: FollowupActor) =>
  isManager(actor)
    ? graduationAccess(actor)
      ? sql`TRUE`
      : sql`NOT EXISTS(SELECT 1 FROM event_message_recipients scope_r WHERE scope_r.campaign_id=c.id AND scope_r.recipient_key NOT LIKE 'customer:%')`
    : sql`c.created_by=${actor.id} AND NOT EXISTS(SELECT 1 FROM event_message_recipients scope_r WHERE scope_r.campaign_id=c.id AND NOT EXISTS(SELECT 1 FROM customer_followups scope_f WHERE scope_f.assigned_staff_id=${actor.id} AND 'customer:'||scope_f.customer_id=scope_r.recipient_key))`;
async function campaign(
  tx: FollowupExecutor,
  actor: FollowupActor,
  value: unknown,
  lock = false,
) {
  const [c] = await messageRows(
    tx,
    sql`SELECT c.* FROM event_message_campaigns c WHERE c.id=${id(value)} AND ${campaignScope(actor)} ${lock ? sql`FOR UPDATE OF c` : sql``}`,
  );
  if (!c) fail(404, "CAMPAIGN_NOT_FOUND", "الحملة غير موجودة ضمن صلاحياتك");
  const [restricted] = await messageRows(
    tx,
    sql`SELECT id FROM event_message_recipients WHERE campaign_id=${c.id} AND recipient_key NOT LIKE 'customer:%' LIMIT 1`,
  );
  if (restricted && (!graduationAccess(actor) || !isManager(actor)))
    fail(
      403,
      "GRADUATION_RECIPIENT_FORBIDDEN",
      "الحملة تحتوي بيانات تخرج تحتاج صلاحية المدير المخوّل بالتخرج",
    );
  return c;
}
async function audit(
  tx: FollowupExecutor,
  actorId: number | null,
  campaignId: number | null,
  recipientId: number | null,
  action: string,
  details: unknown = {},
) {
  await messageRows(
    tx,
    sql`INSERT INTO event_message_events(campaign_id,recipient_id,actor_id,action,details) VALUES(${campaignId},${recipientId},${actorId},${action},${JSON.stringify(details)}::jsonb) RETURNING id`,
  );
}
async function chooseProvider(
  body: any,
): Promise<ApprovedMetaTemplate | undefined> {
  if (body.channel !== "meta") return undefined;
  if (!body.providerTemplate || !Array.isArray(body.providerTemplate.fields))
    fail(422, "META_TEMPLATE_REQUIRED", "اختر قالب Meta معتمداً واربط حقوله");
  const templates = await liveMetaTemplates();
  const t = templates.find(
    (t) =>
      t.name === body.providerTemplate.name &&
      t.language === body.providerTemplate.language,
  );
  return approvedTemplateSnapshot(t, body.providerTemplate.fields);
}

export async function handleEventMessaging(
  db: FollowupDatabase,
  actor: FollowupActor,
  req: {
    method: string;
    parts: string[];
    query: URLSearchParams;
    readBody: () => Promise<any>;
  },
): Promise<{ status: number; data: any }> {
  await checkActor(db, actor);
  const { method, parts, query } = req;
  if (method === "GET" && parts[0] === "recipients")
    return { status: 200, data: await recipientList(db, actor, query) };
  if (method === "GET" && parts[0] === "templates")
    return {
      status: 200,
      data: {
        templates: MESSAGE_TEMPLATES,
        providerTemplates:
          query.get("provider") === "meta" ? await liveMetaTemplates() : [],
      },
    };
  if (method === "GET" && !parts.length) {
    const list = await messageRows(
      db,
      sql`SELECT c.id,c.title,c.channel,c.status,c.created_by,c.scheduled_at,c.created_at,count(r.id)::int AS recipients,count(r.id) FILTER(WHERE r.status IN ('accepted','sent','delivered','read'))::int AS accepted,count(r.id) FILTER(WHERE r.status IN ('failed','unknown','blocked'))::int AS issues FROM event_message_campaigns c LEFT JOIN event_message_recipients r ON r.campaign_id=c.id WHERE ${campaignScope(actor)} GROUP BY c.id ORDER BY c.id DESC LIMIT 50`,
    );
    return {
      status: 200,
      data: {
        campaigns: list,
        canApprove: isManager(actor),
        canGraduation: graduationAccess(actor) && isManager(actor),
      },
    };
  }
  if (method === "GET" && parts.length === 1) {
    const c = await campaign(db, actor, parts[0]);
    return {
      status: 200,
      data: {
        campaign: c,
        recipients: await messageRows(
          db,
          sql`SELECT id,recipient_key,phone,snapshot,message,status,error_code,attempted_at,updated_at FROM event_message_recipients WHERE campaign_id=${c.id} ORDER BY id LIMIT 100`,
        ),
        history: await messageRows(
          db,
          sql`SELECT action,actor_id,details,created_at FROM event_message_events WHERE campaign_id=${c.id} ORDER BY id DESC LIMIT 200`,
        ),
      },
    };
  }
  if (method !== "POST")
    return fail(404, "MESSAGING_ROUTE_NOT_FOUND", "مسار الرسائل غير موجود");
  const body = await req.readBody();
  if (!body || typeof body !== "object" || Array.isArray(body))
    fail(422, "INVALID_BODY", "بيانات غير صالحة");
  if (parts[0] === "consent")
    return db.transaction(async (tx) => {
      await checkActor(tx, actor, true);
      const r = await recipientSource(tx, actor, body.recipientKey);
      const evidence = txt(body.evidence, 1000);
      if (
        typeof body.optedIn !== "boolean" ||
        typeof body.blocked !== "boolean"
      )
        fail(422, "INVALID_CONSENT", "اختر حالة موافقة المستلم");
      await messageRows(
        tx,
        sql`INSERT INTO event_message_consents(recipient_key,phone,opted_in,blocked,evidence,actor_id) VALUES(${r.key},${r.phone},${body.optedIn && !body.blocked},${body.blocked},${evidence},${actor.id}) ON CONFLICT(recipient_key,phone) DO UPDATE SET opted_in=EXCLUDED.opted_in,blocked=EXCLUDED.blocked,evidence=EXCLUDED.evidence,actor_id=EXCLUDED.actor_id,updated_at=now() RETURNING recipient_key`,
      );
      await audit(tx, actor.id, null, null, "consent_changed", {
        recipientKey: r.key,
        phoneSuffix: r.phone.slice(-4),
        optedIn: body.optedIn,
        blocked: body.blocked,
        evidence,
      });
      return { status: 200, data: { ok: true } };
    });
  if (parts[0] === "preview") {
    const provider = await chooseProvider(body);
    return { status: 200, data: await preview(db, actor, body, provider) };
  }
  if (!parts.length) {
    if (!["manual", "meta"].includes(body.channel))
      fail(422, "INVALID_CHANNEL", "اختر طريقة الإرسال");
    const title = txt(body.title, 200),
      token = txt(body.idempotencyKey, 100);
    const provider = await chooseProvider(body);
    const schedule = body.scheduledAt ? new Date(body.scheduledAt) : new Date();
    if (
      !Number.isFinite(schedule.getTime()) ||
      schedule.getTime() > Date.now() + 366 * 86400000
    )
      fail(422, "INVALID_SCHEDULE", "موعد الإرسال غير صالح");
    return db.transaction(async (tx) => {
      await checkActor(tx, actor);
      await messageRows(
        tx,
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`event-campaign:${actor.id}:${token}`},0))`,
      );
      const [prior] = await messageRows(
        tx,
        sql`SELECT * FROM event_message_campaigns WHERE request_token=${`${actor.id}:${token}`}`,
      );
      const selectionHash = digest({
        title,
        templateKey: body.templateKey,
        channel: body.channel,
        recipientKeys: [...new Set(body.recipientKeys || [])].sort(),
        scheduledAt: body.scheduledAt || null,
        providerTemplate: body.providerTemplate || null,
      });
      if (prior) {
        const [created] = await messageRows(
          tx,
          sql`SELECT details FROM event_message_events WHERE campaign_id=${prior.id} AND action='created' ORDER BY id LIMIT 1`,
        );
        if (created?.details?.selectionHash !== selectionHash)
          fail(409, "IDEMPOTENCY_CONFLICT", "معرّف الحفظ مستخدم لحملة مختلفة");
        return { status: 200, data: { campaignId: prior.id } };
      }
      const result = await preview(tx, actor, body, provider);
      const hash = result.previewHash;
      if (body.previewHash !== hash)
        fail(
          409,
          "PREVIEW_CHANGED",
          "تغيرت بيانات المعاينة؛ راجع الرسائل مجدداً قبل الحفظ",
        );
      const [c] = await messageRows(
        tx,
        sql`INSERT INTO event_message_campaigns(title,template_key,channel,created_by,scheduled_at,snapshot_hash,provider_template,request_token) VALUES(${title},${body.templateKey},${body.channel},${actor.id},${schedule.toISOString()}::timestamptz,${hash},${provider ? JSON.stringify(provider) : null}::jsonb,${`${actor.id}:${token}`}) RETURNING id`,
      );
      if (!c) throw new Error("Campaign insert returned no row");
      for (const item of result.recipients)
        await messageRows(
          tx,
          sql`INSERT INTO event_message_recipients(campaign_id,recipient_key,phone,snapshot,message) VALUES(${c.id},${item.recipient.key},${item.recipient.phone},${JSON.stringify(item.recipient)}::jsonb,${item.message}) RETURNING id`,
        );
      await audit(tx, actor.id, c.id, null, "created", {
        selectionHash,
        snapshotHash: hash,
        duplicatesRemoved: result.duplicatesRemoved,
      });
      return { status: 201, data: { campaignId: c.id } };
    });
  }
  if (parts[1] === "approve" || parts[1] === "reject" || parts[1] === "cancel")
    return db.transaction(async (tx) => {
      await checkActor(tx, actor, true);
      const c = await campaign(tx, actor, parts[0], true);
      if (c.status !== "pending")
        fail(409, "CAMPAIGN_NOT_PENDING", "الحملة لم تعد بانتظار الموافقة");
      if (parts[1] === "approve") {
        const recipients = await messageRows(
          tx,
          sql`SELECT snapshot,message FROM event_message_recipients WHERE campaign_id=${c.id} ORDER BY id`,
        );
        if (
          digest(
            recipients.map((r) => ({
              recipient: r.snapshot,
              message: r.message,
            })),
          ) !== c.snapshot_hash
        )
          fail(
            409,
            "CAMPAIGN_SNAPSHOT_CHANGED",
            "تغيرت معاينة الحملة؛ أعد إنشاءها",
          );
        await messageRows(
          tx,
          sql`UPDATE event_message_campaigns SET status='approved',approved_by=${actor.id},approved_at=now() WHERE id=${c.id} RETURNING id`,
        );
      } else
        await messageRows(
          tx,
          sql`UPDATE event_message_campaigns SET status=${parts[1] === "reject" ? "rejected" : "cancelled"} WHERE id=${c.id} RETURNING id`,
        );
      await audit(tx, actor.id, c.id, null, parts[1]);
      return { status: 200, data: { ok: true } };
    });
  if (parts[1] === "manual-open")
    return db.transaction(async (tx) => {
      await checkActor(tx, actor);
      const c = await campaign(tx, actor, parts[0], true);
      if (
        c.channel !== "manual" ||
        c.status !== "approved" ||
        new Date(c.scheduled_at).getTime() > Date.now()
      )
        fail(409, "CAMPAIGN_NOT_READY", "الحملة تحتاج موافقة وبلوغ موعدها");
      const [r] = await messageRows(
        tx,
        sql`SELECT * FROM event_message_recipients WHERE id=${id(body.recipientId)} AND campaign_id=${c.id} FOR UPDATE`,
      );
      if (!r) fail(404, "RECIPIENT_NOT_FOUND", "المستلم غير موجود في الحملة");
      if (r.status !== "pending")
        fail(
          409,
          "ALREADY_OPENED",
          "سبق فتح الرسالة؛ راجع واتساب قبل أي إعادة إرسال",
        );
      const current = await recipientSource(tx, actor, r.recipient_key);
      if (
        current.blocked ||
        (c.template_key === "offers" && !current.consent) ||
        current.phone !== r.phone ||
        renderEventMessage(c.template_key, current) !== r.message
      )
        fail(
          409,
          "RECIPIENT_CHANGED",
          "تغيرت بيانات المستلم أو أوقف التواصل؛ أعد المعاينة",
        );
      await messageRows(
        tx,
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`event-send:${r.phone}`},0))`,
      );
      const [duplicate] = await messageRows(
        tx,
        sql`SELECT id FROM event_message_recipients WHERE id<>${r.id} AND phone=${r.phone} AND message=${r.message} AND attempted_at>=now()-interval '24 hours' AND status IN ('sending','unknown','accepted','sent','delivered','read','manual_opened') LIMIT 1`,
      );
      if (duplicate)
        fail(
          409,
          "DUPLICATE_MESSAGE_24H",
          "سبق فتح أو إرسال هذه الرسالة لهذا الرقم خلال 24 ساعة",
        );
      await messageRows(
        tx,
        sql`UPDATE event_message_recipients SET status='manual_opened',attempted_at=now(),updated_at=now() WHERE id=${r.id} RETURNING id`,
      );
      await audit(tx, actor.id, c.id, r.id, "manual_opened");
      return {
        status: 200,
        data: {
          href: `https://wa.me/${r.phone}?text=${encodeURIComponent(r.message)}`,
          status: "manual_opened",
        },
      };
    });
  if (parts[1] === "dispatch") {
    await checkActor(db, actor, true);
    await campaign(db, actor, parts[0]);
    return {
      status: 200,
      data: await dispatchCampaign(db, id(parts[0]), actor),
    };
  }
  return fail(404, "MESSAGING_ROUTE_NOT_FOUND", "مسار الرسائل غير موجود");
}

export async function dispatchCampaign(
  db: FollowupDatabase,
  campaignId: number,
  caller?: FollowupActor,
  dependencies = { templates: liveMetaTemplates, send: sendMetaTemplate },
) {
  const [c] = await messageRows(
    db,
    sql`SELECT * FROM event_message_campaigns WHERE id=${campaignId}`,
  );
  if (
    !c ||
    c.channel !== "meta" ||
    c.status !== "approved" ||
    new Date(c.scheduled_at).getTime() > Date.now()
  )
    return { processed: 0 };
  const [staff] = await messageRows(
    db,
    sql`SELECT id,role,permissions FROM staff WHERE id=${c.approved_by} AND is_active=true`,
  );
  if (!staff)
    fail(403, "APPROVER_INACTIVE", "المدير الذي اعتمد الحملة لم يعد فعالاً");
  const actor: FollowupActor = {
    ...staff,
    permissions: Array.isArray(staff.permissions) ? staff.permissions : [],
    canBook: false,
    canCreateCustomer: false,
  };
  await checkActor(db, actor, true);
  const live = (await dependencies.templates()).find(
    (t) =>
      t.name === c.provider_template?.name &&
      t.language === c.provider_template?.language,
  );
  if (
    digest(approvedTemplateSnapshot(live, c.provider_template.fields)) !==
    digest(c.provider_template)
  )
    fail(
      409,
      "META_TEMPLATE_CHANGED",
      "قالب Meta تغيّر أو لم يعد معتمداً؛ أعد معاينة الحملة",
    );
  let processed = 0;
  let claimed = 0;
  async function worker() {
    while (claimed++ < 100) {
      const r = await db.transaction(async (tx) => {
        const locked = await campaign(tx, actor, c.id, true);
        if (locked.status !== "approved") return null;
        const [item] = await messageRows(
          tx,
          sql`SELECT * FROM event_message_recipients WHERE campaign_id=${c.id} AND status='pending' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1`,
        );
        if (!item) return null;
        await messageRows(
          tx,
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`event-send:${item.phone}`},0))`,
        );
        let current: MessageRecipient;
        try {
          current = await recipientSource(tx, actor, item.recipient_key);
        } catch (e) {
          if (
            e instanceof CustomerFollowupError &&
            [403, 404, 422].includes(e.status)
          ) {
            await messageRows(
              tx,
              sql`UPDATE event_message_recipients SET status='blocked',error_code=${e.code},updated_at=now() WHERE id=${item.id} RETURNING id`,
            );
            return { blocked: true };
          }
          throw e;
        }
        if (
          current.blocked ||
          !current.consent ||
          current.phone !== item.phone ||
          renderMetaTemplate(c.provider_template, messageValues(current)) !==
            item.message
        ) {
          await messageRows(
            tx,
            sql`UPDATE event_message_recipients SET status='blocked',error_code='RECIPIENT_CHANGED',updated_at=now() WHERE id=${item.id} RETURNING id`,
          );
          return { blocked: true };
        }
        const [duplicate] = await messageRows(
          tx,
          sql`SELECT id FROM event_message_recipients WHERE id<>${item.id} AND phone=${item.phone} AND message=${item.message} AND attempted_at>=now()-interval '24 hours' AND status IN ('sending','unknown','accepted','sent','delivered','read','manual_opened') LIMIT 1`,
        );
        if (duplicate) {
          await messageRows(
            tx,
            sql`UPDATE event_message_recipients SET status='blocked',error_code='DUPLICATE_MESSAGE_24H',updated_at=now() WHERE id=${item.id} RETURNING id`,
          );
          return { blocked: true };
        }
        const claim = randomUUID();
        await messageRows(
          tx,
          sql`UPDATE event_message_recipients SET status='sending',claim_token=${claim},attempted_at=now(),updated_at=now() WHERE id=${item.id} RETURNING id`,
        );
        await audit(tx, caller?.id ?? actor.id, c.id, item.id, "send_claimed");
        return { ...item, claim, current };
      });
      if (!r) return;
      if (r.blocked) {
        processed++;
        continue;
      }
      const result = await dependencies.send(
        r.phone,
        c.provider_template,
        messageValues(r.current),
      );
      await db.transaction(async (tx) => {
        if (result.status === "accepted")
          await messageRows(
            tx,
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${`event-delivery:${result.id}`},0))`,
          );
        await messageRows(
          tx,
          sql`UPDATE event_message_recipients SET status=${result.status},provider_message_id=${result.status === "accepted" ? result.id : null},error_code=${result.status === "accepted" ? null : result.code},updated_at=now() WHERE id=${r.id} AND claim_token=${r.claim} AND status='sending' RETURNING id`,
        );
        await messageRows(
          tx,
          sql`INSERT INTO whatsapp_log(phone,event,message,status,error,provider) VALUES(${r.phone},'event_campaign',${r.message},${result.status},${result.status === "accepted" ? null : result.code},'meta') RETURNING id`,
        );
        await audit(tx, caller?.id ?? actor.id, c.id, r.id, result.status);
        if (result.status === "accepted")
          await reconcileDelivery(tx, result.id, r.phone);
      });
      processed++;
    }
  }
  const workers = await Promise.allSettled(
    Array.from({ length: 5 }, () => worker()),
  );
  const failed = workers.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
  await messageRows(
    db,
    sql`UPDATE event_message_campaigns SET status='complete' WHERE id=${c.id} AND status='approved' AND NOT EXISTS(SELECT 1 FROM event_message_recipients WHERE campaign_id=${c.id} AND status IN ('pending','sending')) RETURNING id`,
  );
  return { processed };
}

/** Called only by the existing authenticated cron. Bounded, no alternative scheduler. */
export async function sweepEventCampaigns(
  db: FollowupDatabase,
  dependencies = { templates: liveMetaTemplates, send: sendMetaTemplate },
) {
  const [ready] = await messageRows(
    db,
    sql`SELECT to_regclass('public.event_message_campaigns') AS name`,
  );
  if (!ready?.name) return { status: "not_configured", processed: 0 };
  await messageRows(
    db,
    sql`DELETE FROM event_message_delivery_inbox WHERE updated_at<now()-interval '7 days' RETURNING provider_message_id`,
  );
  await messageRows(
    db,
    sql`UPDATE event_message_recipients SET status='unknown',error_code='INTERRUPTED_SEND',updated_at=now() WHERE status='sending' AND attempted_at<now()-interval '5 minutes' RETURNING id`,
  );
  const due = await messageRows(
    db,
    sql`SELECT id FROM event_message_campaigns WHERE channel='meta' AND status='approved' AND scheduled_at<=now() ORDER BY scheduled_at,id LIMIT 3`,
  );
  let processed = 0;
  const errors: { campaignId: number; code: string }[] = [];
  for (const row of due) {
    try {
      processed += (await dispatchCampaign(db, row.id, undefined, dependencies))
        .processed;
    } catch (cause) {
      if (
        !(cause instanceof CustomerFollowupError) &&
        !(cause instanceof MetaMessagingError)
      )
        throw cause;
      errors.push({ campaignId: row.id, code: cause.code });
      await audit(db, null, row.id, null, "dispatch_blocked", {
        code: cause.code,
      });
      if (cause.status < 500)
        await messageRows(
          db,
          sql`UPDATE event_message_campaigns SET status='suspended',suspension_code=${cause.code} WHERE id=${row.id} AND status='approved' RETURNING id`,
        );
    }
  }
  return {
    status: errors.length ? "partial_failure" : "ok",
    processed,
    errors,
  };
}

async function reconcileDelivery(
  tx: FollowupExecutor,
  providerId: string,
  phone: string,
): Promise<boolean> {
  const [incoming] = await messageRows(
    tx,
    sql`SELECT * FROM event_message_delivery_inbox WHERE provider_message_id=${providerId} AND phone=${phone}`,
  );
  if (!incoming) return false;
  const [r] = await messageRows(
    tx,
    sql`SELECT * FROM event_message_recipients WHERE provider_message_id=${providerId} AND phone=${phone} FOR UPDATE`,
  );
  if (!r) return false;
  const next = nextDeliveryStatus(r.status, incoming.status as DeliveryStatus);
  if (next === r.status) return false;
  await messageRows(
    tx,
    sql`UPDATE event_message_recipients SET status=${next},updated_at=now() WHERE id=${r.id} RETURNING id`,
  );
  await audit(tx, null, r.campaign_id, r.id, `provider_${next}`);
  return true;
}

export async function applyMetaDelivery(db: FollowupDatabase, payload: any) {
  if (
    payload?.object !== "whatsapp_business_account" ||
    !Array.isArray(payload.entry)
  )
    fail(400, "INVALID_WEBHOOK", "Webhook غير صالح");
  let changed = 0;
  for (const entry of payload.entry.slice(0, 20))
    for (const change of (entry.changes || []).slice(0, 20)) {
      if (
        change.value?.metadata?.phone_number_id !== process.env.META_WA_PHONE_ID
      )
        continue;
      for (const status of (change.value?.statuses || []).slice(0, 100)) {
        if (
          !["sent", "delivered", "read", "failed"].includes(status.status) ||
          typeof status.id !== "string" ||
          status.id.length > 512 ||
          typeof status.recipient_id !== "string" ||
          !/^\d{8,20}$/.test(status.recipient_id)
        )
          continue;
        await db.transaction(async (tx) => {
          await messageRows(
            tx,
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${`event-delivery:${status.id}`},0))`,
          );
          const [previous] = await messageRows(
            tx,
            sql`SELECT * FROM event_message_delivery_inbox WHERE provider_message_id=${status.id}`,
          );
          if (previous && previous.phone !== status.recipient_id) return;
          const next = previous
            ? nextDeliveryStatus(previous.status, status.status)
            : status.status;
          if (!previous || next !== previous.status)
            await messageRows(
              tx,
              sql`INSERT INTO event_message_delivery_inbox(provider_message_id,phone,status) VALUES(${status.id},${status.recipient_id},${next}) ON CONFLICT(provider_message_id) DO UPDATE SET status=EXCLUDED.status,updated_at=now() RETURNING provider_message_id`,
            );
          if (await reconcileDelivery(tx, status.id, status.recipient_id))
            changed++;
        });
      }
    }
  return { changed };
}
