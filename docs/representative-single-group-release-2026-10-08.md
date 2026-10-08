# Representative single-group access — release decision

Date: 2026-10-08. User authorized completion, push to `main`, and production deployment.

## Scope and risk

- Medium security/permission change: existing staff login, one active graduation group per representative, admin retains all-group view.
- No schema migration, new auth system, historical payment rewrite, or production database diagnostic write.
- Financial request/custody creation now serializes with assignment changes through the same staff-row lock. Existing approval and canonical payment allocation remain unchanged.
- Previous `main` before this release: `1bce64dd5d30786597b8fa4e4b7219af4529584b`.

## Go/no-go evidence

- `pnpm run typecheck`: PASS.
- `pnpm run build`: PASS.
- `pnpm run verify:critical`: PASS (`AJN SAFETY CHECK PASSED`).
- `pnpm run test:payment-state`: PASS.
- Representative portal, scope, login, assignment, financial-write, and access-error regression tests: PASS.
- Graduation group pricing and staff portal authentication suites: PASS.
- Independent code review: initial three findings resolved; no remaining release blocker.
- `test:save-smoke` / isolated PostgreSQL write-concurrency tests: **SKIPPED**; no separately verified `TEST_DATABASE_URL` is configured.
- Local browser smoke: **SKIPPED** because the isolated checkout has no `DATABASE_URL`; this was not replaced by a production write test.

Technical decision: GO under the repository's normal safe auto-release policy. The database and browser skips are explicit residual verification gaps, not claimed passes.

## Post-deploy and rollback

- Check that the Vercel production deployment for the pushed commit is Ready and the public representative login route responds without a server error. Do not perform production payment or database write smoke tests.
- Authorized AJN staff should check representative A cannot see group B, an unassigned representative gets a controlled denial, and an admin sees all groups. This needs real accounts and was not simulated against Production.
- If login, data isolation, or financial integrity fails, stop use of the representative portal and redeploy the previous known-good commit through the existing Vercel/Git workflow. Do not rewrite historical financial records or run a destructive database rollback.
