-- Kosha field collections: reported by staff, then posted exactly once by an
-- authorized main administrator. Safe additive/widening DDL only; no booking,
-- customer, payment, or financial history is changed by this migration.

ALTER TABLE "kosha_payment_requests"
  ALTER COLUMN "status" TYPE varchar(32),
  ADD COLUMN IF NOT EXISTS "payment_method" varchar(20) NOT NULL DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS "receipt_image" text,
  ADD COLUMN IF NOT EXISTS "remaining_before" numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(180),
  ADD COLUMN IF NOT EXISTS "rejection_reason" text,
  ADD COLUMN IF NOT EXISTS "collection_meta" jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS "kosha_payment_requests_idempotency_idx"
  ON "kosha_payment_requests" ("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "kosha_payment_requests_booking_status_idx"
  ON "kosha_payment_requests" ("booking_id", "status", "created_at" DESC);

INSERT INTO ajn_schema_revisions(revision, description)
VALUES (100, 'Kosha field collection main-admin approval')
ON CONFLICT (revision) DO NOTHING;
INSERT INTO ajn_migration_history(migration_id, checksum, description)
VALUES ('0100_kosha_field_collection_approval', 'manual-reviewed', 'Safe Kosha field collection approval columns and indexes')
ON CONFLICT (migration_id) DO NOTHING;
