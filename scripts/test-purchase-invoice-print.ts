import assert from "node:assert/strict";
import { buildPurchaseInvoicePrintHtml, type PurchaseInvoiceStatementInput } from "../src/views/admin/print-helpers";

const fixture: PurchaseInvoiceStatementInput = {
  invoiceNo: "PI-<script>alert(1)</script>",
  issuedAt: "2026-09-10T12:00:00.000Z",
  supplierName: "مورد اختبار طويل جداً لفحص الالتفاف",
  paymentStatus: "partial",
  items: [{
    productName: "منتج طويل جداً <img src=x onerror=alert(1)>",
    quantity: "123456789.75",
    unitPrice: "987654321000",
    total: "8765432109876.75",
  }],
  total: "8765432109876.75",
  paid: "7000000000000",
  remaining: "1765432109876.75",
  notes: "ملاحظة <script>alert(2)</script>",
};

const a4 = buildPurchaseInvoicePrintHtml(fixture, "a4");
assert.match(a4, /@page \{ size: A4 portrait;/);
assert.match(a4, /purchase-invoice-sheet/);
assert.doesNotMatch(a4, /purchase-thermal-receipt/);
assert.doesNotMatch(a4, /name="viewport"/);

const thermal = buildPurchaseInvoicePrintHtml(fixture, "80mm");
assert.match(thermal, /@page \{ size: 80mm auto; margin: 0; \}/);
assert.match(thermal, /data-paper-size="80mm"/);
assert.match(thermal, /8,765,432,109,876\.75/);
assert.match(thermal, /flex-wrap: wrap/);
assert.match(thermal, /overflow-wrap: anywhere/);
assert.doesNotMatch(thermal, /\.num[^}]*white-space: nowrap/);
assert.doesNotMatch(thermal, /<script>alert\(1\)<\/script>/);
assert.match(thermal, /&lt;script&gt;alert\(2\)&lt;\/script&gt;/);

console.log("Purchase invoice A4 and 80mm print compositions verified.");
