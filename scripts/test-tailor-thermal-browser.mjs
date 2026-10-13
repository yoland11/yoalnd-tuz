// Synthetic print-only fixtures: no API, database, customer data or physical printing.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import ts from "typescript";

const require = createRequire(import.meta.url);
if (!process.env.AJN_BROWSER_RUNTIME) throw new Error("Set AJN_BROWSER_RUNTIME to a Playwright-enabled package.json.");
const { chromium } = createRequire(process.env.AJN_BROWSER_RUNTIME)("playwright");
const module = { exports: {} };
const compiled = ts.transpileModule(readFileSync("src/lib/graduation-receipt-print.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
new Function("require", "module", "exports", "document", "XMLSerializer", compiled)(
  (name) => name === "@/lib/money" ? { formatCurrency: String } : name === "jsbarcode" ? () => {} : require(name),
  module, module.exports, { createElementNS: () => ({}) },
  class { serializeToString() { return '<svg xmlns="http://www.w3.org/2000/svg" width="230" height="34"><path d="M0 0h230v34H0z"/></svg>'; } },
);
const output = "tmp/tailor-thermal-browser";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.AJN_BROWSER_CHANNEL || "msedge" });
try {
  for (const kind of ["measurements", "production"]) {
    for (const format of ["80mm", "a5"]) {
      let html = "";
      await module.exports.printTailorSheet({ document: { open() {}, write(value) { html = value; }, close() {} } }, {
        kind, format,
        brand: { logo: "", company: "مجموعة علي جان نهاد", phone: "07700000000", address: "طوزخورماتو — عنوان الورشة" },
        student: { name: "محمد عبد الرحمن علي أحمد", studentCode: "AJN-GROUP-2027-0009-0075", trackingUrl: "https://example.invalid/student/75" },
        info: [
          { label: "المجموعة", value: "دفعة كلية التربية للعلوم الصرفة المسائية" },
          { label: "سنة التخرج", value: "2027" }, { label: "الجامعة", value: "جامعة تكريت" },
          { label: "الكلية", value: "كلية التربية للعلوم الصرفة" }, { label: "القسم", value: "قسم الفيزياء المسائي" },
          { label: "الخياط", value: "خياط الاختبار" }, { label: "موعد التسليم", value: "2026-12-25" },
        ],
        garment: [
          { label: "الروب / الموديل", value: "روب تخرج أمريكي — نموذج معتمد" },
          { label: "الاسم على الوشاح", value: "المهندس محمد عبد الرحمن علي أحمد" },
          { label: "القبعة", value: "قبعة تخرج" }, { label: "المقاس النهائي", value: "XL" },
          { label: "لون الروب", value: "أسود" }, { label: "لون الوشاح", value: "عنابي" },
        ],
        measurements: ["طول روب", "طول وشاح", "طول ردن", "خلف الوشاح الأمريكي", "عرض الكتف", "قياس قبعة", "المقاس المثالي", "المقاس النهائي", "الطول", "الوزن", "الصدر", "الخصر"].map((label, i) => ({ label, value: i === 6 ? "XL" : i === 7 ? "—" : String(50 + i) })),
        stage: "جاري التفصيل",
        alterations: [{ type: "تقصير الروب", change: "تقصير بمقدار 2 سم مع إبقاء الحافة" }, { type: "عرض الكتف", change: "حسب القياس المعتمد" }],
        notes: "يرجى مطابقة القياسات وتثبيت الاسم على الوشاح حسب النموذج المعتمد قبل التسليم.",
        warning: kind === "production" ? "تأكد من قياس الوشاح الأمريكي الخلفي قبل القص." : "",
      });
      const page = await browser.newPage({ viewport: { width: 460, height: 1000 } });
      await page.route("**/*", (route) => route.abort());
      await page.emulateMedia({ media: "print" });
      await page.setContent(html.replace("<head>", '<head><script>window.print=function(){window.printRequested=true;};</script>'));
      await page.waitForFunction(() => window.printRequested === true);
      const metrics = await page.evaluate(() => {
        const doc = document.querySelector(".doc");
        const barcode = doc.querySelector(".barcode svg");
        return { heightMm: doc.getBoundingClientRect().height * 25.4 / 96, widthMm: doc.getBoundingClientRect().width * 25.4 / 96, barcodeWidthMm: barcode?.getBoundingClientRect().width * 25.4 / 96, overflow: doc.scrollWidth > doc.clientWidth + 1, text: doc.innerText };
      });
      // 80mm: printed on the XP-80C driver's own page (72.1 × 297 mm), as a physical printer does.
      const pdf = await page.pdf({ ...(format === "80mm" ? { width: "72.1mm", height: "297mm" } : { format: "A5" }), preferCSSPageSize: format !== "80mm", printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } });
      const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length;
      writeFileSync(`${output}/${kind}-${format}.pdf`, pdf);
      await page.screenshot({ path: `${output}/${kind}-${format}.png`, fullPage: true });
      assert.equal(metrics.overflow, false, `${kind}/${format}: text must stay within paper width`);
      assert.ok(metrics.text.includes("خلف الوشاح الأمريكي") && metrics.text.includes("المقاس المثالي") && metrics.text.includes("يرجى مطابقة"), "measurements and notes remain visible");
      assert.ok(!metrics.text.includes("الكم") && !metrics.text.includes("الرقبة"), "removed measurements stay off both tailor sheets");
      if (format === "80mm") {
        assert.equal(pages, 1, `${kind}: 80mm tailor sheet must print as one receipt (height ${metrics.heightMm.toFixed(1)}mm)`);
        assert.ok(metrics.widthMm <= 72.1, "80mm content respects the printable width");
        assert.ok(metrics.barcodeWidthMm >= 59.9, "CODE128 retains the full 60mm scan width");
        assert.ok(metrics.heightMm < 285, "a normal full tailor sheet also fits a 297mm driver page");
        const pageSizes = await page.evaluate(() => [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules])
          .filter((rule) => rule instanceof CSSPageRule).map((rule) => rule.style.getPropertyValue("size")));
        assert.ok(pageSizes.every((size) => !size), "no CSS page size: Chromium centres a smaller CSS page on the driver's paper (blank before the sheet) and shrinks a larger one");
      }
      console.log(`PASS ${kind}/${format}: ${pages} page(s), ${metrics.widthMm.toFixed(1)} × ${metrics.heightMm.toFixed(1)}mm`);
      if (kind === "production" && format === "80mm") {
        const longNotes = "ملاحظة تفصيل طويلة للتحقق من اكتمال ورقة الورشة والحفاظ على جميع التعليمات. ".repeat(40);
        await page.setContent(html.replace("يرجى مطابقة القياسات وتثبيت الاسم على الوشاح حسب النموذج المعتمد قبل التسليم.", longNotes)
          .replace("<head>", '<head><script>window.printRequested=false;window.print=function(){window.printRequested=true;};</script>'));
        await page.waitForFunction(() => window.printRequested === true);
        const zero = { top: 0, bottom: 0, left: 0, right: 0 };
        const longPdf = await page.pdf({ width: "72.1mm", height: "3276mm", preferCSSPageSize: false, margin: zero });
        const longPages = (longPdf.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length;
        assert.equal(longPages, 1, "on the 80(72.1) x 3276 mm roll a long sheet prints as one continuous receipt");
        const fixedPdf = await page.pdf({ width: "72.1mm", height: "297mm", preferCSSPageSize: false, margin: zero });
        const fixedPages = (fixedPdf.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length;
        const height = await page.evaluate(() => document.querySelector(".doc").getBoundingClientRect().height * 25.4 / 96);
        assert.ok(height > 297, "stress fixture must exceed the driver default height");
        assert.ok(fixedPages > 1, "on a fixed 297 mm driver page a longer sheet continues on the next page instead of shrinking");
        writeFileSync(`${output}/production-long-notes-80mm.pdf`, longPdf);
        console.log(`PASS long notes/80mm: ${longPages} continuous roll page, ${fixedPages} pages of 297mm, ${height.toFixed(1)}mm`);
      }
      await page.close();
    }
  }
} finally { await browser.close(); }
