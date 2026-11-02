import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as any).React = React;
const { initialVehicleTab, vehicleTabHref, VehicleAccountNavigation } = await import("../src/views/admin/vehicles");

assert.equal(initialVehicleTab(""), "trips", "daily trips are the default");
assert.equal(initialVehicleTab("?tab=unknown"), "trips");
for (const tab of ["trips", "expenses", "partnership", "overview", "maintenance", "history"] as const) {
  assert.equal(initialVehicleTab(`?tab=${tab}&partnershipTab=monthly`), tab, "existing deep links stay reachable");
  const html = renderToStaticMarkup(<VehicleAccountNavigation tab={tab} onChange={() => {}} />);
  assert.match(html, /التنقل اليومي للمركبة/);
  const primary = html.split('<details')[0];
  assert.equal((primary.match(/<button/g) ?? []).length, 3, "only daily actions occupy the primary row");
  for (const title of ["الرحلات", "المصاريف", "الشراكة والأرباح", "تفاصيل متقدمة", "بيانات السيارة", "الصيانة", "سجل العداد"]) assert.ok(html.includes(title), title);
  assert.equal(/<details[^>]*\bopen=""/.test(html), ["overview", "maintenance", "history"].includes(tab), "requested advanced views reveal their navigation");
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
}
const href = vehicleTabHref("/admin/vehicles/6", "?tab=partnership&partnershipTab=monthly&from=2026-10-01&to=2026-10-31", "expenses");
const params = new URL(href, "http://localhost").searchParams;
assert.equal(params.get("tab"), "expenses");
assert.equal(params.get("partnershipTab"), "monthly");
assert.equal(params.get("from"), "2026-10-01");
assert.equal(params.get("to"), "2026-10-31");
console.log("PASS simplified vehicle navigation: daily actions, all legacy views, advanced deep links and preserved query parameters");
