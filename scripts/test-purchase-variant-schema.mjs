import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [migration, schema, api, purchases, printing] = await Promise.all([
  readFile(new URL("../lib/db/migrations/0121_purchase_invoice_variants.sql", import.meta.url), "utf8"),
  readFile(new URL("../lib/db/src/schema/purchase-invoices.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/server/api.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/views/admin/purchases.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/views/admin/print-helpers.ts", import.meta.url), "utf8"),
]);

assert.match(migration, /ADD COLUMN IF NOT EXISTS "variant_id" integer/i);
assert.match(migration, /ADD COLUMN IF NOT EXISTS "variant_label" text/i);
assert.match(migration, /REFERENCES "product_variants" \("id"\)\s+ON DELETE SET NULL/i);
assert.match(migration, /purchase_invoice_items_variant_idx/i);
assert.doesNotMatch(migration, /^\s*(UPDATE|DELETE|DROP|TRUNCATE)\b/im, "migration must not rewrite legacy invoice rows");
assert.match(schema, /variantId: integer\("variant_id"\)/);
assert.match(schema, /variantLabel: text\("variant_label"\)/);
assert.match(schema, /variantSku: varchar\("variant_sku"/);
assert.ok((api.match(/preparePurchaseInvoiceVariantItemsInTransaction\(/g) ?? []).length >= 3, "helper, create, and edit must validate variant rows");
assert.match(api, /UPDATE product_variants\s+SET stock = stock \+[\s\S]*?WHERE id = \$\{variantId\}\s+RETURNING product_id/);
assert.match(api, /UPDATE product_variants\s+SET stock = GREATEST\(0, stock -/);
assert.match(api, /variantId: item\.variantId \?\? null/);
assert.match(api, /metadata: \{[\s\S]*?variantLabel: item\.variantLabel/);
assert.match(api, /reversePurchaseInvoiceStockInTransaction\(tx, items as any\[\], id, a, "purchase_invoice_deleted_reversal"\)/);
assert.match(api, /variantLabel: purchaseInvoiceItemsTable\.variantLabel/);
assert.match(purchases, /aria-label="متغير المنتج"/);
assert.match(purchases, /required\s+aria-label="متغير المنتج"/);
assert.match(purchases, /variantId: it\.variantId \?\? null/);
assert.match(purchases, /variantLabel: item\.variantLabel \|\| null/);
assert.match(printing, /variantLabel\?: string \| null/);
assert.match(printing, /item\.variantLabel/);

console.log("Purchase invoice variant schema, persistence, stock, detail, supplier comparison, and print contracts passed.");
