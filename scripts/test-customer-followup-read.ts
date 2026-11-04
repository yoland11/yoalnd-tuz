import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { handleCustomerFollowupRequest } from "../src/server/customer-followups";
const dialect = new PgDialect(),
  seen: { sql: string; params: any[] }[] = [];
const staff = {
  id: 8,
  role: "employee",
  permissions: [],
  canBook: false,
  canCreateCustomer: false,
};
const admin = {
  ...staff,
  id: 1,
  role: "admin",
  canBook: true,
  canCreateCustomer: true,
};
const source = {
  source: "service",
  id: 20,
  customer_id: 5,
  name: "",
  full_name: "  اسم عميل قديم  ",
  phone: "07701234567",
  fields: { departments: ["kosha"] },
  event_type: "خطوبة",
  service_type: "kosha",
  created_at: "2026-11-03T10:00:00Z",
};
const db: any = {
  async execute(q: any) {
    const built = dialect.sqlToQuery(q);
    seen.push(built);
    const s = built.sql;
    if (s.includes("source_candidates"))
      return {
        rows: [
          source,
          { ...source, source: "kosha", id: 21, event_type: null },
          {
            ...source,
            source: "graduation",
            id: 22,
            event_type: "graduation",
            service_type: "graduation",
            photography_linked: true,
          },
        ],
      };
    if (s.includes("SELECT v.key"))
      return {
        rows: [
          { key: "service:20:henna" },
          { key: "service:20:wedding" },
          { key: "graduation:22:album" },
          { key: "graduation:22:printing" },
        ],
      };
    if (s.includes(" AS converted"))
      return {
        rows: [
          {
            today: 2,
            overdue: 3,
            upcoming: 4,
            converted: 1,
            total: 12,
            completed: 2,
          },
        ],
      };
    if (s.includes("SELECT count(*)::int AS total"))
      return { rows: [{ total: 6 }] };
    if (s.includes("FROM customer_followups f"))
      return {
        rows: s.includes("WHERE f.id=")
          ? [
              {
                id: 12,
                customer_id: 5,
                customer_name: "",
                customer_full_name: " اسم العميل الكامل ",
                phone: "07701234567",
                service_key: "kosha",
                assigned_staff_id: 8,
                followup_at: "2026-11-03T10:00:00Z",
                status: "interested",
                note: "",
                completed_at: null,
                version: 1,
                created_at: "2026-11-01T10:00:00Z",
                full_name: "موظف",
              },
            ]
          : [],
      };
    if (s.includes("FROM customers"))
      return {
        rows: [
          {
            id: 5,
            name: "",
            full_name: "  اسم عميل قديم  ",
            phone: "07701234567",
            avatar_url: null,
          },
          {
            id: 6,
            name: "  الاسم المختصر  ",
            full_name: "  ",
            phone: "07701112233",
          },
          { id: 7, name: " ", full_name: null, phone: "07702223344" },
        ],
      };
    if (s.includes("FROM staff"))
      return { rows: [{ id: 1, full_name: "مدير", department: "general" }] };
    throw Error(`Unexpected query ${s}`);
  },
};
async function get(actor: any, parts: string[] = [], query = "") {
  return handleCustomerFollowupRequest(db, actor, {
    method: "GET",
    parts,
    query: new URLSearchParams(query),
    readBody: async () => ({}),
  });
}
const result: any = (
  await get(staff, [], "pageSize=100000&bucket=today&q=عميل")
).data;
assert.equal(result.pageSize, 50);
assert.equal(result.total, 6);
assert.equal(result.summary.overdue, 3, "bucket does not erase other KPIs");
assert.equal(result.capabilities.canCreate, false);
assert.equal(result.capabilities.canBook, false);
assert.deepEqual(
  result.suggestions.map((s: any) => s.serviceKey),
  ["henna", "wedding", "album", "printing"],
);
assert.ok(result.suggestions.every((s: any) => s.customer.id === 5));
assert.ok(
  result.suggestions.every((s: any) => s.customer.name === "اسم عميل قديم"),
  "legacy full_name survives suggestion projection when name is empty",
);
assert.equal(
  result.suggestions[0].sourceBooking.href,
  "/admin/bookings/service/20",
);
const page = seen.find((q) => q.sql.includes("ORDER BY f.followup_at"))!;
assert.ok(page.params.includes(8) && page.params.includes(50));
assert.match(page.sql, /f\.assigned_staff_id =/);
assert.match(
  page.sql,
  /c\.full_name AS customer_full_name/,
  "list and scoped reads project the customer's full_name distinctly from employee full_name",
);
assert.match(page.sql, /LIMIT \$\d+ OFFSET \$\d+/);
const count = seen.find((q) => q.sql.includes(" AS converted"))!;
assert.match(count.sql, /count\(DISTINCT \(f.booking_source,f.booking_id\)\)/);
assert.match(count.sql, /Asia\/Baghdad/);
assert.match(count.sql, /IS DISTINCT FROM 'deleted'/);
assert.ok(count.params.includes(8));
const suggestionQuery = seen.find((q) => q.sql.includes("source_candidates"))!;
assert.match(suggestionQuery.sql, /owned\.assigned_staff_id=/);
assert.ok(suggestionQuery.params.includes(8));
assert.match(suggestionQuery.sql, /b\.event_type/);
assert.match(suggestionQuery.sql, /eventName/);
assert.match(suggestionQuery.sql, /coalesce\(nullif\(btrim\(b\.custom_fields->>'eventType'\),''\),nullif\(btrim\(b\.custom_fields->>'eventName'\),''\)\)/, "blank occasion field does not hide an explicitly known event name");
assert.match(suggestionQuery.sql, /photography.*serviceOrderId/);
assert.match(suggestionQuery.sql, /LIMIT 120/);
assert.equal(
  (suggestionQuery.sql.match(/c\.name,c\.full_name,c\.phone/g) ?? []).length,
  4,
  "each canonical suggestion source projects the legacy customer name",
);
const suppression = seen.find((q) => q.sql.includes("SELECT v.key"))!;
assert.match(suppression.sql, /uninterested/);
assert.match(suppression.sql, /suggestion_key/);
assert.match(suppression.sql, /contact_blocked=true/);
assert.match(
  suggestionQuery.sql,
  /FROM graduation_orders[^]*?b\.archived_at IS NULL/,
  "archived graduation orders cannot produce suggestions",
);
seen.length = 0;
const summary: any = (await get(admin, ["summary"], "scope=mine")).data;
assert.equal(summary.summary.today, 2);
assert.equal(
  seen.length,
  1,
  "staff badge does not query customer projections/suggestions",
);
assert.ok(seen[0].params.includes(1));
seen.length = 0;
await get(admin, ["options"], "q=عميل");
assert.equal(seen.length, 2);
assert.match(
  seen[0].sql,
  /SELECT c.id,c.name,c.full_name,c.phone,c.avatar_url/,
);
assert.match(seen[0].sql, /LIMIT 30/);
assert.match(seen[1].sql, /LIMIT 200/);
assert.ok(
  seen.every(
    (q) => !/cash|payment|credit|balance|receivable|notes/.test(q.sql),
  ),
);
const wrongEmployee: any = (await get(staff, [], "employeeId=99")).data;
assert.deepEqual(
  wrongEmployee.suggestions,
  [],
  "employee filters cannot reveal suggestions outside the filtered assigned scope",
);
const picked: any = (await get(admin, ["options"], "q=عميل")).data;
assert.deepEqual(
  picked.customers.map((customer: any) => customer.name),
  ["اسم عميل قديم", "الاسم المختصر", "07702223344"],
  "picker prefers full_name, then name, then canonical phone",
);
assert.equal(
  (await get(staff, ["12", "customer"])).data.customer.name,
  "اسم العميل الكامل",
  "scoped customer preview preserves valid legacy full_name",
);
for (const phoneQuery of [
  "07701234567",
  "+9647701234567",
  "009647701234567",
  "٠٧٧٠ ١٢٣ ٤٥٦٧",
]) {
  seen.length = 0;
  await get(admin, [], new URLSearchParams({ q: phoneQuery }).toString());
  for (const query of seen.filter(
    (item) =>
      item.sql.includes("WHERE") &&
      (item.sql.includes("ORDER BY f.followup_at") ||
        item.sql.includes(" AS converted") ||
        item.sql.includes("source_candidates")),
  )) {
    assert.match(
      query.sql,
      /c\.full_name ILIKE/,
      "all scoped rows/counts/suggestions search legacy full_name",
    );
    assert.match(
      query.sql,
      /regexp_replace\(translate\(c\.phone/,
      "Iraqi phone formatting and Unicode digits are normalized for read comparison only",
    );
    assert.ok(
      query.params.includes("9647701234567") &&
        query.params.includes("07701234567") &&
        query.params.includes("009647701234567"),
    );
  }
  seen.length = 0;
  await get(
    admin,
    ["options"],
    new URLSearchParams({ q: phoneQuery }).toString(),
  );
  assert.match(seen[0].sql, /c\.full_name ILIKE/);
  assert.ok(seen[0].params.includes("9647701234567"));
}
console.log(
  "PASS customer followup reads: bounded SQL, scoped counts/suggestions, explicit occasions, minimal options and badge summary",
);
