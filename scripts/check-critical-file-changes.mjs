import { spawnSync } from "node:child_process";

function git(args, allowFailure = false) {
  const result = spawnSync(process.platform === "win32" ? "git.exe" : "git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status !== 0 && !allowFailure)
    throw new Error(result.stderr?.trim() || `git ${args.join(" ")} failed`);
  return result.status === 0 ? result.stdout.trim() : "";
}

const changed = new Set();
const add = (output) =>
  output
    .split(/\r?\n/)
    .map((value) => value.trim().replaceAll("\\", "/"))
    .filter(Boolean)
    .forEach((value) => changed.add(value));

const base = process.env.AJN_DIFF_BASE?.trim();
if (base && !/^0+$/.test(base)) add(git(["diff", "--name-only", "--diff-filter=ACMR", `${base}...HEAD`]));
else {
  add(git(["diff", "--name-only", "--diff-filter=ACMR"]));
  add(git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]));
}

const schemaPatterns = [
  /^lib\/db\/src\/schema\//,
  /^lib\/db\/migrations\//,
  /^lib\/db\/src\/index\.ts$/,
  /^lib\/db\/drizzle\.config\.ts$/,
];
const sharedCorePatterns = [
  /^src\/server\/master-cash-box\.ts$/,
  /^src\/server\/customer-receivable-repair\.ts$/,
  /^src\/server\/desktop-idempotency\.ts$/,
  /^src\/server\/api\.ts$/,
  /^src\/server\/.*(?:payment|inventory|accounting|booking|invoice).*\.ts$/,
  /^scripts\/(?:apply-reviewed-schema-migration|schema-preflight)\.ts$/,
];

const schemaChanges = [...changed].filter((file) => schemaPatterns.some((pattern) => pattern.test(file)));
const sharedCoreChanges = [...changed].filter((file) => sharedCorePatterns.some((pattern) => pattern.test(file)));
const scope = process.env.AJN_CHANGE_SCOPE?.trim() || "standard";
const databaseApproved =
  process.env.AJN_DB_CHANGE_APPROVED === "true" || scope === "database-approved";

const failures = [];
if (schemaChanges.length && !databaseApproved) {
  failures.push(
    "Database schema/migration files changed without AJN_DB_CHANGE_APPROVED=true or AJN_CHANGE_SCOPE=database-approved.",
  );
}
if (scope === "ui-only" && sharedCoreChanges.length) {
  failures.push("A UI-only task changed shared persistence/financial core files.");
}

if (schemaChanges.length) console.log(`AJN database-sensitive changes:\n- ${schemaChanges.join("\n- ")}`);
if (sharedCoreChanges.length) console.log(`AJN high-blast-radius changes:\n- ${sharedCoreChanges.join("\n- ")}`);

if (failures.length) {
  console.error("AJN CRITICAL REGRESSION");
  console.error("Subsystem: Change authorization");
  console.error("Operation: Database/shared-core change detection");
  console.error("Expected: No unauthorized migration, schema, or shared-core change.");
  console.error(`Actual: ${failures.join(" ")}`);
  console.error("Deployment: BLOCKED");
  process.exit(1);
}

console.log(`PASS  Critical-file change policy (${scope})`);
