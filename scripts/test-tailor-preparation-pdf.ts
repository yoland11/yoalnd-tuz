/** Group preparation PDF: content, escaping, missing data made explicit, page-sized blocks, portal wiring. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { escapeHtml, preparationBlocks, preparationPrintHtml, type PrepStudent } from "../src/lib/tailor-references-pdf";

const sash = (name: string) => ({ name, type: "أمريكي", font: "النسخ", color: "#7b1e3a", embroideryColor: "#d4af37" });
const students: PrepStudent[] = [
  {
    name: "سارة علي",
    studentCode: "G-001",
    phones: ["07701234567", "07809876543"],
    size: "M",
    sash: sash("المهندسة سارة علي"),
    references: [
      { placement: "sash_back", note: "الاسم بخط كبير خلف الوشاح", imageUrl: "https://assets.example/back.png" },
      { placement: "cap_edge", note: "سنة التخرج 2026" },
      { placement: "cap_top", note: "", imageUrl: "data:image/png;base64,AAAA" },
      { placement: "other", note: "", imageUrl: "javascript:alert(1)" },
    ],
  },
  { name: "<script>alert(1)</script>", studentCode: "G-002", phones: [], size: "", sash: sash(""), references: [] },
];

const blocks = preparationBlocks({ title: "هندسة مدني 2026", details: "جامعة تكريت · رقم المجموعة 12", students, logo: "/images/logo.png", generatedAt: new Date(2026, 10, 24) });
assert.equal(blocks.length, 1 + 1 + students.length, "header, one name list, one card per student");
const [header, names, first, second] = blocks;

assert.ok(header.includes("صور وملاحظات الطلبة للتجهيز") && header.includes("هندسة مدني 2026") && header.includes("جامعة تكريت"));
assert.ok(header.includes("2 طالب · 1 أرسلوا صوراً أو ملاحظات"), "how many students sent something");
assert.ok(header.includes('src="/images/logo.png"'), "a same-site logo is kept");

// The name on the sash: in the list for every student, prominent on each card, flagged when missing.
assert.ok(names.includes("قائمة الأسماء على الوشاح") && names.includes("المهندسة سارة علي"));
assert.ok(names.includes("غير محدد"), "a missing sash name is visible in the list");
assert.ok(first.includes("الاسم على الوشاح") && first.includes("المهندسة سارة علي"));
assert.ok(second.includes("لم يُحدد الاسم على الوشاح"), "a missing sash name is visible on the card");
// Mobile numbers: in the list and on the card, every saved number, left-to-right; flagged when none.
assert.ok(names.includes("رقم الموبايل") && names.includes('<bdi dir="ltr">07701234567</bdi><br><bdi dir="ltr">07809876543</bdi>'));
assert.ok(first.includes('رقم الموبايل: <b><bdi dir="ltr">07701234567</bdi> · <bdi dir="ltr">07809876543</bdi></b>'));
assert.ok(second.includes("رقم الموبايل: ") && second.includes("غير مسجل"), "a student without a number says so");
for (const text of ["نوع الوشاح", "أمريكي", "الخط", "النسخ", "#7b1e3a", "لون التطريز", "#d4af37"]) assert.ok(first.includes(text), text);

// The student's photos and notes, by placement; only http(s) images are embedded.
for (const text of ["خلف الوشاح", "الاسم بخط كبير خلف الوشاح", "طرف القبعة", "سنة التخرج 2026", "فوق القبعة", "أخرى"]) assert.ok(first.includes(text), text);
assert.ok(first.includes('src="https://assets.example/back.png"') && first.includes('crossorigin="anonymous"'));
assert.ok(!first.includes("data:image") && !first.includes("javascript:"), "no inline or script URLs");
assert.equal((first.match(/data-prep-image/g) ?? []).length, 1);
assert.ok(second.includes("لم يرسل الطالب صوراً أو ملاحظات للتجهيز."), "students without photos are listed, not dropped");

// Everything typed by students is escaped.
assert.ok(!blocks.join("").includes("<script>") && second.includes(escapeHtml("<script>alert(1)</script>")));

// Long groups: the name list is split so each block fits on a page.
const many = Array.from({ length: 50 }, (_, index): PrepStudent => ({ name: `طالب ${index + 1}`, studentCode: `G-${index + 1}`, phones: [`0770000${String(index).padStart(4, "0")}`], size: "L", sash: sash(`الاسم ${index + 1}`), references: [] }));
const manyBlocks = preparationBlocks({ title: "مجموعة كبيرة", details: "", students: many });
assert.equal(manyBlocks.length, 1 + 3 + 50, "22 names per list block");
assert.ok(manyBlocks[3].includes("الاسم 50") && !manyBlocks[3].includes("قائمة الأسماء على الوشاح"), "only the first list block carries the title");

const printable = preparationPrintHtml({ title: "هندسة مدني 2026", details: "", students });
assert.match(printable, /@page\{size:A4;margin:10mm\}/);
assert.match(printable, /break-inside:avoid/);
assert.ok(printable.startsWith("<!doctype html><html dir=\"rtl\""));

// The portal offers it per group (dashboard) and for the whole group or the selection (group page).
const portal = readFileSync("src/views/staff/tailors/index.tsx", "utf8");
assert.match(portal, /tailorApi\(`\/group\/\$\{g\.id\}`\)/, "the dashboard button loads the group's students");
assert.ok(portal.includes("PDF صور التجهيز ({rows.length})") && portal.includes("PDF المحدد ({sel.size})"));
assert.ok(portal.includes("PRINT_FALLBACK_NOTE"), "the print fallback is announced, never silent");
const server = readFileSync("src/server/tailoring.ts", "utf8");
assert.match(server, /phone: order\.phone \?\? "",\n\s+phone2: order\.phone2 \?\? "",/, "group rows carry the student's numbers");
assert.ok(portal.includes("phones: [...new Set([row.phone, row.phone2]"), "both numbers reach the PDF, without duplicates");
assert.match(server, /studentReferences: studentReferencesOf\(order\.previewAssets\),\n\s+sash: sashDetailsOf\(order\),/, "group rows carry references and sash text");

console.log("PASS tailor preparation PDF: sash name per student (flagged when missing), photos and notes by placement, safe URLs, escaped text, page-sized blocks, portal buttons");
