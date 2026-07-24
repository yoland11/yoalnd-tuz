-- Graduation Management Center — granular permissions.
--
-- Splits the single "graduation" module gate into role-scoped sub-permissions
-- (production / printing / embroidery / cashier / manager / warehouse) while
-- keeping "graduation" as an umbrella grant. Application code (hasPermission /
-- hasPerm) treats "graduation" as implying every "graduation_*" sub-permission,
-- so nobody loses access even before this backfill runs.
--
-- Backfill: every staff member who currently holds the "graduation" module
-- permission is granted all six sub-permissions, so the staff editor reflects
-- them and admins can subsequently narrow each person's scope.

UPDATE staff
SET permissions = (
  SELECT to_jsonb(
    ARRAY(
      SELECT DISTINCT value
      FROM unnest(
        ARRAY(SELECT jsonb_array_elements_text(staff.permissions))
        || ARRAY[
          'graduation_production',
          'graduation_printing',
          'graduation_embroidery',
          'graduation_cashier',
          'graduation_manager',
          'graduation_warehouse'
        ]
      ) AS value
    )
  )
)
WHERE permissions ? 'graduation';
