import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const files = {
  schema: await readFile(resolve(root, "lib/db/src/schema/print-queue.ts"), "utf8"),
  server: await readFile(resolve(root, "src/server/remote-printing.ts"), "utf8"),
  api: await readFile(resolve(root, "src/server/api.ts"), "utf8"),
  agent: await readFile(resolve(root, "apps/print-agent/src/main.ts"), "utf8"),
  receipt: await readFile(resolve(root, "apps/print-agent/src/receipt.ts"), "utf8"),
};
const checks = [
  ["database queue tables", /printAgentsTable[\s\S]*printersTable[\s\S]*printJobsTable/.test(files.schema)],
  ["hashed agent credentials", /hashAgentToken[\s\S]*tokenHash/.test(files.server)],
  ["one-time registration", /registrationTokenHash[\s\S]*registrationTokenHash: null/.test(files.server)],
  ["atomic job claiming", /update\(printJobsTable\)[\s\S]*status: "claimed"[\s\S]*computerAgentId/.test(files.server)],
  ["server-built invoice payload", /buildSalesInvoicePayload[\s\S]*salesInvoiceItemsTable/.test(files.server)],
  ["agent-only queue endpoints", /handlePrintAgentApi[\s\S]*authenticatePrintAgent/.test(files.api)],
  ["mobile idempotency header", /idempotency-key/.test(files.api)],
  ["agent encrypted local credential", /safeStorage\.encryptString/.test(files.agent) && /safeStorage\.decryptString/.test(files.agent)],
  ["agent uses Windows printer driver", /getPrintersAsync[\s\S]*webContents\.print/.test(files.agent)],
  ["receipt keeps decimal quantities", /item\.quantity/.test(files.receipt) && !/Math\.floor\(item\.quantity/.test(files.receipt)],
  ["receipt omits blank notes", /invoice\.notes\?\.trim\(\)/.test(files.receipt)],
];
let failed = false;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failed = true;
}
if (failed) process.exitCode = 1;
