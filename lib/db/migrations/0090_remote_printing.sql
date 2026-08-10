-- Remote Windows printing. Additive only: it does not alter invoices, payments,
-- stock, or any historical financial record.
create table if not exists print_agents (
  id serial primary key,
  agent_id varchar(64) not null,
  name text not null,
  registration_token_hash varchar(128),
  token_hash varchar(128),
  branch_id integer references enterprise_branches(id) on delete set null,
  status varchar(20) not null default 'pending',
  hostname varchar(255),
  app_version varchar(40),
  detected_printers jsonb not null default '[]'::jsonb,
  last_seen_at timestamp,
  credential_rotated_at timestamp,
  disabled_at timestamp,
  created_by integer references staff(id) on delete set null,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now()
);
create unique index if not exists print_agents_agent_id_unique_idx on print_agents(agent_id);
create unique index if not exists print_agents_token_hash_unique_idx on print_agents(token_hash) where token_hash is not null;
create index if not exists print_agents_branch_idx on print_agents(branch_id, status);
create index if not exists print_agents_last_seen_idx on print_agents(last_seen_at);

create table if not exists printers (
  id serial primary key,
  agent_id integer not null references print_agents(id) on delete cascade,
  branch_id integer references enterprise_branches(id) on delete set null,
  name varchar(255) not null,
  display_name varchar(255),
  driver_type varchar(20) not null default 'windows',
  paper_size varchar(10) not null default '80mm',
  default_copies integer not null default 1,
  auto_print_enabled boolean not null default true,
  allowed_document_types jsonb not null default '["sales_invoice"]'::jsonb,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now(),
  constraint printers_agent_name_unique unique(agent_id, name)
);
create index if not exists printers_branch_idx on printers(branch_id, is_active);
create index if not exists printers_agent_idx on printers(agent_id, is_active);

create table if not exists print_jobs (
  id serial primary key,
  job_no varchar(64) not null unique,
  document_type varchar(40) not null,
  document_id integer not null,
  invoice_id integer references sales_invoices(id) on delete restrict,
  printer_id integer references printers(id) on delete set null,
  branch_id integer references enterprise_branches(id) on delete set null,
  computer_agent_id integer references print_agents(id) on delete set null,
  paper_size varchar(10) not null default '80mm',
  copies integer not null default 1,
  payload jsonb not null default '{}'::jsonb,
  status varchar(20) not null default 'queued',
  idempotency_key varchar(140) not null unique,
  requested_by integer references staff(id) on delete set null,
  requested_by_name text not null default '',
  requested_at timestamp not null default now(),
  claimed_at timestamp,
  started_at timestamp,
  completed_at timestamp,
  failed_at timestamp,
  cancelled_at timestamp,
  error_message text,
  retry_count integer not null default 0,
  next_attempt_at timestamp,
  original_print_job_id integer references print_jobs(id) on delete restrict,
  reprint_reason text,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now()
);
create index if not exists print_jobs_queue_idx on print_jobs(computer_agent_id, status, next_attempt_at, requested_at);
create index if not exists print_jobs_invoice_idx on print_jobs(invoice_id, created_at);
create index if not exists print_jobs_branch_idx on print_jobs(branch_id, status, created_at);
