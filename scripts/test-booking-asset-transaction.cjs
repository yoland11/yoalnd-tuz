const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const { sql } = require("drizzle-orm");
const { PgDialect } = require("drizzle-orm/pg-core");

// Execute the actual orchestration, not a copy. Database IO and the already
// covered asset action body are boundaries; unsupported IO fails closed.
const source = ts.createSourceFile(
  "api.ts",
  fs.readFileSync("src/server/api.ts", "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
const declaration = source.statements.find(
  (node) =>
    ts.isFunctionDeclaration(node) &&
    node.name?.text === "executeBookingAssetAction",
);
assert.ok(declaration);
const javascript = ts.transpileModule(declaration.getText(source), {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;
const dialect = new PgDialect();
let state = {
  bookingOperations: {
    assets: [{ productId: 20, quantity: 1, stage: "reserved" }],
  },
  privateNote: "preserve",
};
let commits = 0;
let fail = false;
const events = [];
const product = { id: 10 };
const db = {
  query: { productsTable: { findFirst: async () => product } },
  transaction: async (work) => {
    const draft = structuredClone(state);
    const tx = {
      execute: async (statement) => {
        const { sql: query } = dialect.sqlToQuery(statement);
        if (query.includes("from kosha_bookings")) {
          events.push("booking-lock");
          return { rows: [{ id: 7 }] };
        }
        if (query.includes("from products")) {
          events.push("product-lock");
          return { rows: [{ id: 10 }] };
        }
        throw new Error(`Unexpected query: ${query}`);
      },
      query: {
        koshaBookingsTable: {
          findFirst: async () => {
            events.push("fresh-read");
            return { id: 7, bookingDetails: draft };
          },
        },
      },
      draft,
    };
    const result = await work(tx);
    state = draft;
    commits++;
    return result;
  },
};
const context = {
  db,
  sql,
  productsTable: { id: "id" },
  koshaBookingsTable: { id: "id" },
  eq: (a, b) => [a, b],
  ensureAdminExtensionsTables: async () => {},
  getSoundStoreProducts: async () => [],
  bookingOperationsState: (details) => details.bookingOperations,
  error: (message, status) => ({ message, status }),
  executeLockedBookingAssetAction: async (
    _req,
    _auth,
    reference,
    _input,
    tx,
  ) => {
    events.push("action");
    assert.equal(
      reference.details,
      tx.draft,
      "action uses freshly locked booking details",
    );
    assert.equal(
      reference.operations.assets[0].productId,
      20,
      "stale caller cannot erase an earlier import",
    );
    tx.draft.bookingOperations.assets.push({
      productId: 10,
      stage: "reserved",
    });
    if (fail) throw new Error("audit unavailable");
    return { ok: true };
  },
};
vm.createContext(context);
vm.runInContext(javascript, context);
(async () => {
  const stale = {
    source: "kosha",
    id: 7,
    details: {},
    operations: { assets: [] },
  };
  await context.executeBookingAssetAction({}, {}, stale, {
    productId: 10,
    mode: "reserve",
  });
  assert.deepEqual(events, [
    "booking-lock",
    "product-lock",
    "fresh-read",
    "action",
  ]);
  assert.equal(state.bookingOperations.assets.length, 2);
  fail = true;
  await assert.rejects(
    () =>
      context.executeBookingAssetAction({}, {}, stale, {
        productId: 10,
        mode: "reserve",
      }),
    /audit unavailable/,
  );
  assert.equal(commits, 1, "failure cannot commit custody/booking changes");
  assert.equal(state.bookingOperations.assets.length, 2);
  assert.equal(state.privateNote, "preserve");
  console.log(
    "PASS actual booking asset transaction uses matching locks, fresh state and rollback",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
