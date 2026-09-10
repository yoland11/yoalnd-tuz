# Booking Center invoice data

## Database source

Booking Center invoices use `service_orders` through `serviceOrdersTable` in `lib/db/src/schema/services.ts`.

Persisted fields used by the API include:

- `id`, `serviceId`, `trackingCode`
- `customerName`, `phone`
- `eventDate`, `eventLocation`, `notes`
- `status`
- `totalAmount`, `depositAmount`, `remainingAmount`, `paymentStatus`
- `dueDate`, `customFields`, `financiallyReversed`, `createdAt`

The related service comes from `servicesTable` and supplies the service name, description, and type. Customer email, address, city, and customer ID are resolved from `customersTable` using normalized Iraqi phone variants. Creator name is resolved from the first `admin_activity_logs` row for entity type `service_order`.

## API adapter

`GET /admin/invoices/:id?type=booking` returns the print contract. Important mappings are:

| Invoice value | Authoritative source |
| --- | --- |
| Booking/invoice code | `service_orders.tracking_code` |
| Customer name | `service_orders.customer_name` |
| Phone | `service_orders.phone` |
| Event date/location | `service_orders.event_date`, `event_location` |
| Service | related `services` row |
| Notes/status | `service_orders.notes`, `status` |
| Total/paid/remaining | API fields `price`, `deposit`, `balance` |
| Payment status | API field `paymentStatus` |
| Additional optional presentation fields | `customFields` |
| Verification QR | `ensureQrForEntity("service_order", booking, req)` |

Do not expose the database `id` as the public invoice number when `trackingCode` exists. Do not print `internalNotes` or private accounting metadata.

## Optional legacy data

Legacy records may rely on `customFields` for optional display values. Preserve safe fallbacks for old records, but do not overwrite them or invent new schema fields. Missing optional values should display the template's established placeholder without crashing.

