-- Optional project-level attribution for newly classified investment costs.
-- Existing financial records stay untouched and unassigned.
ALTER TABLE "purchase_invoice_items"
  ADD COLUMN IF NOT EXISTS "construction_project_id" integer
  REFERENCES "kosha_construction_projects"("id") ON DELETE SET NULL;
ALTER TABLE "expenses"
  ADD COLUMN IF NOT EXISTS "construction_project_id" integer
  REFERENCES "kosha_construction_projects"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "purchase_invoice_items_construction_project_idx"
  ON "purchase_invoice_items" ("construction_project_id");
CREATE INDEX IF NOT EXISTS "expenses_construction_project_idx"
  ON "expenses" ("construction_project_id");
