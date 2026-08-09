-- Additive delegated-approval authorization. Historical approval requests remain untouched.
create table if not exists "employee_approval_permissions" (
  "id" serial primary key,
  "staff_id" integer not null unique references "staff"("id") on delete cascade,
  "permission_codes" jsonb not null default '[]'::jsonb,
  "allowed_categories" jsonb not null default '[]'::jsonb,
  "allowed_departments" jsonb not null default '[]'::jsonb,
  "allowed_branch_ids" jsonb not null default '[]'::jsonb,
  "category_modes" jsonb not null default '{}'::jsonb,
  "max_amount" numeric(16,2) not null default 0,
  "unlimited_amount" boolean not null default false,
  "valid_from" timestamp,
  "valid_until" timestamp,
  "is_active" boolean not null default true,
  "is_temporary" boolean not null default false,
  "delegation_reason" text,
  "granted_by" integer references "staff"("id"),
  "created_at" timestamp not null default now(),
  "updated_at" timestamp not null default now()
);
create table if not exists "approval_actions" (
  "id" serial primary key,
  "approval_request_id" integer not null references "approval_requests"("id") on delete cascade,
  "action" varchar(40) not null,
  "old_status" varchar(30),
  "new_status" varchar(30),
  "actor_staff_id" integer references "staff"("id"),
  "actor_name" text not null default '',
  "actor_role" varchar(30),
  "note" text,
  "amount" numeric(16,2),
  "ip_address" varchar(120),
  "session_id" varchar(120),
  "metadata" jsonb not null default '{}'::jsonb,
  "created_at" timestamp not null default now()
);
create index if not exists "employee_approval_permissions_active_staff_idx" on "employee_approval_permissions" ("is_active", "staff_id");
create index if not exists "approval_actions_request_created_idx" on "approval_actions" ("approval_request_id", "created_at");
create index if not exists "approval_actions_actor_created_idx" on "approval_actions" ("actor_staff_id", "created_at");
