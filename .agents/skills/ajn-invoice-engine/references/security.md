# Privacy and write safety

Authenticate on the server; check document permission and branch/tenant/source scope before returning invoice data, media, print payloads or queue jobs. An opaque ID supplied by a browser is not authorization.

Use public verification tokens only through their existing scoped handlers. Printed QR is a public disclosure surface: do not encode raw database UUIDs, secrets, service-role/API keys, admin routes, full private records or internal notes. Preserve supported public tokens rather than inventing a phone-suffix authentication scheme.

Escape text in HTML; constrain image/link URLs to existing safe infrastructure. Don't send complete customer/payment records to logs. Audit only necessary redacted before/after fields and the authenticated actor.

Read-only diagnosis must not mutate production. Never silently replace an API failure with empty items, zero money or success. Use existing structured AJN errors and safe request-ID logs. Changes affecting payments and multiple records stay transactional with durable idempotency. Skills do not expand permission to migrate, publish or print physical paper.
