import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  CustomerFollowupError,
  handleCustomerFollowupRequest,
} from "../src/server/customer-followups";
const dialect = new PgDialect(),
  queries: { sql: string; params: any[] }[] = [];
const manager = {
  id: 1,
  role: "manager",
  permissions: ["customers"],
  canBook: true,
  canCreateCustomer: true,
};
const employee = {
  id: 8,
  role: "employee",
  permissions: [],
  canBook: false,
  canCreateCustomer: false,
};
let records = new Map<number, any>(),
  events = new Map<string, any>(),
  blocked = false,
  nextId = 40,
  failNext = false,
  failEvent = false;
const db: any = {
  async execute(query: any) {
    const built = dialect.sqlToQuery(query);
    queries.push(built);
    const { sql: s, params: p } = built;
    if (s.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (s.includes("FROM staff"))
      return { rows: [{ id: p[0], is_active: true }] };
    if (s.includes("FROM customers")) return { rows: [{ id: 5 }] };
    if (s.includes("FROM customer_followup_events"))
      return { rows: events.has(p[0]) ? [events.get(p[0])] : [] };
    if (s.includes("INSERT INTO customer_followup_events")) {
      if (failEvent) throw Error("audit unavailable");
      events.set(p[3], {
        followup_id: p[0],
        payload_hash: p[4],
        result: JSON.parse(p[5]),
      });
      return { rows: [{ id: events.size }] };
    }
    if (s.includes("SELECT contact_blocked"))
      return { rows: [{ contact_blocked: blocked }] };
    if (s.includes("INSERT INTO customer_followup_contact_preferences")) {
      blocked = p[1];
      return { rows: [{ customer_id: p[0] }] };
    }
    if (s.includes("FROM customer_followups f")) {
      const row = records.get(Number(p[0]));
      if (
        !row ||
        (s.includes("f.assigned_staff_id =") && row.assigned_staff_id !== p[1])
      )
        return { rows: [] };
      return { rows: [{ ...row, contact_blocked: blocked }] };
    }
    if (s.includes("INSERT INTO customer_followups")) {
      if (failNext && s.includes("parent_id"))
        throw Error("next insert unavailable");
      const isNext = s.includes("parent_id"),
        key = p[isNext ? 7 : 6];
      assert.ok(
        key.length <= 100,
        "fully namespaced stored token fits its real column",
      );
      if (
        [...records.values()].some(
          (row) =>
            row.customer_id === p[0] &&
            row.service_key === p[1] &&
            !row.completed_at &&
            ["interested", "waiting"].includes(row.status),
        )
      )
        throw Object.assign(Error("open pair duplicate"), { code: "23505" });
      const id = nextId++;
      records.set(id, {
        id,
        customer_id: p[0],
        service_key: p[1],
        assigned_staff_id: p[2],
        followup_at: p[3],
        note: p[4],
        status: isNext ? "waiting" : "interested",
        completed_at: null,
        booking_source: null,
        booking_id: null,
        parent_id: isNext ? p[5] : null,
        version: 1,
        created_at: new Date().toISOString(),
        customer_name: "عميل",
        phone: "07701234567",
        full_name: "موظف",
        department: "photography",
        create_token: key,
      });
      return { rows: [{ id }] };
    }
    if (s.includes("UPDATE customer_followups")) {
      const row = records.get(Number(p[5]));
      assert.ok(row, "updates preserve the original row");
      records.set(row.id, {
        ...row,
        status: p[0],
        completed_at: p[1],
        followup_at: p[2],
        note: p[3],
        contact_stage: p[4],
        version: row.version + 1,
      });
      return { rows: [{ id: row.id }] };
    }
    throw Error(`Unexpected SQL ${s}`);
  },
  async transaction(run: any) {
    const before = {
      records: structuredClone(records),
      events: structuredClone(events),
      blocked,
      nextId,
    };
    try {
      return await run(db);
    } catch (e) {
      ({ records, events, blocked, nextId } = before);
      throw e;
    }
  },
};
async function post(actor: any, parts: string[], body: any, query = "") {
  return handleCustomerFollowupRequest(db, actor, {
    method: "POST",
    parts,
    query: new URLSearchParams(query),
    readBody: async () => body,
  });
}
const future = (offset: number) =>
  new Date(Date.now() + offset * 86400000).toISOString();
const command = {
  customerId: 5,
  serviceKey: "photography",
  followupAt: future(1),
  assignedStaffId: 8,
  note: "ملاحظة",
  idempotencyKey: "x".repeat(100),
};
const created: any = await post(manager, [], command);
const id = created.data.followup.id;
assert.equal(created.status, 201);
assert.equal(records.size, 1);
assert.equal(created.data.followup.customer.id, 5);
assert.equal((await post(manager, [], command)).status, 200);
assert.equal(
  records.size,
  1,
  "lost create response replays exact committed source",
);
await assert.rejects(
  () => post(manager, [], { ...command, idempotencyKey: "second-create" }),
  (e) => e instanceof CustomerFollowupError && e.status === 409,
);
assert.equal(records.size, 1);
await assert.rejects(
  () =>
    post(
      manager,
      [],
      {
        ...command,
        serviceKey: "sound",
        assignedStaffId: 9,
        idempotencyKey: "scoped-create",
      },
      "scope=mine",
    ),
  (e) => e instanceof CustomerFollowupError && e.status === 403,
);
const act = (actor: any, body: any) =>
  post(actor, [String(id), "actions"], body);
await assert.rejects(
  () =>
    act(employee, {
      action: "status",
      expectedVersion: 1,
      status: "converted",
      idempotencyKey: "false-conversion",
    }),
  (e) =>
    e instanceof CustomerFollowupError &&
    e.code === "CONVERSION_REQUIRES_BOOKING",
);
const complete = {
  action: "complete",
  expectedVersion: 1,
  nextFollowupAt: future(3),
  note: "مكتمل",
  idempotencyKey: "complete-with-next",
};
failNext = true;
await assert.rejects(() => act(employee, complete), /next insert unavailable/);
assert.equal(records.get(id).completed_at, null);
assert.equal(records.size, 1);
assert.equal(
  events.size,
  1,
  "next failure rolls original completion and audit back",
);
failNext = false;
const completed: any = await act(employee, complete);
assert.ok(completed.data.followup.completedAt);
assert.equal(completed.data.nextFollowup.status, "waiting");
assert.equal(records.get(completed.data.nextFollowup.id).parent_id, id);
assert.equal(records.size, 2);
assert.deepEqual(await act(employee, complete), completed);
assert.equal(
  records.size,
  2,
  "complete+next replay does not create another next row",
);
const next = completed.data.nextFollowup;
const nextAct = (actor: any, body: any) =>
  post(actor, [String(next.id), "actions"], body);
await nextAct(employee, {
  action: "status",
  status: "uninterested",
  expectedVersion: 1,
  idempotencyKey: "decline-service",
});
assert.equal(blocked, false, "service decline does not globally stop contact");
assert.equal(records.get(next.id).status, "uninterested");
failEvent = true;
await assert.rejects(
  () =>
    nextAct(employee, {
      action: "stop_contact",
      expectedVersion: 2,
      idempotencyKey: "contact-stop-failed",
    }),
  /audit unavailable/,
);
assert.equal(blocked, false, "consent and event commit together");
failEvent = false;
await nextAct(employee, {
  action: "stop_contact",
  expectedVersion: 2,
  idempotencyKey: "contact-stop",
});
assert.equal(blocked, true);
await assert.rejects(
  () =>
    post(manager, [], {
      ...command,
      serviceKey: "sound",
      idempotencyKey: "contact-block-create",
    }),
  (e) => e instanceof CustomerFollowupError && e.code === "CONTACT_BLOCKED",
);
await assert.rejects(
  () =>
    nextAct(employee, {
      action: "resume_contact",
      expectedVersion: 3,
      confirmResume: true,
      idempotencyKey: "employee-resume",
    }),
  (e) => e instanceof CustomerFollowupError && e.status === 403,
);
assert.equal(blocked, true);
await nextAct(manager, {
  action: "resume_contact",
  expectedVersion: 3,
  confirmResume: true,
  idempotencyKey: "manager-resume",
});
assert.equal(blocked, false);
await assert.rejects(
  () =>
    post({ ...employee, id: 9 }, [String(next.id), "actions"], {
      action: "complete",
      expectedVersion: 4,
      idempotencyKey: "other-employee",
    }),
  (e) => e instanceof CustomerFollowupError && e.status === 404,
);
await assert.rejects(
  () =>
    post(manager, [], {
      ...command,
      serviceKey: "sound",
      followupAt: "2026-02-31T10:00:00Z",
      idempotencyKey: "invalid-calendar-date",
    }),
  (e) =>
    e instanceof CustomerFollowupError && e.code === "INVALID_FOLLOWUP_DATE",
  "impossible calendar dates cannot silently normalize to a different saved day",
);
assert.ok(
  queries.some((q) => /ON CONFLICT \(customer_id\) DO UPDATE/.test(q.sql)),
);
assert.ok(queries.some((q) => /FOR UPDATE OF f/.test(q.sql)));
assert.ok(queries.some((q) => /FROM customers.*FOR UPDATE/.test(q.sql)));
console.log(
  "PASS customer followup mutations: create replay/uniqueness, complete+next rollback/replay, consent separation/rollback and assignment security",
);
