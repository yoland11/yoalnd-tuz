#!/usr/bin/env node

/** Controlled production DDL runner for reviewed additive migrations only. */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const migrationPath = process.env.AJN_MIGRATION_FILE;
// Reviewed DDL uses the authoritative production owner connection. It must
// never reuse the read-only audit credential or a test connection.
const connectionString = process.env.DATABASE_URL;
if (!migrationPath || !connectionString)
  throw new Error("AJN_MIGRATION_FILE and DATABASE_URL are required");
// `pnpm --filter @workspace/db` runs this script from `lib/db`, while the
// approved command normally receives a repository-root path. Accept either
// the package-local path or the repository-root path without guessing a file.
const migrationCandidates = [
  resolve(migrationPath),
  resolve(process.cwd(), "..", "..", migrationPath),
];
const absoluteMigrationPath = migrationCandidates.find(existsSync);
if (!absoluteMigrationPath)
  throw new Error("The reviewed migration file was not found");
const migrationSql = readFileSync(absoluteMigrationPath, "utf8");
if (/\b(?:DROP\s+(?:TABLE|COLUMN|INDEX|TYPE|SCHEMA)|TRUNCATE|DELETE\s+FROM|UPDATE\b|ALTER\s+TABLE[\s\S]*?\b(?:DROP\s+COLUMN|ALTER\s+COLUMN|RENAME\s+(?:COLUMN|TO)))\b/i.test(migrationSql))
  throw new Error("Only additive DDL migrations are accepted by this production runner");

const client = new pg.Client({
  connectionString,
  connectionTimeoutMillis: 15_000,
  ssl: process.env.AJN_SCHEMA_TLS_NO_VERIFY === "true" ? { rejectUnauthorized: false } : undefined,
});
try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout = '5000ms'");
  await client.query("SET LOCAL statement_timeout = '120000ms'");
  await client.query(migrationSql);
  await client.query("COMMIT");
  console.log(JSON.stringify({ status: "APPLIED", migration: absoluteMigrationPath }));
} catch (error: any) {
  await client.query("ROLLBACK").catch(() => undefined);
  console.error(JSON.stringify({ status: "ROLLED_BACK", code: error?.code ?? null, constraint: error?.constraint ?? null }));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
