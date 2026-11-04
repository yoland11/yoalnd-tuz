import assert from "node:assert/strict";
import { followupBookingPreset, followupBookingMetadata, recoveredFollowupBooking } from "../src/lib/customer-followup-booking";
import type { FollowupRow } from "../src/lib/customer-followups";

const row: FollowupRow = { id: 13, customer: { id: 17, name: "عميل عربي", phone: "9647701234567" }, serviceKey: "wedding", followupAt: "2026-11-03T10:00:00Z", status: "interested", employee: { id: 4, fullName: "موظف" }, note: "ملاحظة داخلية لا تنسخ إلى الحجز", completedAt: null, version: 0, contactBlocked: false, booking: null, createdAt: "2026-11-01T10:00:00Z" };
const preset = followupBookingPreset(row);
assert.deepEqual(preset.customer, row.customer);
assert.equal(preset.eventType, "زفاف");
assert.deepEqual(preset.departments, [], "occasion does not invent a kosha service or a sale");
assert.deepEqual(followupBookingPreset({ ...row, serviceKey: "photography" }).departments, ["photography"]);
assert.deepEqual(followupBookingPreset({ ...row, serviceKey: "printing" }).departments, [], "printing is not a Booking Center department");
assert.deepEqual(followupBookingPreset({ ...row, serviceKey: "album" }).departments, [], "album interest needs an actual service choice");
assert.deepEqual(followupBookingMetadata(row, 17), { customerFollowupId: 13, eventType: "زفاف" });
assert.throws(() => followupBookingMetadata(row, 18), /العميل/);
assert.ok(!JSON.stringify(preset).includes(row.note));
assert.deepEqual(recoveredFollowupBooking({ existingBooking: { source: "service", id: 31, number: "B-31", href: "https://untrusted.invalid" } }), { source: "service", id: 31, number: "B-31", href: "/admin/bookings/service/31" });
assert.equal(recoveredFollowupBooking({ existingBooking: { source: "unexpected", id: 31 } }), null);
assert.equal(recoveredFollowupBooking({ existingBooking: { source: "service", id: -1 } }), null);
console.log("PASS followup booking prefill: canonical locked customer, explicit occasion only, real departments, no copied private notes, mismatch rejection and safe original-booking recovery link");
