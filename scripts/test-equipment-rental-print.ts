import assert from "node:assert/strict";
import { equipmentRentalPrintHtml } from "../src/views/admin/equipment-rental-print";
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
