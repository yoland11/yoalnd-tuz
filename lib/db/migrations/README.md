# Database Migrations

Drizzle migration files are generated here.

Typical workflow:

```bash
pnpm --filter @workspace/db run generate
pnpm --filter @workspace/db run push
pnpm --filter @workspace/db run seed
```

Use `push` for Replit/dev environments. For production, review generated SQL
before applying it to a live database.
