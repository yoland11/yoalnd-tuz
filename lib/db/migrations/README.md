# Database Migrations

Drizzle migration files are generated here.

Typical workflow:

```bash
pnpm --filter @workspace/db run generate
pnpm --filter @workspace/db run push
pnpm --filter @workspace/db run seed
```

Use `push` for local development. For production, review SQL
before applying it to a live database.

Production workflow is intentionally explicit: `schema:backup`, then
`schema:preflight`, then `schema:apply` with the exact reviewed migration path and the dedicated migration credential. The runner accepts safe additive DDL only; destructive changes require a separate safety review.
The runner rejects data-changing SQL and rolls back its transaction on error.
