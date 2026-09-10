# Architecture and blast radius

## Entry points

- Booking Center page: `src/views/admin/booking-center.tsx`
- Admin route registration: `src/views/admin/index.tsx`, route `/admin/invoice/:id`
- A4 invoice view: `src/views/admin/invoice.tsx`
- Print/PDF CSS and image-ready print helper: `src/views/admin/print-helpers.ts`
- Invoice API: `src/server/api.ts`, `GET /admin/invoices/:id?type=booking`
- Service-order schema: `lib/db/src/schema/services.ts`

The Booking Center opens the protected A4 document with:

```text
/admin/invoice/{serviceOrderId}?type=booking
```

Adding `&pdf=1` starts the existing PDF download. Adding `&print=1` starts browser printing after assets settle.

## Shared-file warning

`src/views/admin/invoice.tsx` contains one route and renderer used by three request types:

- `booking`: Booking Center service orders — in scope.
- `kosha`: Kosha bookings — out of scope unless separately requested.
- `order`: store/customer orders — out of scope.

`src/views/admin/print-helpers.ts` is shared by many AJN documents. A change there has a broad print blast radius. Inspect every caller of a helper before editing it. Prefer a Booking Center-specific adapter or gated behavior over changing shared output.

## Authorization

The client checks the `invoices` permission for `type=booking`. The server repeats authorization with `requirePermission(req, "invoices")`. Preserve both checks; frontend visibility is not a security boundary.

## Error behavior

The A4 view must render a controlled loading/error state. A failed `/admin/invoices` request must not be transformed into blank data, zero totals, or an apparently valid invoice.

