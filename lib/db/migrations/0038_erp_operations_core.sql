-- AJN ERP Operations Core
-- Additive and safe: task automation, approvals, documents, timelines, warehouses,
-- assets, and recovery metadata. No existing data is deleted or rewritten.

ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "template_key" varchar(80),
  ADD COLUMN IF NOT EXISTS "sequence" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "auto_generated" integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "tasks_related_template_idx"
  ON "tasks" ("related_type", "related_id", "template_key");

CREATE TABLE IF NOT EXISTS "approval_requests" (
  "id" serial PRIMARY KEY,
  "request_no" varchar(50) NOT NULL UNIQUE,
  "type" varchar(60) NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "entity_type" varchar(60),
  "entity_id" integer,
  "amount" text,
  "old_values" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "new_values" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "requested_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
  "requested_by_name" text NOT NULL DEFAULT '',
  "reviewed_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
  "reviewed_by_name" text NOT NULL DEFAULT '',
  "review_note" text,
  "reviewed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "approval_requests_status_idx"
  ON "approval_requests" ("status", "created_at");

CREATE INDEX IF NOT EXISTS "approval_requests_entity_idx"
  ON "approval_requests" ("entity_type", "entity_id");

CREATE TABLE IF NOT EXISTS "entity_documents" (
  "id" serial PRIMARY KEY,
  "entity_type" varchar(60) NOT NULL,
  "entity_id" integer NOT NULL,
  "document_type" varchar(40) NOT NULL DEFAULT 'file',
  "title" text NOT NULL,
  "file_url" text NOT NULL,
  "file_name" text,
  "mime_type" varchar(120),
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "uploaded_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
  "uploaded_by_name" text NOT NULL DEFAULT '',
  "archived_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "entity_documents_entity_idx"
  ON "entity_documents" ("entity_type", "entity_id", "created_at");

CREATE TABLE IF NOT EXISTS "entity_timeline" (
  "id" serial PRIMARY KEY,
  "entity_type" varchar(60) NOT NULL,
  "entity_id" integer NOT NULL,
  "type" varchar(60) NOT NULL,
  "title" text NOT NULL,
  "body" text,
  "actor_id" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
  "actor_name" text NOT NULL DEFAULT '',
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "entity_timeline_entity_idx"
  ON "entity_timeline" ("entity_type", "entity_id", "created_at");

CREATE TABLE IF NOT EXISTS "warehouses" (
  "id" serial PRIMARY KEY,
  "name" text NOT NULL,
  "is_active" integer NOT NULL DEFAULT 1,
  "created_at" timestamp NOT NULL DEFAULT now()
);

INSERT INTO "warehouses" ("name")
SELECT 'المخزن الرئيسي'
WHERE NOT EXISTS (SELECT 1 FROM "warehouses");

CREATE TABLE IF NOT EXISTS "warehouse_transfers" (
  "id" serial PRIMARY KEY,
  "transfer_no" varchar(50) NOT NULL UNIQUE,
  "product_id" integer,
  "product_name" text NOT NULL DEFAULT '',
  "from_warehouse_id" integer REFERENCES "warehouses" ("id") ON DELETE SET NULL,
  "to_warehouse_id" integer REFERENCES "warehouses" ("id") ON DELETE SET NULL,
  "quantity" integer NOT NULL DEFAULT 1,
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "requested_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
  "requested_by_name" text NOT NULL DEFAULT '',
  "reviewed_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
  "reviewed_by_name" text NOT NULL DEFAULT '',
  "notes" text,
  "reviewed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "warehouse_transfers_status_idx"
  ON "warehouse_transfers" ("status", "created_at");

CREATE TABLE IF NOT EXISTS "asset_profiles" (
  "id" serial PRIMARY KEY,
  "product_id" integer NOT NULL UNIQUE,
  "purchase_price" text NOT NULL DEFAULT '0',
  "purchase_date" timestamp,
  "expected_life_uses" integer NOT NULL DEFAULT 50,
  "usage_count" integer NOT NULL DEFAULT 0,
  "maintenance_every_uses" integer NOT NULL DEFAULT 50,
  "current_value" text NOT NULL DEFAULT '0',
  "status" varchar(30) NOT NULL DEFAULT 'active',
  "notes" text,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "asset_profiles_status_idx"
  ON "asset_profiles" ("status", "updated_at");

CREATE TABLE IF NOT EXISTS "disaster_recovery_snapshots" (
  "id" serial PRIMARY KEY,
  "snapshot_no" varchar(50) NOT NULL UNIQUE,
  "type" varchar(30) NOT NULL DEFAULT 'manual',
  "status" varchar(20) NOT NULL DEFAULT 'created',
  "file_url" text,
  "summary" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
  "created_by_name" text NOT NULL DEFAULT '',
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "disaster_recovery_snapshots_created_idx"
  ON "disaster_recovery_snapshots" ("created_at");
