import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "lib/db/migrations/0113_payroll_movement_schema_recovery.sql",
  "utf8",
);

for (const column of ["manual_deduction", "payment_status", "line_notes"]) {
  assert.match(
    migration,
    new RegExp(`add column if not exists ${column}\\b`, "i"),
    `salary movement recovery must add ${column} when missing`,
  );
}

assert.doesNotMatch(migration, /\b(drop|truncate|delete|update)\b/i);
console.log("Payroll movement schema recovery: 4 assertions passed.");
