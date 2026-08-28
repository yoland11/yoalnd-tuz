#!/usr/bin/env node

/**
 * Read-only schema contract audit.
 *
 * It deliberately introspects PostgreSQL rather than trusting a revision row:
 * a marker alone cannot prove a failed or manually skipped migration supplied
 * every table, column, index, and foreign key the Drizzle schema requires.
 */
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import * as databaseSchema from "@workspace/db/schema";
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";

const REQUIRED_SCHEMA_REVISION = Number(
  process.env.AJN_REQUIRED_SCHEMA_REVISION ?? "101",
);
const configuredConnectionString = process.env.AJN_SCHEMA_DATABASE_URL;

if (!configuredConnectionString) {
  console.warn("Production audit: SKIPPED");
  console.warn("Reason: AJN_SCHEMA_DATABASE_URL unavailable.");
  process.exit(0);
}
if (!Number.isInteger(REQUIRED_SCHEMA_REVISION) || REQUIRED_SCHEMA_REVISION < 1)
  throw new Error("AJN_REQUIRED_SCHEMA_REVISION must be a positive integer");

const target = new URL(configuredConnectionString);
const poolerHost = process.env.AJN_SCHEMA_POOLER_HOST?.trim();
if (poolerHost) {
  const projectRef = target.hostname.match(/^db\.([a-z0-9-]+)\.supabase\.co$/i)?.[1];
  if (!projectRef)
    throw new Error("AJN_SCHEMA_POOLER_HOST requires a Supabase direct database URL");
  const baseUser = decodeURIComponent(target.username).split(".")[0];
  target.hostname = poolerHost;
  target.port = process.env.AJN_SCHEMA_POOLER_PORT?.trim() || "5432";
  target.username = `${baseUser}.${projectRef}`;
}
const connectionString = target.toString();
const databaseName = decodeURIComponent(target.pathname.replace(/^\//, ""));
if (!/^postgres(?:ql)?:$/.test(target.protocol))
  throw new Error("AJN_SCHEMA_DATABASE_URL must be a PostgreSQL URL");
if (
  !target.hostname ||
  ["localhost", "127.0.0.1", "::1"].includes(target.hostname.toLowerCase()) ||
  /(^|[_-])(test|testing|dev|development|staging|preview)($|[_-])/i.test(
    databaseName,
  )
)
  throw new Error("Refusing a local, test, development, staging, or preview database");

type ExpectedForeignKey = {
  table: string;
  columns: string[];
  foreignTable: string;
  foreignColumns: string[];
};

const expectedTables = new Map<string, Set<string>>();
const expectedIndexes: Array<{
  table: string;
  name: string;
  columns: string[];
  unique: boolean;
}> = [];
const expectedForeignKeys: ExpectedForeignKey[] = [];

for (const candidate of Object.values(databaseSchema)) {
  if (!is(candidate, PgTable)) continue;
  const tableName = getTableName(candidate);
  if (!expectedTables.has(tableName)) {
    expectedTables.set(
      tableName,
      new Set(Object.values(getTableColumns(candidate)).map((column) => column.name)),
    );
  }
  const config = getTableConfig(candidate);
  for (const index of config.indexes) {
    const indexConfig = (index as any).config;
    const name = indexConfig?.name;
    const columns = (indexConfig?.columns ?? [])
      .map((column: any) => column.name)
      .filter(Boolean);
    if (name && columns.length)
      expectedIndexes.push({
        table: tableName,
        name,
        columns,
        unique: Boolean(indexConfig.unique),
      });
  }
  for (const foreignKey of config.foreignKeys) {
    const reference = (foreignKey as any).reference();
    expectedForeignKeys.push({
      table: tableName,
      columns: reference.columns.map((column: any) => column.name),
      foreignTable: getTableName(reference.foreignTable),
      foreignColumns: reference.foreignColumns.map((column: any) => column.name),
    });
  }
}

const repositoryRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const migrationFiles = readdirSync(resolve(repositoryRoot, "lib/db/migrations"))
  .filter((name) => /^\d+.*\.sql$/i.test(name))
  .sort((left, right) => left.localeCompare(right, "en"));
const migrationPrefixes = new Map<string, string[]>();
for (const name of migrationFiles) {
  const prefix = name.match(/^(\d+)/)?.[1] ?? "unknown";
  const entries = migrationPrefixes.get(prefix) ?? [];
  entries.push(name);
  migrationPrefixes.set(prefix, entries);
}
const ambiguousMigrationOrder = [...migrationPrefixes.entries()]
  .filter(([, entries]) => entries.length > 1)
  .map(([prefix, entries]) => ({ prefix, files: entries }));

const pool = new pg.Pool({
  connectionString,
  max: 1,
  idleTimeoutMillis: 5_000,
  connectionTimeoutMillis: 15_000,
  ssl:
    process.env.AJN_SCHEMA_TLS_NO_VERIFY === "true"
      ? { rejectUnauthorized: false }
      : undefined,
});

let client: pg.PoolClient | undefined;
try {
  client = await pool.connect();
  await client.query("BEGIN READ ONLY");
  await client.query("SET LOCAL statement_timeout = '60000ms'");
  await client.query("SET LOCAL lock_timeout = '3000ms'");

  const columnRows = await client.query<{
    table_name: string;
    column_name: string;
  }>(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `);
  const actualTables = new Map<string, Set<string>>();
  for (const row of columnRows.rows) {
    const columns = actualTables.get(row.table_name) ?? new Set<string>();
    columns.add(row.column_name);
    actualTables.set(row.table_name, columns);
  }

  const indexRows = await client.query<{
    tablename: string;
    indexname: string;
    is_unique: boolean;
    columns: string[];
    definition: string;
  }>(`
    SELECT
      table_rel.relname AS tablename,
      index_rel.relname AS indexname,
      index_meta.indisunique AS is_unique,
      pg_get_indexdef(index_rel.oid) AS definition,
      COALESCE(
        json_agg(attribute.attname ORDER BY index_column.ordinality)
          FILTER (WHERE attribute.attname IS NOT NULL),
        '[]'::json
      ) AS columns
    FROM pg_index index_meta
    JOIN pg_class index_rel ON index_rel.oid = index_meta.indexrelid
    JOIN pg_class table_rel ON table_rel.oid = index_meta.indrelid
    JOIN pg_namespace namespace ON namespace.oid = table_rel.relnamespace
    LEFT JOIN LATERAL unnest(index_meta.indkey) WITH ORDINALITY AS index_column(attribute_number, ordinality) ON true
    LEFT JOIN pg_attribute attribute
      ON attribute.attrelid = table_rel.oid
      AND attribute.attnum = index_column.attribute_number
    WHERE namespace.nspname = 'public'
    GROUP BY table_rel.relname, index_rel.relname, index_rel.oid, index_meta.indisunique
  `);
  const actualIndexes = indexRows.rows.map((row) => ({
    ...row,
    columns: Array.isArray(row.columns) ? row.columns : JSON.parse(String(row.columns ?? "[]")),
  }));

  const foreignKeyRows = await client.query<{
    table_name: string;
    column_name: string;
    foreign_table_name: string;
    foreign_column_name: string;
    ordinal_position: number;
  }>(`
    SELECT
      tc.table_name,
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name,
      kcu.ordinal_position
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
    ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position
  `);
  const actualForeignKeys = new Set(
    foreignKeyRows.rows.map(
      (row) =>
        `${row.table_name}.${row.column_name}->${row.foreign_table_name}.${row.foreign_column_name}`,
    ),
  );

  const revisionTable = actualTables.has("ajn_schema_revisions");
  const revisionRows = revisionTable
    ? await client.query<{ revision: number }>(
        "SELECT revision FROM ajn_schema_revisions ORDER BY revision",
      )
    : { rows: [] as Array<{ revision: number }> };
  const appliedRevisions = revisionRows.rows.map((row) => Number(row.revision));

  const missingTables: string[] = [];
  const missingColumns: string[] = [];
  for (const [table, columns] of expectedTables) {
    const actualColumns = actualTables.get(table);
    if (!actualColumns) {
      missingTables.push(table);
      continue;
    }
    for (const column of columns) {
      if (!actualColumns.has(column)) missingColumns.push(`${table}.${column}`);
    }
  }
  const missingIndexes = expectedIndexes
    .filter(
      (index) =>
        !actualIndexes.some(
          (actual) =>
            actual.tablename === index.table &&
            (index.unique ? actual.is_unique : true) &&
            (
              (actual.columns.length === index.columns.length &&
                actual.columns.every((column, position) => column === index.columns[position])) ||
              // PostgreSQL expression indexes (for example COALESCE used to
              // enforce NULL-safe favorites uniqueness) have no attname in
              // pg_index.indkey. A same-named unique index containing every
              // expected column is therefore the verified equivalent.
              (index.unique && actual.is_unique && actual.indexname === index.name &&
                index.columns.every((column) => actual.definition.includes(column)))
            ),
        ),
    )
    .map(
      (index) =>
        `${index.table}.${index.name} (${index.unique ? "UNIQUE " : ""}${index.columns.join(", ")})`,
    );
  const missingForeignKeys = expectedForeignKeys
    .filter((foreignKey) =>
      foreignKey.columns.some(
        (column, index) =>
          !actualForeignKeys.has(
            `${foreignKey.table}.${column}->${foreignKey.foreignTable}.${foreignKey.foreignColumns[index]}`,
          ),
      ),
    )
    .map(
      (foreignKey) =>
        `${foreignKey.table}.${foreignKey.columns.join(",")}->${foreignKey.foreignTable}.${foreignKey.foreignColumns.join(",")}`,
    );

  const report = {
    status:
      missingTables.length ||
      missingColumns.length ||
      missingIndexes.length ||
      missingForeignKeys.length ||
      !appliedRevisions.includes(REQUIRED_SCHEMA_REVISION)
        ? "DRIFT_DETECTED"
        : "SCHEMA_CURRENT",
    target: { database: databaseName, host: target.hostname },
    readOnly: true,
    requiredRevision: REQUIRED_SCHEMA_REVISION,
    appliedRevisions,
    missingRequiredRevision: !appliedRevisions.includes(REQUIRED_SCHEMA_REVISION),
    expected: {
      tables: expectedTables.size,
      indexes: expectedIndexes.length,
      foreignKeys: expectedForeignKeys.length,
    },
    differences: {
      missingTables: missingTables.sort(),
      missingColumns: missingColumns.sort(),
      missingIndexes: missingIndexes.sort(),
      missingForeignKeys: missingForeignKeys.sort(),
      ambiguousMigrationOrder,
    },
  };
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "SCHEMA_CURRENT") process.exitCode = 2;
} finally {
  await client?.query("ROLLBACK").catch(() => undefined);
  client?.release();
  await pool.end().catch(() => undefined);
}
