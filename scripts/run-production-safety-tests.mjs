import { spawnSync } from "node:child_process";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.error("FAIL  TEST_DATABASE_URL is required for production-safety integration tests");
  process.exit(1);
}
if (process.env.AJN_ENV !== "test" || process.env.ALLOW_TEST_WRITES !== "true") {
  console.error("FAIL  Set AJN_ENV=test and ALLOW_TEST_WRITES=true before database write tests");
  process.exit(1);
}

let databaseName = "";
try {
  databaseName = new URL(url).pathname.replace(/^\//, "");
} catch {
  console.error("FAIL  TEST_DATABASE_URL is not a valid PostgreSQL URL");
  process.exit(1);
}
if (!/(^|[_-])test($|[_-])/i.test(databaseName)) {
  console.error(`FAIL  Refusing writes because test database name is not clearly test-only: ${databaseName}`);
  process.exit(1);
}

const env = { ...process.env, DATABASE_URL: url };
for (const [label, args] of [
  ["production safety integration", ["--filter", "@workspace/db", "exec", "tsx", "--tsconfig", "../../tsconfig.json", "../../scripts/test-production-safety.ts"]],
]) {
  const result = spawnSync("pnpm", args, { cwd: process.cwd(), env, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`FAIL  ${label}`);
    process.exit(result.status ?? 1);
  }
  console.log(`PASS  ${label}`);
}
