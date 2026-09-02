# AJN Write Safety & Regression Rules

These rules supplement existing project conventions and apply to every agent and contributor.

1. Any change to a form, API, database query/write, payment, inventory, invoice, booking, cash box, accounting, or permission flow must run:
   - `pnpm run typecheck`
   - `pnpm run build`
   - `pnpm run verify:critical`
   - Run `pnpm run test:save-smoke` whenever a separately verified test database is configured; otherwise record it as **SKIPPED**, never as passed.
2. Do not mark an isolated database smoke run complete when its checks fail. Normal push/deploy is not blocked solely because no isolated test database is configured; use `pnpm run verify:strict` when full database integration coverage is required.
3. Never convert an API/database failure into `null`, `[]`, or a "no data" UI state.
4. Do not add generic catch blocks that hide the cause. Return the AJN structured error contract and log safe server context with a request ID.
5. Review all callers before changing shared mutation or error infrastructure.
6. Branch, tenant, organization, status, and permission changes must preserve valid legacy records with missing newer fields where safe.
7. Financial and multi-record writes must be transactional. Keep durable idempotency for retry-prone financial actions.
8. Never run destructive diagnostics or smoke tests against production. Database write smoke tests require `AJN_ENV=test`, `ALLOW_TEST_WRITES=true`, and a separate `TEST_DATABASE_URL`; they are skipped (not passed) when that isolated configuration is unavailable.
9. Do not alter production data during diagnosis. The project owner has enabled the safe auto-release policy: after an intended task is complete and the required verification passes, commit the completed code, push `main`, and let the connected Vercel Production deployment run. Never release partial work, failed validation, destructive migrations, or Production data changes automatically.

## AJN Production & Database Safety Rules

1. Unrelated features must not modify database schema, migrations, financial core, Cash Box core, inventory core, or shared payment logic without a proven requirement.
2. A feature request authorizes the minimum safe additive database work it genuinely requires (for example `CREATE TABLE`, `ADD COLUMN`, indexes, backward-compatible enum values, and verified foreign keys). Inspect the existing schema, use one isolated additive migration, and verify the created objects. Stop before any destructive, irreversible, or historical-data-changing operation.
3. Before changing shared server/database code, inspect and list all callers and explain the blast radius.
4. Existing production database and API contracts must remain backward-compatible, including valid legacy records that lack newer optional fields.
5. Never convert an API/database failure into `null`, `[]`, or a misleading no-data state. Known failures must use the AJN structured error contract and the correct HTTP status, with safe server logging and a request ID.
6. Multi-record financial operations must remain transactional, and retry-prone invoice, payment, booking, inventory, and Cash Box paths must remain durably idempotent.
7. Destructive or write tests are forbidden against Production. They require `AJN_ENV=test`, `ALLOW_TEST_WRITES=true`, and a separately verified `TEST_DATABASE_URL`; never fall back to `DATABASE_URL`. Normal release checks may skip these tests when unavailable, but `pnpm run verify:strict` must fail closed.
8. Production data must not be modified during diagnostics. Test cleanup may target only records/schemas/databases owned by the exact unique test run.
9. Any task affecting an API, Server Action, form submission, database query, payment, invoice, booking, inventory, Cash Box, accounting, permission, or shared server helper must run `pnpm run verify:critical` before completion. Run `pnpm run verify:strict` when an isolated test database is available and full write-path coverage is required.
10. If any mandatory critical verification fails: DO NOT COMMIT, DO NOT PUSH, and DO NOT DEPLOY. A missing isolated test database is a clearly reported skip under the normal policy, not a pass; a strict verification failure blocks release.
11. `AJN_SCHEMA_DATABASE_URL` is optional and is reserved exclusively for explicitly requested, read-only Production audit commands (`pnpm run audit:production` or `pnpm run schema:preflight`). Its absence must report that audit as **SKIPPED** and must never block normal coding, typecheck, build, verification, Git hooks, push, or deployment. Never fall back to `DATABASE_URL`, `TEST_DATABASE_URL`, or any other connection string for an audit.
12. Production backups may use a dedicated read-only credential. Reviewed migrations use the authoritative Production owner `DATABASE_URL` only; never use the read-only audit credential or a test connection for a write or migration. A verified backup is required for destructive or materially irreversible work; an unavailable full backup must not block a reviewed, isolated, additive migration.
13. Any financial operation that creates, approves, rejects, reverses, refunds, cancels, or modifies a payment must invoke the canonical AJN payment-state reconciliation path. Do not manually treat feature-specific paid/remaining/paymentStatus snapshots as authoritative.
14. Changes to payment, approval, ledger, Cash Box, invoice, booking, order, or supplier-payment logic must run `pnpm run test:payment-state` and `pnpm run verify:critical`; full write coverage remains restricted to an isolated TEST database.

## AJN Safe Auto-Release Policy

1. A completed, verified code change on `main` is released by the Git post-commit hook: it calls `git push origin main`; the existing pre-push gate must pass before the push is allowed, and Vercel deploys the pushed commit through the configured Git integration.
2. The hook never stages or creates commits. It only acts after an intentional commit, so unfinished files are never published merely because they were saved locally.
3. Set `AJN_AUTO_RELEASE=0` only for an explicit emergency hold. A failed pre-push verification always blocks the release.
4. This policy authorizes only reviewed safe additive migrations required by the completed feature. It never authorizes destructive schema/data changes, secret changes, or bypassing the verification hook.

## AJN Simplified Database Change Policy

1. Normal feature work may apply the smallest reviewed, backward-compatible additive migration without manual `AJN_CHANGE_SCOPE=database-approved` or `AJN_DB_CHANGE_APPROVED=true` flags.
2. Safe additive work includes new tables, nullable or safe-default columns, indexes, compatible unique indexes, verified foreign keys, supporting sequences, compatible enum values, and non-destructive constraints.
3. Migrations must be isolated: apply only the file required by the feature, never every pending migration. Verify the intended tables, columns, indexes, and constraints afterwards.
4. Never stop for a full logical backup solely because a safe additive migration is required. Prefer forward fixes; never automatically drop a newly added object to roll back a failed deployment.
5. Stop and report before `DROP`, `TRUNCATE`, destructive `ALTER`, mass deletion, irreversible type narrowing, historical-value rewrites, or anything that can corrupt existing financial history. Financial logic still requires enhanced validation and canonical reconciliation.
