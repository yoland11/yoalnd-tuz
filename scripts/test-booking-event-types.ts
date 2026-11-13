import assert from "node:assert/strict";
import { BOOKING_EVENT_TYPES, normalizeBookingEventType, bookingEventTypeStorage, bookingEventTypeLabel, bookingEventTypeMatches, readBookingEventType, bookingGraduationHref } from "../src/lib/booking-event-types";

assert.equal(BOOKING_EVENT_TYPES.length, 6);
for (const type of BOOKING_EVENT_TYPES) {
  assert.equal(normalizeBookingEventType(type.key), type.key);
  assert.equal(normalizeBookingEventType(type.label), type.key);
  assert.equal(bookingEventTypeStorage(type.key), type.label);
}
for (const [value, expected] of [["زفاف", "wedding"], ["عرس", "wedding"], [" WEDDING ", "wedding"], ["خِطُوبة", "engagement"], ["ملكة", "engagement"], ["الحِنّة", "henna"], ["حناء", "henna"], ["عيد ميلاد", "birthday"], ["birthday_party", "birthday"], ["حفل تخرج", "graduation"], ["أخرى", "other"], ["مناسبه اخرى", "other"]]) {
  assert.equal(normalizeBookingEventType(value), expected, value);
}
for (const value of [null, undefined, "", "   ", false, 0, {}, "مؤتمر سنوي"]) assert.equal(normalizeBookingEventType(value), null);
assert.equal(bookingEventTypeStorage("other"), "مناسبة أخرى");
assert.equal(bookingEventTypeStorage("مؤتمر سنوي"), null);
assert.equal(bookingEventTypeLabel("مؤتمر سنوي"), "مؤتمر سنوي");
assert.equal(bookingEventTypeLabel(null), "غير محدد");
assert.equal(bookingEventTypeLabel(undefined, "كل المناسبات"), "كل المناسبات");
assert.ok(bookingEventTypeMatches(null, "all"));
assert.ok(!bookingEventTypeMatches(null, "other"));
assert.ok(bookingEventTypeMatches("مؤتمر سنوي", "other"));
assert.ok(bookingEventTypeMatches("عرس", "wedding"));
assert.ok(!bookingEventTypeMatches("حنة", "wedding"));
assert.equal(readBookingEventType("service", { customFields: { eventType: "حنة" }, eventType: "زفاف" }), "حنة");
assert.equal(readBookingEventType("kosha", { eventType: "خطوبة", bookingDetails: { eventType: "حنة" } }), "خطوبة");
assert.equal(readBookingEventType("service", { serviceType: "graduation", customFields: {} }), null);
assert.equal(readBookingEventType("service", { customFields: { bookingSource: "graduation", graduationOrderId: 12 } }), "تخرج");
assert.equal(readBookingEventType("service", { customFields: { graduationOrderId: 12 } }), null);
assert.equal(readBookingEventType("graduation", {}), "تخرج");
assert.equal(bookingGraduationHref({ customFields: { bookingSource: "graduation", graduationOrderId: 12 } }), "/admin/graduation/orders?order=12");
assert.equal(bookingGraduationHref({ customFields: { eventType: "تخرج" } }), "/admin/graduation/orders");
assert.equal(bookingGraduationHref({ customFields: { graduationOrderId: "12/evil" } }), "/admin/graduation/orders");
assert.equal(bookingGraduationHref({ customFields: { graduationOrderId: true } }), "/admin/graduation/orders");
assert.equal(bookingGraduationHref({ customFields: { graduationOrderId: 2147483648 } }), "/admin/graduation/orders");
console.log("PASS booking occasions: six choices, Arabic/English aliases, readable storage, legacy preservation, composed filters and stable graduation references");
