-- Additive metadata on the existing shared Koshah/product assignment.
-- No stock, payment, booking, asset passport, or historical values are changed.
ALTER TABLE kosha_asset_assignments
  ADD COLUMN IF NOT EXISTS equipment_config jsonb;
