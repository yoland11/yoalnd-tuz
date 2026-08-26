import assert from "node:assert/strict";
import {
  assertSafeTestDatabase,
  UnsafeTestDatabaseError,
} from "./lib/test-database-guard.mjs";

const base = {
  AJN_ENV: "test",
  ALLOW_TEST_WRITES: "true",
  TEST_DATABASE_URL: "postgresql://qa:secret@db.example.test/ajn_test",
};

assert.equal(assertSafeTestDatabase(base).database, "ajn_test");
assert.throws(
  () => assertSafeTestDatabase({ ...base, AJN_ENV: "production" }),
  UnsafeTestDatabaseError,
);
assert.throws(
  () => assertSafeTestDatabase({ ...base, ALLOW_TEST_WRITES: "false" }),
  UnsafeTestDatabaseError,
);
assert.throws(
  () => assertSafeTestDatabase({ ...base, TEST_DATABASE_URL: undefined }),
  UnsafeTestDatabaseError,
);
assert.throws(
  () =>
    assertSafeTestDatabase({
      ...base,
      TEST_DATABASE_URL: "postgresql://qa:secret@db.example.test/ajn",
    }),
  UnsafeTestDatabaseError,
);
assert.throws(
  () =>
    assertSafeTestDatabase({
      ...base,
      DATABASE_URL: base.TEST_DATABASE_URL,
    }),
  UnsafeTestDatabaseError,
);
assert.throws(
  () =>
    assertSafeTestDatabase({
      ...base,
      PRODUCTION_DATABASE_URL:
        "postgresql://prod:different@db.example.test/ajn_test?sslmode=require",
    }),
  UnsafeTestDatabaseError,
);
assert.throws(
  () =>
    assertSafeTestDatabase({
      ...base,
      AJN_SCHEMA_DATABASE_URL:
        "postgresql://readonly:other@db.example.test/ajn_test",
    }),
  UnsafeTestDatabaseError,
);

console.log("PASS  AJN database write guard fails closed and rejects production aliases");
