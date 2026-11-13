import assert from "node:assert/strict";
import * as React from "react";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as any).React = React;
const require = createRequire(import.meta.url);
require.extensions[".css"] = () => {};
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query") as typeof import("@tanstack/react-query");
const { UnifiedBookingForm, buildBookingReport } = await import("../src/views/admin/booking-center");
const base = { source: "service", id: 1, number: "AJN-1", customerName: "عميل زفاف", phone: "07701234567", eventDate: "2026-11-15", eventTime: "18:00", hall: "قاعة", status: "confirmed", total: 50000, paid: 10000, remaining: 40000, paymentStatus: "partial", services: [{ type: "photography", status: "waiting" }], raw: {} };
const rows: any[] = [
  { ...base, eventType: "زفاف" },
  { ...base, id: 2, number: "AJN-2", customerName: "عميل حنة", eventType: "henna" },
  { ...base, id: 3, number: "AJN-3", customerName: "عميل قديم بلا نوع", eventType: null },
  { ...base, id: 4, number: "AJN-4", customerName: "عميل مناسبة قديمة", eventType: "افتتاح <مميز>" },
  { ...base, id: 5, number: "AJN-5", customerName: "زفاف بقسم آخر", eventType: "wedding", services: [{ type: "sound", status: "waiting" }] },
  { ...base, id: 6, number: "AJN-6", customerName: "زفاف خارج الفترة", eventType: "عرس", eventDate: "2026-12-01" },
  { ...base, id: 7, number: "AJN-7", customerName: "زفاف ملغي", eventType: "wedding", status: "cancelled" },
];
const report = buildBookingReport({ type: "remaining", department: "photography", eventType: "wedding", from: "2026-11-01", to: "2026-11-30" }, rows);
assert.match(report, /نوع المناسبة/);
assert.match(report, /عميل زفاف/);
for (const excluded of ["عميل حنة", "عميل قديم بلا نوع", "عميل مناسبة قديمة", "زفاف بقسم آخر", "زفاف خارج الفترة", "زفاف ملغي"]) assert.ok(!report.includes(excluded), `composed occasion/department/date/status predicates must exclude ${excluded}`);
const all = buildBookingReport({ type: "summary", department: "all", eventType: "all", from: "", to: "" }, rows);
assert.match(all, /عميل قديم بلا نوع/);
assert.match(all, /غير محدد/);
assert.match(all, /افتتاح &lt;مميز&gt;/);
assert.doesNotMatch(all, /افتتاح <مميز>/);
const other = buildBookingReport({ type: "remaining", department: "all", eventType: "other", from: "", to: "" }, rows);
assert.match(other, /عميل مناسبة قديمة/);
assert.doesNotMatch(other, /عميل قديم بلا نوع|عميل زفاف/);

const services = [{ id: 8, name: "Photography", nameAr: "التصوير", type: "photography", isActive: true }];
const followup: any = { id: 11, serviceKey: "engagement", status: "new", customer: { id: 7, name: "عميل متابعة", fullName: "عميل متابعة", phone: "07701234567" } };
function form(props: Record<string, unknown>) {
  return renderToStaticMarkup(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><UnifiedBookingForm services={services as any} servicesLoading={false} servicesError="" onRetryServices={() => {}} customers={[]} onCancel={() => {}} onCreated={() => {}} {...props} /></QueryClientProvider>);
}
const preset = form({ followup });
assert.match(preset, /role="radiogroup"/);
assert.match(preset, /aria-required="true"/);
assert.match(preset, /value="engagement"[^>]*checked=""|checked=""[^>]*value="engagement"/);
assert.equal((preset.match(/type="radio"/g) ?? []).length, 6);
const add = form({ addTo: { id: 1, customerName: "قديم", phone: "07701234567", totalAmount: 50000, depositAmount: 10000, serviceType: "photography", customFields: { eventType: "افتتاح قديم", bookingCenterVersion: 1 }, serviceItems: [] } });
assert.doesNotMatch(add, /id="booking-event-type"|aria-required="true"/);
assert.match(add, /إضافة خدمات للحجز/);
console.log("PASS original Booking Center event UI: six required choices, followup preset, add-services preservation and printed occasion/department/date/status filters with accessible historical records");
