-- Additive archive marker. No bundle, invoice, snapshot, or stock movement is
-- deleted by this migration.
ALTER TABLE product_bundles
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS product_bundles_archived_idx
  ON product_bundles (archived_at) WHERE archived_at IS NULL;
