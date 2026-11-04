import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
const { QueryClient, QueryClientProvider } = createRequire(import.meta.url)(
  "@tanstack/react-query",
) as typeof import("@tanstack/react-query");
import * as pageModule from "../src/views/admin/customer-followups";
const CustomerFollowupsPage = ((pageModule as any).default?.default ??
  (pageModule as any).default) as React.ComponentType<{
  mode: "admin" | "staff";
}>;
(globalThis as any).React = React;

assert.ok(
  existsSync("src/views/admin/customer-followups.tsx"),
  "the shared customer followup page exists",
);

const row = {
  id: 17,
  customer: { id: 9, name: "أحمد علي", phone: "07701234567" },
  serviceKey: "photography",
  followupAt: "2026-11-03T09:00:00.000Z",
  status: "interested",
  employee: { id: 7, fullName: "زينب كريم" },
  note: "يرغب بتصوير المناسبة",
  completedAt: null,
  version: 1,
  contactBlocked: false,
  booking: null,
  createdAt: "2026-11-01T09:00:00.000Z",
};
const payload = {
  rows: [row],
  summary: {
    today: 2,
    overdue: 3,
    upcoming: 4,
    converted: 1,
    total: 10,
    completed: 5,
  },
  suggestions: [],
  page: 1,
  pageSize: 25,
  total: 1,
  capabilities: {
    canManage: true,
    canCreate: true,
    canBook: true,
    canCreateCustomer: true,
    canOpenCustomer: true,
  },
};
function render(
  data: any = payload,
  mode: "admin" | "staff" = "admin",
  state: "data" | "error" | "loading" = "data",
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const params = new URLSearchParams({ page: "1", pageSize: "25" });
  if (mode === "staff") params.set("scope", "mine");
  const key = ["customer-followups", mode, params.toString()];
  if (state === "data") client.setQueryData(key, data);
  if (state === "error")
    client
      .getQueryCache()
      .build(client, { queryKey: key })
      .setState({
        status: "error",
        fetchStatus: "idle",
        error: new Error("تعذر الاتصال بالخادم — REQ-TEST"),
      });
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(CustomerFollowupsPage, { mode }),
    ),
  );
}
const html = render();
for (const label of [
  "متابعة العملاء",
  "اليوم",
  "المتأخرة",
  "القادمة",
  "تحولت إلى حجز",
  "أحمد علي",
  "زينب كريم",
  "التصوير",
  "إكمال",
  "حالة الاستفسار",
  "الموظف المسؤول",
  "ملخص المتابعة",
])
  assert.ok(html.includes(label), `page displays ${label}`);
assert.equal(
  (html.match(/data-followup-kpi=/g) ?? []).length,
  4,
  "exactly four compact KPI controls",
);
assert.equal(
  (html.match(/<th scope="col"/g) ?? []).length,
  7,
  "assignment remains a secondary row action without extra columns",
);
assert.match(html, /dir="rtl"/);
assert.match(
  html,
  /href="https:\/\/wa.me\/9647701234567\?text=/,
  "manual WhatsApp has a prepared message",
);
assert.match(html, /href="tel:\+9647701234567"/);
assert.match(
  html,
  /href="\/admin\/bookings\?followup=17"/,
  "conversion opens original booking form",
);
assert.match(html, /data-followup-layout="table"/);
assert.match(
  html,
  /data-followup-layout="cards"/,
  "phone layout contains equivalent records",
);
assert.ok(
  !html.includes("إيقاف كل المتابعات"),
  "declining a service is never presented as global consent",
);
const restricted = render(
  {
    ...payload,
    capabilities: {
      canManage: false,
      canCreate: false,
      canBook: false,
      canCreateCustomer: false,
      canOpenCustomer: true,
    },
  },
  "staff",
);
assert.ok(
  !restricted.includes("إضافة متابعة"),
  "staff without create permission cannot globally create",
);
assert.ok(
  !restricted.includes("/admin/bookings?followup="),
  "booking capability is required",
);
const blocked = render({
  ...payload,
  rows: [{ ...row, contactBlocked: true }],
});
assert.ok(
  !blocked.includes("https://wa.me/") && !blocked.includes('href="tel:'),
  "global contact stop suppresses phone and WhatsApp links",
);
const error = render(null, "admin", "error");
assert.ok(
  error.includes("تعذر الاتصال بالخادم") && error.includes("REQ-TEST"),
  "real API errors and request IDs stay visible",
);
assert.ok(
  !error.includes("لا توجد متابعات"),
  "a failed request never becomes an empty state",
);
assert.equal(
  (error.match(/data-followup-kpi=/g) ?? []).length,
  0,
  "failed queries never fabricate zero KPIs",
);
assert.match(
  render(null, "admin", "loading"),
  /aria-busy="true"/,
  "loading state is explicit",
);
assert.ok(
  render({ ...payload, rows: [], total: 0 }).includes("لا توجد متابعات"),
  "successful empty state is distinct",
);
console.log(
  "PASS customer followup UI: four KPIs, responsive records, scoped capabilities, contact block, real errors, loading and empty states",
);
