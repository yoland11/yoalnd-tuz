-- Removing depreciation must never remove the asset/product. Keep the profile as
-- a recoverable financial history record and expose only active profiles to UI.
ALTER TABLE "asset_profiles"
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamp,
  ADD COLUMN IF NOT EXISTS "deleted_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "deleted_reason" text,
  ADD COLUMN IF NOT EXISTS "value_before_removal" text;

CREATE INDEX IF NOT EXISTS "asset_profiles_active_idx"
  ON "asset_profiles" ("product_id")
  WHERE "deleted_at" IS NULL;

-- Give existing asset/product managers the explicit removal permission. The API
-- still validates this permission server-side for every removal request.
UPDATE "staff" AS s
SET "permissions" = (
  SELECT jsonb_agg(to_jsonb(p.value) ORDER BY p.value)
  FROM (
    SELECT value
    FROM jsonb_array_elements_text(coalesce(s."permissions", '[]'::jsonb))
    UNION
    SELECT 'asset_depreciation_remove'
  ) AS p(value)
)
WHERE s."role" IN ('admin', 'manager')
   OR coalesce(s."permissions", '[]'::jsonb) ? 'products';
