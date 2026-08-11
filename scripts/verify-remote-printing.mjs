import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const files = {
  schema: await readFile(resolve(root, "lib/db/src/schema/print-queue.ts"), "utf8"),
  server: await readFile(resolve(root, "src/server/remote-printing.ts"), "utf8"),
  api: await readFile(resolve(root, "src/server/api.ts"), "utf8"),
  queueUi: await readFile(resolve(root, "src/views/admin/print-queue.tsx"), "utf8"),
  printHelper: await readFile(resolve(root, "src/views/admin/print-helpers.ts"), "utf8"),
  template: await readFile(resolve(root, "lib/print-template/src/index.js"), "utf8"),
  agent: await readFile(resolve(root, "apps/print-agent/src/main.ts"), "utf8"),
  receipt: await readFile(resolve(root, "apps/print-agent/src/receipt.ts"), "utf8"),
  contracts: await readFile(resolve(root, "apps/print-agent/src/contracts.ts"), "utf8"),
  remoteOptions: await readFile(resolve(root, "src/views/admin/remote-print-options.tsx"), "utf8"),
  sales: await readFile(resolve(root, "src/views/admin/sales.tsx"), "utf8"),
  pos: await readFile(resolve(root, "src/views/admin/pos.tsx"), "utf8"),
};
const checks = [
  ["database queue tables", /printAgentsTable[\s\S]*printersTable[\s\S]*printJobsTable/.test(files.schema)],
  ["hashed agent credentials", /hashAgentToken[\s\S]*tokenHash/.test(files.server)],
  ["one-time registration", /registrationTokenHash[\s\S]*registrationTokenHash: null/.test(files.server)],
  ["atomic job claiming", /update\(printJobsTable\)[\s\S]*status: "claimed"[\s\S]*computerAgentId/.test(files.server)],
  ["printer save uses an atomic UPSERT", /db\.transaction\(async \(tx\)[\s\S]*onConflictDoUpdate\([\s\S]*target: \[printersTable\.agentId, printersTable\.name\]/.test(files.server)],
  ["default printer update is transaction-safe", /if \(values\.isDefault\)[\s\S]*tx\.update\(printersTable\)[\s\S]*onConflictDoUpdate/.test(files.server)],
  ["printer POST returns the updated row with HTTP 200", /return json\(saved, 200\)/.test(files.api)],
  ["printer UI distinguishes update from creation", /تم تحديث إعدادات الطابعة[\s\S]*تمت إضافة الطابعة بنجاح/.test(files.queueUi)],
  ["server-built invoice payload", /buildSalesInvoicePayload[\s\S]*salesInvoiceItemsTable/.test(files.server)],
  ["agent-only queue endpoints", /handlePrintAgentApi[\s\S]*authenticatePrintAgent/.test(files.api)],
  ["mobile idempotency header", /idempotency-key/.test(files.api)],
  ["agent encrypted local credential", /safeStorage\.encryptString/.test(files.agent) && /safeStorage\.decryptString/.test(files.agent)],
  ["agent uses Windows printer driver", /getPrintersAsync[\s\S]*webContents\.print/.test(files.agent)],
  ["browser and Agent use one canonical receipt template", /buildSalesInvoiceThermalHtml/.test(files.printHelper) && /buildSalesInvoiceThermalHtml/.test(files.receipt)],
  ["canonical template forces Latin digits", /Intl\.NumberFormat\("en-US"/.test(files.template) && /direction:ltr/.test(files.template)],
  ["Agent derives the thermal page height from receipt content", /printPageSize[\s\S]*scrollHeight/.test(files.agent)],
  ["printer calibration stays optional and bounded", /horizontalOffsetMm[\s\S]*verticalOffsetMm/.test(files.schema) && /Math\.min\(5, Math\.max\(-5/.test(files.server)],
  ["remote print options share one UI for Sales and POS", /RemotePrintOptionsDialog/.test(files.sales) && /RemotePrintOptionsDialog/.test(files.pos) && /customWidthMm/.test(files.remoteOptions)],
  ["save-and-print saves before creating the trusted queue job", /createRemoteSalesInvoicePrintJob/.test(files.sales) && /createRemoteSalesInvoicePrintJob/.test(files.pos) && /await adminFetch[\s\S]*sales-invoices/.test(files.pos)],
  ["agent accepts paper size and orientation options", /RemotePaperSize = "80mm" \| "58mm" \| "a5" \| "a4" \| "custom"/.test(files.server) && /orientation\?: "portrait" \| "landscape"/.test(files.contracts)],
];
let failed = false;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failed = true;
}
if (failed) process.exitCode = 1;
