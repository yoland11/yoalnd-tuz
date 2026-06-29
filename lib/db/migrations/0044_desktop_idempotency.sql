-- Desktop retries must never duplicate financial, order, stock, or booking writes.
-- This table stores successful mutation responses by a client-generated key.

CREATE TABLE IF NOT EXISTS "desktop_idempotency_keys" (
  "id" serial PRIMARY KEY,
  "idempotency_key" varchar(100) NOT NULL,
  "request_method" varchar(10) NOT NULL,
  "request_path" text NOT NULL,
  "request_hash" varchar(64) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'processing',
  "response_status" varchar(3),
  "response_body" jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "completed_at" timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS "desktop_idempotency_key_unique_idx"
  ON "desktop_idempotency_keys" ("idempotency_key");

CREATE INDEX IF NOT EXISTS "desktop_idempotency_created_at_idx"
  ON "desktop_idempotency_keys" ("created_at");

CREATE INDEX IF NOT EXISTS "desktop_idempotency_status_idx"
  ON "desktop_idempotency_keys" ("status");
