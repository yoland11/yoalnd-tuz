#!/usr/bin/env node

/** Controlled production DDL runner for reviewed additive migrations only. */
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const migrationPath = process.env.AJN_MIGRATION_FILE;
const connectionString = process.env.AJN_SCHEMA_DATABASE_URL;
if (process.env.AJN_APPLY_PRODUCTION_SCHEMA !== "YES")
  throw new Error("Set AJN_APPLY_PRODUCTION_SCHEMA=YES after a successful backup and preflight");
if (!migrationPath || !connectionString)
  throw new Error("AJN_MIGRATION_FILE and AJN_SCHEMA_DATABASE_URL are required");
const backupPath = process.env.AJN_BACKUP_FILE;
if (!backupPath || !existsSync(backupPath) || statSync(backupPath).size < 1024)
  throw new Error("AJN_BACKUP_FILE must reference a non-empty pre-migration backup");
const absoluteMigrationPath = resolve(migrationPath);
const migrationSql = readFileSync(absoluteMigrationPath, "utf8");
if (/^\s*(?:UPDATE|DELETE\s+FROM|TRUNCATE|DROP)\b/im.test(migrationSql))
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
