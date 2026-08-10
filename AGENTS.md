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
