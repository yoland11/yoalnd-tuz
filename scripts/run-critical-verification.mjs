import { spawnSync } from "node:child_process";

const deploy = process.argv.includes("--deploy");
const steps = [
  ["TypeScript", "pnpm", ["run", "typecheck"]],
  ["Database contracts", "pnpm", ["run", "test:db-contracts"]],
  ["Production write guard", "pnpm", ["run", "test:production-lock"]],
  ["Runtime DDL protection", "pnpm", ["run", "test:no-runtime-ddl"]],
  ["Database/shared-core change authorization", "pnpm", ["run", "test:critical-file-changes"]],
  ["Critical save/API/idempotency/legacy suite", "pnpm", ["run", "test:save-smoke"]],
  ["Production build", "pnpm", ["run", "build"]],
  ["Git whitespace integrity", "git", ["diff", "--check"]],
];

console.log(deploy ? "AJN DEPLOYMENT SAFETY GATE" : "AJN CRITICAL SAFETY GATE");
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

console.log(
  deploy
    ? "AJN DEPLOYMENT SAFETY CHECK PASSED — Deployment may proceed."
    : "AJN SAFETY CHECK PASSED — Push allowed.",
);
