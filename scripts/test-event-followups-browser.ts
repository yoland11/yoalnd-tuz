import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { startEventPreview } from "./preview-event-followups";
assert.ok(
  process.env.AJN_BROWSER_RUNTIME,
  "Set AJN_BROWSER_RUNTIME to installed Playwright package.json",
);
const { chromium } = createRequire(process.env.AJN_BROWSER_RUNTIME!)(
  "playwright",
);
const { server, origin } = await startEventPreview();
const output = ".next/event-followup-review";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.AJN_BROWSER_EXECUTABLE ||
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
});
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(e.message));
    page.setDefaultTimeout(10000);
    await page.goto(origin + "/admin/customer-followups");
    await page
      .getByRole("heading", { name: "متابعة المناسبات والإرسال الجماعي" })
      .waitFor();
    assert.equal(await page.locator("[data-followup-kpi]").count(), 6);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    await page.screenshot({
      path: `${output}/overview-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "المزيد لمتابعة أحمد علي — مثال" })
      .filter({ visible: true })
      .click();
    await page
      .getByRole("menuitem", { name: "عرض العميل", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByText("سجل المتابعة", { exact: true })
      .waitFor();
    await page.getByLabel("تاريخ المناسبة المتوقع").fill("2026-12-14");
    await page.getByLabel("ملاحظة الموظف").fill("يرغب بعرض حنة وزفاف");
    await page.screenshot({
      path: `${output}/customer-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "حفظ المتابعة والملاحظة" }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page
      .getByRole("button", { name: "إضافة متابعة", exact: true })
      .first()
      .click();
    await page
      .getByRole("dialog", { name: "إضافة متابعة", exact: true })
      .waitFor();
    await page.screenshot({
      path: `${output}/add-${width}.png`,
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    const booking = page
      .getByRole("link", { name: "إنشاء حجز", exact: true })
      .filter({ visible: true })
      .first();
    assert.ok((await booking.getAttribute("href"))?.includes("followup"));
    await page
      .getByRole("button", { name: "الحملات والإرسال الجماعي", exact: true })
      .click();
    await page
      .getByRole("button", { name: "إرسال واتساب جماعي", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "إرسال واتساب جماعي",
      exact: true,
    });
    await dialog
      .getByLabel("عنوان الحملة")
      .fill("متابعة دفعة الهندسة — معاينة");
    await dialog.getByLabel("مصدر المستلمين").selectOption("group");
    await dialog.getByRole("checkbox", { name: /اختيار حسين/ }).check();
    await dialog.getByLabel("قالب الرسالة").selectOption("graduation_details");
    await dialog
      .getByRole("button", { name: "معاينة الرسائل", exact: true })
      .click();
    await dialog.locator("[data-message-preview]").waitFor();
    assert.match(
      await dialog.locator("[data-message-preview]").innerText(),
      /دفعة الهندسة/,
    );
    assert.doesNotMatch(
      await dialog.locator("[data-message-preview]").innerText(),
      /نور أحمد/,
    );
    await page.screenshot({
      path: `${output}/campaign-preview-${width}.png`,
      fullPage: true,
    });
    await dialog
      .getByRole("button", { name: "حفظ وإرسال للموافقة", exact: true })
      .click();
    await page
      .getByRole("button", { name: "اعتماد الحملة", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "فتح رسالة هذا المستلم في واتساب" })
        .count(),
      0,
      "no manual open before manager approval",
    );
    await page
      .getByRole("button", { name: "اعتماد الحملة", exact: true })
      .click();
    await page
      .getByRole("button", { name: "فتح رسالة هذا المستلم في واتساب" })
      .waitFor();
    await page.screenshot({
      path: `${output}/approved-${width}.png`,
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      `PASS event followup ${width}px: dashboard, scoped customer history/edit, add form, canonical booking link, representative preview, approval gating, no page errors/overflow`,
    );
  }
} finally {
  await browser.close();
  await new Promise<void>((done, reject) =>
    server.close((e) => (e ? reject(e) : done())),
  );
}
