import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const file of [resolve(projectRoot, ".env.local"), resolve(projectRoot, ".env")]) {
  if (existsSync(file)) loadEnvFile(file);
}

const { backfillPhotographyBookings } = await import(
  "../src/server/photography-booking-integration"
);

const apply = process.argv.includes("--apply");
const limitFlag = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitFlag ? Number(limitFlag.split("=")[1]) : 1000;

if (apply && !process.argv.includes("--confirm")) {
  throw new Error("Apply mode requires both --apply and --confirm. Dry-run is the default.");
}

const report = await backfillPhotographyBookings({
  dryRun: !apply,
  limit: Number.isInteger(limit) && limit > 0 ? limit : 1000,
  actor: { name: "photography-backfill-cli" },
});

console.log(JSON.stringify(report, null, 2));
