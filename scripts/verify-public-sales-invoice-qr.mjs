import { readFileSync } from "node:fs";

const api = readFileSync("src/server/api.ts", "utf8");
const page = readFileSync("src/views/track.tsx", "utf8");
const invoiceStatusSource = api.slice(api.indexOf('if (row.entityType === "invoice")'), api.indexOf('if (row.entityType === "kosha_booking")'));
let failures = 0;

function check(name, condition) {
  if (condition) console.log(`✓ ${name}`);
  else {
    failures += 1;
    console.error(`✗ ${name}`);
  }
}

// Safe source-level contract test: this suite never reads or writes invoice data.
check("QR status resolves invoices from the verified token row", api.includes('row.entityType === "invoice"') && api.includes("salesInvoicesTable.id, row.entityId"));
check("public response returns only whitelisted invoice item fields", invoiceStatusSource.includes("productName: true") && invoiceStatusSource.includes("unitPrice: true") && invoiceStatusSource.includes("total: true") && !invoiceStatusSource.includes("costPrice: true"));
check("public response includes server-originated financial totals", api.includes("paidAmount = Number(invoice.paidAmount") && api.includes("remainingAmount = Number(invoice.remainingAmount"));
check("public delivery payload is explicitly whitelisted", api.includes("province: deliveryRow.detail.provinceName") && api.includes("trackingCode: deliveryRow.order?.deliveryNo"));
check("notes are omitted when blank on the API", api.includes("invoice.notes.trim() ? invoice.notes : null"));
check("invalid QR tokens receive a public-safe error", api.includes("رابط التحقق غير صالح."));
check("public page has an invoice-specific read-only card", page.includes("function PublicSalesInvoiceQrCard"));
check("public page hides notes when blank", page.includes("typeof invoice.notes === \"string\" && invoice.notes.trim().length > 0"));
check("public page renders all safe invoice items", page.includes("items.map((item: any, index: number)"));
check("public page conditionally hides delivery and history sections", page.includes("{hasDelivery ?") && page.includes("{history.length > 0 ?"));

if (failures) process.exitCode = 1;
else console.log("Public sales invoice QR contract passed.");
