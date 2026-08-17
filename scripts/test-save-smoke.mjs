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
const paymentBundle = await build({
  entryPoints: ["src/lib/payment-settlement.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent",
});
const paymentOutput = join(mkdtempSync(join(tmpdir(), "ajn-payment-smoke-")), "payment-settlement.mjs");
writeFileSync(paymentOutput, paymentBundle.outputFiles[0].text);
const { settlePaymentAmounts } = await import(pathToFileURL(paymentOutput).href);

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
check("partial-index conflict maps to a safe actionable response", mapWriteError({ code: "42P10" }), (v) => v.status === 409 && v.code === "CONFLICT" && !v.retryable);

// Payment-state cases used by the sales invoice API. These run without a DB
// and keep full, partial and unpaid server-side calculations consistent.
check("full payment settles the full total", settlePaymentAmounts(5000, 5000, undefined, "transfer"), { paid: 5000, remaining: 0, status: "paid" });
check("partial payment keeps the outstanding balance", settlePaymentAmounts(5000, 1250, undefined, "transfer"), { paid: 1250, remaining: 3750, status: "partial" });
check("unpaid transfer invoice remains unpaid", settlePaymentAmounts(5000, 0, undefined, "transfer"), { paid: 0, remaining: 5000, status: "unpaid" });
check("payment cannot exceed the invoice total", settlePaymentAmounts(5000, 9000, undefined, "transfer"), { paid: 5000, remaining: 0, status: "paid" });

// Fast source assertions protect the high-risk save paths without running them
// against production. Runtime integration tests belong in a separately
// configured test database adapter, never in a developer's normal .env.
const api = readFileSync("src/server/api.ts", "utf8");
const sales = readFileSync("src/views/admin/sales.tsx", "utf8");
const purchases = readFileSync("src/views/admin/purchases.tsx", "utf8");
const client = readFileSync("src/views/admin/_lib.ts", "utf8");
const bundleSchema = readFileSync("lib/db/src/schema/product-bundles.ts", "utf8");
const bundlePage = readFileSync("src/views/admin/product-bundles.tsx", "utf8");
const koshaSchema = readFileSync("lib/db/src/schema/kosha-staff.ts", "utf8");
const koshaMigration = readFileSync("lib/db/migrations/0100_kosha_field_collection_approval.sql", "utf8");
const schemaIndexRecovery = readFileSync("lib/db/migrations/0101_schema_index_recovery.sql", "utf8");
const koshaStaff = readFileSync("src/views/staff/booking-detail.tsx", "utf8");
const koshaCollections = readFileSync("src/views/admin/kosha-collections.tsx", "utf8");
check("all uncaught API writes use central PostgreSQL mapping", api.includes("mapWriteError(err)") && api.includes("createApiErrorPayload"));
check("sales invoice save keeps a database transaction", api.includes("saved = await db.transaction(async (tx) =>"));
check("purchase invoice save keeps a database transaction", api.includes("const savedPurchase = await db.transaction(async (tx) =>"));
check("sales idempotency target matches its partial unique index", api.includes("where: sql`${salesInvoicesTable.idempotencyKey} IS NOT NULL`"));
check("purchase idempotency target matches its partial unique index", api.includes("where: sql`${purchaseInvoicesTable.idempotencyKey} IS NOT NULL`"));
check("sales invoice errors include a safe transaction step trace", api.includes("[SALES_INVOICE_SAVE_FAILED]") && api.includes("invoiceSaveStep"));
check("sales invoice supports decimal inventory quantities to three places", api.includes("الكمية تدعم حتى 3 منازل عشرية") && api.includes("stock::numeric >="));
check("sales invoice persists payments within the invoice transaction", api.includes("createAndExecuteSourceFinancialTransaction(") && api.includes('traceInvoiceSave("payment_and_cashbox")'));
check("sales invoice does not require optional tracking columns on insert", api.includes(".returning(salesInvoiceRecordColumns)") && !api.includes("createdByRole: auth.role"));
check("sales invoice client sends an idempotency key", sales.includes('"x-idempotency-key": submitKeyRef.current'));
check("purchase invoice client sends an idempotency key", purchases.includes('"x-idempotency-key": submitKeyRef.current'));
check("shared client preserves error code and request id", client.includes("class AjNApiError") && client.includes("x-request-id"));
check("shared client coalesces duplicate in-flight writes", client.includes("inFlightWrites") && client.includes("if (pending) return pending"));
check("bundle sale resolves components server-side", api.includes("resolveSalesInvoiceBundleLines") && api.includes("salesInvoiceBundleSnapshotsTable"));
check("bundle stock uses the same conditional invoice transaction", api.includes("sales_invoice_bundle_stock_deducted") && api.includes("stock::numeric >="));
check("bundle snapshot schema preserves original components", bundleSchema.includes("salesInvoiceBundleSnapshotsTable") && bundleSchema.includes("components"));
check("used bundles archive instead of deleting invoice history", api.includes('operation: "archived"') && api.includes("sales_invoice_bundle_snapshots"));
check("bundle management has live component search and duplicate protection", bundlePage.includes("componentSearch") && bundlePage.includes("selectedIds.has"));
check("bundle delivery fee is server-derived and kept separate from component stock", api.includes("offerDeliveryFee = bundleResolution.offerDeliveryFee") && api.includes("deliveryFeePerBundle") && bundleSchema.includes("deliveryFee"));
// Kosha field collection: the staff report is deliberately separate from the
// official booking payment. The atomic approval path is the only path allowed
// to execute cash, voucher allocation, booking totals, and accounting.
check("kosha field collection schema records method, receipt, balance snapshot and idempotency", koshaSchema.includes("paymentMethod") && koshaSchema.includes("receiptImage") && koshaSchema.includes("remainingBefore") && koshaSchema.includes("idempotencyKey"));
check("kosha field collection migration preserves history and prevents duplicate submits", koshaMigration.includes("ADD COLUMN IF NOT EXISTS") && koshaMigration.includes("kosha_payment_requests_idempotency_idx") && !/^\s*(?:UPDATE|DELETE\s+FROM|TRUNCATE|DROP)\b/im.test(koshaMigration));
check("production index recovery remains additive and tracks its applied revision", schemaIndexRecovery.includes("CREATE INDEX IF NOT EXISTS") && schemaIndexRecovery.includes("VALUES (101") && !/^\s*(?:UPDATE|DELETE\s+FROM|TRUNCATE|DROP)\b/im.test(schemaIndexRecovery));
check("kosha field collection starts pending manager approval without a financial movement", api.includes('status: "pending_manager_approval"') && api.includes("kosha_field_collection.submit") && api.includes("x-idempotency-key"));
check("kosha approval posts booking, receipt allocation, cash and journal in one transaction", api.includes('result = await db.transaction(async (tx) =>') && api.includes('sourceEvent: "kosha_field_collection"') && api.includes("createAndExecuteSourceFinancialTransaction(") && api.includes("receiptVoucherAllocationsTable"));
check("kosha rejection requires a recorded reason and never posts cash", api.includes("سبب رفض التحصيل مطلوب") && api.includes("rejection_reason") && api.includes("payment_rejected"));
check("kosha staff collection is embedded in booking details with method and receipt proof", koshaStaff.includes("CollectPanel") && koshaStaff.includes("طريقة الدفع") && koshaStaff.includes("صورة وصل الاستلام"));
check("main approval screen exposes booking, customer, receipt and required rejection reason", koshaCollections.includes("فتح الحجز") && koshaCollections.includes("حساب العميل") && koshaCollections.includes("فتح صورة الوصل") && koshaCollections.includes("سبب الرفض مطلوب"));

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
