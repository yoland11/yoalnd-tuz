# AJN Production Safety Lock

Run this after every AJN change and before any push:

```bash
pnpm run verify:critical
```

The command fails closed. It checks TypeScript, frozen critical database contracts, the production-write guard, runtime DDL, unauthorized schema/core changes, critical write/API/idempotency/legacy behavior on a separate test database, the production build, and Git whitespace.

## Required safe test environment

Write tests never fall back to `DATABASE_URL`:

```env
AJN_ENV=test
ALLOW_TEST_WRITES=true
TEST_DATABASE_URL=postgresql://.../ajn_test
```

The database name must contain an explicit `test`, `testing`, `qa`, or `e2e` marker. If `PRODUCTION_DATABASE_URL`, `AJN_PRODUCTION_DATABASE_URL`, or `AJN_SCHEMA_DATABASE_URL` resolves to the same host/port/database, the suite aborts. The write suites create disposable `TEST-/QA-/E2E-`-owned records or isolated disposable schemas/databases and only remove their exact run scope.

If a test database is unavailable, database write/integration checks are reported as **SKIPPED**. Normal `verify:critical` and `verify:deploy` may still pass after all non-database gates pass; `verify:strict` fails closed.

## Push and deployment gates

- `pnpm run setup:hooks` installs the tracked pre-push hook. `pnpm install` also attempts this through `prepare`.
- The hook runs `verify:critical` and blocks the push on any failure.
- `pnpm run verify:deploy` is the explicit release gate. Current Vercel configuration is intentionally unchanged; configure staging/CI to run this command only after providing the isolated test database secrets.

## Safe additive database changes

An approved feature authorizes its minimum reviewed safe additive migration. `CREATE TABLE`, `ADD COLUMN`, compatible indexes, verified foreign keys, and non-destructive constraints do not require manual `AJN_CHANGE_SCOPE=database-approved` or `AJN_DB_CHANGE_APPROVED=true` flags. Apply only the feature's migration and verify its objects afterwards.

Stop and report before destructive or irreversible DDL/data work, including `DROP`, `TRUNCATE`, mass `DELETE`, destructive `ALTER`, type narrowing, or historical-data rewrites. A full production backup is not a blocker for isolated safe additive DDL, but remains required preparation for destructive or materially irreversible changes.

For a declared UI-only task, use `AJN_CHANGE_SCOPE=ui-only`; touching schema, migrations, or shared financial/persistence core then fails. This is a process gate, not a brittle filesystem lock.

## Recommended staging workflow

Feature change → local `verify:critical` → staging/preview with an isolated test DB → `verify:deploy` → reviewed main branch → Vercel Production.

Do not point either verification command at Production. A failure means commit/push/deploy must stop until the first reported subsystem is repaired and the complete gate passes.
