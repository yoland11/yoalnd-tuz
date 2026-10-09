import assert from "node:assert/strict";

const modulePath = "../src/lib/preparation-thermal-print";
const moduleUnderTest: any = await import(modulePath).catch(() => ({}));
assert.equal(typeof moduleUnderTest.buildPreparationThermalHtml, "function", "80mm preparation printer must exist");
const buildPreparationThermalHtml = moduleUnderTest.buildPreparationThermalHtml as (input: any) => string;

const html = buildPreparationThermalHtml({
  bookingNumber: "AJN-1042",
  customerName: "اسم عربي طويل جداً للتأكد من التفاف النص <script>alert(1)</script>",
  eventDate: "2026-10-08",
  location: "قاعة الزهور",
  items: [
    {
      department: "الزهور",
      name: "ورد أبيض كبير",
      required: 4,
      available: 2,
      status: "ناقص",
      assigneeName: "أحمد علي",
      note: "تأكيد العدد قبل التحميل",
    },
  ],
});

assert.match(html, /@page\s*\{\s*size:\s*80mm auto/);
const receiptWidth = Number(html.match(/\.receipt\s*\{[^}]*\bwidth:\s*([\d.]+)mm/)?.[1]);
assert.ok(Number.isFinite(receiptWidth), "thermal receipt must define its printable content width");
assert.ok(receiptWidth <= 68, "80mm paper needs at least 6mm safety space on each side");
assert.match(html, /AJN-1042/);
assert.match(html, /ورد أبيض كبير/);
assert.match(html, /الكمية المطلوبة[^<]*<\/span>\s*<b[^>]*>4<\/b>/);
assert.match(html, /المتاح[^<]*<\/span>\s*<b[^>]*>2<\/b>/);
assert.match(html, /أحمد علي/);
assert.match(html, /overflow-wrap:\s*anywhere/);
assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
assert.doesNotMatch(html, /المبلغ|الإجمالي|المدفوع|المتبقي/);

const empty = buildPreparationThermalHtml({
  bookingNumber: "AJN-EMPTY",
  customerName: "عميل",
  eventDate: null,
  location: null,
  items: [],
});
assert.match(empty, /لا توجد عناصر تجهيز/);
assert.match(empty, /الموعد غير محدد/);

console.log("Preparation 80mm print composition verified.");
