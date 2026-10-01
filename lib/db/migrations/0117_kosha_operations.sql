-- Koshah construction, shared physical assets, maintenance and damage history.
-- Financial amounts remain in AJN purchase/expense/financial transaction records.

CREATE TABLE IF NOT EXISTS "kosha_construction_projects" (
  "id" serial PRIMARY KEY,
  "kosha_id" integer NOT NULL REFERENCES "koshas"("id") ON DELETE CASCADE,
  "planned_budget" numeric(14,2) NOT NULL DEFAULT 0,
  "stage" varchar(32) NOT NULL DEFAULT 'draft'
    CHECK ("stage" IN ('draft','materials_required','purchasing','materials_received','assembly','inspection','ready')),
  "created_on" date NOT NULL DEFAULT CURRENT_DATE,
  "expected_completion_date" date,
  "responsible_employee_id" integer REFERENCES "staff"("id") ON DELETE SET NULL,
  "notes" text,
  "created_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "kosha_construction_projects_kosha_idx"
  ON "kosha_construction_projects" ("kosha_id");

CREATE TABLE IF NOT EXISTS "kosha_asset_assignments" (
  "id" serial PRIMARY KEY,
  "kosha_id" integer NOT NULL REFERENCES "koshas"("id") ON DELETE CASCADE,
  "product_id" integer NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT,
  "quantity" numeric(12,3) NOT NULL DEFAULT 1 CHECK ("quantity" > 0),
  "shared" boolean NOT NULL DEFAULT false,
  "storage_location" text,
  "notes" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "assigned_at" timestamp NOT NULL DEFAULT now(),
  "assigned_by" integer REFERENCES "staff"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "kosha_asset_assignments_active_product_idx"
  ON "kosha_asset_assignments" ("kosha_id", "product_id") WHERE "is_active" = true;
CREATE INDEX IF NOT EXISTS "kosha_asset_assignments_product_idx"
  ON "kosha_asset_assignments" ("product_id");

CREATE TABLE IF NOT EXISTS "kosha_maintenance_records" (
  "id" serial PRIMARY KEY,
  "kosha_id" integer NOT NULL REFERENCES "koshas"("id") ON DELETE CASCADE,
  "product_id" integer REFERENCES "products"("id") ON DELETE SET NULL,
  "maintenance_type" varchar(40) NOT NULL,
  "maintenance_date" date NOT NULL DEFAULT CURRENT_DATE,
  "description" text NOT NULL,
  "parts" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "supplier_id" integer REFERENCES "suppliers"("id") ON DELETE SET NULL,
  "technician_name" text,
  "employee_id" integer REFERENCES "staff"("id") ON DELETE SET NULL,
  "attachments" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "next_maintenance_date" date,
  "expense_id" integer UNIQUE REFERENCES "expenses"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "kosha_maintenance_kosha_date_idx"
  ON "kosha_maintenance_records" ("kosha_id", "maintenance_date");
CREATE INDEX IF NOT EXISTS "kosha_maintenance_next_date_idx"
  ON "kosha_maintenance_records" ("next_maintenance_date");

-- Reuse the legacy booking damage workflow table and add nullable Koshah context.
ALTER TABLE "kosha_damage_reports"
  ADD COLUMN IF NOT EXISTS "kosha_id" integer REFERENCES "koshas"("id") ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS "incident_type" varchar(30),
  ADD COLUMN IF NOT EXISTS "reason" text,
  ADD COLUMN IF NOT EXISTS "estimated_repair_cost" numeric(14,2),
  ADD COLUMN IF NOT EXISTS "estimated_replacement_cost" numeric(14,2),
  ADD COLUMN IF NOT EXISTS "expense_id" integer REFERENCES "expenses"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "resolved_at" timestamp;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'kosha_damage_incident_type_check'
  ) THEN
    ALTER TABLE "kosha_damage_reports"
      ADD CONSTRAINT "kosha_damage_incident_type_check"
      CHECK ("incident_type" IS NULL OR "incident_type" IN ('damage','missing','loss'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "kosha_damage_kosha_date_idx"
  ON "kosha_damage_reports" ("kosha_id", "created_at");
CREATE INDEX IF NOT EXISTS "kosha_damage_booking_idx"
  ON "kosha_damage_reports" ("booking_id");
CREATE UNIQUE INDEX IF NOT EXISTS "kosha_damage_expense_idx"
  ON "kosha_damage_reports" ("expense_id") WHERE "expense_id" IS NOT NULL;
