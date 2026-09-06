const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  module._compile(compiled, filename);
};

const databaseSchema = require(path.resolve(__dirname, "../lib/db/src/schema/index.ts"));
const { getTableColumns, getTableName, is } = require("drizzle-orm");
const { getTableConfig, PgDialect, PgTable } = require("drizzle-orm/pg-core");

const dialect = new PgDialect();
const normalizeSql = (source) => source.replace(/\s+/g, " ").trim().toLowerCase();

const expectedColumns = {
  kosha_manager_instructions: {
    id: ["serial", true, true],
    booking_source: ["varchar(12)", true, false],
    booking_id: ["integer", true, false],
    kind: ["varchar(12)", true, false],
    media_url: ["text", false, false],
    caption: ["text", false, false],
    uploaded_by_staff_id: ["integer", false, false],
    uploaded_by_name: ["text", false, false],
    revision: ["integer", true, true],
    archived_at: ["timestamp", false, false],
    archived_by_staff_id: ["integer", false, false],
    created_at: ["timestamp", true, true],
    updated_at: ["timestamp", true, true],
  },
  kosha_booking_channel_reads: {
    id: ["serial", true, true],
    booking_source: ["varchar(12)", true, false],
    booking_id: ["integer", true, false],
    staff_id: ["integer", true, false],
    channel: ["varchar(24)", true, false],
    viewed_at: ["timestamp", true, false],
    created_at: ["timestamp", true, true],
    updated_at: ["timestamp", true, true],
  },
};

const exportedTables = [
  ["koshaManagerInstructionsTable", "kosha_manager_instructions"],
  ["koshaBookingChannelReadsTable", "kosha_booking_channel_reads"],
];

const expectedEnums = {
  kosha_manager_instructions: {
    booking_source: ["kosha", "service"],
    kind: ["note", "image"],
  },
  kosha_booking_channel_reads: {
    booking_source: ["kosha", "service"],
    channel: ["manager_instruction", "staff_execution"],
  },
};

for (const [exportName, tableName] of exportedTables) {
  const table = databaseSchema[exportName];
  assert.ok(table && is(table, PgTable), `${exportName} must be exported as a Drizzle table`);
  assert.equal(getTableName(table), tableName);

  const columns = new Map(
    Object.values(getTableColumns(table)).map((column) => [column.name, column]),
  );
  for (const [columnName, [type, notNull, hasDefault]] of Object.entries(expectedColumns[tableName])) {
    const column = columns.get(columnName);
    assert.ok(column, `${tableName}.${columnName} must be declared`);
    assert.equal(column.getSQLType(), type, `${tableName}.${columnName} type`);
    assert.equal(Boolean(column.notNull), notNull, `${tableName}.${columnName} nullability`);
    assert.equal(Boolean(column.hasDefault), hasDefault, `${tableName}.${columnName} default`);
  }
  for (const [columnName, enumValues] of Object.entries(expectedEnums[tableName])) {
    assert.deepEqual(columns.get(columnName).enumValues, enumValues, `${tableName}.${columnName} must retain its inferred union`);
  }

  const config = getTableConfig(table);
  const foreignKeys = config.foreignKeys.map((foreignKey) => foreignKey.reference());
  const foreignKeyColumns = foreignKeys.flatMap((foreignKey) => foreignKey.columns.map((column) => column.name));
  assert.ok(!foreignKeyColumns.includes("booking_source") && !foreignKeyColumns.includes("booking_id"), `${tableName} must keep its booking identity polymorphic`);
}

const instructions = databaseSchema.koshaManagerInstructionsTable;
const reads = databaseSchema.koshaBookingChannelReadsTable;

const instructionConfig = getTableConfig(instructions);
const indexContracts = (config) => config.indexes.map((index) => ({
  name: index.config.name,
  columns: index.config.columns.map((column) => column.name),
  unique: Boolean(index.config.unique),
})).sort((a, b) => a.name.localeCompare(b.name));
assert.deepEqual(indexContracts(instructionConfig), [{
  name: "kosha_manager_instructions_active_booking_idx",
  columns: ["booking_source", "booking_id", "archived_at", "created_at"],
  unique: false,
}], "instructions must retain their named active-booking lookup index");
assert.deepEqual(
  instructionConfig.foreignKeys.map((foreignKey) => {
    const reference = foreignKey.reference();
    return {
      columns: reference.columns.map((column) => column.name),
      table: getTableName(reference.foreignTable),
      target: reference.foreignColumns.map((column) => column.name),
      onDelete: foreignKey.onDelete,
    };
  }).sort((a, b) => a.columns[0].localeCompare(b.columns[0])),
  [
    { columns: ["archived_by_staff_id"], table: "staff", target: ["id"], onDelete: "set null" },
    { columns: ["uploaded_by_staff_id"], table: "staff", target: ["id"], onDelete: "set null" },
  ],
  "instructions must retain safe staff attribution after staff deletion",
);
assert.deepEqual(
  instructionConfig.checks.map((constraint) => ({ name: constraint.name, sql: dialect.sqlToQuery(constraint.value).sql })).sort((a, b) => a.name.localeCompare(b.name)),
  [
    { name: "kosha_manager_instructions_booking_source_check", sql: "\"kosha_manager_instructions\".\"booking_source\" in ('kosha', 'service')" },
    { name: "kosha_manager_instructions_kind_check", sql: "\"kosha_manager_instructions\".\"kind\" in ('note', 'image')" },
    { name: "kosha_manager_instructions_media_check", sql: "(\"kosha_manager_instructions\".\"kind\" = 'image' and \"kosha_manager_instructions\".\"media_url\" is not null and btrim(\"kosha_manager_instructions\".\"media_url\") <> '') or (\"kosha_manager_instructions\".\"kind\" = 'note' and \"kosha_manager_instructions\".\"media_url\" is null)" },
  ],
  "instructions must constrain source, kind, and image media",
);
assert.equal(getTableColumns(instructions).revision.default, 1, "instructions must default revision to one");

