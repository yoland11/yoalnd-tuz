import assert from "node:assert/strict";
import { equipmentRentalDispatchPrintHtml, equipmentRentalPrintHtml, equipmentRentalReturnPrintHtml } from "../src/views/admin/equipment-rental-print";
const row: any = { orderNo: "RNT-2035-000001", customerName: '<script>alert("x")</script>', phone: "07700000123", startDate: "2035-01-01", endDate: "2035-01-02", status: "confirmed", total: 500000, paid: 200000, remaining: 300000, finance: { depositHeld: 100000 }, details: { address: "بغداد", startTime: "10:00", endTime: "20:00", deliveryCharge: 0, installationCharge: 0, discount: 0, depositRequired: 100000, terms: '<img src=x onerror="alert(1)">', assets: [{ name: "كرسي ملكي", code: "A-1", warehouseId: 2, quantity: 20, duration: 2, unitPrice: 12500, discount: 0, lineTotal: 500000 }] } };
for (const size of ["A4", "80mm"] as const) {
  const html = equipmentRentalPrintHtml(row, { site_name: "AJN", phone: "07700000000" }, size);
  assert.ok(html.includes('dir="rtl"')); assert.ok(html.includes("RNT-2035-000001"));
  assert.ok(html.includes("500,000")); assert.ok(html.includes("200,000")); assert.ok(html.includes("300,000")); assert.ok(html.includes("100,000"));
  assert.ok(html.includes("التأمين المسترد التزام مستقل"));
  assert.ok(html.includes("&lt;script&gt;")); assert.ok(!html.includes('<script>alert'));
  assert.ok(!html.includes('<img src=x')); assert.ok(html.includes("توقيع العميل"));
  if (size === "80mm") { assert.ok(html.includes('<th colspan="2">المعدات</th>')); assert.ok(!html.includes("<th>سعر الوحدة</th>"), "thermal document uses compact lines rather than a six-column A4 table"); }
  assert.ok(size === "A4" ? html.includes("size:A4") : html.includes("80mm"));
}
console.log("PASS rental A4/80mm documents: original totals/deposit separation, conditions, signatures and escaped user text.");

const returnHtml = equipmentRentalReturnPrintHtml(row, {
  requestId: "test-return-request", returnedAt: "2026-11-05T07:05:00.000Z", recordedAt: "2026-11-05T07:06:00.000Z",
  actorId: 4, actorName: "موظف الاختبار", note: "<script>bad()</script>",
  lines: [{ productId: 1, name: "كرسي ملكي", code: "A-1", warehouseId: 2, warehouseName: "المخزن الثاني",
    receivingEmployeeId: 4, receivingEmployeeName: "موظف الاستلام", dispatched: 10, previouslyReturned: 2, previouslyMissing: 0,
    outstandingBefore: 8, outstandingAfter: 1, good: 4, damaged: 1, missing: 1, pending: 1, lossApproved: true }],
}, { site_name: "AJN" });
assert.match(returnHtml, /dir="rtl"/);
assert.match(returnHtml, /@page\{size:A4/);
assert.match(returnHtml, /سند استرجاع معدات/);
assert.match(returnHtml, /المخزن الثاني/);
assert.match(returnHtml, /موظف الاستلام/);
assert.match(returnHtml, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
assert.doesNotMatch(returnHtml, /<script|500,000|200,000/);
console.log("PASS A4 equipment return receipt: receiver, warehouse, return conditions, RTL and escaped history.");

const dispatchHtml = equipmentRentalDispatchPrintHtml(row, {
  requestId: "test-dispatch-request", dispatchedAt: "2026-11-05T07:05:00.000Z", recordedAt: "2026-11-05T07:06:00.000Z",
  actorId: 4, actorName: "موظف الاختبار", note: "<script>bad()</script>",
  lines: [{ productId: 1, name: "كرسي ملكي", code: "A-1", employeeId: 4, employeeName: "موظف التسليم",
    quantity: 5, remaining: 2, warehouses: [{ warehouseId: 2, name: "المخزن الثاني", quantity: 5 }] }],
}, { site_name: "AJN" });
assert.match(dispatchHtml, /dir="rtl"/);
assert.match(dispatchHtml, /@page\{size:A4/);
assert.match(dispatchHtml, /سند تسليم معدات/);
assert.match(dispatchHtml, /المخزن الثاني × <bdi>5<\/bdi>/);
assert.match(dispatchHtml, /موظف التسليم/);
assert.match(dispatchHtml, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
assert.doesNotMatch(dispatchHtml, /<script|500,000|200,000/);
console.log("PASS A4 equipment dispatch receipt: original source and quantity, staff, RTL and escaped history.");
