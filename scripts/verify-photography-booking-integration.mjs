// Contract tests for Photography Booking detection and idempotent central linking.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { build } = require("../node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/lib/main.js");
const bundle = await build({
  entryPoints: ["src/server/sound-detection.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent",
});
const outFile = join(mkdtempSync(join(tmpdir(), "ajn-photo-detection-")), "detection.mjs");
writeFileSync(outFile, bundle.outputFiles[0].text);
const {
  bookingLinkKey,
  detectBookingDepartments,
  isProductInDepartment,
  matchesDepartment,
  resolveDepartmentCategoryIds,
} = await import(pathToFileURL(outFile).href);

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.error(`✗ ${name}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`);
  } else console.log(`✓ ${name}`);
}

check("normalized department code", matchesDepartment("PHOTOGRAPHY", "photography"), true);
check("Arabic photography service", matchesDepartment("تصوير حفلات", "photography"), true);
check("videography is supported", matchesDepartment("videography", "photography"), true);

const categories = [
  { id: 17, slug: "event-media", name: "Media", nameAr: "الوسائط", imageMetadata: { departmentCode: "PHOTOGRAPHY", departmentId: 8 } },
  { id: 18, slug: "flowers", name: "Flowers", nameAr: "ورود", imageMetadata: {} },
];
const categoryIds = resolveDepartmentCategoryIds(categories, "photography");
check("stable metadata resolves category id", [...categoryIds], [17]);
check("product category id detects photography", isProductInDepartment({ categoryId: 17 }, categoryIds, "photography"), true);
check("unrelated product stays unrelated", isProductInDepartment({ categoryId: 18 }, categoryIds, "photography"), false);

const productDepartments = new Map([[101, ["photography"]], [202, ["kosha"]]]);
check(
  "mixed booking remains one booking with two departments",
  detectBookingDepartments({ signals: { productIds: [101, 202] }, productDepartments }),
  ["kosha", "photography"],
);
check("source idempotency key is stable", bookingLinkKey("service_order", 125), "booking-link:service_order:125");

const migration = readFileSync("lib/db/migrations/0067_photography_booking_integration.sql", "utf8");
const integration = readFileSync("src/server/photography-booking-integration.ts", "utf8");
check("migration enforces one event per central booking", migration.includes("photography_events_booking_idx"), true);
check("migration enforces one shoot per central booking", migration.includes("photography_shoots_booking_idx"), true);
check("sync uses a transaction advisory lock", integration.includes("pg_advisory_xact_lock"), true);
check("backfill defaults to dry-run", integration.includes("const dryRun = input.dryRun !== false"), true);
check("central status is synchronized from portal", integration.includes("syncPhotographyStageToCentralBooking"), true);

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
