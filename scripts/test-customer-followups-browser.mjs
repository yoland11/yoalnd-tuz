import { spawnSync } from "node:child_process";

for (const flow of ["browser", "booking-browser", "staff-browser"]) {
  const result = spawnSync(process.execPath, ["scripts/run-tsx.mjs", "--tsconfig", "tsconfig.json", `scripts/test-customer-followup-${flow}.ts`], { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log("PASS mounted followup acceptance: admin/staff screen, original booking form and original staff portal at desktop/mobile widths; all HTTP synthetic, no database writes.");
