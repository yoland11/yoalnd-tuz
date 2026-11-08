/** Booking invoice lines: every part of the booking listed, and Σ lines − discount = the stored total. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildServiceBookingInvoice, INVOICE_GROUPS, lineTotal } from "../src/lib/booking-invoice-lines";

const balanced = (result: ReturnType<typeof buildServiceBookingInvoice>) => {
  const sum = Math.round(result.items.reduce((total, row) => total + lineTotal(row), 0) * 100) / 100;
  assert.equal(sum, result.subtotal, "subtotal is the sum of the lines");
  assert.equal(Math.round((result.subtotal - result.discount) * 100) / 100, result.total, "subtotal − discount = stored total");
};

// 1) A booking-centre booking with every kind of content.
const full = buildServiceBookingInvoice({
  total: 1_103_000,
  discount: 50_000,
  fields: {
    bookingCenterServices: [
      { type: "kosha", amount: 0, notes: "باقة جاهزة: الملكية" },
      { type: "sound", amount: 0 },
      { type: "flowers", amount: 60_000 },
      { type: "gifts", amount: 40_000 },
      { type: "photography", amount: 130_000, notes: "جلسة تصوير (داخلية · ألبوم)" },
      { type: "transportation", amount: 25_000 },
    ],
    koshaSelection: { mode: "package", id: 3, name: "الملكية", price: 500_000 },
    flowerItems: [{ productId: 1, name: "مسكة عروس", variantLabel: "أبيض", quantity: 2, unitPrice: 30_000 }],
    giftItems: [{ productId: 2, name: "توزيعات شوكولا", quantity: 100, unitPrice: 400 }],
    videoItems: [{ productId: 3, name: "فيديو كامل", quantity: 1, unitPrice: 100_000 }],
    photographyKinds: ["photo_session", "video", "aerial"],
    aerialPhotographyRequested: true,
    aerialPhotographyPrice: 30_000,
    soundItems: [
      { productId: 20, name: "سماعة كبيرة", quantity: 2, isAsset: true, source: "asset" },
      { productId: 21, name: "مايك لاسلكي", quantity: 1, isAsset: false, source: "store" },
    ],
  },
  transport: { mode: "ajn", fee: 25_000, inTotal: true },
  transportDescription: "كيا · 1234",
  serviceItems: [{ id: 7, productName: "ألبوم إضافي", unit: "قطعة", quantity: 1, unitPrice: 50_000, discount: 5_000 }],
  products: [
    { id: 9, productName: "شموع", variantLabel: "ذهبي", color: "ذهبي", quantity: 10, unitPrice: 3_000, discount: 0, status: "reserved" },
    { id: 10, productName: "منتج ملغى", quantity: 1, unitPrice: 99_999, discount: 0, status: "released" },
  ],
  assets: [{ productId: 20, name: "سماعة كبيرة", assetCode: "AJN-A000020", quantity: 2 }],
});
balanced(full);
const names = full.items.map((row) => row.productNameAr);
const priced = (name: string) => full.items.find((row) => row.productNameAr === name);
assert.ok(names.includes("الكوشة: الملكية") && names.includes("الصوت") && names.includes("التصوير"), "services in the base are listed");
assert.equal(priced("الكوشة: الملكية")?.included, true, "several base services share one base line");
const base = priced("المبلغ الأساسي المتفق عليه");
// 1,103,000 + 50,000 − (60,000 flowers + 40,000 gifts + 100,000 video + 30,000 aerial + 45,000 album + 30,000 candles + 25,000 transport)
assert.equal(base?.price, 823_000, "base = stored total + discount − every separately priced line");
assert.match(String(base?.description), /الكوشة: الملكية/);
assert.equal(priced("مسكة عروس")?.group, INVOICE_GROUPS.flowers);
assert.equal(priced("توزيعات شوكولا")?.price, 400, "gift unit price kept");
assert.equal(priced("فيديو كامل")?.group, INVOICE_GROUPS.photography);
assert.equal(priced("تصوير جوي")?.price, 30_000);
assert.equal(priced("ألبوم إضافي")?.discount, 5_000, "photography line discount kept");
assert.equal(priced("النقل بواسطة AJN")?.price, 25_000);
assert.equal(priced("النقل بواسطة AJN")?.description, "كيا · 1234");
assert.equal(priced("شموع")?.group, INVOICE_GROUPS.products);
assert.ok(!names.includes("منتج ملغى"), "released products are not on the invoice");
assert.equal(full.items.filter((row) => row.productNameAr === "سماعة كبيرة").length, 1, "a sound asset is listed once, as an asset");
assert.equal(priced("سماعة كبيرة")?.group, INVOICE_GROUPS.assets);
assert.equal(priced("مايك لاسلكي")?.includedLabel, "ضمن خدمة الصوت");
assert.equal(full.discount, 50_000);
// Groups print in one block each.
const order = full.items.map((row) => row.group).filter((group, index, all) => group !== all[index - 1]);
assert.equal(new Set(order).size, order.length, "each group is one contiguous block");

// 2) One base service carries the base price itself.
const kosha = buildServiceBookingInvoice({ total: 400_000, discount: 0, fields: { bookingCenterServices: [{ type: "kosha", amount: 0 }] }, transport: null });
balanced(kosha);
assert.equal(kosha.items.length, 1);
assert.equal(kosha.items[0].price, 400_000);
assert.equal(kosha.items[0].included, false);

// 3) A legacy booking (before the booking centre) lists its service at the total.
const legacy = buildServiceBookingInvoice({ total: 250_000, discount: 0, fields: {}, transport: null, serviceName: "تنسيق قاعة" });
balanced(legacy);
assert.equal(legacy.items[0].productNameAr, "تنسيق قاعة");
assert.equal(legacy.items[0].price, 250_000);

// 4) Lines priced above the stored total (discount given after they were added) show as discount.
const over = buildServiceBookingInvoice({ total: 100_000, discount: 0, fields: { bookingCenterServices: [{ type: "kosha", amount: 0 }] }, transport: null, products: [{ id: 1, productName: "ورد", quantity: 1, unitPrice: 120_000, discount: 0 }] });
balanced(over);
assert.equal(over.discount, 20_000);
assert.equal(over.items.find((row) => row.productNameAr === "الكوشة")?.included, true, "no negative base line");

// 5) Transport outside the total and transport on the customer never add money.
const outside = buildServiceBookingInvoice({ total: 300_000, discount: 0, fields: { bookingCenterServices: [{ type: "sound", amount: 0 }, { type: "transportation", amount: 0 }] }, transport: { mode: "ajn", fee: 20_000 } });
balanced(outside);
assert.equal(outside.items.find((row) => row.productNameAr === "النقل بواسطة AJN")?.includedLabel, "خارج الإجمالي");
assert.equal(outside.items.find((row) => row.productNameAr === "الصوت")?.price, 300_000);
const customer = buildServiceBookingInvoice({ total: 300_000, discount: 0, fields: { bookingCenterServices: [{ type: "transportation", amount: 0 }] }, transport: { mode: "customer" } });
balanced(customer);
assert.equal(customer.items.find((row) => row.productNameAr === "النقل")?.includedLabel, "على الزبون");

// 6) Wiring: the invoice API sends these lines and the page prints groups and «ضمن…».
const api = readFileSync("src/server/api.ts", "utf8");
assert.match(api, /const invoice = buildServiceBookingInvoice\(\{/);
assert.match(api, /invoiceSummary: \{ subtotal: invoice\.subtotal, discount: invoice\.discount, total: invoice\.total \}/);
assert.match(api, /bookingProductInvoiceLines\(await bookingOperationProducts\(koshaReference\)\)/);
const page = readFileSync("src/views/admin/invoice.tsx", "utf8");
assert.match(page, /className="wi-group"/);
assert.match(page, /item\.includedLabel/);
assert.match(page, /data\.invoiceSummary/);

console.log("PASS booking invoice lines: services, flowers, gifts, photography, store products, sound and assets listed once, grouped, and Σ lines − discount = the booking total");
