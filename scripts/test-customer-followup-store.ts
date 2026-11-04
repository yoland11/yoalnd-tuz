import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { PgDialect } from "drizzle-orm/pg-core";
assert.ok(
  existsSync("src/server/customer-followups.ts"),
  "transactional followup repository/controller must exist",
);
const {
  handleCustomerFollowupRequest,
  completeFollowupConversion,
  CustomerFollowupError,
} = await import("../src/server/customer-followups");
const actor = {
  id: 8,
  role: "employee",
  permissions: [],
  canBook: true,
  canCreateCustomer: false,
};
const manager = {
  ...actor,
  id: 1,
  role: "admin",
  permissions: ["customers"],
  canCreateCustomer: true,
};
const dialect = new PgDialect();
const seen: { sql: string; params: unknown[] }[] = [];
const base: any = {
  id: 12,
  customer_id: 5,
  service_key: "photography",
  assigned_staff_id: 8,
  followup_at: "2026-11-03T09:00:00Z",
  note: "",
  status: "interested",
  completed_at: null,
  version: 1,
  contact_blocked: false,
  booking_source: null,
  booking_id: null,
  created_at: "2026-11-01T10:00:00Z",
  customer_name: "عميل",
  phone: "07701234567",
  full_name: "موظف",
  department: "general",
  created_by: 1,
};
let record: any = { ...base },
  events: any[] = [];
let throwEvent = false,
  assigneeActive = true;
