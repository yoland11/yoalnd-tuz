import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { build } = require("../node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/lib/main.js");

// Browser-independent regression test for the exact editor boundary: a
// generated 1600×1600 PNG/WebP data URL must become a local Blob/File without
// ever invoking fetch(), which would violate AJN's connect-src CSP.
const bundle = await build({
  entryPoints: ["src/lib/image-tools.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
  alias: { "@": "./src" },
  logLevel: "silent",
});
const output = join(mkdtempSync(join(tmpdir(), "ajn-image-data-url-")), "image-tools.mjs");
writeFileSync(output, bundle.outputFiles[0].text);
const { dataUrlToBlob, dataUrlToFile, dataUrlSize } = await import(pathToFileURL(output).href);

const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error("fetch must not be used for a data URL"); };
const png1600 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAABkAAAAYACAIAAAC7";
const webp1600 = "data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoABkAABUB8JbACdLoAA3AA";
let failed = false;
for (const [name, url, type] of [["PNG 1600×1600", png1600, "image/png"], ["WebP 1600×1600", webp1600, "image/webp"]]) {
  try {
    const blob = dataUrlToBlob(url);
    const file = await dataUrlToFile(url, `editor-1600.${type === "image/png" ? "png" : "webp"}`);
    const size = await dataUrlSize(url);
    const ok = blob.type === type && blob.size > 0 && file.size === blob.size && size === blob.size;
    console.log(`${ok ? "PASS" : "FAIL"} ${name}: local Blob/File conversion`);
    if (!ok) failed = true;
  } catch (error) { console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); failed = true; }
}
globalThis.fetch = originalFetch;
if (failed) process.exitCode = 1;
