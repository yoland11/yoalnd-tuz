import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as databaseSchema from "@workspace/db/schema";
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";

type ColumnContract = {
  type: string;
  notNull: boolean;
  hasDefault?: boolean;
  defaultValue?: string | number | boolean;
  primaryKey?: boolean;
  enumValues?: string[];
};
type TableContract = {
  columns: Record<string, ColumnContract>;
  unique?: string[][];
  foreignKeys?: Array<{ columns: string[]; table: string; target: string[] }>;
};
type ContractFile = { version: number; tables: Record<string, TableContract> };

const contract = JSON.parse(
  await readFile(new URL("./contracts/critical-db-contracts.json", import.meta.url), "utf8"),
) as ContractFile;
assert.equal(contract.version, 1, "Unsupported AJN DB contract version");

const tables = new Map<string, any>();
for (const candidate of Object.values(databaseSchema)) {
  if (is(candidate, PgTable)) tables.set(getTableName(candidate), candidate);
}

const failures: string[] = [];
const signature = (columns: string[]) => [...columns].join(",");

for (const [tableName, expected] of Object.entries(contract.tables)) {
  const table = tables.get(tableName);
  if (!table) {
    failures.push(`${tableName}: required table declaration is missing`);
    continue;
  }
  const columns = Object.values(getTableColumns(table)) as any[];
  const byName = new Map(columns.map((column) => [column.name, column]));
  for (const [columnName, columnContract] of Object.entries(expected.columns)) {
    const column = byName.get(columnName);
    if (!column) {
      failures.push(`${tableName}.${columnName}: required column is missing`);
      continue;
    }
    const actualType = column.getSQLType();
    if (actualType !== columnContract.type)
      failures.push(`${tableName}.${columnName}: type ${actualType} != ${columnContract.type}`);
    if (Boolean(column.notNull) !== columnContract.notNull)
      failures.push(`${tableName}.${columnName}: notNull=${Boolean(column.notNull)} != ${columnContract.notNull}`);
    if (columnContract.hasDefault !== undefined && Boolean(column.hasDefault) !== columnContract.hasDefault)
      failures.push(`${tableName}.${columnName}: hasDefault=${Boolean(column.hasDefault)} != ${columnContract.hasDefault}`);
    if (columnContract.primaryKey !== undefined && Boolean(column.primary) !== columnContract.primaryKey)
      failures.push(`${tableName}.${columnName}: primaryKey=${Boolean(column.primary)} != ${columnContract.primaryKey}`);
    if (columnContract.defaultValue !== undefined && column.default !== columnContract.defaultValue)
      failures.push(`${tableName}.${columnName}: default=${String(column.default)} != ${String(columnContract.defaultValue)}`);
    if (columnContract.enumValues && JSON.stringify(column.enumValues ?? []) !== JSON.stringify(columnContract.enumValues))
      failures.push(`${tableName}.${columnName}: enum values changed`);
  }

  const config = getTableConfig(table);
  const unique = new Set<string>();
  for (const column of columns) if (column.isUnique) unique.add(signature([column.name]));
  for (const constraint of config.uniqueConstraints as any[]) {
    const cols = constraint?.config?.columns?.map((column: any) => column.name).filter(Boolean) ?? [];
    if (cols.length) unique.add(signature(cols));
  }
  for (const index of config.indexes as any[]) {
    if (!index?.config?.unique) continue;
    const cols = index.config.columns?.map((column: any) => column.name).filter(Boolean) ?? [];
    if (cols.length) unique.add(signature(cols));
  }
  for (const columns of expected.unique ?? []) {
    if (!unique.has(signature(columns)))
      failures.push(`${tableName}: required unique contract (${columns.join(", ")}) is missing`);
  }

  const foreignKeys = (config.foreignKeys as any[]).map((foreignKey) => {
    const reference = foreignKey.reference();
    return {
      columns: reference.columns.map((column: any) => column.name),
      table: getTableName(reference.foreignTable),
      target: reference.foreignColumns.map((column: any) => column.name),
    };
  });
  for (const foreignKey of expected.foreignKeys ?? []) {
    const present = foreignKeys.some(
      (actual) =>
        signature(actual.columns) === signature(foreignKey.columns) &&
        actual.table === foreignKey.table &&
        signature(actual.target) === signature(foreignKey.target),
    );
    if (!present)
      failures.push(
        `${tableName}: FK ${foreignKey.columns.join(",")} -> ${foreignKey.table}.${foreignKey.target.join(",")} is missing`,
      );
  }
}

if (failures.length) {
  console.error("AJN CRITICAL REGRESSION");
  console.error("Subsystem: Database schema contracts");
  console.error("Operation: Critical schema compatibility audit");
  console.error("Expected: Required AJN columns, types, nullability, defaults, keys and relationships remain compatible.");
  console.error(`Actual:\n- ${failures.join("\n- ")}`);
  console.error("Deployment: BLOCKED");
  process.exit(1);
}

console.log(`PASS  ${Object.keys(contract.tables).length} critical AJN database table contracts are backward-compatible`);
console.log("PASS  Additive tables/columns and harmless indexes remain allowed");
