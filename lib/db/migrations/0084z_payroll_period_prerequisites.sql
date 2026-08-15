-- 0085/0086 use these lifecycle columns before the former runtime bootstrap.
ALTER TABLE payroll_runs
  ADD COLUMN IF NOT EXISTS period_start_date date,
  ADD COLUMN IF NOT EXISTS period_end_date date,
  ADD COLUMN IF NOT EXISTS deleted_at timestamp;
