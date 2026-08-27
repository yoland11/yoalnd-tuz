import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  assertSafeTestDatabase,
  printBlockedTest,
} from "./lib/test-database-guard.mjs";

const suites = {
  production: "scripts/test-production-safety.ts",
  phase2: "scripts/test-phase2-production-safety.ts",
  phase3: "scripts/test-phase3-release-readiness.ts",
};
const suite = process.argv[2];
if (!suite || !suites[suite]) {
  console.error(`Unknown safe DB test suite: ${suite ?? "(missing)"}`);
  process.exit(2);
}

let safe;
try {
  safe = assertSafeTestDatabase(process.env);
} catch (error) {
  printBlockedTest(error);
  process.exit(2);
}

console.log(`AJN safe write target verified: ${safe.database}`);
const result = spawnSync(
  process.execPath,
  [
    resolve("scripts/run-tsx.mjs"),
    "--tsconfig",
    "tsconfig.json",
    suites[suite],
  ],
  {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: safe.url },
    stdio: "inherit",
  },
);
if (result.status !== 0) {
  console.error("AJN CRITICAL REGRESSION");
  console.error(`Subsystem: ${suite}`);
  console.error("Operation: Safe database integration suite");
  console.error("Expected: All critical contracts pass.");
  console.error(`Actual: Test process exited with ${result.status ?? "no status"}.`);
  console.error("Deployment: BLOCKED");
  process.exit(result.status ?? 1);
}
console.log(`PASS  ${suite} safe database integration suite`);
