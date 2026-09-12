-- Phase 1 — Unified customer identity for service bookings.
--
-- Service bookings historically identified the customer only by name + phone
-- (unlike orders and kosha bookings, which already carry a canonical
-- customer_id). This migration adds that missing canonical link so every
-- service booking can be joined to the one real customer account by a stable id
-- instead of by a fragile name/phone match.
--
-- SAFETY: additive only. It adds a nullable column + index and NEVER changes any
-- financial total, deposit, remaining, payment status, cash box, receipt, or
-- existing service-order data. Existing rows are linked separately by an
-- idempotent application backfill that matches the canonical normalized phone
-- (exact match only — it never guesses identity from names).
ALTER TABLE "service_orders"
  ADD COLUMN IF NOT EXISTS "customer_id" integer REFERENCES "customers"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "service_orders_customer_idx"
  ON "service_orders" ("customer_id");
