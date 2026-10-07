import assert from "node:assert/strict";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as calendar from "../src/views/admin/calendar";

// The page imports styles for the browser; Node only needs its route behavior.
const testRequire = createRequire(import.meta.url);
(testRequire as typeof testRequire & { extensions: Record<string, () => void> }).extensions[".css"] = () => {};
const bookingCenter = await import("../src/views/admin/booking-center");
const adminIndex = await import("../src/views/admin/index");

const target = (calendar as typeof calendar & {
  calendarEventTarget?: (event: { kind: "service" | "kosha" | "order"; id: number }) => { href: string; label: string } | null;
}).calendarEventTarget;

assert.equal(typeof target, "function", "calendar events need a direct action for the selected record");

assert.deepEqual(target({ kind: "service", id: 103 }), {
  href: "/admin/invoice/103?type=booking",
  label: "فتح الفاتورة",
}, "a service event opens the A4 invoice for that exact service order");

assert.deepEqual(target({ kind: "kosha", id: 42 }), {
  href: "/admin/invoice/42?type=kosha",
  label: "فتح الفاتورة",
}, "a Kosha event opens the invoice for that exact Kosha booking");

assert.deepEqual(target({ kind: "order", id: 79 }), {
  href: "/admin/invoice/79",
  label: "فتح الفاتورة",
}, "a store order opens its own invoice");

assert.equal(target({ kind: "order", id: 0 }), null, "an invalid ID must not open an unrelated record");
assert.equal(target({ kind: "unknown" as "order", id: 79 }), null, "unknown event kinds must not open a store invoice");

const OpenButton = (calendar as typeof calendar & {
  CalendarEventOpenButton?: React.ComponentType<{ event: { kind: "service" | "kosha" | "order"; id: number }; canViewInvoices: boolean }>;
}).CalendarEventOpenButton;
assert.equal(typeof OpenButton, "function", "the calendar modal must render its direct action");
Object.assign(globalThis, { React });
const bookingButton = renderToStaticMarkup(React.createElement(OpenButton, { event: { kind: "service", id: 103 }, canViewInvoices: true }));
assert.match(bookingButton, /href="\/admin\/invoice\/103\?type=booking"/, "the visible modal action must link to the selected service invoice");
assert.match(bookingButton, /فتح الفاتورة/, "the visible action must describe its destination");
const koshaButton = renderToStaticMarkup(React.createElement(OpenButton, { event: { kind: "kosha", id: 42 }, canViewInvoices: false }));
assert.match(koshaButton, /href="\/admin\/invoice\/42\?type=kosha"/, "the visible modal action must link to the selected Kosha invoice");
const invoiceButton = renderToStaticMarkup(React.createElement(OpenButton, { event: { kind: "order", id: 79 }, canViewInvoices: true }));
assert.match(invoiceButton, /href="\/admin\/invoice\/79"/, "the visible modal action must link to the selected store invoice");
const restrictedBookingButton = renderToStaticMarkup(React.createElement(OpenButton, { event: { kind: "service", id: 103 }, canViewInvoices: false }));
assert.doesNotMatch(restrictedBookingButton, /href=/, "an orders-only user must not be sent to an invoice they cannot view");
assert.match(restrictedBookingButton, /disabled/, "the missing invoice permission should be visible in the calendar");
assert.match(restrictedBookingButton, /صلاحية الفواتير/, "the disabled action should explain the missing permission");
const restrictedStoreButton = renderToStaticMarkup(React.createElement(OpenButton, { event: { kind: "order", id: 79 }, canViewInvoices: false }));
assert.doesNotMatch(restrictedStoreButton, /href=/, "store invoices also require the invoices permission");

const workspacePath = (bookingCenter as typeof bookingCenter & {
  bookingWorkspacePath?: (source: "service" | "kosha", id: number) => string;
}).bookingWorkspacePath;
assert.equal(typeof workspacePath, "function", "booking details must load the exact record rather than a capped list");
assert.equal(workspacePath("service", 103), "/admin/booking-center/service/103");
assert.equal(workspacePath("kosha", 42), "/admin/kosha-bookings/42");

const invoicePermission = (adminIndex as typeof adminIndex & {
  invoiceRoutePermission?: (type: string | null) => "orders" | "invoices";
}).invoiceRoutePermission;
assert.equal(typeof invoicePermission, "function", "Kosha invoices need the same route permission as their existing API");
assert.equal(invoicePermission("kosha"), "orders", "Kosha invoice access follows the existing orders permission");
assert.equal(invoicePermission("booking"), "invoices", "service invoices keep their existing invoices permission");
assert.equal(invoicePermission(null), "invoices", "store invoices keep their existing invoices permission");

console.log("PASS: calendar actions target the selected booking or invoice.");
