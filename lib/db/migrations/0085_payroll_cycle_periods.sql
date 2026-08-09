-- Payroll cycles were historically unique per calendar month.  Keep that month
-- for legacy reports, but use a stable window key for weekly/daily/custom runs.
alter table payroll_runs
  add column if not exists period_type varchar(20) not null default 'monthly',
  add column if not exists period_key varchar(80);

update payroll_runs
set
  period_type = coalesce(nullif(period_type, ''), 'monthly'),
  period_key = coalesce(
    period_key,
    concat(
      coalesce(nullif(period_type, ''), 'monthly'),
      ':',
      coalesce(period_start_date, (period || '-01')::date)::text,
      ':',
      coalesce(period_end_date, ((period || '-01')::date + interval '1 month - 1 day')::date)::text
    )
  )
where period_key is null;

alter table payroll_runs drop constraint if exists payroll_runs_period_key;
drop index if exists payroll_runs_active_period_uq;
create unique index if not exists payroll_runs_active_period_key_uq
  on payroll_runs(period_key)
  where deleted_at is null;

create index if not exists payroll_runs_period_type_start_idx
  on payroll_runs(period_type, period_start_date desc);
