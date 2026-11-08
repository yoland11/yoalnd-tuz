const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const { sql } = require("drizzle-orm");
const { PgDialect } = require("drizzle-orm/pg-core");
const file = ts.createSourceFile(
  "api.ts",
  fs.readFileSync("src/server/api.ts", "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
// adjustVariantStock runs its change in one transaction via withStockWrite.
const wanted = new Set(["adjustVariantStock", "withStockWrite"]);
const pieces = file.statements.filter(
  (n) =>
    (ts.isFunctionDeclaration(n) && wanted.has(n.name?.text)) ||
    (ts.isVariableStatement(n) &&
      n.declarationList.declarations.some((d) => d.name.getText(file) === "stockAfterCommitQueues")),
);
assert.equal(pieces.length, 3);
const js = ts.transpileModule(pieces.map((n) => n.getText(file)).join("\n"), {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;
const dialect = new PgDialect();
let stock = 2;
const ledger = [];
const context = {
  sql,
  Math,
  Number,
  String,
  console,
  ensureVariantTables: async () => {},
  ensureStockTrackingTables: async () => {},
  syncProductStockFromVariants: async () => {},
  stockMovementsTable: {},
  db: {
    execute: async (query) => {
      const built = dialect.sqlToQuery(query);
      assert.match(built.sql, /update product_variants set stock/);
      stock = Math.max(0, stock + Number(built.params[0]));
      return { rows: [{ product_id: 10 }] };
    },
    insert: () => ({
      values: async (value) => {
        ledger.push(value);
      },
    }),
    transaction: async (callback) => {
      transactions += 1;
      return callback(context.db);
    },
  },
};
let transactions = 0;
vm.createContext(context);
vm.runInContext(js, context);
(async () => {
  await context.adjustVariantStock(20, -0.5, {
    reason: "reservation_consumed:service_order",
    sourceType: "service_order",
    sourceId: 7,
  });
  assert.equal(
    stock,
    1.5,
    "checkout of half a unit must deduct half, not one whole unit",
  );
  assert.equal(ledger[0].quantityChange, "-0.5");
  await context.adjustVariantStock(20, 0.5, {
    reason: "reservation_restored:service_order",
    sourceType: "service_order",
    sourceId: 7,
  });
  assert.equal(stock, 2, "reversal restores the exact fractional quantity");
  assert.equal(ledger[1].quantityChange, "0.5");
  assert.equal(transactions, 2, "each variant change and its ledger row share one transaction");
  console.log(
    "PASS actual variant stock adjustment preserves decimal checkout/reversal and ledger agreement",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
