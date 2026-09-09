const fs = require("node:fs");

const salesPath = "src/views/admin/sales.tsx";
const uiPath = "src/views/admin/sales-invoice-ui.tsx";
const sales = fs.readFileSync(salesPath, "utf8");
const ui = fs.existsSync(uiPath) ? fs.readFileSync(uiPath, "utf8") : "";

const checks = [
  ["existing save mutation stays canonical", sales.includes("async function saveInvoice") && sales.includes('adminFetch<{ invoice: SalesInvoice') && sales.includes('"/admin/sales-invoices"')],
  ["barcode keyboard flow remains", sales.includes("function handleSearchKey")],
  ["delivery section remains reused", sales.includes("<DeliverySection")],
  ["canonical cash settlement helper remains", sales.includes("isCashPaymentMethod")],
  ["decimal quantity remains supported", sales.includes('min="0.001"') && sales.includes('step="0.001"')],
  ["premium header component exists", ui.includes("export function SalesInvoiceHeader")],
  ["real category chips component exists", ui.includes("export function ProductCategoryChips")],
  ["invoice items component exists", ui.includes("export function InvoiceItemsCard")],
  ["totals component exists", ui.includes("export function InvoiceTotalsCard")],
  ["mobile save bar exists", ui.includes("export function InvoiceMobileSaveBar")],
];

let failed = 0;
for (const [label, ok] of checks) {
  if (ok) console.log(`PASS ${label}`);
  else {
    failed += 1;
    console.error(`FAIL ${label}`);
  }
}

if (failed) {
  console.error(`\n${failed} sales invoice UI contract check(s) failed.`);
  process.exit(1);
}

console.log("\nSales invoice UI contract verified.");
