import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const esbuildDir = readdirSync("node_modules/.pnpm").find((name) => name.startsWith("esbuild@"));
if (!esbuildDir) throw new Error("The installed esbuild package is unavailable");
const { build } = require(`../node_modules/.pnpm/${esbuildDir}/node_modules/esbuild/lib/main.js`);
const bundle = await build({ entryPoints: ["src/server/service-item-lines.ts"], bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent" });
const output = join(mkdtempSync(join(tmpdir(), "ajn-service-lines-")), "logic.mjs");
writeFileSync(output, bundle.outputFiles[0].text);
const { calculateServiceLine, invoiceLineTracksInventory, serviceOrderTotal } = await import(pathToFileURL(output).href);

assert.deepEqual(calculateServiceLine({ quantity: 5, unitPrice: 10_000 }), { quantity: 5, unitPrice: 10_000, discount: 0, total: 50_000 });
assert.deepEqual(calculateServiceLine({ quantity: 5, unitPrice: 10_000, discount: 2_500 }), { quantity: 5, unitPrice: 10_000, discount: 2_500, total: 47_500 });
assert.equal(calculateServiceLine({ quantity: 0, unitPrice: 10_000 }), null);
assert.equal(calculateServiceLine({ quantity: 1.2345, unitPrice: 10_000 })?.total, 12_345);
assert.deepEqual([invoiceLineTracksInventory(false), invoiceLineTracksInventory(null), invoiceLineTracksInventory(undefined)], [false, true, true]);
assert.equal(serviceOrderTotal(15_000, [50_000]), 65_000);
assert.equal(serviceOrderTotal(0, [50_000]), 50_000);
console.log("Service item invoice and booking calculations passed.");
