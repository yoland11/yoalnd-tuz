// Pure business-rule verification for Asset Sale; no database or production state is touched.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { build } = require("../node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/lib/main.js");
const bundle = await build({ entryPoints: ["src/server/asset-sale-logic.ts"], bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent" });
const output = join(mkdtempSync(join(tmpdir(), "ajn-asset-sale-")), "logic.mjs");
writeFileSync(output, bundle.outputFiles[0].text);
const { calculateAssetSaleOutcome, assetSaleEligibility } = await import(pathToFileURL(output).href);

let failures = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) console.log(`✓ ${name}`);
  else { failures += 1; console.error(`✗ ${name}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`); }
};

check("active asset is eligible", assetSaleEligibility({ status: "active", isActive: true, alreadySold: false, assignedToEmployee: false, inCustodyGroup: false, reservedInBooking: false, linkedToActiveBooking: false }).allowed, true);
check("fully depreciated asset sale is all profit", calculateAssetSaleOutcome({ bookValue: 0, salePrice: 500, paidAmount: 500 }), { bookValue: 0, salePrice: 500, paidAmount: 500, receivableAmount: 0, profitAmount: 500, lossAmount: 0 });
check("partially depreciated asset sold at profit", calculateAssetSaleOutcome({ bookValue: 700, salePrice: 900, paidAmount: 900 }).profitAmount, 200);
check("asset sold at loss", calculateAssetSaleOutcome({ bookValue: 700, salePrice: 450, paidAmount: 450 }).lossAmount, 250);
check("partial payment creates receivable", calculateAssetSaleOutcome({ bookValue: 700, salePrice: 900, paidAmount: 300 }).receivableAmount, 600);
check("employee assignment blocks sale", assetSaleEligibility({ status: "active", isActive: true, alreadySold: false, assignedToEmployee: true, inCustodyGroup: false, reservedInBooking: false, linkedToActiveBooking: false }).allowed, false);
check("active booking blocks sale", assetSaleEligibility({ status: "active", isActive: true, alreadySold: false, assignedToEmployee: false, inCustodyGroup: false, reservedInBooking: true, linkedToActiveBooking: false }).allowed, false);
check("maintenance blocks sale", assetSaleEligibility({ status: "maintenance", isActive: true, alreadySold: false, assignedToEmployee: false, inCustodyGroup: false, reservedInBooking: false, linkedToActiveBooking: false }).allowed, false);
check("duplicate sale is blocked", assetSaleEligibility({ status: "sold", isActive: true, alreadySold: true, assignedToEmployee: false, inCustodyGroup: false, reservedInBooking: false, linkedToActiveBooking: false }).allowed, false);

if (failures) process.exitCode = 1;
else console.log("Asset Sale business rules passed.");
