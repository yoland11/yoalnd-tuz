// Pure cancellation matching/idempotency checks. No database state is touched.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const esbuildDir = readdirSync("node_modules/.pnpm").find((name) => name.startsWith("esbuild@"));
if (!esbuildDir) throw new Error("The installed esbuild package is unavailable");
const { build } = require(`../node_modules/.pnpm/${esbuildDir}/node_modules/esbuild/lib/main.js`);
const bundle = await build({ entryPoints: ["src/server/sales-invoice-cancellation-logic.ts"], bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent" });
const output = join(mkdtempSync(join(tmpdir(), "ajn-sales-invoice-cancel-")), "logic.mjs");
writeFileSync(output, bundle.outputFiles[0].text);
const { selectSalesInvoiceOriginalMovement, salesInvoiceCancellationIdempotencyKey } = await import(pathToFileURL(output).href);
const serviceBundle = await build({ entryPoints: ["src/server/service-item-lines.ts"], bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent" });
const serviceOutput = join(mkdtempSync(join(tmpdir(), "ajn-sales-invoice-service-stock-")), "logic.mjs");
writeFileSync(serviceOutput, serviceBundle.outputFiles[0].text);
const { invoiceLineTracksInventory } = await import(pathToFileURL(serviceOutput).href);

let failures = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) console.log(`✓ ${name}`);
  else { failures += 1; console.error(`✗ ${name}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`); }
};
const base = { product_id: 10, stock_source_product_id: 10, quantity_change: "-2" };
const match = (candidates, usedMovementIds = new Set()) => selectSalesInvoiceOriginalMovement({ invoiceItemId: 50, productId: 10, stockProductId: 10, quantity: 2, candidates, usedMovementIds });

check("direct invoice link wins", match([{ ...base, id: 1, match_priority: 1 }, { ...base, id: 2, match_priority: 2 }]).movement.id, 1);
check("invoice item link is selected exactly", match([{ ...base, id: 3, match_priority: 1 }, { ...base, id: 4, match_priority: 1, sales_invoice_item_id: 50 }]).movement.id, 4);
check("used original movement is ignored", match([{ ...base, id: 5, match_priority: 1 }], new Set([5])).kind, "missing");
check("quantity mismatch is rejected", match([{ ...base, id: 6, quantity_change: "-3", match_priority: 1 }]).kind, "missing");
check("single legacy match is accepted", match([{ ...base, id: 7, match_priority: 5 }]).kind, "matched");
check("ambiguous legacy match is blocked", match([{ ...base, id: 8, match_priority: 5 }, { ...base, id: 9, match_priority: 5 }]).kind, "ambiguous");
check("cancellation key is stable", salesInvoiceCancellationIdempotencyKey(12, 34), "sales-invoice-cancel:12:34");
check("service cancellation never restores stock but legacy snapshots still do", [invoiceLineTracksInventory(false), invoiceLineTracksInventory(null)], [false, true]);

if (failures) process.exitCode = 1;
else console.log("Sales invoice cancellation business rules passed.");
