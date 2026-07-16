-- Granular payroll permissions.  Keep the existing HR permission as a module gate,
-- while granting the new action permissions to current HR-capable roles.
UPDATE "staff" AS s
SET "permissions" = (
  SELECT jsonb_agg(to_jsonb(p.value) ORDER BY p.value)
  FROM (
    SELECT value
    FROM jsonb_array_elements_text(coalesce(s."permissions", '[]'::jsonb))
    UNION
    SELECT unnest(ARRAY[
      'payroll_view', 'payroll_edit', 'payroll_delete',
      'payroll_recalculate', 'payroll_reopen', 'payroll_cancel',
      'payroll_approve', 'payroll_pay'
    ]::text[])
  ) AS p(value)
)
WHERE s."role" IN ('admin', 'manager')
   OR coalesce(s."permissions", '[]'::jsonb) ? 'hr';

-- Accountants can inspect/recalculate, approve, and pay payroll, but should not
-- receive employee-record edit/delete/reopen privileges by default.
UPDATE "staff" AS s
SET "permissions" = (
  SELECT jsonb_agg(to_jsonb(p.value) ORDER BY p.value)
  FROM (
    SELECT value
    FROM jsonb_array_elements_text(coalesce(s."permissions", '[]'::jsonb))
    UNION
    SELECT unnest(ARRAY[
      'payroll_view', 'payroll_recalculate', 'payroll_approve', 'payroll_pay'
    ]::text[])
  ) AS p(value)
)
WHERE s."role" = 'accountant';
