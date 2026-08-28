import { spawnSync } from "node:child_process";
import {
  assertSafeTestDatabase,
  printBlockedTest,
} from "./lib/test-database-guard.mjs";

const deploy = process.argv.includes("--deploy");
const strict = process.argv.includes("--strict");
const steps = [
  ["TypeScript", "pnpm", ["run", "typecheck"]],
  ["Database contracts", "pnpm", ["run", "test:db-contracts"]],
  ["Production write guard", "pnpm", ["run", "test:production-lock"]],
  ["Runtime DDL protection", "pnpm", ["run", "test:no-runtime-ddl"]],
  ["Database/shared-core change authorization", "pnpm", ["run", "test:critical-file-changes"]],
  ["Financial approval invariant", "pnpm", ["run", "test:financial-approval"]],
  ["Payment-state reconciliation invariant", "pnpm", ["run", "test:payment-state"]],
  ["Production build", "pnpm", ["run", "build"]],
  ["Git whitespace integrity", "git", ["diff", "--check"]],
];

let safeTestDatabase = null;
try {
  safeTestDatabase = assertSafeTestDatabase(process.env);
} catch (error) {
  if (strict) {
    printBlockedTest(error, "STRICT VERIFICATION BLOCKED");
    process.exit(2);
  }
  console.warn("AJN DATABASE INTEGRATION TESTS SKIPPED — no valid isolated TEST_DATABASE_URL is configured.");
  console.warn("Run `pnpm run verify:strict` with AJN_ENV=test, ALLOW_TEST_WRITES=true, and a separate TEST_DATABASE_URL to include write/integration tests.");
}

console.log(
  deploy
    ? strict
      ? "AJN STRICT DEPLOYMENT SAFETY GATE"
      : "AJN DEPLOYMENT SAFETY GATE"
    : strict
      ? "AJN STRICT CRITICAL SAFETY GATE"
      : "AJN CRITICAL SAFETY GATE",
);
for (const [subsystem, command, args] of steps) {
  console.log(`\n[AJN] ${subsystem}`);
  const executable =
    command === "pnpm" && process.env.npm_execpath
      ? process.execPath
      : command === "git" && process.platform === "win32"
        ? "git.exe"
        : command;
  const commandArgs =
    command === "pnpm" && process.env.npm_execpath
      ? [process.env.npm_execpath, ...args]
      : args;
  const result = spawnSync(executable, commandArgs, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    shell:
      process.platform === "win32" &&
      command === "pnpm" &&
      !process.env.npm_execpath,
  });
  if (result.status !== 0) {
    if (deploy && subsystem === "Critical save/API/idempotency/legacy suite" && !process.env.TEST_DATABASE_URL) {
      console.error("DEPLOYMENT VERIFICATION INCOMPLETE: TEST_DATABASE_URL is unavailable.");
    }
    console.error("AJN CRITICAL REGRESSION");
    console.error(`Subsystem: ${subsystem}`);
    console.error(`Operation: ${command} ${args.join(" ")}`);
    console.error("Expected: Validation passes before release.");
    console.error(`Actual: Command exited with ${result.status ?? "no status"}.`);
    console.error("Deployment: BLOCKED");
    process.exit(result.status ?? 1);
  }
}

if (safeTestDatabase) {
  console.log(`\n[AJN] Critical save/API/idempotency/legacy suite (isolated ${safeTestDatabase.database})`);
  const executable = process.env.npm_execpath ? process.execPath : "pnpm";
  const args = process.env.npm_execpath
    ? [process.env.npm_execpath, "run", "test:save-smoke"]
    : ["run", "test:save-smoke"];
  const result = spawnSync(executable, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32" && !process.env.npm_execpath,
  });
  if (result.status !== 0) {
    console.error("AJN CRITICAL REGRESSION");
    console.error("Subsystem: Critical save/API/idempotency/legacy suite");
    console.error("Operation: pnpm run test:save-smoke");
    console.error("Expected: Validation passes against the isolated test database.");
    console.error(`Actual: Command exited with ${result.status ?? "no status"}.`);
    console.error("Deployment: BLOCKED");
    process.exit(result.status ?? 1);
  }
} else {
  console.warn("AJN DATABASE INTEGRATION TESTS: SKIPPED (normal release policy; not reported as PASS).");
}

console.log(
  deploy
    ? "AJN DEPLOYMENT SAFETY CHECK PASSED — Deployment may proceed."
    : "AJN SAFETY CHECK PASSED — Push allowed.",
);
