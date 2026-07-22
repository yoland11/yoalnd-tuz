// Verifies identifier-first department detection. No DB.
// Run: node scripts/verify-sound-detection.mjs
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { build } = require("../node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/lib/main.js");

const bundle = await build({
  entryPoints: ["src/server/sound-detection.ts"],
  bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent",
});
const outFile = join(mkdtempSync(join(tmpdir(), "ajn-snd-")), "sound.mjs");
writeFileSync(outFile, bundle.outputFiles[0].text);

const {
  normalizeTaxonomy, matchesDepartment, resolveDepartmentCategoryIds,
  isProductInDepartment, filterProductsByDepartment, detectBookingDepartments,
  bookingLinkKey, departmentBadge, productCategoryIds, resolveSoundBookingService,
} = await import(pathToFileURL(outFile).href);

let failures = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { failures++; console.error(`✗ ${name}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`); }
  else console.log(`✓ ${name}`);
};

// ── Normalization: the exact failure that broke the old lookup ──
check("definite article is stripped", normalizeTaxonomy("الصوتيات"), "صوتيات");
check("diacritics are stripped", normalizeTaxonomy("الصَّوتيّات"), "صوتيات");
check("tatweel is stripped", normalizeTaxonomy("صــوتيات"), "صوتيات");
check("alef variants unify", normalizeTaxonomy("أنظمة"), normalizeTaxonomy("انظمة"));
check("ta-marbuta folds to ha", normalizeTaxonomy("كوشة"), "كوشه");
check("separators collapse", normalizeTaxonomy("Sound - Systems"), "sound systems");
check("case folds", normalizeTaxonomy("SOUND"), "sound");
check("padding is trimmed", normalizeTaxonomy("  صوتيات  "), "صوتيات");

// ── Department matching across every naming the business uses ──
for (const value of ["صوتيات", "الصوتيات", "Sound", "SOUND", "audio", "Sound Systems", "أنظمة صوتية"]) {
  check(`"${value}" is sound`, matchesDepartment(value, "sound"), true);
}
check("كوشات is not sound", matchesDepartment("كوشات", "sound"), false);
check("تصوير is not sound", matchesDepartment("تصوير", "sound"), false);
check("empty is nothing", matchesDepartment("", "sound"), false);
check("null is nothing", matchesDepartment(null, "sound"), false);
// Guards against the substring trap: "soundtrack" must not read as the Sound department.
check("soundtrack is not the sound department", matchesDepartment("soundtrack", "sound"), false);
check("كوشات is kosha", matchesDepartment("كوشات", "kosha"), true);
check("تصوير is photography", matchesDepartment("تصوير", "photography"), true);

// ── Category id resolution — the actual regression that was found ──
const categories = [
  { id: 1, slug: "koshas", nameAr: "كوشات" },
  { id: 2, slug: "sound", nameAr: "الصوتيات" },          // renamed with ال
  { id: 3, slug: "audio-gear", nameAr: "معدات", imageMetadata: { departmentCode: "SOUND" } },
  { id: 4, slug: "photo", nameAr: "تصوير" },
  { id: 5, slug: "flowers", nameAr: "ورود" },
];
const soundIds = resolveDepartmentCategoryIds(categories, "sound");
check("renamed category still resolves", soundIds.has(2), true);
check("metadata departmentCode resolves", soundIds.has(3), true);
check("unrelated categories excluded", [soundIds.has(1), soundIds.has(4), soundIds.has(5)], [false, false, false]);
check("exactly two sound categories", soundIds.size, 2);
check("kosha resolves independently", [...resolveDepartmentCategoryIds(categories, "kosha")], [1]);

// ── Product membership ──
check("all linked category ids are collected",
  productCategoryIds({ categoryId: 2, subcategoryId: 3, subcategoryIds: [4, "5", null, 0, -1] }), [2, 3, 4, 5]);
check("product in sound by categoryId", isProductInDepartment({ id: 9, categoryId: 2 }, soundIds, "sound"), true);
check("product in sound by subcategoryIds", isProductInDepartment({ id: 9, subcategoryIds: [3] }, soundIds, "sound"), true);
check("legacy product with only a category string",
  isProductInDepartment({ id: 9, category: "صوتيات" }, soundIds, "sound"), true);
check("kosha product is not sound", isProductInDepartment({ id: 9, categoryId: 1 }, soundIds, "sound"), false);
check("uncategorized product is not sound", isProductInDepartment({ id: 9 }, soundIds, "sound"), false);
// A speaker named "RCF 745" in the Kosha category must NOT be a sound item — the whole
// point of identifier-first detection.
check("product title never overrides its category",
  isProductInDepartment({ id: 9, categoryId: 1, name: "RCF 745 سماعة" }, soundIds, "sound"), false);

check("filter keeps only sound products",
  filterProductsByDepartment(
    [{ id: 1, categoryId: 1 }, { id: 2, categoryId: 2 }, { id: 3, subcategoryIds: [3] }],
    soundIds, "sound",
  ).map((p) => p.id), [2, 3]);