let booking: any = {
  id: 20,
  customer_id: 5,
  created_at: "2026-11-03T10:00:00Z",
  status: "pending",
  tracking_code: "AJN-REAL-00020",
};
const db: any = {
  async execute(q: any) {
    const built = dialect.sqlToQuery(q);
    seen.push(built);
    const s = built.sql,
      p = built.params;
    if (s.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (s.includes("FROM customer_followup_events"))
      return { rows: events.filter((e) => e.request_token === p[0]) };
    if (s.includes("INSERT INTO customer_followup_events")) {
      if (throwEvent) throw Error("event write unavailable");
      events.push({
        followup_id: p[0],
        request_token: p[3],
        payload_hash: p[4],
        result: JSON.parse(p[5]),
      });
      return { rows: [{ id: events.length }] };
    }
    if (s.includes("FROM staff"))
      return {
        rows:
          p[0] === 8 && !assigneeActive
            ? []
            : [
                { id: 8, full_name: "موظف", is_active: true },
                { id: 1, full_name: "مدير", is_active: true },
              ],
      };
    if (s.includes("FROM customers")) return { rows: [{ id: 5 }] };
    if (
      s.includes("FROM service_orders") &&
      !s.includes("UNION ALL") &&
      !s.includes("FROM customer_followups")
    )
      return { rows: booking ? [booking] : [] };
    if (s.includes("FROM customer_followups f"))
      return {
        rows:
          Number(p[0]) === 12 &&
          (!s.includes("f.assigned_staff_id =") || p.includes(8))
            ? [
                {
                  ...record,
                  booking_number: record.booking_id
                    ? booking?.tracking_code
                    : null,
                },
              ]
            : [],
      };
    if (s.includes("UPDATE customer_followups")) {
      if (s.includes("status='converted'")) {
        record = {
          ...record,
          status: "converted",
          booking_source: p[0],
          booking_id: p[1],
          version: record.version + 1,
        };
      } else {
        record = {
          ...record,
          completed_at: "2026-11-03T12:00:00Z",
          version: record.version + 1,
        };
      }
      return { rows: [record] };
    }
    throw Error(`Unhandled SQL ${s}`);
  },
  async transaction(fn: any) {
    const snapshot = {
      record: structuredClone(record),
      events: structuredClone(events),
    };
    try {
      return await fn(db);
    } catch (e) {
      record = snapshot.record;
      events = snapshot.events;
      throw e;
    }
  },
};
const request = (body: any) =>
  handleCustomerFollowupRequest(db, actor, {
    method: "POST",
    parts: ["12", "actions"],
    query: new URLSearchParams(),
    readBody: async () => body,
  });
await assert.rejects(
  () =>
    handleCustomerFollowupRequest(db, actor, {
      method: "GET",
      parts: ["options"],
      query: new URLSearchParams(),
      readBody: async () => ({}),
    }),
  (e) => e instanceof CustomerFollowupError && e.status === 403,
);
const command = {
  action: "complete",
  expectedVersion: 1,
  idempotencyKey: "complete-request-one",
};
const first = await request(command);
assert.equal((first.data as any).followup.version, 2);
assert.equal(record.version, 2);
assert.equal(events.length, 1);
const replay = await request(command);
assert.deepEqual(
  replay,
  first,
  "durable replay precedes old optimistic version rejection",
);
assert.equal(record.version, 2);
await assert.rejects(
  () => request({ ...command, note: "changed" }),
  (e) =>
    e instanceof CustomerFollowupError && e.code === "IDEMPOTENCY_CONFLICT",
);
await assert.rejects(
  () =>
    request({
      ...command,
      idempotencyKey: "other-request",
      expectedVersion: 1,
    }),
  (e) => e instanceof CustomerFollowupError && e.code === "STALE_VERSION",
);
record = { ...base };
events = [];
throwEvent = true;
await assert.rejects(() => request(command), /event write unavailable/);
assert.equal(record.completed_at, null, "failed audit rolls back mutation");
throwEvent = false;
record = { ...base };
await completeFollowupConversion(db, {
  actor,
  followupId: 12,
  customerId: 5,
  booking: { source: "service", id: 20 },
});
assert.equal(record.status, "converted");
await assert.rejects(
  () =>
    completeFollowupConversion(db, {
      actor,
      followupId: 12,
      customerId: 5,
      booking: { source: "service", id: 21 },
    }),
  (e) =>
    e instanceof CustomerFollowupError &&
    e.code === "FOLLOWUP_ALREADY_CONVERTED" &&
    e.existingBooking?.id === 20,
);
const linked: any = await handleCustomerFollowupRequest(db, actor, {
  method: "GET",
  parts: ["12"],
  query: new URLSearchParams(),
  readBody: async () => ({}),
});
assert.equal(
  linked.data.followup.booking.number,
  "AJN-REAL-00020",
  "read conversion reference uses real canonical number, with #ID fallback only when unknown",
);
record = { ...base };
await assert.rejects(
  () =>
    completeFollowupConversion(db, {
      actor,
      followupId: 12,
      customerId: 6,
      booking: { source: "service", id: 20 },
    }),
  (e) => e instanceof CustomerFollowupError && e.code === "CUSTOMER_MISMATCH",
);
assert.equal(record.status, "interested");
booking = { ...booking, created_at: "2026-10-01T00:00:00Z" };
await assert.rejects(
  () =>
    completeFollowupConversion(db, {
      actor: manager,
      followupId: 12,
      customerId: 5,
      booking: { source: "service", id: 20 },
    }),
  (e) =>
    e instanceof CustomerFollowupError &&
    e.code === "BOOKING_PREDATES_FOLLOWUP",
);
assigneeActive = false;
await assert.rejects(
  () =>
    handleCustomerFollowupRequest(db, manager, {
      method: "POST",
      parts: ["12", "actions"],
      query: new URLSearchParams(),
      readBody: async () => ({
        ...command,
        idempotencyKey: "inactive-request",
      }),
    }),
  (e) => e instanceof CustomerFollowupError && e.code === "ASSIGNEE_INACTIVE",
  "every mutation revalidates the assigned employee under a share lock",
);
assigneeActive = true;
booking = {
  ...booking,
  created_at: "2026-11-03T10:00:00Z",
  status: "canceled",
};
await assert.rejects(
  () =>
    completeFollowupConversion(db, {
      actor: manager,
      followupId: 12,
      customerId: 5,
      booking: { source: "service", id: 20 },
    }),
  (e) => e instanceof CustomerFollowupError && e.code === "BOOKING_UNAVAILABLE",
  "legacy canceled status is not an eligible conversion",
);
assert.ok(
  seen.some((q) => /FOR UPDATE OF f/.test(q.sql)),
  "source is locked before changing conversion",
);
assert.ok(
  seen.some((q) => /f.assigned_staff_id =/.test(q.sql)),
  "ordinary source reads enforce assignment in SQL",
);
assert.ok(
  seen.every(
    (q) =>
      !/(CREATE|ALTER|DROP) TABLE|INSERT INTO (service_orders|kosha_bookings|notifications|tasks|cash|payments)/i.test(
        q.sql,
      ),
  ),
);
await assert.rejects(
  () =>
    handleCustomerFollowupRequest(
      {
        execute: async () => {
          throw Object.assign(new Error("undefined table"), { code: "42P01" });
        },
      } as any,
      actor,
      {
        method: "GET",
        parts: [],
        query: new URLSearchParams(),
        readBody: async () => ({}),
      },
    ),
  (e) => e instanceof CustomerFollowupError && e.status === 503,
);
console.log(
  "PASS customer followup store: actual SQL scope, durable replay, transactional failure, canonical conversion and unavailable schema",
);
