-- AJN ERP Enterprise Phase 5
-- Additive only. Existing bookings, finance, inventory, CRM and timelines remain unchanged.

CREATE TABLE IF NOT EXISTS "enterprise_branches" (
  "id" serial PRIMARY KEY,
  "code" varchar(30) NOT NULL UNIQUE,
  "name" text NOT NULL,
  "city" text,
  "address" text,
  "map_url" text,
  "latitude" numeric(10,7),
  "longitude" numeric(10,7),
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

INSERT INTO "enterprise_branches" ("code", "name")
VALUES ('MAIN', 'الفرع الرئيسي')
ON CONFLICT ("code") DO NOTHING;

CREATE TABLE IF NOT EXISTS "branch_entity_assignments" (
  "id" serial PRIMARY KEY,
  "branch_id" integer NOT NULL REFERENCES "enterprise_branches" ("id") ON DELETE CASCADE,
  "entity_type" varchar(40) NOT NULL,
  "entity_id" integer NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "branch_entity_assignments_entity_idx" ON "branch_entity_assignments" ("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "branch_entity_assignments_branch_idx" ON "branch_entity_assignments" ("branch_id", "entity_type");

CREATE TABLE IF NOT EXISTS "fleet_vehicles" (
  "id" serial PRIMARY KEY,
  "branch_id" integer REFERENCES "enterprise_branches" ("id") ON DELETE SET NULL,
  "name" text NOT NULL,
  "plate_number" varchar(40) NOT NULL UNIQUE,
  "status" varchar(24) NOT NULL DEFAULT 'available',
  "capacity" integer NOT NULL DEFAULT 1,
  "latitude" numeric(10,7),
  "longitude" numeric(10,7),
  "notes" text,
  "last_location_at" timestamp,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "fleet_vehicles_status_idx" ON "fleet_vehicles" ("status", "is_active");
CREATE INDEX IF NOT EXISTS "fleet_vehicles_branch_idx" ON "fleet_vehicles" ("branch_id");

CREATE TABLE IF NOT EXISTS "field_locations" (
  "id" serial PRIMARY KEY,
  "resource_type" varchar(24) NOT NULL,
  "resource_id" integer NOT NULL,
  "resource_name" text NOT NULL DEFAULT '',
  "branch_id" integer REFERENCES "enterprise_branches" ("id") ON DELETE SET NULL,
  "entity_type" varchar(40),
  "entity_id" integer,
  "latitude" numeric(10,7) NOT NULL,
  "longitude" numeric(10,7) NOT NULL,
  "accuracy_meters" numeric(10,2),
  "status" varchar(30) NOT NULL DEFAULT 'available',
  "recorded_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
  "recorded_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "field_locations_resource_idx" ON "field_locations" ("resource_type", "resource_id", "recorded_at");
CREATE INDEX IF NOT EXISTS "field_locations_entity_idx" ON "field_locations" ("entity_type", "entity_id");

CREATE TABLE IF NOT EXISTS "dispatch_assignments" (
  "id" serial PRIMARY KEY,
  "entity_type" varchar(40) NOT NULL,
  "entity_id" integer NOT NULL,
  "branch_id" integer REFERENCES "enterprise_branches" ("id") ON DELETE SET NULL,
  "crew_id" integer REFERENCES "crews" ("id") ON DELETE SET NULL,
  "vehicle_id" integer REFERENCES "fleet_vehicles" ("id") ON DELETE SET NULL,
  "warehouse_id" integer REFERENCES "warehouses" ("id") ON DELETE SET NULL,
  "score" numeric(6,2) NOT NULL DEFAULT 0,
  "status" varchar(24) NOT NULL DEFAULT 'assigned',
  "suggestions" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "notes" text,
  "assigned_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
  "assigned_by_name" text NOT NULL DEFAULT '',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "dispatch_assignments_entity_idx" ON "dispatch_assignments" ("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "dispatch_assignments_status_idx" ON "dispatch_assignments" ("status", "created_at");

CREATE TABLE IF NOT EXISTS "internal_channels" (
  "id" serial PRIMARY KEY,
  "title" text NOT NULL,
  "department" varchar(40) NOT NULL DEFAULT 'general',
  "entity_type" varchar(40),
  "entity_id" integer,
  "participant_staff_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
  "archived_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "internal_channels_entity_idx" ON "internal_channels" ("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "internal_channels_department_idx" ON "internal_channels" ("department", "updated_at");

CREATE TABLE IF NOT EXISTS "internal_messages" (
  "id" serial PRIMARY KEY,
  "channel_id" integer NOT NULL REFERENCES "internal_channels" ("id") ON DELETE CASCADE,
  "sender_id" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
  "sender_name" text NOT NULL DEFAULT '',
  "body" text,
  "voice_url" text,
  "voice_duration" integer,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "internal_messages_channel_idx" ON "internal_messages" ("channel_id", "created_at");

CREATE TABLE IF NOT EXISTS "customer_queue_entries" (
  "id" serial PRIMARY KEY,
  "queue_no" varchar(40) NOT NULL UNIQUE,
  "customer_id" integer REFERENCES "customers" ("id") ON DELETE SET NULL,
  "customer_name" text NOT NULL DEFAULT '',
  "phone" varchar(30),
  "service_type" varchar(40) NOT NULL DEFAULT 'general',
  "branch_id" integer REFERENCES "enterprise_branches" ("id") ON DELETE SET NULL,
  "status" varchar(24) NOT NULL DEFAULT 'waiting',
  "arrived_at" timestamp NOT NULL DEFAULT now(),
  "service_started_at" timestamp,
  "completed_at" timestamp,
  "notes" text,
  "created_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "customer_queue_entries_status_idx" ON "customer_queue_entries" ("status", "arrived_at");

CREATE TABLE IF NOT EXISTS "lost_time_entries" (
  "id" serial PRIMARY KEY,
  "entity_type" varchar(40),
  "entity_id" integer,
  "reason_type" varchar(30) NOT NULL,
  "minutes" integer NOT NULL,
  "description" text,
  "staff_id" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
  "vehicle_id" integer REFERENCES "fleet_vehicles" ("id") ON DELETE SET NULL,
  "product_id" integer REFERENCES "products" ("id") ON DELETE SET NULL,
  "recorded_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
  "occurred_at" timestamp NOT NULL DEFAULT now(),
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "lost_time_entries_reason_idx" ON "lost_time_entries" ("reason_type", "occurred_at");
CREATE INDEX IF NOT EXISTS "lost_time_entries_entity_idx" ON "lost_time_entries" ("entity_type", "entity_id");

CREATE TABLE IF NOT EXISTS "asset_passports" (
  "id" serial PRIMARY KEY,
  "product_id" integer NOT NULL UNIQUE REFERENCES "products" ("id") ON DELETE CASCADE,
  "serial_number" varchar(120) UNIQUE,
  "supplier_name" text,
  "warranty_until" date,
  "warehouse_id" integer REFERENCES "warehouses" ("id") ON DELETE SET NULL,
  "shelf_code" varchar(40),
  "image_url" text,
  "qr_token" varchar(80),
  "last_staff_id" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
  "last_location" text,
  "revenue_total" numeric(16,2) NOT NULL DEFAULT 0,
  "maintenance_cost" numeric(16,2) NOT NULL DEFAULT 0,
  "next_maintenance_date" date,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "asset_passports_shelf_idx" ON "asset_passports" ("warehouse_id", "shelf_code");

CREATE TABLE IF NOT EXISTS "equipment_custody" (
  "id" serial PRIMARY KEY,
  "product_id" integer NOT NULL REFERENCES "products" ("id") ON DELETE RESTRICT,
  "staff_id" integer NOT NULL REFERENCES "staff" ("id") ON DELETE RESTRICT,
  "quantity" integer NOT NULL DEFAULT 1,
  "status" varchar(24) NOT NULL DEFAULT 'issued',
  "signature_url" text,
  "issued_at" timestamp NOT NULL DEFAULT now(),
  "returned_at" timestamp,
  "notes" text,
  "issued_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "equipment_custody_staff_status_idx" ON "equipment_custody" ("staff_id", "status");
CREATE INDEX IF NOT EXISTS "equipment_custody_product_status_idx" ON "equipment_custody" ("product_id", "status");

CREATE TABLE IF NOT EXISTS "event_cost_estimates" (
  "id" serial PRIMARY KEY,
  "entity_type" varchar(40) NOT NULL,
  "entity_id" integer NOT NULL,
  "materials_cost" numeric(16,2) NOT NULL DEFAULT 0,
  "transport_cost" numeric(16,2) NOT NULL DEFAULT 0,
  "fuel_cost" numeric(16,2) NOT NULL DEFAULT 0,
  "labor_cost" numeric(16,2) NOT NULL DEFAULT 0,
  "depreciation_cost" numeric(16,2) NOT NULL DEFAULT 0,
  "expected_revenue" numeric(16,2) NOT NULL DEFAULT 0,
  "expected_profit" numeric(16,2) NOT NULL DEFAULT 0,
  "profit_margin" numeric(7,2) NOT NULL DEFAULT 0,
  "warning" text,
  "created_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "event_cost_estimates_entity_idx" ON "event_cost_estimates" ("entity_type", "entity_id");

CREATE TABLE IF NOT EXISTS "warehouse_camera_snapshots" (
  "id" serial PRIMARY KEY,
  "warehouse_id" integer REFERENCES "warehouses" ("id") ON DELETE SET NULL,
  "entity_type" varchar(40),
  "entity_id" integer,
  "movement_type" varchar(24) NOT NULL DEFAULT 'checkout',
  "image_url" text NOT NULL,
  "captured_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
  "captured_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "warehouse_camera_snapshots_entity_idx" ON "warehouse_camera_snapshots" ("entity_type", "entity_id", "captured_at");

CREATE TABLE IF NOT EXISTS "design_library_items" (
  "id" serial PRIMARY KEY,
  "type" varchar(30) NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "images" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "material_product_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "execution_cost" numeric(16,2) NOT NULL DEFAULT 0,
  "execution_minutes" integer NOT NULL DEFAULT 0,
  "order_count" integer NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "design_library_items_type_idx" ON "design_library_items" ("type", "is_active");

CREATE TABLE IF NOT EXISTS "daily_closing_checklists" (
  "id" serial PRIMARY KEY,
  "closing_date" date NOT NULL,
  "branch_code" varchar(30) NOT NULL DEFAULT 'MAIN',
  "equipment_returned" boolean NOT NULL DEFAULT false,
  "payments_approved" boolean NOT NULL DEFAULT false,
  "bookings_closed" boolean NOT NULL DEFAULT false,
  "cash_closed" boolean NOT NULL DEFAULT false,
  "backup_completed" boolean NOT NULL DEFAULT false,
  "notes" text,
  "status" varchar(20) NOT NULL DEFAULT 'open',
  "closed_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
  "closed_by_name" text NOT NULL DEFAULT '',
  "closed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "daily_closing_checklists_date_branch_idx" ON "daily_closing_checklists" ("closing_date", "branch_code");

CREATE TABLE IF NOT EXISTS "knowledge_articles" (
  "id" serial PRIMARY KEY,
  "category" varchar(40) NOT NULL DEFAULT 'general',
  "title" text NOT NULL,
  "content" text NOT NULL,
  "video_url" text,
  "tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
  "created_by_name" text NOT NULL DEFAULT '',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "knowledge_articles_category_idx" ON "knowledge_articles" ("category", "is_active");

CREATE TABLE IF NOT EXISTS "knowledge_cases" (
  "id" serial PRIMARY KEY,
  "problem" text NOT NULL,
  "solution" text NOT NULL,
  "entity_type" varchar(40),
  "entity_id" integer,
  "tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "times_reused" integer NOT NULL DEFAULT 0,
  "created_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "knowledge_cases_entity_idx" ON "knowledge_cases" ("entity_type", "entity_id");

CREATE TABLE IF NOT EXISTS "management_decisions" (
  "id" serial PRIMARY KEY,
  "title" text NOT NULL,
  "decision" text NOT NULL,
  "reason" text NOT NULL,
  "entity_type" varchar(40),
  "entity_id" integer,
  "decided_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
  "decided_by_name" text NOT NULL DEFAULT '',
  "decided_at" timestamp NOT NULL DEFAULT now(),
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "management_decisions_date_idx" ON "management_decisions" ("decided_at");
CREATE INDEX IF NOT EXISTS "management_decisions_entity_idx" ON "management_decisions" ("entity_type", "entity_id");

CREATE TABLE IF NOT EXISTS "customer_attributions" (
  "id" serial PRIMARY KEY,
  "customer_id" integer REFERENCES "customers" ("id") ON DELETE CASCADE,
  "phone" varchar(30),
  "source" varchar(30) NOT NULL,
  "campaign" text,
  "entity_type" varchar(40),
  "entity_id" integer,
  "created_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "customer_attributions_source_idx" ON "customer_attributions" ("source", "created_at");
CREATE INDEX IF NOT EXISTS "customer_attributions_customer_idx" ON "customer_attributions" ("customer_id", "created_at");
