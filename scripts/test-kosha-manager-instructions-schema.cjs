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
const { getTableConfig, PgTable } = require("drizzle-orm/pg-core");

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

  const config = getTableConfig(table);
  const foreignKeys = config.foreignKeys.map((foreignKey) => foreignKey.reference());
  const foreignKeyColumns = foreignKeys.flatMap((foreignKey) => foreignKey.columns.map((column) => column.name));
  assert.ok(!foreignKeyColumns.includes("booking_source") && !foreignKeyColumns.includes("booking_id"), `${tableName} must keep its booking identity polymorphic`);
}

const instructions = databaseSchema.koshaManagerInstructionsTable;
const reads = databaseSchema.koshaBookingChannelReadsTable;

const instructionConfig = getTableConfig(instructions);
const instructionIndexes = instructionConfig.indexes.map((index) => index.config.columns.map((column) => column.name).join(","));
assert.ok(instructionIndexes.includes("booking_source,booking_id,archived_at,created_at"), "instructions need an active-booking lookup index");
assert.deepEqual(
  instructionConfig.foreignKeys.map((foreignKey) => foreignKey.reference().columns.map((column) => column.name)).sort(),
  [["archived_by_staff_id"], ["uploaded_by_staff_id"]],
  "instructions must retain safe staff attribution after staff deletion",
);
assert.deepEqual(
  instructionConfig.checks.map((constraint) => constraint.name).sort(),
  ["kosha_manager_instructions_booking_source_check", "kosha_manager_instructions_kind_check", "kosha_manager_instructions_media_check"],
  "instructions must constrain source, kind, and image media",
);

const readConfig = getTableConfig(reads);
const readIndexes = readConfig.indexes.map((index) => ({
  columns: index.config.columns.map((column) => column.name).join(","),
  unique: Boolean(index.config.unique),
}));
assert.ok(readIndexes.some((index) => index.columns === "booking_source,booking_id,staff_id,channel" && index.unique), "reads must be unique per booking, staff, and channel");
assert.ok(readIndexes.some((index) => index.columns === "booking_source,booking_id,channel" && !index.unique), "reads need a booking/channel lookup index");
assert.deepEqual(
  readConfig.foreignKeys.map((foreignKey) => foreignKey.reference().columns.map((column) => column.name)),
  [["staff_id"]],
  "reads must attribute the viewer to staff",
);
assert.deepEqual(
  readConfig.checks.map((constraint) => constraint.name),
  ["kosha_booking_channel_reads_booking_source_check", "kosha_booking_channel_reads_channel_check"],
  "reads must constrain booking source and channels",
);

assert.ok("koshaManagerInstructionsRelations" in databaseSchema, "instruction staff relations must be exported");
assert.ok("koshaBookingChannelReadsRelations" in databaseSchema, "channel-read staff relations must be exported");

console.log("PASS: Kosha manager instruction and channel read schema contracts");
