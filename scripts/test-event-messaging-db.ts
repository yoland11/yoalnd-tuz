import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import {
  handleEventMessaging,
  dispatchCampaign,
  applyMetaDelivery,
  digest,
  recipientSource,
  sweepEventCampaigns,
} from "../src/server/event-messaging";
import { handleCustomerFollowupRequest } from "../src/server/customer-followups";
import {
  recordOccasionFollowups,
  sweepOccasionFollowups,
} from "../src/server/event-followup-operations";
// @ts-expect-error shared fail-closed JavaScript database guard
import { assertSafeTestDatabase } from "./lib/test-database-guard.mjs";
let url: string;
try {
  url = assertSafeTestDatabase(process.env).url;
} catch (cause) {
  if (process.env.TEST_DATABASE_URL || process.argv.includes("--strict"))
    throw cause;
  console.log(
    "SKIPPED event messaging DB integration: no isolated TEST database (not PASS)",
  );
  process.exit(0);
}
const pool = new pg.Pool({ connectionString: url, max: 5 });
const schema = "event_message_test_" + randomBytes(8).toString("hex");
const owner = await pool.connect();
try {
  await owner.query(`CREATE SCHEMA "${schema}"`);
  const tables = [
    "staff",
    "customers",
    "services",
    "service_orders",
    "kosha_bookings",
    "products",
    "stock_reservations",
    "financial_transactions",
    "receipt_vouchers",
    "receipt_voucher_allocations",
    "graduation_groups",
    "graduation_orders",
    "graduation_order_items",
    "notifications",
    "whatsapp_log",
    "customer_followups",
    "customer_followup_events",
    "customer_followup_contact_preferences",
    "event_message_consents",
    "event_message_campaigns",
    "event_message_recipients",
    "event_message_events",
    "event_message_delivery_inbox",
    "event_followup_reminders",
  ];
  // Dedicated test schema; retain real column types/checks while keeping production writes impossible.
  for (const table of tables)
    await owner.query(
      `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`,
    );
  const db: any = {
    execute: async (q: any) => {
      const c = await pool.connect();
      try {
        await c.query(`SET search_path TO "${schema}",pg_catalog`);
        return await drizzle(c).execute(q);
      } finally {
        c.release();
      }
    },
    transaction: async (run: any) => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await c.query(`SET LOCAL search_path TO "${schema}",pg_catalog`);
        const value = await run(drizzle(c));
        await c.query("COMMIT");
        return value;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    },
  };
  const exec = async (q: any) => (await db.execute(q)).rows;
  const [manager] = await exec(
    sql`INSERT INTO staff(username,password_hash,full_name,role,permissions) VALUES('event_manager','not-a-login','مدير الاختبار','admin','[]') RETURNING id`,
  );
  const [employee] = await exec(
    sql`INSERT INTO staff(username,password_hash,full_name,role,permissions) VALUES('event_employee','not-a-login','الموظف','employee','["whatsapp"]') RETURNING id`,
  );
  const [customer] = await exec(
    sql`INSERT INTO customers(name,phone) VALUES('أحمد الاختبار','07701234567') RETURNING id`,
  );
  const [other] = await exec(
    sql`INSERT INTO customers(name,phone) VALUES('عميل آخر','07707654321') RETURNING id`,
  );
  const [service] = await exec(
    sql`INSERT INTO services(name,name_ar,type) VALUES('Photography','التصوير','photography') RETURNING id`,
  );
  const [booking] = await exec(
    sql`INSERT INTO service_orders(service_id,customer_id,customer_name,phone,tracking_code,event_date,custom_fields,total_amount,remaining_amount) VALUES(${service.id},${customer.id},'أحمد','07701234567','AJN-EVENT-TEST','2026-12-01','{"eventType":"خطوبة"}',15000,15000) RETURNING id`,
  );
  const actor = {
    id: manager.id,
    role: "admin",
    permissions: [],
    canBook: true,
    canCreateCustomer: true,
  };
  const worker = {
    id: employee.id,
    role: "employee",
    permissions: ["whatsapp"],
    canBook: false,
    canCreateCustomer: false,
  };
  const call = (method: string, parts: string[], body: any = {}, a = actor) =>
    handleEventMessaging(db, a, {
      method,
      parts,
      query: new URLSearchParams(),
      readBody: async () => body,
    });
  const expectCode = (code: string) => (e: any) => e.code === code;
  assert.equal(
    digest({ a: 1, b: 2 }),
    digest({ b: 2, a: 1 }),
    "JSONB key order must not invalidate approval",
  );
  await assert.rejects(
    () => recipientSource(db, worker, `customer:${other.id}`),
    expectCode("RECIPIENT_UNAVAILABLE"),
  );
  const autos = await Promise.all([
    db.transaction((tx: any) =>
      recordOccasionFollowups(tx, {
        source: "service",
        id: booking.id,
        staffId: employee.id,
      }),
    ),
    db.transaction((tx: any) =>
      recordOccasionFollowups(tx, {
        source: "service",
        id: booking.id,
        staffId: employee.id,
      }),
    ),
  ]);
  assert.equal(
    autos.reduce((n, a) => n + a.created, 0),
    2,
  );
  assert.equal(
    (await exec(sql`SELECT count(*)::int AS count FROM customer_followups`))[0]
      .count,
    2,
  );
  const recipient = await recipientSource(db, actor, `customer:${customer.id}`);
  assert.equal(recipient.details.remaining, "15000");
  assert.equal(
    recipient.details.photographyDate,
    "2026-12-01",
    "normal customer photography reminder uses its real verified appointment date",
  );
  const base = {
    title: "الحملة التجريبية",
    channel: "manual",
    templateKey: "event_details",
    recipientKeys: [`customer:${customer.id}`],
  };
  const p = await call("POST", ["preview"], base);
  assert.match(p.data.recipients[0].message, /أحمد/);
  const save = {
    ...base,
    previewHash: p.data.previewHash,
    idempotencyKey: "campaign-integration-1",
  };
  const created = await call("POST", [], save);
  const cid = created.data.campaignId;
  assert.equal((await call("POST", [], save)).data.campaignId, cid);
  await assert.rejects(
    () => call("POST", [], { ...save, title: "مختلف" }),
    expectCode("IDEMPOTENCY_CONFLICT"),
  );
  await assert.rejects(
    () => call("POST", [String(cid), "approve"], {}, worker),
    expectCode("CAMPAIGN_FORBIDDEN"),
  );
  let detail = await call("GET", [String(cid)]),
    rid = detail.data.recipients[0].id;
  await assert.rejects(
    () => call("POST", [String(cid), "manual-open"], { recipientId: rid }),
    expectCode("CAMPAIGN_NOT_READY"),
  );
  await call("POST", [String(cid), "approve"]);
  assert.match(
    (await call("POST", [String(cid), "manual-open"], { recipientId: rid }))
      .data.href,
    /^https:\/\/wa.me\//,
  );
  await assert.rejects(
    () => call("POST", [String(cid), "manual-open"], { recipientId: rid }),
    expectCode("ALREADY_OPENED"),
  );
  assert.equal(
    (await exec(sql`SELECT count(*)::int AS count FROM whatsapp_log`))[0].count,
    0,
    "manual opening is not a provider send",
  );
  await assert.rejects(
    () => call("POST", ["preview"], { ...base, channel: "meta" }),
    () => true,
  );
  const group = await exec(
    sql`INSERT INTO graduation_groups(group_no,join_token,title,representative_name,representative_phone) VALUES('GRAD-TEST','private-join-token','دفعة اختبار','الممثل المخول','07705555555') RETURNING id`,
  );
  const [order] = await exec(
    sql`INSERT INTO graduation_orders(order_no,qr_token,customer_name,phone,group_id,total_amount,remaining_amount,internal_notes,due_date) VALUES('GRAD-ORDER-TEST','private-qr','طالب خاص','07704444444',${group[0].id},23000,23000,'لا تسرّب هذه الملاحظة','2026-12-02') RETURNING id`,
  );
  const g = await recipientSource(db, actor, `group:${group[0].id}`);
  assert.equal(g.name, "الممثل المخول");
  assert.equal(g.details.students, "1");
  assert.doesNotMatch(JSON.stringify(g), /طالب خاص|private|لا تسرّب/);
  await assert.rejects(
    () => recipientSource(db, worker, g.key),
    expectCode("GRADUATION_RECIPIENT_FORBIDDEN"),
  );
  const individual = await recipientSource(db, actor, `graduation:${order.id}`);
  assert.equal(individual.name, "طالب خاص");
  assert.equal(individual.details.deliveryDate, "2026-12-02");
  assert.equal(
    individual.details.photographyDate,
    "",
    "delivery date is never reused as a photography appointment",
  );
  assert.doesNotMatch(JSON.stringify(individual), /private|لا تسرّب/);
  await call("POST", ["consent"], {
    recipientKey: g.key,
    optedIn: true,
    blocked: false,
    evidence: "طلب ممثل المجموعة اختبارياً",
  });
  assert.equal((await recipientSource(db, actor, g.key)).consent, true);
  await call("POST", ["consent"], {
    recipientKey: g.key,
    optedIn: false,
    blocked: true,
    evidence: "طلب إيقاف التواصل",
  });
  await assert.rejects(
    () => call("POST", ["preview"], { ...base, recipientKeys: [g.key] }),
    expectCode("CONTACT_BLOCKED"),
  );
  await exec(
    sql`UPDATE graduation_groups SET representative_phone='07706666666' WHERE id=${g.id}`,
  );
  assert.equal(
    (await recipientSource(db, actor, g.key)).consent,
    false,
    "consent never transfers to a changed phone",
  );
  // Dispatch uses an injected official provider; no network call or real customer message.
  await call("POST", ["consent"], {
    recipientKey: recipient.key,
    optedIn: true,
    blocked: false,
    evidence: "موافقة اختبارية موثقة",
  });
  const snap = await recipientSource(db, actor, recipient.key),
    provider = {
      name: "ajn_test",
      language: "ar",
      body: "مرحباً {{1}}",
      footer: "",
      fields: ["name"],
    };
  const [apiCampaign] = await exec(
    sql`INSERT INTO event_message_campaigns(title,template_key,channel,status,created_by,approved_by,approved_at,snapshot_hash,provider_template,request_token) VALUES('اختبار الإرسال','event_details','meta','approved',${manager.id},${manager.id},now(),'',${JSON.stringify(provider)}::jsonb,'controlled-provider-test') RETURNING id`,
  );
  const [apiRecipient] = await exec(
    sql`INSERT INTO event_message_recipients(campaign_id,recipient_key,phone,snapshot,message) VALUES(${apiCampaign.id},${snap.key},${snap.phone},${JSON.stringify(snap)}::jsonb,'مرحباً أحمد الاختبار') RETURNING id`,
  );
  let sends = 0;
  process.env.META_WA_PHONE_ID = "test-phone-id";
  const dependencies = {
    templates: async () => [
      {
        ...provider,
        status: "APPROVED",
        components: [{ type: "BODY", text: provider.body }],
      },
    ],
    send: async () => {
      sends++;
      await applyMetaDelivery(db, {
        object: "whatsapp_business_account",
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: "test-phone-id" },
                  statuses: [
                    {
                      id: "wamid.test",
                      recipient_id: snap.phone,
                      status: "read",
                    },
                  ],
                },
              },
            ],
          },
        ],
      });
      await new Promise((r) => setTimeout(r, 30));
      return { status: "accepted" as const, id: "wamid.test" };
    },
  };
  await Promise.all([
    dispatchCampaign(db, apiCampaign.id, actor, dependencies),
    dispatchCampaign(db, apiCampaign.id, actor, dependencies),
  ]);
  assert.equal(sends, 1, "concurrent workers must not send twice");
  assert.equal(
    (
      await exec(
        sql`SELECT status FROM event_message_recipients WHERE id=${apiRecipient.id}`,
      )
    )[0].status,
    "read",
    "a signed delivery event arriving before the provider response is retained and reconciled",
  );
  process.env.META_WA_PHONE_ID = "test-phone-id";
  const payload = (status: string) => ({
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: "test-phone-id" },
              statuses: [
                { id: "wamid.test", recipient_id: snap.phone, status },
              ],
            },
          },
        ],
      },
    ],
  });
  await applyMetaDelivery(db, payload("read"));
  await applyMetaDelivery(db, payload("delivered"));
  assert.equal(
    (
      await exec(
        sql`SELECT status FROM event_message_recipients WHERE id=${apiRecipient.id}`,
      )
    )[0].status,
    "read",
  );
  // Occasion edits retain canonical booking/conversion and immutable employee history.
  const [f] = await exec(
    sql`SELECT * FROM customer_followups ORDER BY id LIMIT 1`,
  );
  await handleCustomerFollowupRequest(db, actor, {
    method: "POST",
    parts: [String(f.id), "actions"],
    query: new URLSearchParams(),
    readBody: async () => ({
      action: "event_details",
      expectedVersion: f.version,
      contactStage: "quotation",
      expectedEventDate: "2026-12-10",
      note: "اتصال تجريبي",
      idempotencyKey: "occasion-details-db",
    }),
  });
  const h = await handleCustomerFollowupRequest(db, actor, {
    method: "GET",
    parts: [String(f.id), "history"],
    query: new URLSearchParams(),
    readBody: async () => null,
  });
  assert.equal((h.data as any).followup.contactStage, "quotation");
  const changedPreview = await call("POST", ["preview"], base);
  await exec(sql`UPDATE customers SET name='اسم جديد' WHERE id=${customer.id}`);
  await assert.rejects(
    () =>
      call("POST", [], {
        ...save,
        idempotencyKey: "stale-preview-test",
        previewHash: changedPreview.data.previewHash,
      }),
    expectCode("PREVIEW_CHANGED"),
  );
  await exec(
    sql`UPDATE customers SET name='أحمد الاختبار' WHERE id=${customer.id}`,
  );
  const currentPreview = await call("POST", ["preview"], base);
  const repeated = await call("POST", [], {
    ...save,
    idempotencyKey: "different-campaign-same-message",
    previewHash: currentPreview.data.previewHash,
  });
  await call("POST", [String(repeated.data.campaignId), "approve"]);
  const repeatedDetail = await call("GET", [String(repeated.data.campaignId)]);
  await assert.rejects(
    () =>
      call("POST", [String(repeated.data.campaignId), "manual-open"], {
        recipientId: repeatedDetail.data.recipients[0].id,
      }),
    expectCode("DUPLICATE_MESSAGE_24H"),
  );
  await exec(
    sql`UPDATE customer_followups SET followup_at=now()-interval '1 day' WHERE id=${f.id}`,
  );
  const reminders = await sweepOccasionFollowups(db);
  assert.equal(
    reminders.notificationIds.length,
    2,
    "one assigned employee and one manager reminder",
  );
  assert.equal(
    (await sweepOccasionFollowups(db)).notificationIds.length,
    0,
    "unchanged followup never creates repeated reminders",
  );
  const employeePreview = await call("POST", ["preview"], base, worker);
  const employeeCampaign = await call(
    "POST",
    [],
    {
      ...base,
      previewHash: employeePreview.data.previewHash,
      idempotencyKey: "employee-scope-test",
    },
    worker,
  );
  await exec(
    sql`UPDATE customer_followups SET assigned_staff_id=${manager.id} WHERE customer_id=${customer.id}`,
  );
  await assert.rejects(
    () => call("GET", [String(employeeCampaign.data.campaignId)], {}, worker),
    expectCode("CAMPAIGN_NOT_FOUND"),
  );
  assert.equal(
    (await call("GET", [], {}, worker)).data.campaigns.length,
    0,
    "reassignment removes access to previously stored snapshots",
  );
  await exec(
    sql`UPDATE customer_followups SET assigned_staff_id=${employee.id} WHERE customer_id=${customer.id}`,
  );
  const offerBody = { ...base, templateKey: "offers" };
  const offerPreview = await call("POST", ["preview"], offerBody);
  const offer = await call("POST", [], {
    ...offerBody,
    previewHash: offerPreview.data.previewHash,
    idempotencyKey: "manual-consent-revoked",
  });
  await call("POST", [String(offer.data.campaignId), "approve"]);
  const offerDetail = await call("GET", [String(offer.data.campaignId)]);
  await call("POST", ["consent"], {
    recipientKey: recipient.key,
    optedIn: false,
    blocked: false,
    evidence: "سحب الموافقة على العروض",
  });
  await assert.rejects(
    () =>
      call("POST", [String(offer.data.campaignId), "manual-open"], {
        recipientId: offerDetail.data.recipients[0].id,
      }),
    expectCode("RECIPIENT_CHANGED"),
  );
  // The first invalid scheduled campaign must not starve a later valid 12-person campaign.
  const [inactive] = await exec(
    sql`INSERT INTO staff(username,password_hash,full_name,role,is_active) VALUES('inactive_approver','not-a-login','مدير سابق','admin',false) RETURNING id`,
  );
  const [bad] = await exec(
    sql`INSERT INTO event_message_campaigns(title,template_key,channel,status,created_by,approved_by,approved_at,snapshot_hash,provider_template,request_token) VALUES('حملة يجب إيقافها','event_details','meta','approved',${manager.id},${inactive.id},now(),'',${JSON.stringify(provider)}::jsonb,'invalid-approver-campaign') RETURNING id`,
  );
  const [batch] = await exec(
    sql`INSERT INTO event_message_campaigns(title,template_key,channel,status,created_by,approved_by,approved_at,snapshot_hash,provider_template,request_token) VALUES('حملة اثني عشر مستلماً','event_details','meta','approved',${manager.id},${manager.id},now(),'',${JSON.stringify(provider)}::jsonb,'batch-campaign-test') RETURNING id`,
  );
  for (let i = 0; i < 12; i++) {
    const [c] = await exec(
      sql`INSERT INTO customers(name,phone) VALUES(${"مستلم تجريبي " + i},${"0770" + String(1200000 + i)}) RETURNING id`,
    );
    const key = `customer:${c.id}`;
    await call("POST", ["consent"], {
      recipientKey: key,
      optedIn: true,
      blocked: false,
      evidence: "موافقة تجريبية للحملة",
    });
    const r = await recipientSource(db, actor, key);
    await exec(
      sql`INSERT INTO event_message_recipients(campaign_id,recipient_key,phone,snapshot,message) VALUES(${batch.id},${key},${r.phone},${JSON.stringify(r)}::jsonb,${"مرحباً " + r.name}) RETURNING id`,
    );
  }
  let scheduledSends = 0;
  const swept = await sweepEventCampaigns(db, {
    templates: dependencies.templates,
    send: async (to: string) => {
      scheduledSends++;
      return { status: "accepted" as const, id: "wamid.batch." + to };
    },
  });
  assert.equal(
    swept.processed,
    12,
    "the entire 12-recipient campaign is processed in one daily sweep, not over two days",
  );
  assert.equal(scheduledSends, 12);
  assert.equal(
    (
      await exec(
        sql`SELECT status FROM event_message_campaigns WHERE id=${bad.id}`,
      )
    )[0].status,
    "suspended",
  );
  assert.equal(
    (
      await exec(
        sql`SELECT status FROM event_message_campaigns WHERE id=${batch.id}`,
      )
    )[0].status,
    "complete",
  );
  assert.equal(
    (await exec(sql`SELECT count(*)::int AS count FROM service_orders`))[0]
      .count,
    1,
    "messaging creates no duplicate booking",
  );
  console.log(
    "PASS PostgreSQL event messaging: real schema projections, concurrent automatic followups and send claims, approval, replay, contact stop, changed representative, student privacy, immutable preview, scoped history, monotonic delivery; no external messages",
  );
} finally {
  // Only the exact unique schema owned by this test run.
  await owner.query(`DROP SCHEMA "${schema}" CASCADE`);
  owner.release();
  await pool.end();
}
