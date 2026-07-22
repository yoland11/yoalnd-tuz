import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");

async function loadProjectEnv() {
  for (const file of [".env.local", ".env"]) {
    try {
      const content = await readFile(path.join(projectRoot, file), "utf8");
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const separator = trimmed.indexOf("=");
        if (separator <= 0) continue;
        const key = trimmed.slice(0, separator).trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) continue;
        let value = trimmed.slice(separator + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) value = value.slice(1, -1);
        process.env[key] = value.replace(/\\n/g, "\n");
      }
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

await loadProjectEnv();

function valueOf(name: string) {
  const prefix = `--${name}=`;
  const entry = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return entry?.slice(prefix.length);
}

function positiveInt(name: string) {
  const raw = valueOf(name);
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`--${name} يجب أن يكون رقماً صحيحاً موجباً`);
  return value;
}

function dateValue(name: string) {
  const raw = valueOf(name);
  if (!raw) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error(`--${name} يجب أن يكون بصيغة YYYY-MM-DD`);
  return raw;
}

const execute = process.argv.includes("--execute");
const all = process.argv.includes("--all");
const confirm = valueOf("confirm");
if (execute && confirm !== "REPAIR-CUSTOMER-RECEIVABLES") {
  throw new Error(
    "التنفيذ الفعلي يتطلب --confirm=REPAIR-CUSTOMER-RECEIVABLES. بدون ذلك استخدم Dry Run الافتراضي.",
  );
}

const filters = {
  from: dateValue("from"),
  to: dateValue("to"),
  customerId: positiveInt("customer"),
  invoiceId: positiveInt("invoice"),
  limit: all ? 100_000 : positiveInt("limit") ?? 5_000,
};

const repair = await import("../src/server/customer-receivable-repair");
const { pool } = await import("../lib/db/src/index");

try {
  const report = execute
    ? await repair.executeHistoricalCustomerReceivableRepair(filters, {
        id: positiveInt("actor-id") ?? null,
        name: valueOf("actor-name")?.trim() || "system_backfill",
      })
    : await repair.previewHistoricalCustomerReceivables(filters);
  const serialized = JSON.stringify(report, null, 2);
  const output = valueOf("output");
  if (output) {
    const target = path.resolve(projectRoot, output);
    await writeFile(target, `${serialized}\n`, "utf8");
    process.stdout.write(`Report: ${target}\n`);
  }
  process.stdout.write(`${serialized}\n`);
} finally {
  await pool.end();
}
