import { spawnSync } from "node:child_process";
import {
  assertSafeTestDatabase,
  printBlockedTest,
} from "./lib/test-database-guard.mjs";

let safe;
try {
  safe = assertSafeTestDatabase(process.env);
} catch (error) {
  printBlockedTest(error);
  process.exit(2);
}

const env = { ...process.env };
const suites = [
  ["Static save/API/legacy contracts", "test:save-contracts"],
  ["Phase 2 production safety", "test:phase2-safety"],
  ["Phase 3 release readiness and critical writes", "test:phase3-readiness"],
  ["Financial idempotency and rollback safety", "test:production-safety"],
];

console.log(`AJN save smoke run ID: TEST-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`);
console.log(`AJN safe write target verified: ${safe.database}`);

for (const [label, script] of suites) {
  const pnpmArgs = ["run", script];
  const executable = process.env.npm_execpath ? process.execPath : "pnpm";
  const args = process.env.npm_execpath
    ? [process.env.npm_execpath, ...pnpmArgs]
    : pnpmArgs;
  const result = spawnSync(executable, args, {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
    shell: process.platform === "win32" && !process.env.npm_execpath,
  });
  if (result.status !== 0) {
    console.error("AJN CRITICAL REGRESSION");
    console.error(`Subsystem: ${label}`);
    console.error(`Operation: pnpm run ${script}`);
    console.error("Expected: Critical save path passes against the isolated TEST database.");
    console.error(`Actual: Test exited with ${result.status ?? "no status"}.`);
    console.error("Likely affected component: See the first failing assertion above.");
    console.error("Deployment: BLOCKED");
    process.exit(result.status ?? 1);
  }
}

console.log("AJN SAFETY CHECK PASSED — Critical save smoke suite completed safely.");
