---
name: ajn-invoice-engine
description: Use when changing or investigating AJN invoice data, adapters, totals, customer or item mappings across sales, purchases, bookings, orders and rentals.
---

# AJN invoice engine

Business data belongs to its existing module and authoritative backend, not to a print template. This skill is guidance, not authorization to migrate data or redesign invoices.

Read [architecture](references/architecture.md) to locate the affected source and its callers, then [data and money](references/invoice-data.md) before changing an adapter. Confirm fields in current code; reference maps are starting points, not frozen contracts.

- Preserve original IDs, lines, decimal quantities, historical prices, currency and invoice numbers. Never rebuild missing historical items from current stock.
- Keep calculations, payment reconciliation, inventory movements, permissions and durable idempotency in their existing owners. Rendering and reprinting do not create financial writes.
- Diagnose discrepancies explicitly; never hide failed reads as empty invoices or zero balances.
- A normalized document adapter is a future-compatible option, not an existing universal AJN model. Do not introduce it just to comply with this skill.

**REQUIRED SUB-SKILLS WHEN CHANGING THOSE DOMAINS:** Use `ajn-finance` for payment, approval, ledger or Cash Box changes, and `ajn-invoice-print` for presentation or paper-format changes. Read [security](references/security.md) and the [verification matrix](references/testing.md) for every affected invoice flow.
