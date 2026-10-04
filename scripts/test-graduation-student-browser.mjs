// Browser-only fixtures: intercept ALL API calls; never write to any database.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { DEFAULT_GRADUATION_CONFIG } from "../src/lib/graduation.ts";
const runtime = process.env.AJN_BROWSER_RUNTIME;
if (!runtime)
  throw new Error("Set AJN_BROWSER_RUNTIME to a package.json with Playwright.");
const { chromium } = createRequire(runtime)("playwright");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.AJN_BROWSER_CHANNEL
    ? { channel: process.env.AJN_BROWSER_CHANNEL }
    : {}),
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const submitted = [];
let rejectNext = true;
let catalogFails = true;
let loseResponse = true;
const savedByKey = new Map();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.route("**/api/**", async (route) => {
  const path = new URL(route.request().url()).pathname;
  let payload = {};
  let status = 200;
  if (path === "/api/graduation/config")
    payload = { ...DEFAULT_GRADUATION_CONFIG, aiAvailable: false };
  else if (path.includes("/photography-services")) payload = { services: [] };
  else if (path.includes("/photographers")) payload = { photographers: [] };
  else if (path.includes("/graduation/groups/"))
    payload = {
      group: {
        title: "دفعة الاختبار",
        groupNo: "GRP-TEST",
        department: "الحاسبات",
        defaultConfiguration: {
          styleKey: "standard",
          fabric: { key: "standard" },
          colors: { robe: "#111111", sash: "#182539", embroidery: "#D4AF37" },
          customText: { sashNamePrefix: "المهندس" },
        },
      },
    };
  else if (path.includes("/designer-catalog")) {
    if (catalogFails) {
      status = 503;
      payload = { error: "catalog unavailable" };
    } else
      payload = {
        products: [
          {
            id: 10,
            nameAr: "مسكة اختبار",
            name: "bouquet",
            images: [],
            price: 1000,
            designerSection: "bridal_bouquets",
            stock: 10,
            variants: [],
          },
        ],
      };
  } else if (path === "/api/graduation/orders") {
    const body = route.request().postDataJSON();
    assert.ok(route.request().headers()["x-idempotency-key"]);
    if (rejectNext) {
      rejectNext = false;
      status = 400;
      payload = { error: "خطأ اختباري في الحفظ" };
    } else {
      const key = route.request().headers()["x-idempotency-key"];
      if (savedByKey.has(key)) {
        assert.equal(
          savedByKey.get(key).body,
          route.request().postData(),
          "retry must retain exact payload",
        );
        payload = savedByKey.get(key).result;
      } else {
        submitted.push(body);
        payload = {
          warning: "تنبيه اختباري: راجع موعد التصوير",
          order: {
            ...body,
            id: submitted.length,
            orderNo: `TEST-${submitted.length}`,
            trackingUrl: `/graduation/track/test-${submitted.length}`,
            totalAmount: 1000,
          },
        };
        savedByKey.set(key, {
          body: route.request().postData(),
          result: payload,
        });
        if (loseResponse) {
          loseResponse = false;
          await route.abort("failed");
          return;
        }
      }
    }
  } else if (path.includes("/media"))
    payload = { items: [], media: [], categories: [] };
  else if (path.includes("/auth") || path.includes("/customer/me")) {
    status = 401;
    payload = { error: "not authenticated" };
  }
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
});
try {
  await page.goto(
    `${process.env.AJN_BROWSER_ORIGIN || "http://127.0.0.1:3105"}/graduation?group=fixture-students`,
    { waitUntil: "domcontentloaded" },
  );
  assert.equal(await page.getByLabel("الكنية الثابتة لجميع الطلبة").isVisible(), true);
  await page.getByText("معاينة الاسم: المهندس محمد علي", { exact: true }).waitFor();
  await page.getByLabel("الاسم الكامل *", { exact: true }).fill("علي أحمد");
  await page.getByLabel("رقم الهاتف *", { exact: true }).fill("07712345678");
  await page.getByRole("button", { name: "التالي", exact: true }).click();
  await page.getByRole("button", { name: "ملكي", exact: true }).click();
  const sashModels = page.getByRole("group", { name: "نماذج الوشاح ملكي" });
  await sashModels.waitFor();
  assert.equal(await sashModels.getByText("أمام", { exact: true }).count(), 1);
  assert.equal(await sashModels.getByText("خلف", { exact: true }).count(), 1);
  assert.equal(
    await page.getByRole("button", { name: "ملكي", exact: true }).getAttribute("aria-pressed"),
    "true",
  );
  await page
    .getByRole("alert")
    .filter({ hasText: "تعذر تحميل الورود" })
    .waitFor();
  assert.equal(
    await page.getByText("لا توجد ورود أو مسكات متاحة حالياً.").count(),
    0,
  );
  catalogFails = false;
  await page
    .getByRole("button", { name: "إعادة المحاولة", exact: true })
    .click();
  await page.getByRole("button", { name: "إضافة", exact: true }).click();
  await page.getByRole("button", { name: "التالي", exact: true }).click();
  await page.getByText("أدخل قياساتك بالتفصيل (اختياري)", { exact: true }).click();
  await page.getByRole("button", { name: "XS", exact: true }).click();
  await page.getByRole("button", { name: "التالي", exact: true }).click();
  await page.getByLabel("اكتب اسمك", { exact: true }).fill("علي");
  await page.getByText("الاسم على الوشاح: المهندس علي", { exact: true }).waitFor();
  await page.getByLabel("الخط", { exact: true }).selectOption("thuluth");
  assert.equal(await page.getByLabel("لون الوشاح", { exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "فضي", exact: true }).count(), 0);
  await page.getByRole("button", { name: "فوق القبعة", exact: true }).click();
  await page.getByLabel("ملاحظة على الصورة أو الموضع", { exact: false }).fill("ثبّت الزهرة في الأعلى");
  await page.getByLabel("صورة مرجعية (اختياري)").setInputFiles({
    name: "cap.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==", "base64"),
  });
  await page.getByRole("img", { name: "معاينة الصورة المرجعية" }).waitFor();
  await page.getByRole("button", { name: "خلف الوشاح", exact: true }).click();
  await page.getByLabel("ملاحظة على الصورة أو الموضع", { exact: false }).fill("خلف الوشاح فقط");
  await page.getByLabel("صورة مرجعية (اختياري)").setInputFiles({
    name: "back.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==", "base64"),
  });
  await page.getByRole("button", { name: /^فوق القبعة/ }).click();
  assert.equal(await page.getByLabel("ملاحظة على الصورة أو الموضع", { exact: false }).inputValue(), "ثبّت الزهرة في الأعلى");
  await page.evaluate(() => document.fonts.ready);
  await page
    .getByRole("img", { name: /^معاينة الوشاح ملكي:/ })
    .screenshot({ path: "tmp/graduation-sash-preview.png" });
  await page.screenshot({
    path: "tmp/graduation-student-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
    "mobile must not overflow",
  );
  await page
    .getByRole("button", { name: "إضافة طالب آخر", exact: true })
    .click();
  await page.getByRole("alert").filter({ hasText: "خطأ اختباري" }).waitFor();
  assert.equal(
    await page.getByLabel("اكتب اسمك", { exact: true }).inputValue(),
    "عَلِيّ",
  );
  assert.equal(submitted.length, 0, "failed save must not advance");
  await page
    .getByRole("button", { name: "إضافة طالب آخر", exact: true })
    .click();
  await page.getByText("لم يتأكد الحفظ بعد.", { exact: false }).waitFor();
  await page.reload();
  await page.getByText("لم يتأكد الحفظ بعد.", { exact: false }).waitFor();
  assert.equal(
    await page.getByLabel("اكتب اسمك", { exact: true }).isDisabled(),
    true,
  );
  await page
    .getByRole("button", { name: "إضافة طالب آخر", exact: true })
    .click();
  await page.getByLabel("الاسم الكامل *", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("الاسم الكامل *", { exact: true }).inputValue(),
    "",
  );
  assert.equal(submitted[0].groupToken, "fixture-students");
  assert.equal(submitted[0].customText.sashType, "royal");
  assert.equal(submitted[0].customText.font, "thuluth");
  assert.equal(submitted[0].colors.sash, "#182539");
  assert.equal(submitted[0].colors.embroidery, "#D4AF37");
  assert.equal(submitted[0].studentReferences.length, 2);
  assert.equal(submitted[0].studentReferences[0].placement, "cap_top");
  assert.equal(submitted[0].studentReferences[0].note, "ثبّت الزهرة في الأعلى");
  assert.ok(submitted[0].studentReferences[0].imageData.startsWith("data:image/"));
  assert.equal(submitted[0].studentReferences[1].placement, "sash_back");
  assert.equal(submitted[0].studentReferences[1].note, "خلف الوشاح فقط");
  assert.equal(submitted[0].extras.flowers[0].productId, 10);
  assert.equal(submitted[0].measurements.readySize, "XS");
  await page.getByLabel("الاسم الكامل *", { exact: true }).fill("زينب حسن");
  await page.getByLabel("رقم الهاتف *", { exact: true }).fill("07712345679");
  await page.getByRole("button", { name: "التالي", exact: true }).click();
  assert.equal(
    await page.getByLabel("كمية مسكة اختبار").count(),
    0,
    "new student must not inherit extras",
  );
  await page.getByRole("button", { name: "التالي", exact: true }).click();
  await page.getByText("أدخل قياساتك بالتفصيل (اختياري)", { exact: true }).click();
  assert.equal(
    await page.getByLabel("مقاس البدن (أو اكتب رقم مقاسك)").inputValue(),
    "",
  );
  await page.getByRole("button", { name: "نسائي", exact: true }).click();
  await page.getByRole("button", { name: "التالي", exact: true }).click();
  assert.equal(
    await page.getByLabel("اكتب اسمك", { exact: true }).inputValue(),
    "",
  );
  await page.getByRole("button", { name: "اكتمال", exact: true }).click();
  await page.getByRole("heading", { name: "اكتمل تسجيل الطلبات" }).waitFor();
  assert.equal(submitted.length, 2);
  assert.equal(submitted[1].customerName, "زينب حسن");
  assert.equal(submitted[1].measurements.gender, "female");
  assert.equal(submitted[1].studentReferences, undefined, "the next student must not inherit reference images or notes");
  await page.reload();
  await page.getByRole("heading", { name: "اكتمل تسجيل الطلبات" }).waitFor();
  assert.equal(
    await page.getByRole("link", { name: /TEST-.*متابعة الطلب/ }).count(),
    2,
  );
  assert.equal(submitted.length, 2, "reload must not resubmit");
  await page
    .getByRole("status")
    .filter({ hasText: "تنبيه اختباري" })
    .first()
    .waitFor();
  // The individual configurator uses the same wizard after its design steps.
  await page.goto(
    `${process.env.AJN_BROWSER_ORIGIN || "http://127.0.0.1:3105"}/graduation`,
  );
  await page.getByRole("button", { name: /طلب فردي/ }).click();
  for (let index = 0; index < 10; index++)
    await page
      .getByRole("button", { name: "التالي", exact: true })
      .first()
      .click();
  await page.getByLabel("الاسم الكامل *", { exact: true }).fill("طالب فردي");
  await page.getByLabel("رقم الهاتف *", { exact: true }).fill("07712345678");
  for (let index = 0; index < 3; index++)
    await page.getByRole("button", { name: "التالي", exact: true }).click();
  await page.getByRole("button", { name: "اكتمال", exact: true }).click();
  await page.getByRole("heading", { name: "اكتمل تسجيل الطلبات" }).waitFor();
  assert.equal(submitted.length, 3);
  assert.equal(submitted[2].groupToken, "");
  assert.deepEqual(errors, []);
  console.log(
    "PASS mobile, catalog failure, save failure, two students, customization, reset, receipts and reload. No database writes.",
  );
} finally {
  await browser.close();
}
