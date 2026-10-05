import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Regression: on Vercel a request has a one-connection pool. Looking up stock
// through the pool while an order transaction owns that connection times out.
const source = readFileSync("src/server/graduation.ts", "utf8");
const ast = ts.createSourceFile("graduation.ts", source, ts.ScriptTarget.Latest, true);
const names = new Set(["stockOwner", "aggregateByStockOwner", "applyInventory"]);
const code = ast.statements
  .filter((node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text))
  .map((node) => node.getText(ast))
  .join("\n");
assert.equal(names.size, 3);

const products = new Map([
  [1, { id: 1, stock: 4, sharedStockProductId: null }],
  [2, { id: 2, stock: 0, sharedStockProductId: 1 }],
]);
const movements = [];
let inTransaction = false;
const eq = (_column, id) => id;
const productsTable = { id: "id" };
const stockMovementsTable = {};
const tx = {
  query: { productsTable: {
    findFirst: async ({ where: id }) => products.get(id) ?? null,
  } },
  execute: async () => {
    const owner = products.get(1);
    owner.stock -= 3;
    return { rows: [{ id: owner.id, stock: owner.stock }] };
  },
  insert: () => ({ values: async (movement) => { movements.push(movement); } }),
};
const db = {
  query: { productsTable: {
    findFirst: async ({ where: id }) => {
      if (inTransaction) throw new Error("pool exhausted: lookup escaped the order transaction");
      return products.get(id) ?? null;
    },
  } },
  transaction: async (callback) => {
    inTransaction = true;
    try { return await callback(tx); }
    finally { inTransaction = false; }
  },
};
const context = vm.createContext({
  db, eq, productsTable, stockMovementsTable,
  sql: (parts, ...values) => ({ parts, values }),
});
const compiled = ts.transpileModule(`${code}\nglobalThis.applyInventoryUnderTest = applyInventory;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
vm.runInContext(compiled, context);

await db.transaction((connection) => context.applyInventoryUnderTest(42, [
  { productId: 1, quantity: 2, label: "روب" },
  { productId: 2, quantity: 1, label: "وشاح" },
], -1, null, connection));
assert.equal(products.get(1).stock, 1);
assert.equal(movements.length, 1);
assert.equal(Number(movements[0].quantityChange), -3);
assert.equal(movements[0].stockSourceProductId, 1);
console.log("PASS graduation inventory lookup uses the order transaction with a one-connection pool");
