import assert from "node:assert/strict";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as calendar from "../src/views/admin/calendar";

// The page imports styles for the browser; Node only needs its route behavior.
const testRequire = createRequire(import.meta.url);
(testRequire as typeof testRequire & { extensions: Record<string, () => void> }).extensions[".css"] = () => {};
const bookingCenter = await import("../src/views/admin/booking-center");

const target = (calendar as typeof calendar & {
  calendarEventTarget?: (event: { kind: "service" | "kosha" | "order"; id: number }) => { href: string; label: string } | null;
}).calendarEventTarget;

assert.equal(typeof target, "function", "calendar events need a direct action for the selected record");

assert.deepEqual(target({ kind: "service", id: 103 }), {
  href: "/admin/bookings/service/103",
  label: "فتح الحجز",
}, "a service event opens its own booking, not the orders list");

assert.deepEqual(target({ kind: "kosha", id: 42 }), {
  href: "/admin/bookings/kosha/42",
  label: "فتح الحجز",
}, "a Kosha event opens its own booking");

assert.deepEqual(target({ kind: "order", id: 79 }), {
  href: "/admin/invoice/79",
  label: "فتح الفاتورة",
}, "a store order opens its own invoice");

assert.equal(target({ kind: "order", id: 0 }), null, "an invalid ID must not open an unrelated record");
assert.equal(target({ kind: "unknown" as "order", id: 79 }), null, "unknown event kinds must not open a store invoice");

const OpenButton = (calendar as typeof calendar & {
  CalendarEventOpenButton?: React.ComponentType<{ event: { kind: "service" | "kosha" | "order"; id: number } }>;
}).CalendarEventOpenButton;
assert.equal(typeof OpenButton, "function", "the calendar modal must render its direct action");
Object.assign(globalThis, { React });
const bookingButton = renderToStaticMarkup(React.createElement(OpenButton, { event: { kind: "service", id: 103 } }));
assert.match(bookingButton, /href="\/admin\/bookings\/service\/103"/, "the visible modal action must link to the selected booking");
assert.match(bookingButton, /فتح الحجز/, "the visible action must describe its destination");
const invoiceButton = renderToStaticMarkup(React.createElement(OpenButton, { event: { kind: "order", id: 79 } }));
assert.match(invoiceButton, /href="\/admin\/invoice\/79"/, "the visible modal action must link to the selected store invoice");

const workspacePath = (bookingCenter as typeof bookingCenter & {
  bookingWorkspacePath?: (source: "service" | "kosha", id: number) => string;
}).bookingWorkspacePath;
assert.equal(typeof workspacePath, "function", "booking details must load the exact record rather than a capped list");
assert.equal(workspacePath("service", 103), "/admin/booking-center/service/103");
assert.equal(workspacePath("kosha", 42), "/admin/kosha-bookings/42");

console.log("PASS: calendar actions target the selected booking or invoice.");
