# AJN Write Safety & Regression Rules

These rules supplement existing project conventions and apply to every agent and contributor.

1. Any change to a form, API, database query/write, payment, inventory, invoice, booking, cash box, accounting, or permission flow must run:
   - `pnpm run typecheck`
   - `pnpm run build`
   - `pnpm run test:save-smoke`
2. Do not mark such work complete when save smoke checks fail.
3. Never convert an API/database failure into `null`, `[]`, or a "no data" UI state.
4. Do not add generic catch blocks that hide the cause. Return the AJN structured error contract and log safe server context with a request ID.
5. Review all callers before changing shared mutation or error infrastructure.
6. Branch, tenant, organization, status, and permission changes must preserve valid legacy records with missing newer fields where safe.
7. Financial and multi-record writes must be transactional. Keep durable idempotency for retry-prone financial actions.
8. Never run destructive diagnostics or smoke tests against production. Write smoke tests require `AJN_ENV=test`, `ALLOW_TEST_WRITES=true`, and a separate `TEST_DATABASE_URL`.
9. Do not alter production data during diagnosis, and do not commit, push, or deploy unless the user explicitly requests it.

## AJN Production & Database Safety Rules

1. Unrelated features must not modify database schema, migrations, financial core, Cash Box core, inventory core, or shared payment logic without a proven requirement.
2. Never create or run migrations unless the task explicitly requires database architecture changes. Stop and report any unexpected migration requirement.
3. Before changing shared server/database code, inspect and list all callers and explain the blast radius.
4. Existing production database and API contracts must remain backward-compatible, including valid legacy records that lack newer optional fields.
5. Never convert an API/database failure into `null`, `[]`, or a misleading no-data state. Known failures must use the AJN structured error contract and the correct HTTP status, with safe server logging and a request ID.
6. Multi-record financial operations must remain transactional, and retry-prone invoice, payment, booking, inventory, and Cash Box paths must remain durably idempotent.
7. Destructive or write tests are forbidden against Production. They require `AJN_ENV=test`, `ALLOW_TEST_WRITES=true`, and a separately verified `TEST_DATABASE_URL`; never fall back to `DATABASE_URL`.
8. Production data must not be modified during diagnostics. Test cleanup may target only records/schemas/databases owned by the exact unique test run.
9. Any task affecting an API, Server Action, form submission, database query, payment, invoice, booking, inventory, Cash Box, accounting, permission, or shared server helper must run `pnpm run verify:critical` before completion.
10. If any critical verification fails: DO NOT COMMIT, DO NOT PUSH, and DO NOT DEPLOY. Report the failing subsystem and preserve the failure for diagnosis.