// ── Service host resolution for Store → Booking Center sync ──
const dedicatedSoundService = { id: 7, type: "sound", name: "Sound Systems", nameAr: "الصوتيات", isActive: true };
const genericSetupService = { id: 2, type: "setup", name: "Setups", nameAr: "تجهيزات", isActive: true };
const researchService = { id: 6, type: "research", name: "Research", nameAr: "بحوث", isActive: true };
check("dedicated Sound service wins", resolveSoundBookingService([genericSetupService, dedicatedSoundService]), dedicatedSoundService);
check("generic setup service supports legacy databases", resolveSoundBookingService([researchService, genericSetupService]), genericSetupService);
check("inactive Sound service is ignored", resolveSoundBookingService([{ ...dedicatedSoundService, isActive: false }, genericSetupService]), genericSetupService);
check("an unrelated service is never used as a Sound host", resolveSoundBookingService([researchService]), null);

// ── Booking-level detection ──
const productDepartments = new Map([
  [101, ["sound"]], [102, ["kosha"]], [103, ["photography"]], [104, ["sound", "kosha"]],
]);
const detect = (signals) => detectBookingDepartments({ signals, productDepartments });

check("single sound product", detect({ productIds: [101] }), ["sound"]);
check("kosha + sound stays one booking with two departments",
  detect({ productIds: [101, 102] }), ["kosha", "sound"]);
check("sound + photography", detect({ productIds: [101, 103] }), ["sound", "photography"]);
check("a product spanning two departments", detect({ productIds: [104] }), ["kosha", "sound"]);
check("all three departments", detect({ productIds: [101, 102, 103] }), ["kosha", "sound", "photography"]);
check("departments come back in a stable order",
  detect({ productIds: [103, 101, 102] }), ["kosha", "sound", "photography"]);
check("unknown product ids contribute nothing", detect({ productIds: [999] }), []);
check("junk product ids are ignored", detect({ productIds: [null, "abc", 0, -5] }), []);

check("structured taxonomy alone is enough", detect({ taxonomy: ["sound"] }), ["sound"]);
check("department field on the booking", detect({ taxonomy: [null, "الصوتيات"] }), ["sound"]);
check("item names are a last resort", detect({ itemNames: ["سماعة"] }), []);
check("item name matching a department name does count",
  detect({ itemNames: ["صوتيات"] }), ["sound"]);
// The rule that stops a stray title from re-classifying a correctly-tagged booking.
check("item names cannot add a department once something structured matched",
  detect({ taxonomy: ["kosha"], itemNames: ["صوتيات"] }), ["kosha"]);
check("empty signals yield nothing", detect({}), []);

// ── Idempotency + badges ──
check("link key is stable", bookingLinkKey("store", 4210), "booking-link:store:4210");
check("link key normalizes source type", bookingLinkKey("  Store  ", "4210"), "booking-link:store:4210");
check("distinct sources never collide",
  bookingLinkKey("store", 1) === bookingLinkKey("rental", 1), false);

check("sound badge", departmentBadge(["sound"]), "صوتيات");
check("kosha badge", departmentBadge(["kosha"]), "كوشات");
check("mixed badge order is fixed", departmentBadge(["sound", "kosha"]), "كوشات + صوتيات");
check("empty badge", departmentBadge([]), "");

// ── Portal filter semantics (mirrors BookingsList in src/views/staff/index.tsx) ──
const passesFilter = (departments, tab) => {
  const list = departments?.length ? departments : ["kosha"];
  const hasKosha = list.includes("kosha");
  const hasSound = list.includes("sound");
  if (tab === "all") return true;
  if (tab === "mixed") return hasKosha && hasSound;
  if (tab === "sound") return hasSound;
  return hasKosha;
};
check("sound tab shows a sound booking", passesFilter(["sound"], "sound"), true);
check("sound tab hides a kosha booking", passesFilter(["kosha"], "sound"), false);
check("kosha tab hides a sound-only booking", passesFilter(["sound"], "kosha"), false);
check("mixed tab needs BOTH departments", passesFilter(["sound"], "mixed"), false);
check("mixed tab shows kosha+sound", passesFilter(["kosha", "sound"], "mixed"), true);
check("sound tab also shows a mixed booking", passesFilter(["kosha", "sound"], "sound"), true);
check("kosha tab also shows a mixed booking", passesFilter(["kosha", "sound"], "kosha"), true);
// Legacy rows carry no departments at all; they must not vanish from the portal.
check("a booking with no departments defaults to kosha", passesFilter(undefined, "kosha"), true);
check("a booking with no departments is not sound", passesFilter([], "sound"), false);
check("the all tab hides nothing", [passesFilter([], "all"), passesFilter(["sound"], "all")], [true, true]);
// photography-only must not leak into either kosha or sound tabs
check("photography-only is absent from both tabs",
  [passesFilter(["photography"], "kosha"), passesFilter(["photography"], "sound")], [false, false]);

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
