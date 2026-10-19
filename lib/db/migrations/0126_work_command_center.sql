-- مركز أوامر العمل: additive only.
-- Work orders ARE existing tasks (tasks table); work_orders holds only the
-- order-specific settings for a task. Chat reuses internal_channels and
-- internal_messages; messages gain attachments, replies and order cards.
-- No financial, inventory or booking table is touched.

ALTER TABLE "internal_messages"
  ADD COLUMN IF NOT EXISTS "message_type" varchar(20) NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS "attachments" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "reply_to_id" integer,
  ADD COLUMN IF NOT EXISTS "task_id" integer,
  ADD COLUMN IF NOT EXISTS "client_key" varchar(80);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'internal_messages_reply_to_id_fkey' AND conrelid = 'internal_messages'::regclass
  ) THEN
    ALTER TABLE "internal_messages"
      ADD CONSTRAINT "internal_messages_reply_to_id_fkey"
      FOREIGN KEY ("reply_to_id") REFERENCES "internal_messages" ("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'internal_messages_task_id_fkey' AND conrelid = 'internal_messages'::regclass
  ) THEN
    ALTER TABLE "internal_messages"
      ADD CONSTRAINT "internal_messages_task_id_fkey"
      FOREIGN KEY ("task_id") REFERENCES "tasks" ("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'internal_messages_type_check' AND conrelid = 'internal_messages'::regclass
  ) THEN
    ALTER TABLE "internal_messages"
      ADD CONSTRAINT "internal_messages_type_check"
      CHECK ("message_type" IN ('text', 'voice', 'attachment', 'work_order', 'system'));
  END IF;
END $$;

-- A retried send returns the original message instead of a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS "internal_messages_client_key_idx"
  ON "internal_messages" ("channel_id", "client_key") WHERE "client_key" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "internal_messages_task_idx"
  ON "internal_messages" ("task_id") WHERE "task_id" IS NOT NULL;

-- One department channel per department.
CREATE UNIQUE INDEX IF NOT EXISTS "internal_channels_work_department_idx"
  ON "internal_channels" ("department")
  WHERE "entity_type" = 'work_department' AND "archived_at" IS NULL;

-- Read position per employee and channel (unread counts and read receipts).
CREATE TABLE IF NOT EXISTS "internal_channel_reads" (
  "channel_id" integer NOT NULL REFERENCES "internal_channels" ("id") ON DELETE CASCADE,
  "staff_id" integer NOT NULL REFERENCES "staff" ("id") ON DELETE CASCADE,
  "last_read_message_id" integer NOT NULL DEFAULT 0,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("channel_id", "staff_id")
);

CREATE TABLE IF NOT EXISTS "work_orders" (
  "task_id" integer PRIMARY KEY REFERENCES "tasks" ("id") ON DELETE CASCADE,
  "channel_id" integer REFERENCES "internal_channels" ("id") ON DELETE SET NULL,
  "parent_task_id" integer REFERENCES "tasks" ("id") ON DELETE SET NULL,
  "mandatory" boolean NOT NULL DEFAULT true,
  "template_key" varchar(60),
  "requires_approval" boolean NOT NULL DEFAULT false,
  "evidence_required" boolean NOT NULL DEFAULT false,
  "customer_id" integer REFERENCES "customers" ("id") ON DELETE SET NULL,
  "customer_name" text,
  "product_id" integer REFERENCES "products" ("id") ON DELETE SET NULL,
  "source_type" varchar(40),
  "source_id" integer,
  "pending_due_at" timestamp,
  "pending_due_reason" text,
  "pending_due_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
  "pending_due_requested_at" timestamp,
  "idempotency_key" varchar(120),
  "created_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "work_orders_idempotency_idx"
  ON "work_orders" ("idempotency_key") WHERE "idempotency_key" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "work_orders_parent_idx"
  ON "work_orders" ("parent_task_id") WHERE "parent_task_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "work_orders_source_idx"
  ON "work_orders" ("source_type", "source_id") WHERE "source_type" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "work_orders_channel_idx"
  ON "work_orders" ("channel_id");
