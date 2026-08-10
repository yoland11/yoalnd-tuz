// AJN save reliability smoke suite.
//
// This suite is intentionally safe by default: it never writes to a database.
// A future integration adapter may only run when all three safeguards below
// are present. Production DATABASE_URL is deliberately never accepted here.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { build } = require("../node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/lib/main.js");
const bundle = await build({
  entryPoints: ["src/server/write-safety.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent",
});
const output = join(mkdtempSync(join(tmpdir(), "ajn-save-smoke-")), "write-safety.mjs");
writeFileSync(output, bundle.outputFiles[0].text);
const { createApiErrorPayload, mapWriteError } = await import(pathToFileURL(output).href);

let failures = 0;
function check(name, actual, expected = true) {
  const ok = typeof expected === "function" ? expected(actual) : JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) console.log(`✓ ${name}`);
  else { failures += 1; console.error(`✗ ${name}\n  actual: ${JSON.stringify(actual)}`); }
}

// Error-contract regression tests. These are pure and never connect to a DB.
const payload = createApiErrorPayload({ requestId: "REQ-save-smoke", status: 400, code: "VALIDATION_ERROR", fieldErrors: { customerId: "مطلوب" } });
check("structured validation response preserves legacy and new fields", {
  success: payload.success,
  code: payload.code,
  requestId: payload.requestId,
  hasMessage: Boolean(payload.message),
  hasLegacyError: Boolean(payload.error),
  field: payload.fieldErrors?.customerId,
}, { success: false, code: "VALIDATION_ERROR", requestId: "REQ-save-smoke", hasMessage: true, hasLegacyError: true, field: "مطلوب" });
check("unique violation maps to duplicate conflict", mapWriteError({ code: "23505" }), (v) => v.status === 409 && v.code === "DUPLICATE");
check("foreign-key violation maps safely", mapWriteError({ code: "23503" }), (v) => v.status === 409 && v.code === "FOREIGN_KEY_CONFLICT");
check("not-null violation maps to validation", mapWriteError({ code: "23502" }), (v) => v.status === 400 && v.code === "VALIDATION_ERROR");
check("serialization conflict is retryable", mapWriteError({ code: "40001" }), (v) => v.status === 409 && v.code === "STALE_DATA" && v.retryable);
check("database outage is not exposed as raw driver error", mapWriteError({ code: "08006" }), (v) => v.status === 500 && v.code === "DATABASE_ERROR" && v.retryable);

// Fast source assertions protect the high-risk save paths without running them
// against production. Runtime integration tests belong in a separately
// configured test database adapter, never in a developer's normal .env.
const api = readFileSync("src/server/api.ts", "utf8");
const sales = readFileSync("src/views/admin/sales.tsx", "utf8");
const purchases = readFileSync("src/views/admin/purchases.tsx", "utf8");
const client = readFileSync("src/views/admin/_lib.ts", "utf8");
check("all uncaught API writes use central PostgreSQL mapping", api.includes("mapWriteError(err)") && api.includes("createApiErrorPayload"));
check("sales invoice save keeps a database transaction", api.includes("const saved = await db.transaction(async (tx) =>"));
check("purchase invoice save keeps a database transaction", api.includes("const savedPurchase = await db.transaction(async (tx) =>"));
check("sales invoice client sends an idempotency key", sales.includes('"x-idempotency-key": submitKeyRef.current'));
check("purchase invoice client sends an idempotency key", purchases.includes('"x-idempotency-key": submitKeyRef.current'));
check("shared client preserves error code and request id", client.includes("class AjNApiError") && client.includes("x-request-id"));
check("shared client coalesces duplicate in-flight writes", client.includes("inFlightWrites") && client.includes("if (pending) return pending"));

const safeTestDb = process.env.AJN_ENV === "test"
  && process.env.ALLOW_TEST_WRITES === "true"
  && Boolean(process.env.TEST_DATABASE_URL)
  && process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL
  && /(?:test|testing|staging|dev)/i.test(process.env.TEST_DATABASE_URL);

if (!safeTestDb) {
  console.log("Safe test database is not configured. Live write scenarios were not run.");
  console.log("To enable a future test-only integration adapter, set AJN_ENV=test, ALLOW_TEST_WRITES=true, and a separate TEST_DATABASE_URL containing test/dev/staging.");
} else {
  console.log("Safe test database marker verified. No write adapter is configured in this repository, so no database records were created.");
}

if (failures) process.exitCode = 1;
else console.log("AJN save smoke contract passed.");
