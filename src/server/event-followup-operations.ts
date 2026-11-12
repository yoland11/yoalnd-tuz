import { sql } from "drizzle-orm";
import type { FollowupDatabase, FollowupExecutor } from "./customer-followups";
import { messageRows, digest } from "./event-messaging";
import { followupOccasion } from "./customer-followups-rules";

/** Runs in the original booking transaction. No financial or booking-status mutation. */
export async function recordOccasionFollowups(
  tx: FollowupExecutor,
  input: { source: "service" | "kosha"; id: number; staffId?: number },
) {
  const [schema] = await messageRows(
    tx,
    sql`SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='customer_followups' AND column_name='contact_stage') AS ready`,
  );
  if (!schema?.ready) return { status: "not_configured", created: 0 };
  const [b] = await messageRows(
    tx,
    input.source === "service"
      ? sql`SELECT id,customer_id,custom_fields->>'eventType' AS event_type FROM service_orders WHERE id=${input.id} AND archived_at IS NULL AND lower(status) NOT IN ('cancelled','canceled','deleted','archived')`
      : sql`SELECT id,customer_id,event_type FROM kosha_bookings WHERE id=${input.id} AND archived_at IS NULL AND lower(status) NOT IN ('cancelled','canceled','deleted','archived')`,
  );
  if (!b?.customer_id || followupOccasion(b.event_type) !== "engagement")
    return { status: "not_applicable", created: 0 };
  const [c] = await messageRows(
    tx,
    sql`SELECT c.id FROM customers c WHERE c.id=${b.customer_id} AND c.status IS DISTINCT FROM 'deleted' AND NOT EXISTS(SELECT 1 FROM customer_followup_contact_preferences p WHERE p.customer_id=c.id AND p.contact_blocked=true) FOR UPDATE OF c`,
  );
  if (!c) return { status: "contact_blocked", created: 0 };
  const [staff] = await messageRows(
    tx,
    input.staffId
      ? sql`SELECT id FROM staff WHERE id=${input.staffId} AND is_active=true`
      : sql`SELECT id FROM staff WHERE is_active=true AND role IN ('admin','manager') ORDER BY CASE WHEN role='admin' THEN 0 ELSE 1 END,id LIMIT 1`,
  );
  if (!staff) return { status: "assignee_unavailable", created: 0 };
  let created = 0;
  for (const service of ["henna", "wedding"]) {
    const token = `auto:${input.source}:${input.id}:${service}`;
    const [saved] = await messageRows(
      tx,
      sql`INSERT INTO customer_followups(customer_id,service_key,assigned_staff_id,followup_at,note,status,contact_stage,occasion_key,created_by,create_token,payload_hash,suggestion_key,source_booking_source,source_booking_id)
      SELECT ${c.id},${service},${staff.id},now()+interval '7 days','متابعة مناسبة بعد حجز الخطوبة','waiting','new',${service},${staff.id},${token},${digest({ source: input.source, id: input.id, service })},${`${input.source}:${input.id}:${service}`},${input.source},${input.id}
      WHERE NOT EXISTS(SELECT 1 FROM customer_followups f WHERE f.customer_id=${c.id} AND f.service_key=${service} AND (f.status IN ('converted','uninterested') OR f.completed_at IS NULL)) ON CONFLICT DO NOTHING RETURNING id`,
    );
    if (saved) {
      created++;
      await messageRows(
        tx,
        sql`INSERT INTO customer_followup_events(followup_id,actor_id,action,request_token,payload_hash,result) VALUES(${saved.id},${staff.id},'auto_created',${token},${digest(token)},${JSON.stringify({ source: input.source, id: input.id, service })}::jsonb) RETURNING id`,
      );
    }
  }
  return { status: "ok", created };
}

