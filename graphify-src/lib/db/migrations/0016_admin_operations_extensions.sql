ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "qr_token" varchar(80);
ALTER TABLE "service_orders" ADD COLUMN IF NOT EXISTS "qr_token" varchar(80);
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "qr_token" varchar(80);

CREATE TABLE IF NOT EXISTS "tasks" (
  "id" serial PRIMARY KEY,
  "title" text NOT NULL,
  "description" text,
  "status" varchar(30) NOT NULL DEFAULT 'new',
  "priority" varchar(20) NOT NULL DEFAULT 'medium',
  "due_at" timestamp,
  "assigned_staff_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "related_type" varchar(30),
  "related_id" integer,
  "notes" text,
  "attachments" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_by" integer REFERENCES "staff" ("id"),
  "archived_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "task_comments" (
  "id" serial PRIMARY KEY,
  "task_id" integer NOT NULL REFERENCES "tasks" ("id"),
  "staff_id" integer REFERENCES "staff" ("id"),
  "body" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "task_attachments" (
  "id" serial PRIMARY KEY,
  "task_id" integer NOT NULL REFERENCES "tasks" ("id"),
  "file_url" text NOT NULL,
  "file_name" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "message_threads" (
  "id" serial PRIMARY KEY,
  "customer_id" integer REFERENCES "customers" ("id"),
  "phone" varchar(30),
  "customer_name" text NOT NULL DEFAULT '',
  "subject" text NOT NULL DEFAULT 'رسالة زبون',
  "status" varchar(20) NOT NULL DEFAULT 'new',
  "related_type" varchar(30),
  "related_id" integer,
  "last_message_at" timestamp NOT NULL DEFAULT now(),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "message_replies" (
  "id" serial PRIMARY KEY,
  "thread_id" integer NOT NULL REFERENCES "message_threads" ("id"),
  "sender_type" varchar(20) NOT NULL DEFAULT 'customer',
  "staff_id" integer REFERENCES "staff" ("id"),
  "body" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "customer_activity_logs" (
  "id" serial PRIMARY KEY,
  "customer_id" integer REFERENCES "customers" ("id"),
  "session_id" varchar(80),
  "phone" varchar(30),
  "action" varchar(60) NOT NULL,
  "entity_type" varchar(40),
  "entity_id" integer,
  "entity_label" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "ip_address" varchar(80),
  "user_agent" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "attendance_records" (
  "id" serial PRIMARY KEY,
  "staff_id" integer NOT NULL REFERENCES "staff" ("id"),
  "check_in_at" timestamp NOT NULL DEFAULT now(),
  "check_out_at" timestamp,
  "status" varchar(20) NOT NULL DEFAULT 'present',
  "notes" text,
  "edited_by" integer REFERENCES "staff" ("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "qr_tokens" (
  "id" serial PRIMARY KEY,
  "entity_type" varchar(30) NOT NULL,
  "entity_id" integer NOT NULL,
  "token" varchar(80) NOT NULL UNIQUE,
  "target_url" text NOT NULL,
  "scan_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "last_scanned_at" timestamp
);

CREATE INDEX IF NOT EXISTS "tasks_assigned_staff_ids_gin_idx" ON "tasks" USING gin ("assigned_staff_ids");
CREATE INDEX IF NOT EXISTS "tasks_status_due_idx" ON "tasks" ("status", "due_at");
CREATE INDEX IF NOT EXISTS "message_threads_status_idx" ON "message_threads" ("status", "last_message_at");
CREATE INDEX IF NOT EXISTS "message_replies_thread_idx" ON "message_replies" ("thread_id", "created_at");
CREATE INDEX IF NOT EXISTS "customer_activity_created_idx" ON "customer_activity_logs" ("created_at");
CREATE INDEX IF NOT EXISTS "customer_activity_customer_idx" ON "customer_activity_logs" ("customer_id", "created_at");
CREATE INDEX IF NOT EXISTS "attendance_staff_day_idx" ON "attendance_records" ("staff_id", "check_in_at");
CREATE UNIQUE INDEX IF NOT EXISTS "qr_tokens_entity_unique_idx" ON "qr_tokens" ("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "orders_qr_token_idx" ON "orders" ("qr_token");
CREATE INDEX IF NOT EXISTS "service_orders_qr_token_idx" ON "service_orders" ("qr_token");
CREATE INDEX IF NOT EXISTS "sales_invoices_qr_token_idx" ON "sales_invoices" ("qr_token");
