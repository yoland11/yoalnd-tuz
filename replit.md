# AJN — مجموعة علي جان

An Iraqi luxury events platform for Ali Jan Group in Tuz Khurmatu — offering koshats, photography, graduation setups, albums, distributions, and research services. Includes a store, order tracking, admin dashboard, gallery, and customer accounts.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/ajn-platform run dev` — run the frontend (port varies via $PORT)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string, `SESSION_SECRET` — express-session secret

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite (Tailwind v4, shadcn/ui, Wouter, React Query)
- API: Express 5, pino logging
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec → React Query hooks + Zod schemas)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI contract (source of truth for all endpoints)
- `lib/db/src/schema/` — all Drizzle table definitions (customers, products, services, orders, cart, gallery, reviews, delivery, otp)
- `lib/db/src/index.ts` — exports `db` instance and all schema tables
- `lib/api-client-react/src/generated/` — auto-generated React Query hooks (do not edit manually)
- `lib/api-zod/src/generated/` — auto-generated Zod schemas (do not edit manually)
- `artifacts/api-server/src/routes/` — all Express route handlers
- `artifacts/ajn-platform/src/pages/` — all frontend pages
- `artifacts/ajn-platform/src/index.css` — luxury black/gold theme CSS vars

## Architecture decisions

- Contract-first API: OpenAPI spec → Orval codegen → typed hooks and schemas. Run codegen after any spec change.
- Cart uses `x-session-id` header (UUID, stored in localStorage on the client) for anonymous sessions.
- Auth uses phone OTP: in dev mode, `devOtp` is returned in the response for testing.
- Admin dashboard uses real cookie-based auth (HttpOnly `ajn_admin_session`). Root admin: `alijan` / `123123` (seeded on boot). Staff users have granular permissions (12 perms: dashboard, orders, bookings, services, products, gallery, delivery, customers, staff, settings, invoices, whatsapp). Passwords hashed with bcrypt. Every admin endpoint is gated server-side via `requireAdminAuth` / `requirePermission(perm)` from `lib/admin-auth.ts`.
- All route files import tables from `@workspace/db`, which must be rebuilt via `pnpm run typecheck:libs` after schema changes.

## Product

- **Homepage**: Hero + services overview + featured products + about section
- **Services**: کوشات، تصوير، تجهيزات تخرج، ألبومات، توزيعات، بحوث — each with request form
- **Store**: Product listings with category/search filter, add to cart, reviews, color selection
- **Cart**: Session-based cart with quantity controls
- **Checkout**: Order form with delivery zone selection (8 Iraqi governorates seeded)
- **Order Tracking**: Search by tracking code (AJN-prefixed), shows step-by-step progress
- **Gallery**: Masonry grid with category filter and fullscreen lightbox
- **Account**: Phone OTP login, order history
- **Admin**: Password-protected dashboard — stats, orders management (status updates), products CRUD, gallery management, delivery zone toggle

## User preferences

- Full Arabic RTL UI throughout
- Luxury dark theme: deep black background, gold (#C9A84C) primary color
- Iraqi Dinar (د.ع) currency formatting
- All user-facing text in Arabic

## Gotchas

- After editing `lib/api-spec/openapi.yaml`, run codegen: `pnpm --filter @workspace/api-spec run codegen`
- After changing DB schema, run `pnpm --filter @workspace/db run push` then `pnpm run typecheck:libs`
- Orval-generated hooks use `UseQueryOptions` from react-query v5 which requires `queryKey` when passing query options — always include the matching `getXQueryKey()` call
- Do not import `zod/v4` directly in api-server; use `@workspace/api-zod` schemas instead
- The frontend uses `import.meta.env.BASE_URL` as the wouter base (path-based routing through the shared proxy)

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- DB is seeded: 6 services, 6 products, 8 delivery zones
