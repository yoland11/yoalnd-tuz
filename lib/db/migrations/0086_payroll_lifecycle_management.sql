-- Extends the existing payroll run; it does not create duplicate balances or payments.
alter table payroll_runs
  add column if not exists run_kind varchar(20) not null default 'standard',
  add column if not exists parent_payroll_run_id integer references payroll_runs(id) on delete restrict,
  add column if not exists supplement_reason text,
  add column if not exists version_no integer not null default 1,
  add column if not exists reviewed_at timestamp,
  add column if not exists reviewed_by integer references staff(id) on delete set null,
  add column if not exists locked_at timestamp,
  add column if not exists locked_by integer references staff(id) on delete set null,
  add column if not exists closed_at timestamp,
  add column if not exists closed_by integer references staff(id) on delete set null;

create index if not exists payroll_runs_parent_idx on payroll_runs(parent_payroll_run_id);
create index if not exists payroll_runs_status_period_idx on payroll_runs(status, period_start_date desc);
