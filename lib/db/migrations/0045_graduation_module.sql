-- AJN graduation production module. Existing customers, products, finance, tasks,
-- notifications, documents and timeline tables are reused by foreign keys/entity ids.

CREATE TABLE IF NOT EXISTS "graduation_groups" (
  "id" serial PRIMARY KEY,
  "group_no" varchar(50) NOT NULL,
  "join_token" varchar(96) NOT NULL,
  "title" text NOT NULL,
  "representative_name" text NOT NULL DEFAULT '',
  "representative_phone" varchar(30) NOT NULL DEFAULT '',
  "university" text,
  "college" text,
  "department" text,
  "graduation_year" varchar(10),
  "event_date" date,
  "default_configuration" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" varchar(24) NOT NULL DEFAULT 'open',
  "expires_at" timestamp,
  "created_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "graduation_groups_no_idx" ON "graduation_groups" ("group_no");
CREATE UNIQUE INDEX IF NOT EXISTS "graduation_groups_token_idx" ON "graduation_groups" ("join_token");
CREATE INDEX IF NOT EXISTS "graduation_groups_status_idx" ON "graduation_groups" ("status");

CREATE TABLE IF NOT EXISTS "graduation_orders" (
  "id" serial PRIMARY KEY,
  "order_no" varchar(50) NOT NULL,
  "qr_token" varchar(96) NOT NULL,
  "customer_id" integer REFERENCES "customers"("id") ON DELETE SET NULL,
  "group_id" integer REFERENCES "graduation_groups"("id") ON DELETE SET NULL,
  "customer_name" text NOT NULL,
  "phone" varchar(30) NOT NULL,
  "phone_last4" varchar(4),
  "status" varchar(30) NOT NULL DEFAULT 'draft',
  "production_stage" varchar(40) NOT NULL DEFAULT 'new',
  "style_key" varchar(60) NOT NULL DEFAULT 'standard',
  "package_key" varchar(60),
  "measurements" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "colors" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "fabric" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "decoration" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "custom_text" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "accessories" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "university_template" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "preview_assets" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "inventory_items" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "pricing" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "subtotal" numeric(14,2) NOT NULL DEFAULT 0,
  "discount_amount" numeric(14,2) NOT NULL DEFAULT 0,
  "total_amount" numeric(14,2) NOT NULL DEFAULT 0,
  "paid_amount" numeric(14,2) NOT NULL DEFAULT 0,
  "remaining_amount" numeric(14,2) NOT NULL DEFAULT 0,
  "payment_method" varchar(20) NOT NULL DEFAULT 'cash',
  "payment_status" varchar(20) NOT NULL DEFAULT 'unpaid',
  "invoice_id" integer,
  "financial_transaction_id" integer,
  "inventory_applied" boolean NOT NULL DEFAULT false,
  "production_estimate" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "quality_checklist" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "design_approved_at" timestamp,
  "assigned_staff_id" integer REFERENCES "staff"("id") ON DELETE SET NULL,
  "delivery" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "due_date" date,
  "notes" text,
  "internal_notes" text,
  "submitted_at" timestamp,
  "ready_at" timestamp,
  "delivered_at" timestamp,
  "archived_at" timestamp,
  "created_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
  "created_by_name" text NOT NULL DEFAULT '',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "graduation_orders_no_idx" ON "graduation_orders" ("order_no");
CREATE UNIQUE INDEX IF NOT EXISTS "graduation_orders_qr_token_idx" ON "graduation_orders" ("qr_token");
CREATE INDEX IF NOT EXISTS "graduation_orders_phone_idx" ON "graduation_orders" ("phone");
CREATE INDEX IF NOT EXISTS "graduation_orders_customer_idx" ON "graduation_orders" ("customer_id");
CREATE INDEX IF NOT EXISTS "graduation_orders_group_idx" ON "graduation_orders" ("group_id");
CREATE INDEX IF NOT EXISTS "graduation_orders_status_idx" ON "graduation_orders" ("status");
CREATE INDEX IF NOT EXISTS "graduation_orders_stage_idx" ON "graduation_orders" ("production_stage");
CREATE INDEX IF NOT EXISTS "graduation_orders_due_idx" ON "graduation_orders" ("due_date");
CREATE INDEX IF NOT EXISTS "graduation_orders_created_idx" ON "graduation_orders" ("created_at");

CREATE TABLE IF NOT EXISTS "graduation_resources" (
  "id" serial PRIMARY KEY,
  "resource_type" varchar(30) NOT NULL,
  "code" varchar(80) NOT NULL,
  "name" text NOT NULL,
  "product_id" integer REFERENCES "products"("id") ON DELETE SET NULL,
  "operator_id" integer REFERENCES "staff"("id") ON DELETE SET NULL,
  "operator_name" text NOT NULL DEFAULT '',
  "status" varchar(30) NOT NULL DEFAULT 'available',
  "metrics" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "usage_count" integer NOT NULL DEFAULT 0,
  "maintenance_due_at" timestamp,
  "notes" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "graduation_resources_code_idx" ON "graduation_resources" ("code");
CREATE INDEX IF NOT EXISTS "graduation_resources_type_idx" ON "graduation_resources" ("resource_type");
CREATE INDEX IF NOT EXISTS "graduation_resources_status_idx" ON "graduation_resources" ("status");
CREATE INDEX IF NOT EXISTS "graduation_resources_product_idx" ON "graduation_resources" ("product_id");

UPDATE "staff"
SET "permissions" = COALESCE("permissions", '[]'::jsonb) || '["graduation"]'::jsonb
WHERE "role" IN ('admin', 'manager')
  AND NOT (COALESCE("permissions", '[]'::jsonb) @> '["graduation"]'::jsonb);

INSERT INTO "financial_accounts" ("code", "name_ar", "account_type", "department") VALUES
  ('4060', 'إيرادات تجهيزات التخرج', 'revenue', 'graduation'),
  ('5060', 'مصاريف تجهيزات التخرج', 'expense', 'graduation')
ON CONFLICT ("code") DO NOTHING;
