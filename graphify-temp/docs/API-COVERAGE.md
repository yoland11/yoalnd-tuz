# API Coverage Notes

`lib/api-spec/openapi.yaml` covers the public storefront API and the typed
React Query/Zod clients. The admin UI currently uses manual `adminFetch` calls
for the broader `/api/admin/*` surface.

The following implemented admin endpoints should be promoted into OpenAPI when
you want typed admin hooks as well:

- `POST /api/admin/auth/login`
- `POST /api/admin/auth/logout`
- `GET /api/admin/auth/me`
- `GET /api/admin/dashboard`
- `GET|POST|PATCH|DELETE /api/admin/categories`
- `GET|PUT /api/admin/settings`
- `GET|POST|PATCH|DELETE /api/admin/staff`
- `GET /api/admin/customers`
- `GET /api/admin/customers/:id`
- `GET|PATCH|DELETE /api/admin/service-orders`
- `POST /api/admin/service-orders/:id/reschedule-action`
- `GET /api/admin/service-orders/:id/history`
- `POST|PATCH|DELETE /api/admin/orders`
- `GET|POST|PATCH|DELETE /api/admin/services`
- `GET /api/admin/invoices/:id`
- `GET|PUT /api/admin/whatsapp/settings`
- `GET|DELETE /api/admin/whatsapp/log`
- `POST /api/admin/whatsapp/log/:id/resend`
- `POST /api/admin/whatsapp/test`
- `POST /api/admin/uploads`
- `GET|POST|PATCH|DELETE /api/admin/expense-categories`
- `GET|POST|DELETE /api/admin/receipt-vouchers`
- `GET|POST|DELETE /api/admin/payment-vouchers`
- `GET|POST|DELETE /api/admin/expenses`
- `GET /api/admin/accounting/statement`
- `GET /api/admin/accounting/pnl`
- `GET /api/admin/backup/export`
- `GET /api/admin/backup/export/:entity`
- `POST /api/admin/backup/import`

Until those routes are added to OpenAPI, keep admin API changes mirrored in the
manual admin client helpers.
