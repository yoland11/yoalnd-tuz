import { spawnSync } from "node:child_process";

const suites = [
  "domain", "read", "store", "mutations", "schema", "permissions", "assignment", "route", "preflight", "booking", "customer-identity", "wiring", "ui",
];
for (const suite of suites) {
  const path = `scripts/test-customer-followup-${suite}.${suite === "ui" ? "tsx" : "ts"}`;
  const result = spawnSync(process.execPath, ["scripts/run-tsx.mjs", "--tsconfig", "tsconfig.json", path], { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`PASS customer followup feature (${suites.length} controlled/domain/UI suites). Live database write integration not executed.`);
