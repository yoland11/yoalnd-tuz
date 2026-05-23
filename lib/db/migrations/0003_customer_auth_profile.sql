create table if not exists "otp_codes" (
  "id" serial primary key,
  "phone" varchar(20) not null,
  "code_hash" text not null default '',
  "expires_at" timestamp not null,
  "used" boolean not null default false,
  "attempts" integer not null default 0,
  "created_at" timestamp not null default now()
);

alter table "otp_codes" add column if not exists "code_hash" text not null default '';
alter table "otp_codes" add column if not exists "attempts" integer not null default 0;
alter table "otp_codes" add column if not exists "code" varchar(10);
alter table "otp_codes" alter column "code" drop not null;
create index if not exists "otp_codes_phone_idx" on "otp_codes" ("phone");
create index if not exists "otp_codes_phone_created_idx" on "otp_codes" ("phone", "created_at");

alter table "customers" add column if not exists "full_name" text;
alter table "customers" add column if not exists "email" text;
alter table "customers" add column if not exists "avatar_url" text;
alter table "customers" add column if not exists "address" text;
alter table "customers" add column if not exists "city" text;
alter table "customers" add column if not exists "updated_at" timestamp not null default now();