const readConfig = getTableConfig(reads);
assert.deepEqual(indexContracts(readConfig), [
  { name: "kosha_booking_channel_reads_booking_channel_idx", columns: ["booking_source", "booking_id", "channel"], unique: false },
  { name: "kosha_booking_channel_reads_identity_idx", columns: ["booking_source", "booking_id", "staff_id", "channel"], unique: true },
], "reads must retain named unique and lookup indexes");
assert.deepEqual(
  readConfig.foreignKeys.map((foreignKey) => {
    const reference = foreignKey.reference();
    return {
      columns: reference.columns.map((column) => column.name),
      table: getTableName(reference.foreignTable),
      target: reference.foreignColumns.map((column) => column.name),
      onDelete: foreignKey.onDelete,
    };
  }),
  [{ columns: ["staff_id"], table: "staff", target: ["id"], onDelete: "restrict" }],
  "reads must attribute the viewer to staff",
);
assert.deepEqual(
  readConfig.checks.map((constraint) => ({ name: constraint.name, sql: dialect.sqlToQuery(constraint.value).sql })).sort((a, b) => a.name.localeCompare(b.name)),
  [
    { name: "kosha_booking_channel_reads_booking_source_check", sql: "\"kosha_booking_channel_reads\".\"booking_source\" in ('kosha', 'service')" },
    { name: "kosha_booking_channel_reads_channel_check", sql: "\"kosha_booking_channel_reads\".\"channel\" in ('manager_instruction', 'staff_execution')" },
  ],
  "reads must constrain booking source and channels",
);

const migrationSql = normalizeSql(fs.readFileSync(path.resolve(__dirname, "../lib/db/migrations/0110_kosha_manager_instructions.sql"), "utf8"));
for (const fragment of [
  'create table if not exists "kosha_manager_instructions"',
  '"uploaded_by_staff_id" integer references "staff" ("id") on delete set null',
  '"archived_by_staff_id" integer references "staff" ("id") on delete set null',
  '"revision" integer not null default 1',
  'constraint "kosha_manager_instructions_booking_source_check" check ("booking_source" in (\'kosha\', \'service\'))',
  'constraint "kosha_manager_instructions_kind_check" check ("kind" in (\'note\', \'image\'))',
  'constraint "kosha_manager_instructions_media_check" check (("kind" = \'image\' and "media_url" is not null and btrim("media_url") <> \'\') or ("kind" = \'note\' and "media_url" is null))',
  'create index if not exists "kosha_manager_instructions_active_booking_idx" on "kosha_manager_instructions" ("booking_source", "booking_id", "archived_at", "created_at")',
  'create table if not exists "kosha_booking_channel_reads"',
  '"staff_id" integer not null references "staff" ("id") on delete restrict',
  'constraint "kosha_booking_channel_reads_booking_source_check" check ("booking_source" in (\'kosha\', \'service\'))',
  'constraint "kosha_booking_channel_reads_channel_check" check ("channel" in (\'manager_instruction\', \'staff_execution\'))',
  'create unique index if not exists "kosha_booking_channel_reads_identity_idx" on "kosha_booking_channel_reads" ("booking_source", "booking_id", "staff_id", "channel")',
  'create index if not exists "kosha_booking_channel_reads_booking_channel_idx" on "kosha_booking_channel_reads" ("booking_source", "booking_id", "channel")',
]) assert.ok(migrationSql.includes(fragment), `migration must retain: ${fragment}`);

assert.ok("koshaManagerInstructionsRelations" in databaseSchema, "instruction staff relations must be exported");
assert.ok("koshaBookingChannelReadsRelations" in databaseSchema, "channel-read staff relations must be exported");

console.log("PASS: Kosha manager instruction and channel read schema contracts");
