#!/usr/bin/env node

/** Controlled production DDL runner for reviewed additive migrations only. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const migrationPath = process.env.AJN_MIGRATION_FILE;
// A reviewed DDL operation must never reuse the read-only audit credential.
const connectionString = process.env.AJN_MIGRATION_DATABASE_URL;
if (!migrationPath || !connectionString)
  throw new Error("AJN_MIGRATION_FILE and AJN_MIGRATION_DATABASE_URL are required");
const absoluteMigrationPath = resolve(migrationPath);
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
