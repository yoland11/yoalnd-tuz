-- Restore the additive payroll-line fields required by salary movements.
-- Older payroll_lines tables may predate these fields; existing rows and
-- financial history remain unchanged.
ALTER TABLE payroll_lines
  ADD COLUMN IF NOT EXISTS manual_deduction numeric(16,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_status varchar(20) NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS line_notes text;
