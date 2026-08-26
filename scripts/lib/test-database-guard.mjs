const TEST_DATABASE_PATTERN = /(^|[_-])(test|testing|qa|e2e)($|[_-])/i;

export class UnsafeTestDatabaseError extends Error {
  constructor(reason) {
    super(reason);
    this.name = "UnsafeTestDatabaseError";
  }
}

function parsePostgresUrl(raw, label) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new UnsafeTestDatabaseError(`${label} is not a valid URL.`);
  }
  if (!/^postgres(?:ql)?:$/.test(parsed.protocol)) {
    throw new UnsafeTestDatabaseError(`${label} must be a PostgreSQL URL.`);
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!parsed.hostname || !database) {
    throw new UnsafeTestDatabaseError(`${label} must include a host and database name.`);
  }
  return { parsed, database };
}

function databaseIdentity(parsed) {
  const port = parsed.port || "5432";
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  return `${parsed.hostname.toLowerCase()}:${port}/${database.toLowerCase()}`;
}

/**
 * Fail-closed guard for every AJN integration test that can write data.
 * This function never falls back to DATABASE_URL.
 */
export function assertSafeTestDatabase(env = process.env) {
  if (env.AJN_ENV !== "test" || env.ALLOW_TEST_WRITES !== "true") {
    throw new UnsafeTestDatabaseError(
      "AJN_ENV=test and ALLOW_TEST_WRITES=true are required.",
    );
  }
  const raw = env.TEST_DATABASE_URL?.trim();
  if (!raw) {
    throw new UnsafeTestDatabaseError("TEST_DATABASE_URL is unavailable.");
  }
  const target = parsePostgresUrl(raw, "TEST_DATABASE_URL");
  if (!TEST_DATABASE_PATTERN.test(target.database)) {
    throw new UnsafeTestDatabaseError(
      `Database name is not explicitly test-only: ${target.database}`,
    );
  }

  for (const label of [
    "PRODUCTION_DATABASE_URL",
    "AJN_PRODUCTION_DATABASE_URL",
    "AJN_SCHEMA_DATABASE_URL",
  ]) {
    const candidate = env[label]?.trim();
    if (!candidate) continue;
    const production = parsePostgresUrl(candidate, label);
    if (databaseIdentity(production.parsed) === databaseIdentity(target.parsed)) {
      throw new UnsafeTestDatabaseError(
        `TEST_DATABASE_URL resolves to the same database as ${label}.`,
      );
    }
  }

  // The outer guard must never accept the runtime database as its test target.
  // Only the verified child process receives DATABASE_URL=TEST_DATABASE_URL.
  const runtimeUrl = env.DATABASE_URL?.trim();
  if (runtimeUrl) {
    const runtime = parsePostgresUrl(runtimeUrl, "DATABASE_URL");
    if (databaseIdentity(runtime.parsed) === databaseIdentity(target.parsed)) {
      throw new UnsafeTestDatabaseError(
        "TEST_DATABASE_URL resolves to the configured runtime database.",
      );
    }
  }

  return {
    url: raw,
    database: target.database,
    identity: databaseIdentity(target.parsed),
  };
}

export function printBlockedTest(error, prefix = "TEST BLOCKED") {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`${prefix}: Safe test database could not be verified.`);
  console.error(`Reason: ${reason}`);
}