export async function sweepOccasionFollowups(db: FollowupDatabase) {
  const [schema] = await messageRows(
    db,
    sql`SELECT to_regclass('public.event_followup_reminders') AS name`,
  );
  if (!schema?.name)
    return {
      status: "not_configured",
      created: 0,
      notificationIds: [] as number[],
    };
  const [manager] = await messageRows(
    db,
    sql`SELECT id FROM staff WHERE is_active=true AND role IN ('admin','manager') ORDER BY CASE WHEN role='admin' THEN 0 ELSE 1 END,id LIMIT 1`,
  );
  if (!manager)
    return {
      status: "no_manager",
      created: 0,
      notificationIds: [] as number[],
    };
  // Only recent sources, bounded. No migration/backfill of historical bookings.
  const sources = await messageRows(
    db,
    sql`SELECT * FROM ((SELECT 'service' AS source,id,created_at FROM service_orders WHERE created_at>=now()-interval '7 days' AND archived_at IS NULL AND custom_fields->>'eventType' IN ('engagement','خطوبة','خطوبه') ORDER BY id DESC LIMIT 40)
    UNION ALL (SELECT 'kosha' AS source,id,created_at FROM kosha_bookings WHERE created_at>=now()-interval '7 days' AND archived_at IS NULL AND event_type IN ('engagement','خطوبة','خطوبه') ORDER BY id DESC LIMIT 40)) b ORDER BY created_at DESC LIMIT 60`,
  );
  let created = 0;
  for (const b of sources)
    created += (
      await db.transaction((tx) =>
        recordOccasionFollowups(tx, {
          source: b.source,
          id: b.id,
          staffId: manager.id,
        }),
      )
    ).created;
  const notificationIds: number[] = [];
  await db.transaction(async (tx) => {
    await messageRows(
      tx,
      sql`SELECT pg_advisory_xact_lock(hashtextextended('event-followup-reminders',0))`,
    );
    const due = await messageRows(
      tx,
      sql`SELECT f.id,f.followup_at,f.assigned_staff_id,c.name,c.full_name FROM customer_followups f JOIN customers c ON c.id=f.customer_id JOIN staff s ON s.id=f.assigned_staff_id
      WHERE f.completed_at IS NULL AND f.status IN ('interested','waiting') AND s.is_active=true AND c.status IS DISTINCT FROM 'deleted' AND f.followup_at<=now()
      AND NOT EXISTS(SELECT 1 FROM customer_followup_contact_preferences p WHERE p.customer_id=f.customer_id AND p.contact_blocked=true)
      AND (f.source_booking_source IS NULL OR (f.source_booking_source='service' AND EXISTS(SELECT 1 FROM service_orders b WHERE b.id=f.source_booking_id AND b.archived_at IS NULL AND lower(b.status) NOT IN ('cancelled','canceled','deleted','archived')))
        OR (f.source_booking_source='kosha' AND EXISTS(SELECT 1 FROM kosha_bookings b WHERE b.id=f.source_booking_id AND b.archived_at IS NULL AND lower(b.status) NOT IN ('cancelled','canceled','deleted','archived'))))
      AND NOT EXISTS(SELECT 1 FROM event_followup_reminders r WHERE r.followup_id=f.id AND r.followup_at=f.followup_at AND r.staff_id=f.assigned_staff_id)
      ORDER BY f.followup_at,f.id LIMIT 100 FOR UPDATE OF f`,
    );
    const managers = await messageRows(
      tx,
      sql`SELECT id FROM staff WHERE is_active=true AND role IN ('admin','manager') ORDER BY id LIMIT 100`,
    );
    for (const f of due)
      for (const staffId of new Set<number>([
        Number(f.assigned_staff_id),
        ...managers.map((m) => Number(m.id)),
      ])) {
        const [already] = await messageRows(
          tx,
          sql`SELECT notification_id FROM event_followup_reminders WHERE followup_id=${f.id} AND followup_at=${f.followup_at}::timestamptz AND staff_id=${staffId}`,
        );
        if (already) continue;
        const href = managers.some((m) => Number(m.id) === staffId)
          ? "/admin/customer-followups"
          : "/staff?tab=followups";
        const [n] = await messageRows(
          tx,
          sql`INSERT INTO notifications(audience_type,staff_id,type,title,body,entity_type,entity_id,href,metadata) VALUES('staff',${staffId},'customer_event_followup','موعد متابعة مناسبة',${String(f.full_name || f.name || "عميل")},'customer_followup',${f.id},${href},${JSON.stringify({ followupId: f.id })}::jsonb) RETURNING id`,
        );
        if (!n) throw new Error("Followup notification insert missing");
        await messageRows(
          tx,
          sql`INSERT INTO event_followup_reminders(followup_id,followup_at,staff_id,notification_id) VALUES(${f.id},${f.followup_at}::timestamptz,${staffId},${n.id}) RETURNING notification_id`,
        );
        notificationIds.push(n.id);
      }
  });
  return { status: "ok", created, notificationIds };
}
