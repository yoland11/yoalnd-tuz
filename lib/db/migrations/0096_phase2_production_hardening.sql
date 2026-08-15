-- Phase 2 production hardening.
-- Apply during deployment before serving application traffic.

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  key_hash varchar(64) PRIMARY KEY,
  action varchar(80) NOT NULL,
  hit_count integer NOT NULL DEFAULT 0,
  window_started_at timestamp with time zone NOT NULL DEFAULT now(),
  reset_at timestamp with time zone NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rate_limit_buckets_reset_at_idx
  ON rate_limit_buckets (reset_at);

-- Runtime schema compatibility statements moved out of request execution.;

-- Migrated from src/server/api.ts:7962
create table if not exists "crews" (
        "id" serial primary key,
        "name" text not null,
        "is_active" boolean not null default true,
        "status" varchar(20) not null default 'available',
        "internal_notes" text,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      )
;

-- Migrated from src/server/api.ts:7976
alter table "crews" add column if not exists "status" varchar(20) not null default 'available'
;

-- Migrated from src/server/api.ts:7981
alter table "crews" add column if not exists "internal_notes" text
;

-- Migrated from src/server/api.ts:7991
create index if not exists "crews_status_idx" on "crews" ("status")
;

-- Migrated from src/server/api.ts:8003
create table if not exists "otp_codes" (
        "id" serial primary key,
        "phone" varchar(20) not null,
        "code" varchar(10),
        "code_hash" text not null default '',
        "expires_at" timestamp not null,
        "used" boolean not null default false,
        "attempts" integer not null default 0,
        "created_at" timestamp not null default now()
      )
;

-- Migrated from src/server/api.ts:8018
alter table "otp_codes" add column if not exists "code_hash" text not null default ''
;

-- Migrated from src/server/api.ts:8021
alter table "otp_codes" add column if not exists "attempts" integer not null default 0
;

-- Migrated from src/server/api.ts:8024
alter table "otp_codes" add column if not exists "code" varchar(10)
;

-- Migrated from src/server/api.ts:8027
alter table "otp_codes" alter column "code" drop not null
;

-- Migrated from src/server/api.ts:8030
create index if not exists "otp_codes_phone_idx" on "otp_codes" ("phone")
;

-- Migrated from src/server/api.ts:8033
create index if not exists "otp_codes_phone_created_idx" on "otp_codes" ("phone", "created_at")
;

-- Migrated from src/server/api.ts:8045
alter table "customers" add column if not exists "full_name" text
;

-- Migrated from src/server/api.ts:8049
alter table "customers" add column if not exists "email" text
;

-- Migrated from src/server/api.ts:8054
alter table "customers" add column if not exists "avatar_url" text
;

-- Migrated from src/server/api.ts:8059
alter table "customers" add column if not exists "address" text
;

-- Migrated from src/server/api.ts:8064
alter table "customers" add column if not exists "city" text
;

-- Migrated from src/server/api.ts:8069
alter table "customers" add column if not exists "updated_at" timestamp not null default now()
;

-- Migrated from src/server/api.ts:8074
alter table "customers" add column if not exists "status" varchar(20) not null default 'active'
;

-- Migrated from src/server/api.ts:8086
create table if not exists "customer_accounts" (
        "id" serial primary key,
        "customer_id" integer not null unique references "customers"("id") on delete restrict,
        "customer_code" varchar(32) not null unique,
        "username" varchar(80) not null unique,
        "phone_normalized" varchar(20) not null,
        "email" text,
        "password_hash" text not null,
        "recovery_code_hash" text not null,
        "recovery_generated_at" timestamp not null default now(),
        "recovery_acknowledged_at" timestamp,
        "failed_login_count" integer not null default 0,
        "locked_until" timestamp,
        "link_status" varchar(24) not null default 'linked',
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );
      create index if not exists "customer_accounts_phone_normalized_idx" on "customer_accounts" ("phone_normalized");
      create table if not exists "customer_sessions" (
        "id" serial primary key,
        "session_id" uuid not null unique,
        "account_id" integer not null references "customer_accounts"("id") on delete cascade,
        "customer_id" integer not null references "customers"("id") on delete cascade,
        "token_hash" text not null unique,
        "expires_at" timestamp not null,
        "user_agent" text,
        "device_id" text,
        "ip_address" varchar(80),
        "last_active_at" timestamp,
        "revoked_at" timestamp,
        "revoke_reason" text,
        "created_at" timestamp not null default now()
      );
      create index if not exists "customer_sessions_customer_idx" on "customer_sessions" ("customer_id", "expires_at");
      create table if not exists "customer_account_recovery_requests" (
        "id" serial primary key,
        "customer_id" integer references "customers"("id") on delete set null,
        "account_id" integer references "customer_accounts"("id") on delete set null,
        "identifier" varchar(120) not null,
        "phone_normalized" varchar(20),
        "notes" text,
        "status" varchar(24) not null default 'pending',
        "reviewed_by" integer references "staff"("id") on delete set null,
        "review_notes" text,
        "created_at" timestamp not null default now(),
        "reviewed_at" timestamp
      );
      create table if not exists "customer_private_photos" (
        "id" serial primary key,
        "customer_id" integer not null unique references "customers"("id") on delete cascade,
        "storage_path" text not null,
        "mime_type" varchar(80) not null,
        "file_size" integer not null,
        "width" integer,
        "height" integer,
        "checksum" varchar(128) not null,
        "deleted_at" timestamp,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );
      create table if not exists "customer_account_audit_logs" (
        "id" serial primary key,
        "customer_id" integer references "customers"("id") on delete set null,
        "account_id" integer references "customer_accounts"("id") on delete set null,
        "actor_staff_id" integer references "staff"("id") on delete set null,
        "action" varchar(100) not null,
        "metadata" jsonb not null default '{}'::jsonb,
        "ip_address" varchar(80),
        "user_agent" text,
        "created_at" timestamp not null default now()
      );
      create index if not exists "customer_account_audit_customer_idx" on "customer_account_audit_logs" ("customer_id", "created_at" desc);
;

-- Migrated from src/server/api.ts:8174
create table if not exists "customer_addresses" (
        "id" serial primary key,
        "customer_id" integer not null references "customers"("id"),
        "type" varchar(20) not null default 'home',
        "full_name" text not null default '',
        "phone" varchar(20) not null,
        "governorate" text not null default '',
        "city" text not null default '',
        "address" text not null default '',
        "landmark" text not null default '',
        "notes" text not null default '',
        "is_default" boolean not null default false,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      )
;

-- Migrated from src/server/api.ts:8194
create index if not exists "customer_addresses_customer_id_idx" on "customer_addresses" ("customer_id")
;

-- Migrated from src/server/api.ts:8198
create table if not exists "customer_preferences" (
          "id" serial primary key,
          "customer_id" integer not null references "customers"("id"),
          "default_payment_method" varchar(20) not null default 'cash',
          "created_at" timestamp not null default now(),
          "updated_at" timestamp not null default now()
        )
;

-- Migrated from src/server/api.ts:8210
create unique index if not exists "customer_preferences_customer_id_unique" on "customer_preferences" ("customer_id")
;

-- Migrated from src/server/api.ts:8222
alter table "orders" add column if not exists "phone_last4" varchar(4);
          alter table "orders" alter column "tracking_code" type varchar(40);
;

-- Migrated from src/server/api.ts:8229
alter table "service_orders" add column if not exists "phone_last4" varchar(4);
            alter table "service_orders" alter column "tracking_code" type varchar(40);
;

-- Migrated from src/server/api.ts:8253
alter table "orders" drop constraint if exists "orders_tracking_code_unique"
;

-- Migrated from src/server/api.ts:8258
alter table "service_orders" drop constraint if exists "service_orders_tracking_code_unique"
;

-- Migrated from src/server/api.ts:8262
drop index if exists "orders_tracking_code_unique"
;

-- Migrated from src/server/api.ts:8266
drop index if exists "service_orders_tracking_code_unique"
;

-- Migrated from src/server/api.ts:8271
create index if not exists "orders_tracking_code_idx" on "orders" ("tracking_code")
;

-- Migrated from src/server/api.ts:8276
create index if not exists "orders_phone_last4_idx" on "orders" ("phone_last4")
;

-- Migrated from src/server/api.ts:8281
create index if not exists "service_orders_tracking_code_idx" on "service_orders" ("tracking_code")
;

-- Migrated from src/server/api.ts:8286
create index if not exists "service_orders_phone_last4_idx" on "service_orders" ("phone_last4")
;

-- Migrated from src/server/api.ts:8298
alter table "orders" add column if not exists "deposit_amount" numeric(10,2) not null default 0
;

-- Migrated from src/server/api.ts:8302
alter table "orders" add column if not exists "remaining_amount" numeric(10,2) not null default 0
;

-- Migrated from src/server/api.ts:8307
alter table "orders" add column if not exists "payment_status" varchar(20) not null default 'unpaid'
;

-- Migrated from src/server/api.ts:8312
alter table "orders" add column if not exists "internal_notes" text
;

-- Migrated from src/server/api.ts:8317
alter table "service_orders" add column if not exists "total_amount" numeric(10,2) not null default 0
;

-- Migrated from src/server/api.ts:8322
alter table "service_orders" add column if not exists "deposit_amount" numeric(10,2) not null default 0
;

-- Migrated from src/server/api.ts:8327
alter table "service_orders" add column if not exists "remaining_amount" numeric(10,2) not null default 0
;

-- Migrated from src/server/api.ts:8332
alter table "service_orders" add column if not exists "payment_status" varchar(20) not null default 'unpaid'
;

-- Migrated from src/server/api.ts:8337
alter table "service_orders" add column if not exists "internal_notes" text
;

-- Migrated from src/server/api.ts:8365
create index if not exists "orders_payment_status_idx" on "orders" ("payment_status")
;

-- Migrated from src/server/api.ts:8370
create index if not exists "service_orders_payment_status_idx" on "service_orders" ("payment_status")
;

-- Migrated from src/server/api.ts:8382
alter table "orders" add column if not exists "archived_at" timestamp
;

-- Migrated from src/server/api.ts:8386
alter table "service_orders" add column if not exists "archived_at" timestamp
;

-- Migrated from src/server/api.ts:8391
create index if not exists "orders_archived_at_idx" on "orders" ("archived_at")
;

-- Migrated from src/server/api.ts:8396
create index if not exists "service_orders_archived_at_idx" on "service_orders" ("archived_at")
;

-- Migrated from src/server/api.ts:8408
create table if not exists "staff" (
        "id" serial primary key,
        "username" varchar(50) not null unique,
        "password_hash" text not null,
        "full_name" text not null default '',
        "role" varchar(30) not null default 'employee',
        "permissions" jsonb not null default '[]'::jsonb,
        "is_active" boolean not null default true,
        "last_activity_at" timestamp,
        "created_at" timestamp not null default now()
      )
;

-- Migrated from src/server/api.ts:8423
alter table "staff"
          add column if not exists "username" varchar(50),
          add column if not exists "password_hash" text,
          add column if not exists "full_name" text not null default '',
          add column if not exists "role" varchar(30) not null default 'employee',
          add column if not exists "department" varchar(60) not null default 'general',
          add column if not exists "base_salary" numeric(16,2) not null default 0,
          add column if not exists "hired_at" date not null default current_date,
          add column if not exists "job_title" varchar(100),
          add column if not exists "salary_type" varchar(20) not null default 'monthly',
          add column if not exists "currency" varchar(10) not null default 'IQD',
          add column if not exists "working_days_per_week" numeric(4,1) not null default 6,
          add column if not exists "daily_working_hours" numeric(5,2) not null default 8,
          add column if not exists "hourly_rate" numeric(16,2) not null default 0,
          add column if not exists "overtime_rate" numeric(16,2) not null default 0,
          add column if not exists "attendance_allowance" numeric(16,2) not null default 0,
          add column if not exists "transportation_allowance" numeric(16,2) not null default 0,
          add column if not exists "food_allowance" numeric(16,2) not null default 0,
          add column if not exists "phone_allowance" numeric(16,2) not null default 0,
          add column if not exists "housing_allowance" numeric(16,2) not null default 0,
          add column if not exists "other_fixed_allowances" numeric(16,2) not null default 0,
          add column if not exists "fixed_deduction" numeric(16,2) not null default 0,
          add column if not exists "sales_commission_percentage" numeric(6,2) not null default 0,
          add column if not exists "profit_commission_percentage" numeric(6,2) not null default 0,
          add column if not exists "payment_method" varchar(30) not null default 'cash',
          add column if not exists "payment_reference" text,
          add column if not exists "salary_status" varchar(20) not null default 'active',
          add column if not exists "salary_notes" text,
          add column if not exists "is_active" boolean not null default true,
          add column if not exists "last_activity_at" timestamp,
          add column if not exists "created_at" timestamp not null default now()
;

-- Migrated from src/server/api.ts:8458
do $$
        begin
          if exists (
            select 1
            from information_schema.columns
            where table_schema = current_schema()
              and table_name = 'staff'
              and column_name = 'permissions'
              and udt_name <> 'jsonb'
          ) then
            alter table "staff" rename column "permissions" to "permissions_legacy";
            alter table "staff" add column "permissions" jsonb not null default '[]'::jsonb;
          end if;
        end $$;
;

-- Migrated from src/server/api.ts:8477
alter table "staff" add column if not exists "permissions" jsonb not null default '[]'::jsonb
;

-- Migrated from src/server/api.ts:8482
alter table "staff" alter column "permissions" set default '[]'::jsonb
;

-- Migrated from src/server/api.ts:8487
create unique index if not exists "staff_username_unique_idx" on "staff" ("username")
;

-- Migrated from src/server/api.ts:8492
create index if not exists "staff_username_lower_idx" on "staff" (lower("username"))
;

-- Migrated from src/server/api.ts:8505
alter table "staff" add column if not exists "last_activity_at" timestamp
;

-- Migrated from src/server/api.ts:8517
create table if not exists "admin_activity_logs" (
        "id" serial primary key,
        "staff_id" integer references "staff" ("id"),
        "user_name" text not null default '',
        "action" varchar(80) not null,
        "entity_type" varchar(80),
        "entity_id" integer,
        "metadata" jsonb not null default '{}'::jsonb,
        "ip_address" varchar(80),
        "user_agent" text,
        "created_at" timestamp not null default now()
      )
;

-- Migrated from src/server/api.ts:8533
alter table "admin_activity_logs"
          add column if not exists "user_name" text not null default '',
          add column if not exists "ip_address" varchar(80),
          add column if not exists "user_agent" text
;

-- Migrated from src/server/api.ts:8542
create index if not exists "admin_activity_staff_created_idx" on "admin_activity_logs" ("staff_id", "created_at")
;

-- Migrated from src/server/api.ts:8547
create index if not exists "admin_activity_action_created_idx" on "admin_activity_logs" ("action", "created_at")
;

-- Migrated from src/server/api.ts:8552
create index if not exists "admin_activity_user_created_idx" on "admin_activity_logs" ("user_name", "created_at")
;

-- Migrated from src/server/api.ts:8557
create index if not exists "admin_activity_entity_created_idx" on "admin_activity_logs" ("entity_type", "created_at")
;

-- Migrated from src/server/api.ts:8573
alter table "admin_sessions"
          add column if not exists "session_id" uuid,
          add column if not exists "portal" varchar(24),
          add column if not exists "device_id" text,
          add column if not exists "user_agent" text,
          add column if not exists "ip_address" varchar(80),
          add column if not exists "last_active_at" timestamp,
          add column if not exists "revoked_at" timestamp,
          add column if not exists "revoked_by" integer references "staff" ("id") on delete set null,
          add column if not exists "revoke_reason" text
;

-- Migrated from src/server/api.ts:8591
alter table "admin_sessions" alter column "session_id" set default gen_random_uuid()
;

-- Migrated from src/server/api.ts:8601
create index if not exists "admin_sessions_session_id_idx" on "admin_sessions" ("session_id")
;

-- Migrated from src/server/api.ts:8619
create table if not exists "order_reviews" (
        "id" serial primary key,
        "customer_id" integer references "customers" ("id"),
        "order_kind" varchar(20) not null,
        "order_id" integer not null,
        "rating" integer not null,
        "comment" text,
        "created_at" timestamp not null default now()
      )
;

-- Migrated from src/server/api.ts:8633
create unique index if not exists "order_reviews_kind_order_customer_idx" on "order_reviews" ("order_kind", "order_id", "customer_id")
;

-- Migrated from src/server/api.ts:8638
create index if not exists "order_reviews_order_idx" on "order_reviews" ("order_kind", "order_id")
;

-- Migrated from src/server/api.ts:8650
alter table "customers" add column if not exists "reward_points" integer not null default 0
;

-- Migrated from src/server/api.ts:8654
alter table "customers" add column if not exists "reward_level" varchar(20) not null default 'bronze'
;

-- Migrated from src/server/api.ts:8659
alter table "orders" add column if not exists "reward_points_awarded" integer not null default 0
;

-- Migrated from src/server/api.ts:8664
alter table "orders" add column if not exists "loyalty_points_redeemed" integer not null default 0
;

-- Migrated from src/server/api.ts:8669
alter table "orders" add column if not exists "loyalty_discount_amount" numeric(10,2) not null default 0
;

-- Migrated from src/server/api.ts:8674
alter table "service_orders" add column if not exists "reward_points_awarded" integer not null default 0
;

-- Migrated from src/server/api.ts:8678
create table if not exists "customer_reward_history" (
          "id" serial primary key,
          "customer_id" integer not null references "customers" ("id"),
          "order_id" integer references "orders" ("id"),
          "service_order_id" integer references "service_orders" ("id"),
          "points" integer not null,
          "reason" varchar(120) not null default 'order_reward',
          "note" text,
          "created_at" timestamp not null default now()
        )
;

-- Migrated from src/server/api.ts:8692
create table if not exists "loyalty_points" (
          "id" serial primary key,
          "customer_id" integer not null references "customers" ("id"),
          "order_id" integer references "orders" ("id"),
          "service_order_id" integer references "service_orders" ("id"),
          "points" integer not null,
          "reason" varchar(120) not null default 'order_reward',
          "note" text,
          "created_at" timestamp not null default now()
        )
;

-- Migrated from src/server/api.ts:8707
create index if not exists "customer_reward_history_customer_created_idx" on "customer_reward_history" ("customer_id", "created_at")
;

-- Migrated from src/server/api.ts:8712
create index if not exists "loyalty_points_customer_created_idx" on "loyalty_points" ("customer_id", "created_at")
;

-- Migrated from src/server/api.ts:8717
create index if not exists "customers_reward_points_idx" on "customers" ("reward_points")
;

-- Migrated from src/server/api.ts:8729
alter table products add column if not exists image_metadata jsonb not null default '[]'::jsonb;
      alter table services add column if not exists image_metadata jsonb not null default '{}'::jsonb;
      alter table gallery_items add column if not exists image_metadata jsonb not null default '{}'::jsonb;
      alter table customers add column if not exists avatar_metadata jsonb not null default '{}'::jsonb;
;

-- Migrated from src/server/api.ts:8745
alter table cart_items add column if not exists selected_color_data jsonb;
      alter table order_items add column if not exists selected_color_data jsonb;
      alter table cart_items add column if not exists variant_id integer;
      alter table order_items add column if not exists variant_id integer;
      create index if not exists cart_items_variant_idx on cart_items (variant_id);
      create index if not exists order_items_variant_idx on order_items (variant_id);
;

-- Migrated from src/server/api.ts:8763
create index if not exists "orders_tracking_code_perf_idx" on "orders" ("tracking_code")
;

-- Migrated from src/server/api.ts:8766
create index if not exists "orders_customer_phone_perf_idx" on "orders" ("customer_phone")
;

-- Migrated from src/server/api.ts:8769
create index if not exists "orders_phone_last4_perf_idx" on "orders" ("phone_last4")
;

-- Migrated from src/server/api.ts:8772
create index if not exists "orders_status_archived_perf_idx" on "orders" ("status", "archived_at")
;

-- Migrated from src/server/api.ts:8775
create index if not exists "service_orders_tracking_code_perf_idx" on "service_orders" ("tracking_code")
;

-- Migrated from src/server/api.ts:8778
create index if not exists "service_orders_phone_perf_idx" on "service_orders" ("phone")
;

-- Migrated from src/server/api.ts:8781
create index if not exists "service_orders_phone_last4_perf_idx" on "service_orders" ("phone_last4")
;

-- Migrated from src/server/api.ts:8784
create index if not exists "service_orders_status_archived_perf_idx" on "service_orders" ("status", "archived_at")
;

-- Migrated from src/server/api.ts:8787
create index if not exists "products_category_active_perf_idx" on "products" ("category", "is_active")
;

-- Migrated from src/server/api.ts:8790
create index if not exists "products_active_created_perf_idx" on "products" ("is_active", "created_at")
;

-- Migrated from src/server/api.ts:8793
create index if not exists "staff_username_perf_idx" on "staff" ("username")
;

-- Migrated from src/server/api.ts:8796
create index if not exists "customers_phone_perf_idx" on "customers" ("phone")
;

-- Migrated from src/server/api.ts:8817
alter table "products" add column if not exists "barcode" varchar(100);
      alter table "products" add column if not exists "cost_price" numeric(14,2) not null default 0;
      alter table "products" add column if not exists "min_stock" integer not null default 0;
      alter table "products" add column if not exists "shared_stock_product_id" integer;
      alter table "products" add column if not exists "is_rental" boolean not null default false;
      alter table "products" add column if not exists "price_per_day" numeric(12,2) not null default 0;
      alter table "products" add column if not exists "videos" jsonb not null default '[]'::jsonb;
      alter table "products" add column if not exists "archived_at" timestamp;
      alter table "products" add column if not exists "is_asset" boolean not null default false;
      alter table "products" add column if not exists "subcategory_ids" jsonb not null default '[]'::jsonb;
      do $$
      begin
        alter table "products"
          add constraint "products_shared_stock_product_id_fkey"
          foreign key ("shared_stock_product_id")
          references "products" ("id")
          on delete set null;
      exception
        when duplicate_object then null;
      end $$;
      update "products"
      set "barcode" = 'AJN' || lpad("id"::text, 8, '0')
      where "barcode" is null or "barcode" = '';
      create index if not exists "products_barcode_idx" on "products" ("barcode") where "barcode" is not null;
      create index if not exists "products_stock_min_stock_idx" on "products" ("stock", "min_stock");
      create index if not exists "products_shared_stock_product_id_idx" on "products" ("shared_stock_product_id");
      create index if not exists "products_is_rental_active_idx" on "products" ("is_rental", "is_active");
      create index if not exists "products_archived_at_idx" on "products" ("archived_at");
      create index if not exists "products_is_asset_idx" on "products" ("is_asset");
;

-- Migrated from src/server/api.ts:8869
create table if not exists "rental_orders" (
        "id" serial primary key,
        "order_no" varchar(40) not null unique,
        "product_id" integer not null references "products" ("id") on delete restrict,
        "stock_source_product_id" integer references "products" ("id") on delete set null,
        "customer_id" integer references "customers" ("id") on delete set null,
        "customer_name" text not null default '',
        "phone" varchar(30) not null,
        "phone_last4" varchar(4),
        "start_date" date not null,
        "end_date" date not null,
        "days" integer not null default 1,
        "price_per_day" numeric(12,2) not null default 0,
        "total_amount" numeric(12,2) not null default 0,
        "paid_amount" numeric(12,2) not null default 0,
        "remaining_amount" numeric(12,2) not null default 0,
        "payment_method" varchar(20) not null default 'cash',
        "payment_status" varchar(20) not null default 'paid',
        "status" varchar(20) not null default 'active',
        "notes" text,
        "stock_applied" integer not null default 1,
        "stock_restored_at" timestamp,
        "financial_transaction_id" integer,
        "created_by" integer references "staff" ("id") on delete set null,
        "created_by_name" text not null default '',
        "returned_at" timestamp,
        "cancelled_at" timestamp,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );
      create index if not exists "rental_orders_product_dates_idx" on "rental_orders" ("product_id", "start_date", "end_date", "status");
      create index if not exists "rental_orders_stock_source_dates_idx" on "rental_orders" ("stock_source_product_id", "start_date", "end_date", "status");
      create index if not exists "rental_orders_phone_idx" on "rental_orders" ("phone");
      create index if not exists "rental_orders_customer_idx" on "rental_orders" ("customer_id");
      create index if not exists "rental_orders_status_created_idx" on "rental_orders" ("status", "created_at");
;

-- Migrated from src/server/api.ts:8920
alter table "orders"
        add column if not exists "stock_applied" integer not null default 1,
        add column if not exists "stock_restored_at" timestamp;

      do $$
      begin
        if to_regclass('sales_invoices') is not null then
          alter table "sales_invoices"
            add column if not exists "stock_applied" integer not null default 1,
            add column if not exists "stock_restored_at" timestamp;
        end if;
      end $$;

      create table if not exists "stock_movements" (
        "id" serial primary key,
        "product_id" integer references "products" ("id") on delete set null,
        "stock_source_product_id" integer references "products" ("id") on delete set null,
        "quantity_change" numeric(12,3) not null,
        "reason" varchar(80) not null,
        "related_type" varchar(40),
        "related_id" integer,
        "created_by" integer,
        "created_by_name" text not null default '',
        "created_at" timestamp not null default now()
      );

      alter table "stock_movements"
        add column if not exists "variant_id" integer,
        add column if not exists "sales_invoice_id" integer,
        add column if not exists "sales_invoice_item_id" integer,
        add column if not exists "invoice_number" varchar(40),
        add column if not exists "warehouse_id" integer,
        add column if not exists "movement_type" varchar(60),
        add column if not exists "reversed_movement_id" integer,
        add column if not exists "reversal_reason" text,
        add column if not exists "cancelled_by" integer,
        add column if not exists "cancelled_at" timestamp,
        add column if not exists "idempotency_key" varchar(180),
        add column if not exists "metadata" jsonb not null default '{}'::jsonb;

      update "stock_movements" movement
      set "sales_invoice_id" = movement."related_id",
          "invoice_number" = invoice."invoice_no",
          "movement_type" = case
            when movement."quantity_change"::numeric < 0 then 'sale'
            when movement."reason" = 'sales_invoice_cancellation_return' then 'sales_invoice_cancellation'
            else movement."movement_type"
          end
      from "sales_invoices" invoice
      where movement."related_type" = 'sales_invoice'
        and movement."related_id" = invoice."id"
        and (movement."sales_invoice_id" is null or movement."invoice_number" is null or movement."movement_type" is null);

      create index if not exists "stock_movements_product_id_idx" on "stock_movements" ("product_id");
      create index if not exists "stock_movements_stock_source_product_id_idx" on "stock_movements" ("stock_source_product_id");
      create index if not exists "stock_movements_variant_idx" on "stock_movements" ("variant_id");
      create index if not exists "stock_movements_related_idx" on "stock_movements" ("related_type", "related_id");
      create index if not exists "stock_movements_created_at_idx" on "stock_movements" ("created_at");
      drop index if exists "stock_movements_sales_invoice_cancel_once_idx";
      create index if not exists "stock_movements_sales_invoice_direct_idx" on "stock_movements" ("sales_invoice_id", "sales_invoice_item_id", "movement_type", "created_at" desc);
      create index if not exists "stock_movements_invoice_number_idx" on "stock_movements" ("invoice_number", "product_id", "created_at" desc) where "invoice_number" is not null;
      create unique index if not exists "stock_movements_idempotency_idx" on "stock_movements" ("idempotency_key") where "idempotency_key" is not null;
      create unique index if not exists "stock_movements_reversal_once_idx" on "stock_movements" ("reversed_movement_id") where "reversed_movement_id" is not null and "movement_type" = 'sales_invoice_cancellation';
      create unique index if not exists "stock_movements_invoice_item_cancel_once_idx" on "stock_movements" ("sales_invoice_id", "sales_invoice_item_id") where "sales_invoice_id" is not null and "sales_invoice_item_id" is not null and "movement_type" = 'sales_invoice_cancellation';
      create index if not exists "orders_stock_applied_status_idx" on "orders" ("stock_applied", "status");
      do $$
      begin
        if to_regclass('sales_invoices') is not null then
          create index if not exists "sales_invoices_stock_applied_status_idx" on "sales_invoices" ("stock_applied", "status");
        end if;
      end $$;
;

-- Migrated from src/server/api.ts:9007
create table if not exists "koshas" (
        "id" serial primary key,
        "name" text not null,
        "slug" varchar(160) not null unique,
        "description" text,
        "price" numeric(14,2) not null default 0,
        "old_price" numeric(14,2),
        "discount_percentage" integer not null default 0,
        "main_image" text,
        "number_of_pieces" integer,
        "main_color" varchar(80),
        "flower_color" varchar(80),
        "kosha_space" varchar(120),
        "side_console_space" varchar(120),
        "accessories" jsonb not null default '[]'::jsonb,
        "notes" text,
        "availability_status" varchar(40) not null default 'available',
        "is_featured" boolean not null default false,
        "is_active" boolean not null default true,
        "sort_order" integer not null default 0,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );

      create table if not exists "kosha_images" (
        "id" serial primary key,
        "kosha_id" integer not null references "koshas" ("id") on delete cascade,
        "image_url" text not null,
        "image_metadata" jsonb not null default '{}'::jsonb,
        "sort_order" integer not null default 0,
        "created_at" timestamp not null default now()
      );

      create table if not exists "kosha_packages" (
        "id" serial primary key,
        "name" text not null,
        "slug" varchar(160) not null unique,
        "description" text,
        "price" numeric(14,2) not null default 0,
        "old_price" numeric(14,2),
        "main_image" text,
        "features" jsonb not null default '[]'::jsonb,
        "badge_text" varchar(80),
        "is_featured" boolean not null default false,
        "is_active" boolean not null default true,
        "sort_order" integer not null default 0,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );

      create table if not exists "kosha_bookings" (
        "id" serial primary key,
        "kosha_id" integer references "koshas" ("id") on delete set null,
        "package_id" integer references "kosha_packages" ("id") on delete set null,
        "package_name" text,
        "package_price" numeric(14,2),
        "customer_name" text not null,
        "phone" varchar(20) not null,
        "bride_name" text,
        "groom_name" text,
        "event_date" text,
        "event_time" varchar(20),
        "event_type" varchar(40),
        "service_level" varchar(20),
        "venue_type" varchar(20),
        "theme_color" varchar(20),
        "province" text,
        "area" text,
        "mahalla" text,
        "nearest_point" text,
        "address_notes" text,
        "bride_phone" varchar(20),
        "groom_phone" varchar(20),
        "alternate_phone" varchar(20),
        "city_area" text,
        "hall_location" text,
        "selected_addons" jsonb not null default '[]'::jsonb,
        "welcome_boards" jsonb not null default '[]'::jsonb,
        "selected_accessories" jsonb not null default '[]'::jsonb,
        "venue_images" jsonb not null default '[]'::jsonb,
        "booking_details" jsonb not null default '{}'::jsonb,
        "notes" text,
        "status" varchar(30) not null default 'new',
        "internal_notes" text,
        "execution_stage" varchar(30) not null default 'preparing',
        "assigned_staff_id" integer,
        "archived_at" timestamp,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );

      alter table "kosha_bookings"
        add column if not exists "customer_id" integer references "customers" ("id") on delete set null,
        add column if not exists "bride_name" text,
        add column if not exists "groom_name" text,
        add column if not exists "event_type" varchar(40),
        add column if not exists "service_level" varchar(20),
        add column if not exists "venue_type" varchar(20),
        add column if not exists "theme_color" varchar(20),
        add column if not exists "province" text,
        add column if not exists "area" text,
        add column if not exists "mahalla" text,
        add column if not exists "nearest_point" text,
        add column if not exists "address_notes" text,
        add column if not exists "bride_phone" varchar(20),
        add column if not exists "groom_phone" varchar(20),
        add column if not exists "alternate_phone" varchar(20),
        add column if not exists "selected_addons" jsonb not null default '[]'::jsonb,
        add column if not exists "welcome_boards" jsonb not null default '[]'::jsonb,
        add column if not exists "selected_accessories" jsonb not null default '[]'::jsonb,
        add column if not exists "venue_images" jsonb not null default '[]'::jsonb,
        add column if not exists "booking_details" jsonb not null default '{}'::jsonb,
        add column if not exists "package_id" integer references "kosha_packages" ("id") on delete set null,
        add column if not exists "package_name" text,
        add column if not exists "package_price" numeric(14,2),
        add column if not exists "execution_stage" varchar(30) not null default 'preparing',
        add column if not exists "assigned_staff_id" integer,
        add column if not exists "archived_at" timestamp,
        add column if not exists "tracking_code" varchar(40),
        add column if not exists "tracking_status" varchar(40) not null default 'booked',
        add column if not exists "products_total" numeric(14,2) not null default 0;
      -- Backfill the canonical customer relation for legacy bookings that only
      -- stored a phone number. This is deterministic and leaves unmatched rows
      -- untouched for manual reconciliation.
      update "kosha_bookings" b
      set "customer_id" = c.id
      from "customers" c
      where b."customer_id" is null
        and regexp_replace(coalesce(b."phone", ''), '[^0-9]', '', 'g') <> ''
        and regexp_replace(coalesce(c."phone", ''), '[^0-9]', '', 'g') = regexp_replace(coalesce(b."phone", ''), '[^0-9]', '', 'g');
      update "kosha_bookings" set "tracking_code" = 'AJN-KOSHA-' || lpad("id"::text, 4, '0') where "tracking_code" is null;
      create unique index if not exists "kosha_bookings_tracking_code_idx" on "kosha_bookings" ("tracking_code");

      create table if not exists "kosha_accessories" (
        "id" serial primary key,
        "name" text not null unique,
        "price" numeric(14,2) not null default 0,
        "description" text,
        "main_image" text,
        "is_active" boolean not null default true,
        "sort_order" integer not null default 0,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );

      alter table "kosha_accessories"
        add column if not exists "price" numeric(14,2) not null default 0,
        add column if not exists "description" text,
        add column if not exists "main_image" text;

      -- Additional Services: reference-only Store line items on a kosha booking.
      create table if not exists "kosha_booking_items" (
        "id" serial primary key,
        "kosha_booking_id" integer not null references "kosha_bookings" ("id") on delete cascade,
        "product_id" integer,
        "product_name" text not null default '',
        "product_sku" varchar(120),
        "image_url" text,
        "category" text,
        "quantity" numeric(12,2) not null default 1,
        "unit_price" numeric(14,2) not null default 0,
        "cost_price" numeric(14,2) not null default 0,
        "is_rental" boolean not null default false,
        "rental_days" integer not null default 0,
        "checkout_date" date,
        "return_date" date,
        "returned_at" timestamp,
        "discount" numeric(14,2) not null default 0,
        "tax" numeric(14,2) not null default 0,
        "line_total" numeric(14,2) not null default 0,
        "notes" text,
        "customization" jsonb not null default '{}'::jsonb,
        "reserved_at" timestamp,
        "sort_order" integer not null default 0,
        "created_at" timestamp not null default now()
      );
      create index if not exists "kosha_booking_items_booking_idx" on "kosha_booking_items" ("kosha_booking_id", "sort_order");
      create index if not exists "kosha_booking_items_product_idx" on "kosha_booking_items" ("product_id");

      create table if not exists "kosha_addons" (
        "id" serial primary key,
        "name" text not null unique,
        "price" numeric(14,2) not null default 0,
        "description" text,
        "main_image" text,
        "is_active" boolean not null default true,
        "sort_order" integer not null default 0,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );

      create table if not exists "kosha_welcome_boards" (
        "id" serial primary key,
        "name" text not null unique,
        "price" numeric(14,2) not null default 0,
        "description" text,
        "main_image" text,
        "is_active" boolean not null default true,
        "sort_order" integer not null default 0,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );

      create table if not exists "kosha_provinces" (
        "id" serial primary key,
        "name" text not null unique,
        "is_active" boolean not null default true,
        "sort_order" integer not null default 0,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );

      create table if not exists "kosha_categories" (
        "id" serial primary key,
        "name" text not null unique,
        "slug" varchar(160) not null unique,
        "icon" varchar(60),
        "image" text,
        "is_active" boolean not null default true,
        "sort_order" integer not null default 0,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );
      alter table "koshas" add column if not exists "category_id" integer references "kosha_categories" ("id") on delete set null;
      create index if not exists "koshas_category_idx" on "koshas" ("category_id");
      insert into "kosha_categories" ("name","slug","sort_order") values
        ('حنة','hanna',1),('خطوبة','khotoba',2),('عرس','wedding',3),
        ('عيد ميلاد','birthday',4),('تخرج','graduation',5),('مناسبات أخرى','other',6)
      on conflict ("name") do nothing;

      create table if not exists "kosha_package_components" (
        "id" serial primary key,
        "package_id" integer not null references "kosha_packages" ("id") on delete cascade,
        "component_type" varchar(30) not null,
        "component_id" integer not null,
        "is_default" boolean not null default false,
        "sort_order" integer not null default 0,
        "created_at" timestamp not null default now()
      );

      create index if not exists "koshas_active_sort_idx" on "koshas" ("is_active", "sort_order", "id");
      create index if not exists "koshas_featured_idx" on "koshas" ("is_featured", "is_active");
      create index if not exists "kosha_images_kosha_sort_idx" on "kosha_images" ("kosha_id", "sort_order", "id");
      create index if not exists "kosha_bookings_kosha_idx" on "kosha_bookings" ("kosha_id");
      create index if not exists "kosha_bookings_status_idx" on "kosha_bookings" ("status");
      create index if not exists "kosha_bookings_created_at_idx" on "kosha_bookings" ("created_at");
      create index if not exists "kosha_bookings_event_date_idx" on "kosha_bookings" ("event_date");
      create index if not exists "kosha_bookings_archived_created_idx" on "kosha_bookings" ("archived_at", "created_at");
      create index if not exists "kosha_accessories_active_sort_idx" on "kosha_accessories" ("is_active", "sort_order", "id");
      create index if not exists "kosha_addons_active_sort_idx" on "kosha_addons" ("is_active", "sort_order", "id");
      create index if not exists "kosha_welcome_boards_active_sort_idx" on "kosha_welcome_boards" ("is_active", "sort_order", "id");
      create index if not exists "kosha_provinces_active_sort_idx" on "kosha_provinces" ("is_active", "sort_order", "id");
      create unique index if not exists "kosha_package_components_unique_idx" on "kosha_package_components" ("package_id", "component_type", "component_id");
      create index if not exists "kosha_packages_active_sort_idx" on "kosha_packages" ("is_active", "sort_order", "id");
      create index if not exists "kosha_package_components_package_idx" on "kosha_package_components" ("package_id", "sort_order", "id");
      create index if not exists "kosha_bookings_package_idx" on "kosha_bookings" ("package_id", "created_at");
      create index if not exists "kosha_bookings_customer_id_idx" on "kosha_bookings" ("customer_id");

      insert into "kosha_addons" ("name", "sort_order")
      values
        ('تصوير', 10),
        ('ألبوم', 20),
        ('فيديو مختصر', 30),
        ('دي جي', 40),
        ('إضاءة إضافية', 50),
        ('توصيل وتركيب', 60),
        ('تنسيق بسيط', 70),
        ('تنسيق VIP كامل', 80)
      on conflict ("name") do nothing;

      insert into "kosha_welcome_boards" ("name", "sort_order")
      values
        ('بورد ترحيب كلاسيك', 10),
        ('بورد ترحيب ذهبي', 20),
        ('بورد ورد', 30),
        ('بورد مرآة', 40)
      on conflict ("name") do nothing;

      insert into "kosha_accessories" ("name", "sort_order")
      values
        ('كفرات منع التصوير', 10),
        ('دفوف حنة', 20),
        ('مبخرة', 30),
        ('مهفة', 40),
        ('القرآن الكريم', 50),
        ('شال المهر', 60),
        ('ورد الحنة', 70),
        ('وثيقة', 80),
        ('ستاند حلقات', 90),
        ('قصاصات', 100)
      on conflict ("name") do nothing;

      insert into "kosha_provinces" ("name", "sort_order")
      values
        ('كركوك', 10),
        ('صلاح الدين', 20),
        ('بغداد', 30),
        ('أربيل', 40),
        ('السليمانية', 50),
        ('ديالى', 60),
        ('نينوى', 70)
      on conflict ("name") do nothing;

      insert into "kosha_packages" ("name", "slug", "description", "features", "badge_text", "is_featured", "sort_order")
      values
        ('الباقة الفضية', 'silver-package', 'اختيار متوازن للحفلات الأنيقة بتنسيق أساسي متكامل.', '["كوشة أساسية","بورد ترحيب","ستاند حلقات","تنسيق بسيط"]'::jsonb, null, false, 10),
        ('الباقة الذهبية', 'gold-package', 'باقة فاخرة تجمع أهم تفاصيل ليلة الحنة في اختيار واحد.', '["كوشة فاخرة","بورد ترحيب","ستاند حلقات","دفوف حنة","مبخرة","مهفة"]'::jsonb, 'الأكثر طلباً', true, 20),
        ('باقة VIP', 'vip-package', 'التجربة الملكية الكاملة مع جميع تفاصيل التنسيق والإكسسوارات المميزة.', '["كوشة ملكية","بورد ترحيب فاخر","ستاند حلقات","دفوف حنة","مبخرة","مهفة","شال المهر","وثيقة","قصاصات","تنسيق VIP كامل"]'::jsonb, 'VIP', false, 30)
      on conflict ("slug") do nothing;

      insert into "kosha_package_components" ("package_id", "component_type", "component_id", "is_default", "sort_order")
      select p.id, 'kosha', k.id, true, 0
      from "kosha_packages" p
      cross join lateral (
        select ranked.id
        from (
          select id, row_number() over (order by "sort_order", "id") as position
          from "koshas"
          where "is_active" = true
        ) ranked
        order by case when ranked.position = case p.slug when 'silver-package' then 1 when 'gold-package' then 2 else 3 end then 0 else 1 end, ranked.position
        limit 1
      ) k
      where p.slug in ('silver-package', 'gold-package', 'vip-package')
      on conflict do nothing;

      insert into "kosha_package_components" ("package_id", "component_type", "component_id", "sort_order")
      select p.id, 'welcome_board', b.id, 10
      from "kosha_packages" p
      join "kosha_welcome_boards" b on b.name = case p.slug
        when 'silver-package' then 'بورد ترحيب كلاسيك'
        when 'gold-package' then 'بورد ترحيب ذهبي'
        else 'بورد مرآة'
      end
      where p.slug in ('silver-package', 'gold-package', 'vip-package')
      on conflict do nothing;

      insert into "kosha_package_components" ("package_id", "component_type", "component_id", "sort_order")
      select p.id, 'addon', a.id, 20
      from "kosha_packages" p
      join "kosha_addons" a on a.name = case when p.slug = 'vip-package' then 'تنسيق VIP كامل' else 'تنسيق بسيط' end
      where p.slug in ('silver-package', 'gold-package', 'vip-package')
      on conflict do nothing;

      insert into "kosha_package_components" ("package_id", "component_type", "component_id", "sort_order")
      select p.id, 'accessory', a.id, 30 + a.sort_order
      from "kosha_packages" p
      join "kosha_accessories" a on (
        (p.slug = 'silver-package' and a.name in ('ستاند حلقات')) or
        (p.slug = 'gold-package' and a.name in ('ستاند حلقات', 'دفوف حنة', 'مبخرة', 'مهفة')) or
        (p.slug = 'vip-package' and a.name in ('ستاند حلقات', 'دفوف حنة', 'مبخرة', 'مهفة', 'شال المهر', 'وثيقة', 'قصاصات'))
      )
      where p.slug in ('silver-package', 'gold-package', 'vip-package')
      on conflict do nothing;
;

-- Migrated from src/server/api.ts:9379
alter table "kosha_bookings" add column if not exists "execution_stage" varchar(30) not null default 'preparing';
      alter table "kosha_bookings" add column if not exists "assigned_staff_id" integer;

      create table if not exists "kosha_booking_events" (
        "id" serial primary key,
        "booking_id" integer not null references "kosha_bookings" ("id") on delete cascade,
        "staff_id" integer references "staff" ("id") on delete set null,
        "staff_name" text not null default '',
        "type" varchar(30) not null,
        "from_stage" varchar(30),
        "to_stage" varchar(30),
        "note" text,
        "meta" jsonb not null default '{}'::jsonb,
        "created_at" timestamp not null default now()
      );
      create index if not exists "kosha_booking_events_booking_idx" on "kosha_booking_events" ("booking_id");

      create table if not exists "kosha_media" (
        "id" serial primary key,
        "booking_id" integer not null references "kosha_bookings" ("id") on delete cascade,
        "event_id" integer references "kosha_booking_events" ("id") on delete set null,
        "staff_id" integer references "staff" ("id") on delete set null,
        "url" text not null,
        "kind" varchar(10) not null default 'image',
        "stage" varchar(30),
        "purpose" varchar(20) not null default 'execution',
        "created_at" timestamp not null default now()
      );
      create index if not exists "kosha_media_booking_idx" on "kosha_media" ("booking_id");

      create table if not exists "kosha_delivery_reports" (
        "id" serial primary key,
        "booking_id" integer not null references "kosha_bookings" ("id") on delete cascade,
        "staff_id" integer references "staff" ("id") on delete set null,
        "staff_name" text not null default '',
        "has_loss" boolean not null default false,
        "has_breakage" boolean not null default false,
        "note" text,
        "compensation_amount" numeric(14,2) not null default 0,
        "signature_url" text,
        "created_at" timestamp not null default now()
      );
      create index if not exists "kosha_delivery_reports_booking_idx" on "kosha_delivery_reports" ("booking_id");

      create table if not exists "kosha_payment_requests" (
        "id" serial primary key,
        "booking_id" integer not null references "kosha_bookings" ("id") on delete cascade,
        "staff_id" integer references "staff" ("id") on delete set null,
        "staff_name" text not null default '',
        "amount" numeric(14,2) not null default 0,
        "note" text,
        "status" varchar(12) not null default 'pending',
        "reviewed_by_staff_id" integer references "staff" ("id") on delete set null,
        "reviewed_by_name" text,
        "reviewed_at" timestamp,
        "financial_transaction_id" integer,
        "created_at" timestamp not null default now()
      );
      alter table "kosha_payment_requests"
        add column if not exists "financial_transaction_id" integer;
      create index if not exists "kosha_payment_requests_status_idx" on "kosha_payment_requests" ("status");
      create index if not exists "kosha_payment_requests_financial_idx" on "kosha_payment_requests" ("financial_transaction_id");

      create table if not exists "kosha_staff_notifications" (
        "id" serial primary key,
        "staff_id" integer references "staff" ("id") on delete cascade,
        "audience" varchar(12) not null default 'staff',
        "type" varchar(30) not null,
        "title" text not null,
        "body" text,
        "href" text,
        "booking_id" integer references "kosha_bookings" ("id") on delete cascade,
        "is_read" boolean not null default false,
        "created_at" timestamp not null default now()
      );
      create index if not exists "kosha_staff_notifications_staff_idx" on "kosha_staff_notifications" ("staff_id");
;

-- Migrated from src/server/api.ts:9471
create table if not exists "photography_events" (
        "id" serial primary key,
        "client_token" varchar(64) not null unique,
        "groom_name" text not null,
        "event_name" text,
        "event_date" date not null,
        "location" text,
        "assigned_staff_id" integer references "staff" ("id") on delete set null,
        "assigned_staff_name" text not null default '',
        "status" varchar(20) not null default 'active',
        "created_by" integer references "staff" ("id") on delete set null,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );
      create table if not exists "photography_orders" (
        "id" serial primary key,
        "client_token" varchar(64) not null unique,
        "order_no" varchar(40) not null unique,
        "event_id" integer not null references "photography_events" ("id") on delete restrict,
        "assigned_staff_id" integer references "staff" ("id") on delete set null,
        "customer_name" text not null,
        "phone" varchar(20) not null,
        "copies" integer not null default 1,
        "print_type" varchar(30) not null default '10x15',
        "total_amount" numeric(14,2) not null default 0,
        "paid_amount" numeric(14,2) not null default 0,
        "remaining_amount" numeric(14,2) not null default 0,
        "payment_status" varchar(20) not null default 'unpaid',
        "photo_number" varchar(120),
        "notes" text,
        "reference_image" text,
        "status" varchar(30) not null default 'registered',
        "created_by" integer references "staff" ("id") on delete set null,
        "delivered_at" timestamp,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );
      create table if not exists "photography_order_events" (
        "id" serial primary key,
        "order_id" integer not null references "photography_orders" ("id") on delete cascade,
        "staff_id" integer references "staff" ("id") on delete set null,
        "staff_name" text not null default '',
        "type" varchar(40) not null,
        "from_status" varchar(30),
        "to_status" varchar(30),
        "note" text,
        "created_at" timestamp not null default now()
      );
      alter table "photography_orders" add column if not exists "client_token" varchar(64);
      update "photography_orders" set "client_token" = md5(random()::text || clock_timestamp()::text || "id"::text) where "client_token" is null;
      alter table "photography_orders" alter column "client_token" set not null;
      create unique index if not exists "photography_orders_client_token_idx" on "photography_orders" ("client_token");
      alter table "photography_orders" add column if not exists "unit_price" numeric(14,2) not null default 0;
      alter table "photography_orders" add column if not exists "cancelled_at" timestamp;
      alter table "photography_orders" add column if not exists "cancelled_by" integer references "staff" ("id") on delete set null;
      create table if not exists "photography_payment_requests" (
        "id" serial primary key,
        "order_id" integer not null references "photography_orders" ("id") on delete cascade,
        "staff_id" integer references "staff" ("id") on delete set null,
        "staff_name" text not null default '',
        "amount" numeric(14,2) not null,
        "note" text,
        "status" varchar(20) not null default 'pending',
        "financial_transaction_id" integer,
        "reviewed_by_staff_id" integer references "staff" ("id") on delete set null,
        "reviewed_by_name" text,
        "reviewed_at" timestamp,
        "created_at" timestamp not null default now()
      );
      create index if not exists "photography_events_staff_date_idx" on "photography_events" ("assigned_staff_id", "event_date", "id");
      create index if not exists "photography_orders_event_idx" on "photography_orders" ("event_id", "created_at");
      create index if not exists "photography_orders_staff_status_idx" on "photography_orders" ("assigned_staff_id", "status", "created_at");
      create index if not exists "photography_orders_phone_idx" on "photography_orders" ("phone");
      create index if not exists "photography_order_events_order_idx" on "photography_order_events" ("order_id", "created_at");
      create index if not exists "photography_payment_requests_status_idx" on "photography_payment_requests" ("status", "created_at");
      create unique index if not exists "photography_payment_requests_financial_idx" on "photography_payment_requests" ("financial_transaction_id") where "financial_transaction_id" is not null;
      update "staff" set "permissions" = '["photography"]'::jsonb where "role" = 'photographer';
      update "staff" set "permissions" = coalesce("permissions", '[]'::jsonb) || '["photography"]'::jsonb
      where "role" = 'manager' and not (coalesce("permissions", '[]'::jsonb) ? 'photography');
;

-- Migrated from src/server/api.ts:9571
create table if not exists "photography_shoots" (
        "id" serial primary key,
        "event_id" integer not null unique references "photography_events" ("id") on delete cascade,
        "stage" varchar(30) not null default 'awaiting_assignment',
        "venue" text,
        "gps_lat" numeric(10,7),
        "gps_lng" numeric(10,7),
        "event_time" varchar(10),
        "checklist" jsonb not null default '{}'::jsonb,
        "checklist_completed_at" timestamp,
        "checklist_completed_by" integer references "staff" ("id") on delete set null,
        "departed_at" timestamp,
        "arrived_at" timestamp,
        "arrived_lat" numeric(10,7),
        "arrived_lng" numeric(10,7),
        "shooting_started_at" timestamp,
        "shooting_ended_at" timestamp,
        "delivered_at" timestamp,
        "completed_at" timestamp,
        "notes" text,
        "cancelled_at" timestamp,
        "created_by" integer references "staff" ("id") on delete set null,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );
      create table if not exists "photography_shoot_events" (
        "id" serial primary key,
        "shoot_id" integer not null references "photography_shoots" ("id") on delete cascade,
        "staff_id" integer references "staff" ("id") on delete set null,
        "staff_name" text not null default '',
        "type" varchar(40) not null,
        "from_stage" varchar(30),
        "to_stage" varchar(30),
        "note" text,
        "lat" numeric(10,7),
        "lng" numeric(10,7),
        "created_at" timestamp not null default now()
      );
      create table if not exists "photography_shoot_crew" (
        "id" serial primary key,
        "shoot_id" integer not null references "photography_shoots" ("id") on delete cascade,
        "staff_id" integer not null references "staff" ("id") on delete cascade,
        "staff_name" text not null default '',
        "role" varchar(30) not null default 'photographer',
        "is_lead" boolean not null default false,
        "created_at" timestamp not null default now(),
        constraint "photography_shoot_crew_unique" unique ("shoot_id", "staff_id")
      );
      create index if not exists "photography_shoots_stage_idx" on "photography_shoots" ("stage", "updated_at");
      create index if not exists "photography_shoot_events_shoot_idx" on "photography_shoot_events" ("shoot_id", "created_at");
;

-- Migrated from src/server/api.ts:9642
create table if not exists "photography_edit_projects" (
        "id" serial primary key,
        "shoot_id" integer not null unique references "photography_shoots" ("id") on delete cascade,
        "status" varchar(30) not null default 'waiting',
        "editor_staff_id" integer references "staff" ("id") on delete set null,
        "editor_name" text,
        "due_date" varchar(10),
        "notes" text,
        "assigned_at" timestamp,
        "started_at" timestamp,
        "ready_at" timestamp,
        "delivered_at" timestamp,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );
      create table if not exists "photography_edit_events" (
        "id" serial primary key,
        "project_id" integer not null references "photography_edit_projects" ("id") on delete cascade,
        "staff_id" integer references "staff" ("id") on delete set null,
        "staff_name" text not null default '',
        "type" varchar(40) not null,
        "from_status" varchar(30),
        "to_status" varchar(30),
        "note" text,
        "created_at" timestamp not null default now()
      );
      create table if not exists "photography_memory_cards" (
        "id" serial primary key,
        "label" text not null,
        "capacity_gb" integer not null default 0,
        "serial_number" varchar(120),
        "product_id" integer references "products" ("id") on delete set null,
        "status" varchar(20) not null default 'available',
        "notes" text,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );
      create table if not exists "photography_card_assignments" (
        "id" serial primary key,
        "card_id" integer not null references "photography_memory_cards" ("id") on delete cascade,
        "shoot_id" integer not null references "photography_shoots" ("id") on delete cascade,
        "photographer_staff_id" integer references "staff" ("id") on delete set null,
        "photographer_name" text not null default '',
        "camera_product_id" integer references "products" ("id") on delete set null,
        "camera_name" text,
        "status" varchar(20) not null default 'assigned',
        "files_copied" integer not null default 0,
        "copied_at" timestamp,
        "delivered_at" timestamp,
        "returned_at" timestamp,
        "note" text,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now(),
        constraint "photography_card_assignments_unique" unique ("card_id", "shoot_id")
      );
      create table if not exists "photography_media_batches" (
        "id" serial primary key,
        "shoot_id" integer not null references "photography_shoots" ("id") on delete cascade,
        "kind" varchar(20) not null,
        "file_count" integer not null default 0,
        "total_bytes" bigint not null default 0,
        "card_id" integer references "photography_memory_cards" ("id") on delete set null,
        "external_url" text,
        "note" text,
        "recorded_by" integer references "staff" ("id") on delete set null,
        "recorded_by_name" text not null default '',
        "created_at" timestamp not null default now()
      );
      create index if not exists "photography_edit_projects_status_idx" on "photography_edit_projects" ("status", "updated_at");
      create index if not exists "photography_edit_projects_editor_idx" on "photography_edit_projects" ("editor_staff_id", "status");
      create index if not exists "photography_edit_events_project_idx" on "photography_edit_events" ("project_id", "created_at");
      create index if not exists "photography_memory_cards_status_idx" on "photography_memory_cards" ("status", "label");
      create index if not exists "photography_card_assignments_shoot_idx" on "photography_card_assignments" ("shoot_id", "status");
      create index if not exists "photography_media_batches_shoot_idx" on "photography_media_batches" ("shoot_id", "kind");
;

-- Migrated from src/server/api.ts:9737
create table if not exists "kosha_stage_events" (
        "id" serial primary key,
        "booking_id" integer not null,
        "booking_source" varchar(20) not null default 'kosha',
        "from_stage" varchar(30),
        "to_stage" varchar(30) not null,
        "staff_id" integer references "staff" ("id") on delete set null,
        "staff_name" text not null default '',
        "note" text,
        "photo_url" text,
        "lat" numeric(10,7),
        "lng" numeric(10,7),
        "created_at" timestamp not null default now()
      );
      create table if not exists "kosha_checklist_entries" (
        "id" serial primary key,
        "booking_id" integer not null,
        "booking_source" varchar(20) not null default 'kosha',
        "item" varchar(30) not null,
        "condition" varchar(30) not null default 'available',
        "product_id" integer references "products" ("id") on delete set null,
        "quantity" integer not null default 1,
        "note" text,
        "checked_by" integer references "staff" ("id") on delete set null,
        "checked_by_name" text not null default '',
        "updated_at" timestamp not null default now(),
        "created_at" timestamp not null default now(),
        constraint "kosha_checklist_unique" unique ("booking_id", "booking_source", "item")
      );
      create table if not exists "kosha_damage_reports" (
        "id" serial primary key,
        "booking_id" integer not null,
        "booking_source" varchar(20) not null default 'kosha',
        "product_id" integer references "products" ("id") on delete set null,
        "description" text not null,
        "priority" varchar(20) not null default 'medium',
        "cost_estimate" numeric(14,2) not null default 0,
        "photo_url" text,
        "responsible_staff_id" integer references "staff" ("id") on delete set null,
        "reported_by" integer references "staff" ("id") on delete set null,
        "reported_by_name" text not null default '',
        "status" varchar(20) not null default 'open',
        "approved_by" integer references "staff" ("id") on delete set null,
        "approved_at" timestamp,
        "created_at" timestamp not null default now()
      );
      create table if not exists "kosha_item_scans" (
        "id" serial primary key,
        "booking_id" integer not null,
        "booking_source" varchar(20) not null default 'kosha',
        "product_id" integer not null references "products" ("id") on delete cascade,
        "scan_point" varchar(30) not null,
        "staff_id" integer references "staff" ("id") on delete set null,
        "staff_name" text not null default '',
        "note" text,
        "created_at" timestamp not null default now()
      );
      create index if not exists "kosha_stage_events_booking_idx" on "kosha_stage_events" ("booking_id", "booking_source", "created_at");
      create index if not exists "kosha_checklist_booking_idx" on "kosha_checklist_entries" ("booking_id", "booking_source");
      create index if not exists "kosha_damage_booking_idx" on "kosha_damage_reports" ("booking_id", "booking_source", "status");
      create index if not exists "kosha_item_scans_booking_idx" on "kosha_item_scans" ("booking_id", "booking_source", "scan_point");
      create index if not exists "kosha_item_scans_product_idx" on "kosha_item_scans" ("product_id", "created_at");
;

-- Migrated from src/server/api.ts:9816
create table if not exists "photography_galleries" (
        "id" serial primary key,
        "shoot_id" integer not null unique references "photography_shoots" ("id") on delete cascade,
        "slug" varchar(32) not null unique,
        "title" text not null default '',
        "password_hash" text,
        "password_salt" text,
        "expires_at" timestamp,
        "is_active" boolean not null default true,
        "view_count" integer not null default 0,
        "download_count" integer not null default 0,
        "last_viewed_at" timestamp,
        "notes" text,
        "created_by" integer references "staff" ("id") on delete set null,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );
      create table if not exists "photography_gallery_items" (
        "id" serial primary key,
        "gallery_id" integer not null references "photography_galleries" ("id") on delete cascade,
        "title" text,
        "preview_image" text,
        "download_url" text,
        "kind" varchar(20) not null default 'photo',
        "sort_order" integer not null default 0,
        "favorite_count" integer not null default 0,
        "download_count" integer not null default 0,
        "created_at" timestamp not null default now()
      );
      create table if not exists "photography_gallery_events" (
        "id" serial primary key,
        "gallery_id" integer not null references "photography_galleries" ("id") on delete cascade,
        "item_id" integer references "photography_gallery_items" ("id") on delete cascade,
        "type" varchar(20) not null,
        "visitor_token" varchar(64),
        "created_at" timestamp not null default now()
      );
      create index if not exists "photography_galleries_active_idx" on "photography_galleries" ("is_active", "expires_at");
      create index if not exists "photography_gallery_items_gallery_idx" on "photography_gallery_items" ("gallery_id", "sort_order");
      create index if not exists "photography_gallery_events_gallery_idx" on "photography_gallery_events" ("gallery_id", "type", "created_at");
;

-- Migrated from src/server/api.ts:9872
alter table "categories" add column if not exists "image_url" text;
      alter table "categories" add column if not exists "image_metadata" jsonb not null default '{}'::jsonb;
      alter table "categories" add column if not exists "updated_at" timestamp not null default now();
      alter table "products" add column if not exists "category_id" integer references "categories" ("id");
      alter table "products" add column if not exists "subcategory_id" integer references "categories" ("id");
      alter table "products" add column if not exists "available_in_bouquet_designer" boolean not null default false;
      alter table "products" add column if not exists "show_in_bouquet_builder" boolean not null default false;
      alter table "products" add column if not exists "bouquet_element_type" varchar(24);
      alter table "products" add column if not exists "preview_cutout_url" text;
      alter table "products" add column if not exists "ready_made_preview_url" text;
      alter table "products" add column if not exists "preview_asset_url" text;
      alter table "products" add column if not exists "preview_color" varchar(32);
      alter table "products" add column if not exists "preview_scale" numeric(6,3);
      alter table "products" add column if not exists "preview_rotation" numeric(7,2);
      alter table "products" add column if not exists "preview_layer" integer;
      alter table "products" add column if not exists "bouquet_recipe" jsonb not null default '[]'::jsonb;
      alter table "products" add column if not exists "is_ready_made_bouquet" boolean not null default false;
      alter table "products" add column if not exists "is_bouquet_template" boolean not null default false;
      update "products" set "show_in_bouquet_builder" = "available_in_bouquet_designer" where "available_in_bouquet_designer" = true and "show_in_bouquet_builder" = false;
      update "products" set "preview_cutout_url" = "preview_asset_url" where "preview_cutout_url" is null and "preview_asset_url" is not null;
      update "products" p
      set "category_id" = c."id"
      from "categories" c
      where p."category_id" is null
        and p."category" is not null
        and p."category" = c."slug"
        and c."parent_id" is null;
      update "products" p
      set "subcategory_id" = c."id"
      from "categories" c
      where p."subcategory_id" is null
        and p."subcategory" is not null
        and p."subcategory" = c."slug"
        and c."parent_id" is not null;
      create index if not exists "categories_parent_active_sort_idx" on "categories" ("parent_id", "is_active", "sort_order");
      create index if not exists "products_category_id_active_idx" on "products" ("category_id", "is_active");
      create index if not exists "products_subcategory_id_active_idx" on "products" ("subcategory_id", "is_active");
      create index if not exists "products_bouquet_designer_active_idx" on "products" ("available_in_bouquet_designer", "is_active");
      create index if not exists "products_bouquet_preview_type_idx" on "products" ("available_in_bouquet_designer", "bouquet_element_type", "is_active");
;

-- Migrated from src/server/api.ts:9927
create table if not exists "coupons" (
        "id" serial primary key,
        "code" varchar(60) not null unique,
        "title" text not null default '',
        "type" varchar(20) not null default 'fixed',
        "value" numeric(14,2) not null default 0,
        "min_order_amount" numeric(14,2) not null default 0,
        "usage_limit" integer,
        "used_count" integer not null default 0,
        "expires_at" timestamp,
        "is_active" boolean not null default true,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );
      create table if not exists "coupon_usages" (
        "id" serial primary key,
        "coupon_id" integer not null references "coupons" ("id"),
        "customer_phone" varchar(30),
        "order_id" integer references "orders" ("id"),
        "sales_invoice_id" integer references "sales_invoices" ("id"),
        "discount_amount" numeric(14,2) not null default 0,
        "created_at" timestamp not null default now()
      );
      alter table "orders"
        add column if not exists "coupon_code" varchar(60),
        add column if not exists "coupon_discount_amount" numeric(10,2) not null default 0;
      alter table "sales_invoices"
        add column if not exists "coupon_code" varchar(60),
        add column if not exists "coupon_discount_amount" numeric(14,2) not null default 0;
      create index if not exists "coupons_code_idx" on "coupons" ("code");
      create index if not exists "coupon_usages_coupon_created_idx" on "coupon_usages" ("coupon_id", "created_at");
;

-- Migrated from src/server/api.ts:9974
create table if not exists "report_templates" (
        "id" serial primary key,
        "name" text not null,
        "category" varchar(30) not null default 'custom',
        "paper_kind" varchar(30) not null default 'A4',
        "repx_xml" text not null,
        "model" jsonb not null default '{}'::jsonb,
        "mapping" jsonb not null default '{}'::jsonb,
        "warnings" jsonb not null default '[]'::jsonb,
        "version" integer not null default 1,
        "history" jsonb not null default '[]'::jsonb,
        "is_default" integer not null default 0,
        "file_name" text,
        "created_by" integer references "staff" ("id"),
        "created_by_name" text not null default '',
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );
      create index if not exists "report_templates_category_idx" on "report_templates" ("category", "updated_at");
;

-- Migrated from src/server/api.ts:10256
alter table "orders" add column if not exists "qr_token" varchar(80);
      alter table "service_orders" add column if not exists "qr_token" varchar(80);
      alter table "sales_invoices" add column if not exists "qr_token" varchar(80);

      create table if not exists "tasks" (
        "id" serial primary key,
        "title" text not null,
        "description" text,
        "status" varchar(30) not null default 'new',
        "priority" varchar(20) not null default 'medium',
        "due_at" timestamp,
        "assigned_staff_ids" jsonb not null default '[]'::jsonb,
        "related_type" varchar(30),
        "related_id" integer,
        "notes" text,
        "attachments" jsonb not null default '[]'::jsonb,
        "created_by" integer references "staff" ("id"),
        "archived_at" timestamp,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );
      create table if not exists "task_comments" (
        "id" serial primary key,
        "task_id" integer not null references "tasks" ("id"),
        "staff_id" integer references "staff" ("id"),
        "body" text not null,
        "created_at" timestamp not null default now()
      );
      create table if not exists "task_attachments" (
        "id" serial primary key,
        "task_id" integer not null references "tasks" ("id"),
        "file_url" text not null,
        "file_name" text,
        "created_at" timestamp not null default now()
      );
      alter table "tasks" add column if not exists "task_no" varchar(50);
      alter table "tasks" add column if not exists "department" varchar(100);
      alter table "tasks" add column if not exists "task_type" varchar(50);
      alter table "tasks" add column if not exists "start_at" timestamp;
      alter table "tasks" add column if not exists "estimated_minutes" integer;
      alter table "tasks" add column if not exists "submitted_at" timestamp;
      alter table "tasks" add column if not exists "completed_at" timestamp;
      alter table "tasks" add column if not exists "approved_by" integer references "staff" ("id");
      alter table "tasks" add column if not exists "approved_at" timestamp;
      alter table "tasks" add column if not exists "rejection_reason" text;
      create unique index if not exists "tasks_task_no_unique" on "tasks" ("task_no") where "task_no" is not null;
      create table if not exists "task_checklist_items" (
        "id" serial primary key,
        "task_id" integer not null references "tasks" ("id"),
        "title" text not null,
        "required_quantity" numeric(14,2) not null default 1,
        "completed_quantity" numeric(14,2) not null default 0,
        "sort_order" integer not null default 0,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );
      create index if not exists "task_checklist_items_task_id_idx" on "task_checklist_items" ("task_id", "sort_order");
      create table if not exists "task_item_attachments" (
        "id" serial primary key,
        "task_item_id" integer not null references "task_checklist_items" ("id"),
        "staff_id" integer references "staff" ("id"),
        "file_url" text not null,
        "file_name" text,
        "media_type" varchar(40) not null default 'file',
        "created_at" timestamp not null default now()
      );
      create index if not exists "task_item_attachments_item_id_idx" on "task_item_attachments" ("task_item_id");
      create table if not exists "message_threads" (
        "id" serial primary key,
        "customer_id" integer references "customers" ("id"),
        "phone" varchar(30),
        "customer_name" text not null default '',
        "subject" text not null default 'رسالة زبون',
        "status" varchar(20) not null default 'new',
        "related_type" varchar(30),
        "related_id" integer,
        "last_message_at" timestamp not null default now(),
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );
      create table if not exists "message_replies" (
        "id" serial primary key,
        "thread_id" integer not null references "message_threads" ("id"),
        "sender_type" varchar(20) not null default 'customer',
        "staff_id" integer references "staff" ("id"),
        "body" text not null,
        "created_at" timestamp not null default now()
      );
      create table if not exists "customer_activity_logs" (
        "id" serial primary key,
        "customer_id" integer references "customers" ("id"),
        "session_id" varchar(80),
        "phone" varchar(30),
        "action" varchar(60) not null,
        "entity_type" varchar(40),
        "entity_id" integer,
        "entity_label" text,
        "metadata" jsonb not null default '{}'::jsonb,
        "ip_address" varchar(80),
        "user_agent" text,
        "created_at" timestamp not null default now()
      );
      create table if not exists "customer_notes" (
        "id" serial primary key,
        "customer_id" integer not null references "customers" ("id"),
        "staff_id" integer references "staff" ("id"),
        "body" text not null,
        "priority" varchar(20) not null default 'normal',
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );
      create table if not exists "attendance_records" (
        "id" serial primary key,
        "staff_id" integer not null references "staff" ("id"),
        "check_in_at" timestamp not null default now(),
        "check_out_at" timestamp,
        "status" varchar(20) not null default 'present',
        "notes" text,
        "edited_by" integer references "staff" ("id"),
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );
      create table if not exists "qr_tokens" (
        "id" serial primary key,
        "entity_type" varchar(30) not null,
        "entity_id" integer not null,
        "token" varchar(80) not null unique,
        "target_url" text not null,
        "scan_count" integer not null default 0,
        "created_at" timestamp not null default now(),
        "last_scanned_at" timestamp
      );
      create table if not exists "notifications" (
        "id" serial primary key,
        "audience_type" varchar(20) not null default 'admin',
        "staff_id" integer references "staff" ("id"),
        "customer_id" integer references "customers" ("id"),
        "type" varchar(60) not null default 'general',
        "title" text not null,
        "body" text not null default '',
        "entity_type" varchar(40),
        "entity_id" integer,
        "href" text,
        "metadata" jsonb not null default '{}'::jsonb,
        "read_at" timestamp,
        "archived_at" timestamp,
        "created_at" timestamp not null default now()
      );
      create table if not exists "notification_subscriptions" (
        "id" serial primary key,
        "owner_type" varchar(20) not null default 'staff',
        "staff_id" integer references "staff" ("id"),
        "customer_id" integer references "customers" ("id"),
        "endpoint" text not null unique,
        "p256dh" text not null,
        "auth" text not null,
        "user_agent" text,
        "is_active" integer not null default 1,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );
      create table if not exists "notification_settings" (
        "id" serial primary key,
        "owner_type" varchar(20) not null default 'global',
        "owner_id" integer,
        "push_enabled" integer not null default 1,
        "orders_enabled" integer not null default 1,
        "messages_enabled" integer not null default 1,
        "tasks_enabled" integer not null default 1,
        "inventory_enabled" integer not null default 1,
        "customer_enabled" integer not null default 1,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );
      alter table "tasks"
        add column if not exists "template_key" varchar(80),
        add column if not exists "sequence" integer not null default 0,
        add column if not exists "auto_generated" integer not null default 0;
      create table if not exists "approval_requests" (
        "id" serial primary key,
        "request_no" varchar(50) not null unique,
        "type" varchar(60) not null,
        "title" text not null,
        "description" text,
        "entity_type" varchar(60),
        "entity_id" integer,
        "amount" text,
        "old_values" jsonb not null default '{}'::jsonb,
        "new_values" jsonb not null default '{}'::jsonb,
        "status" varchar(20) not null default 'pending',
        "requested_by" integer references "staff" ("id"),
        "requested_by_name" text not null default '',
        "reviewed_by" integer references "staff" ("id"),
        "reviewed_by_name" text not null default '',
        "review_note" text,
        "reviewed_at" timestamp,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );
      create table if not exists "employee_approval_permissions" (
        "id" serial primary key,
        "staff_id" integer not null unique references "staff" ("id") on delete cascade,
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
        "granted_by" integer references "staff" ("id"),
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );
      create table if not exists "approval_actions" (
        "id" serial primary key,
        "approval_request_id" integer not null references "approval_requests" ("id") on delete cascade,
        "action" varchar(40) not null,
        "old_status" varchar(30),
        "new_status" varchar(30),
        "actor_staff_id" integer references "staff" ("id"),
        "actor_name" text not null default '',
        "actor_role" varchar(30),
        "note" text,
        "amount" numeric(16,2),
        "ip_address" varchar(120),
        "session_id" varchar(120),
        "metadata" jsonb not null default '{}'::jsonb,
        "created_at" timestamp not null default now()
      );
      create table if not exists "entity_documents" (
        "id" serial primary key,
        "entity_type" varchar(60) not null,
        "entity_id" integer not null,
        "document_type" varchar(40) not null default 'file',
        "title" text not null,
        "file_url" text not null,
        "file_name" text,
        "mime_type" varchar(120),
        "metadata" jsonb not null default '{}'::jsonb,
        "uploaded_by" integer references "staff" ("id"),
        "uploaded_by_name" text not null default '',
        "archived_at" timestamp,
        "created_at" timestamp not null default now()
      );
      create table if not exists "entity_timeline" (
        "id" serial primary key,
        "entity_type" varchar(60) not null,
        "entity_id" integer not null,
        "type" varchar(60) not null,
        "title" text not null,
        "body" text,
        "actor_id" integer references "staff" ("id"),
        "actor_name" text not null default '',
        "metadata" jsonb not null default '{}'::jsonb,
        "created_at" timestamp not null default now()
      );
      create table if not exists "warehouses" (
        "id" serial primary key,
        "name" text not null,
        "is_active" integer not null default 1,
        "created_at" timestamp not null default now()
      );
      insert into "warehouses" ("name")
      select 'المخزن الرئيسي'
      where not exists (select 1 from "warehouses");
      create table if not exists "warehouse_stock" (
        "id" serial primary key,
        "warehouse_id" integer not null references "warehouses" ("id"),
        "product_id" integer not null,
        "quantity" numeric(12,3) not null default 0,
        "updated_at" timestamp not null default now(),
        "created_at" timestamp not null default now()
      );
      create table if not exists "warehouse_transfers" (
        "id" serial primary key,
        "transfer_no" varchar(50) not null unique,
        "product_id" integer,
        "product_name" text not null default '',
        "from_warehouse_id" integer references "warehouses" ("id"),
        "to_warehouse_id" integer references "warehouses" ("id"),
        "quantity" integer not null default 1,
        "status" varchar(20) not null default 'pending',
        "requested_by" integer references "staff" ("id"),
        "requested_by_name" text not null default '',
        "reviewed_by" integer references "staff" ("id"),
        "reviewed_by_name" text not null default '',
        "notes" text,
        "reviewed_at" timestamp,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );
      create table if not exists "asset_profiles" (
        "id" serial primary key,
        "product_id" integer not null unique,
        "purchase_price" text not null default '0',
        "purchase_date" timestamp,
        "expected_life_uses" integer not null default 50,
        "usage_count" integer not null default 0,
        "maintenance_every_uses" integer not null default 50,
        "current_value" text not null default '0',
        "status" varchar(30) not null default 'active',
        "notes" text,
        "updated_at" timestamp not null default now(),
        "created_at" timestamp not null default now()
      );
      alter table "asset_profiles" add column if not exists "serial_number" varchar(120);
      alter table "asset_profiles" add column if not exists "deleted_at" timestamp, add column if not exists "deleted_by" integer references "staff"("id") on delete set null, add column if not exists "deleted_reason" text, add column if not exists "value_before_removal" text;
      create table if not exists "disaster_recovery_snapshots" (
        "id" serial primary key,
        "snapshot_no" varchar(50) not null unique,
        "type" varchar(30) not null default 'manual',
        "status" varchar(20) not null default 'created',
        "file_url" text,
        "summary" jsonb not null default '{}'::jsonb,
        "created_by" integer references "staff" ("id"),
        "created_by_name" text not null default '',
        "created_at" timestamp not null default now()
      );
      create index if not exists "tasks_assigned_staff_ids_gin_idx" on "tasks" using gin ("assigned_staff_ids");
      create index if not exists "tasks_status_due_idx" on "tasks" ("status", "due_at");
      create index if not exists "tasks_related_template_idx" on "tasks" ("related_type", "related_id", "template_key");
      create index if not exists "approval_requests_status_idx" on "approval_requests" ("status", "created_at");
      create index if not exists "approval_requests_entity_idx" on "approval_requests" ("entity_type", "entity_id");
      create index if not exists "employee_approval_permissions_active_staff_idx" on "employee_approval_permissions" ("is_active", "staff_id");
      create index if not exists "approval_actions_request_created_idx" on "approval_actions" ("approval_request_id", "created_at");
      create index if not exists "approval_actions_actor_created_idx" on "approval_actions" ("actor_staff_id", "created_at");
      create index if not exists "entity_documents_entity_idx" on "entity_documents" ("entity_type", "entity_id", "created_at");
      create index if not exists "entity_timeline_entity_idx" on "entity_timeline" ("entity_type", "entity_id", "created_at");
      create unique index if not exists "warehouse_stock_product_warehouse_idx" on "warehouse_stock" ("product_id", "warehouse_id");
      create index if not exists "warehouse_stock_warehouse_idx" on "warehouse_stock" ("warehouse_id");
      create index if not exists "warehouse_stock_product_idx" on "warehouse_stock" ("product_id");
      create index if not exists "warehouse_transfers_status_idx" on "warehouse_transfers" ("status", "created_at");
      create index if not exists "asset_profiles_status_idx" on "asset_profiles" ("status", "updated_at");
      create index if not exists "disaster_recovery_snapshots_created_idx" on "disaster_recovery_snapshots" ("created_at");
      create index if not exists "message_threads_status_idx" on "message_threads" ("status", "last_message_at");
      create index if not exists "message_replies_thread_idx" on "message_replies" ("thread_id", "created_at");
      create index if not exists "customer_activity_created_idx" on "customer_activity_logs" ("created_at");
      create index if not exists "customer_activity_customer_idx" on "customer_activity_logs" ("customer_id", "created_at");
      create index if not exists "customer_notes_customer_created_idx" on "customer_notes" ("customer_id", "created_at");
      create index if not exists "attendance_staff_day_idx" on "attendance_records" ("staff_id", "check_in_at");
      create unique index if not exists "qr_tokens_entity_unique_idx" on "qr_tokens" ("entity_type", "entity_id");
      create index if not exists "orders_qr_token_idx" on "orders" ("qr_token");
      create index if not exists "service_orders_qr_token_idx" on "service_orders" ("qr_token");
      create index if not exists "sales_invoices_qr_token_idx" on "sales_invoices" ("qr_token");
      create index if not exists "notifications_audience_created_idx" on "notifications" ("audience_type", "created_at");
      create index if not exists "notifications_staff_read_idx" on "notifications" ("staff_id", "read_at");
      create index if not exists "notifications_customer_read_idx" on "notifications" ("customer_id", "read_at");
      create index if not exists "notification_subscriptions_staff_idx" on "notification_subscriptions" ("staff_id", "is_active");
      create index if not exists "notification_subscriptions_customer_idx" on "notification_subscriptions" ("customer_id", "is_active");
      create unique index if not exists "notification_settings_owner_unique_idx" on "notification_settings" ("owner_type", coalesce("owner_id", 0));
;

-- Migrated from src/server/api.ts:10632
create table if not exists "enterprise_branches" (
        "id" serial primary key, "code" varchar(30) not null unique, "name" text not null,
        "city" text, "address" text, "map_url" text, "latitude" numeric(10,7), "longitude" numeric(10,7),
        "is_active" boolean not null default true, "created_at" timestamp not null default now(), "updated_at" timestamp not null default now()
      );
      insert into "enterprise_branches" ("code", "name") values ('MAIN', 'الفرع الرئيسي') on conflict ("code") do nothing;
      create table if not exists "branch_entity_assignments" (
        "id" serial primary key, "branch_id" integer not null references "enterprise_branches" ("id") on delete cascade,
        "entity_type" varchar(40) not null, "entity_id" integer not null, "created_at" timestamp not null default now()
      );
      create unique index if not exists "branch_entity_assignments_entity_idx" on "branch_entity_assignments" ("entity_type", "entity_id");
      create index if not exists "branch_entity_assignments_branch_idx" on "branch_entity_assignments" ("branch_id", "entity_type");
      create table if not exists "fleet_vehicles" (
        "id" serial primary key, "branch_id" integer references "enterprise_branches" ("id") on delete set null,
        "name" text not null, "plate_number" varchar(40) not null unique, "status" varchar(24) not null default 'available',
        "capacity" integer not null default 1, "latitude" numeric(10,7), "longitude" numeric(10,7), "notes" text,
        "last_location_at" timestamp, "is_active" boolean not null default true,
        "created_at" timestamp not null default now(), "updated_at" timestamp not null default now()
      );
      create index if not exists "fleet_vehicles_status_idx" on "fleet_vehicles" ("status", "is_active");
      create table if not exists "field_locations" (
        "id" serial primary key, "resource_type" varchar(24) not null, "resource_id" integer not null,
        "resource_name" text not null default '', "branch_id" integer references "enterprise_branches" ("id") on delete set null,
        "entity_type" varchar(40), "entity_id" integer, "latitude" numeric(10,7) not null, "longitude" numeric(10,7) not null,
        "accuracy_meters" numeric(10,2), "status" varchar(30) not null default 'available',
        "recorded_by" integer references "staff" ("id") on delete set null, "recorded_at" timestamp not null default now()
      );
      create index if not exists "field_locations_resource_idx" on "field_locations" ("resource_type", "resource_id", "recorded_at");
      create table if not exists "dispatch_assignments" (
        "id" serial primary key, "entity_type" varchar(40) not null, "entity_id" integer not null,
        "branch_id" integer references "enterprise_branches" ("id") on delete set null,
        "crew_id" integer references "crews" ("id") on delete set null,
        "vehicle_id" integer references "fleet_vehicles" ("id") on delete set null,
        "warehouse_id" integer references "warehouses" ("id") on delete set null,
        "score" numeric(6,2) not null default 0, "status" varchar(24) not null default 'assigned',
        "suggestions" jsonb not null default '{}'::jsonb, "notes" text,
        "assigned_by" integer references "staff" ("id") on delete set null, "assigned_by_name" text not null default '',
        "created_at" timestamp not null default now(), "updated_at" timestamp not null default now()
      );
      create unique index if not exists "dispatch_assignments_entity_idx" on "dispatch_assignments" ("entity_type", "entity_id");
      create table if not exists "internal_channels" (
        "id" serial primary key, "title" text not null, "department" varchar(40) not null default 'general',
        "entity_type" varchar(40), "entity_id" integer, "participant_staff_ids" jsonb not null default '[]'::jsonb,
        "created_by" integer references "staff" ("id") on delete set null, "archived_at" timestamp,
        "created_at" timestamp not null default now(), "updated_at" timestamp not null default now()
      );
      create table if not exists "internal_messages" (
        "id" serial primary key, "channel_id" integer not null references "internal_channels" ("id") on delete cascade,
        "sender_id" integer references "staff" ("id") on delete set null, "sender_name" text not null default '',
        "body" text, "voice_url" text, "voice_duration" integer, "created_at" timestamp not null default now()
      );
      create index if not exists "internal_messages_channel_idx" on "internal_messages" ("channel_id", "created_at");
      create table if not exists "customer_queue_entries" (
        "id" serial primary key, "queue_no" varchar(40) not null unique, "customer_id" integer references "customers" ("id") on delete set null,
        "customer_name" text not null default '', "phone" varchar(30), "service_type" varchar(40) not null default 'general',
        "branch_id" integer references "enterprise_branches" ("id") on delete set null, "status" varchar(24) not null default 'waiting',
        "arrived_at" timestamp not null default now(), "service_started_at" timestamp, "completed_at" timestamp, "notes" text,
        "created_by" integer references "staff" ("id") on delete set null,
        "created_at" timestamp not null default now(), "updated_at" timestamp not null default now()
      );
      create index if not exists "customer_queue_entries_status_idx" on "customer_queue_entries" ("status", "arrived_at");
      create table if not exists "lost_time_entries" (
        "id" serial primary key, "entity_type" varchar(40), "entity_id" integer, "reason_type" varchar(30) not null,
        "minutes" integer not null, "description" text, "staff_id" integer references "staff" ("id") on delete set null,
        "vehicle_id" integer references "fleet_vehicles" ("id") on delete set null,
        "product_id" integer references "products" ("id") on delete set null,
        "recorded_by" integer references "staff" ("id") on delete set null,
        "occurred_at" timestamp not null default now(), "created_at" timestamp not null default now()
      );
      create index if not exists "lost_time_entries_reason_idx" on "lost_time_entries" ("reason_type", "occurred_at");
      create table if not exists "asset_passports" (
        "id" serial primary key, "product_id" integer not null unique references "products" ("id") on delete cascade,
        "serial_number" varchar(120) unique, "supplier_name" text, "warranty_until" date,
        "warehouse_id" integer references "warehouses" ("id") on delete set null, "shelf_code" varchar(40), "image_url" text,
        "qr_token" varchar(80), "last_staff_id" integer references "staff" ("id") on delete set null, "last_location" text,
        "revenue_total" numeric(16,2) not null default 0, "maintenance_cost" numeric(16,2) not null default 0,
        "next_maintenance_date" date, "metadata" jsonb not null default '{}'::jsonb,
        "created_at" timestamp not null default now(), "updated_at" timestamp not null default now()
      );
      create index if not exists "asset_passports_shelf_idx" on "asset_passports" ("warehouse_id", "shelf_code");
      create table if not exists "equipment_custody" (
        "id" serial primary key, "product_id" integer not null references "products" ("id") on delete restrict,
        "staff_id" integer not null references "staff" ("id") on delete restrict, "quantity" integer not null default 1,
        "status" varchar(24) not null default 'issued', "signature_url" text, "issued_at" timestamp not null default now(),
        "returned_at" timestamp, "notes" text, "issued_by" integer references "staff" ("id") on delete set null,
        "created_at" timestamp not null default now(), "updated_at" timestamp not null default now()
      );
      create table if not exists "event_cost_estimates" (
        "id" serial primary key, "entity_type" varchar(40) not null, "entity_id" integer not null,
        "materials_cost" numeric(16,2) not null default 0, "transport_cost" numeric(16,2) not null default 0,
        "fuel_cost" numeric(16,2) not null default 0, "labor_cost" numeric(16,2) not null default 0,
        "depreciation_cost" numeric(16,2) not null default 0, "expected_revenue" numeric(16,2) not null default 0,
        "expected_profit" numeric(16,2) not null default 0, "profit_margin" numeric(7,2) not null default 0,
        "warning" text, "created_by" integer references "staff" ("id") on delete set null,
        "created_at" timestamp not null default now(), "updated_at" timestamp not null default now()
      );
      create unique index if not exists "event_cost_estimates_entity_idx" on "event_cost_estimates" ("entity_type", "entity_id");
      create table if not exists "warehouse_camera_snapshots" (
        "id" serial primary key, "warehouse_id" integer references "warehouses" ("id") on delete set null,
        "entity_type" varchar(40), "entity_id" integer, "movement_type" varchar(24) not null default 'checkout',
        "image_url" text not null, "captured_by" integer references "staff" ("id") on delete set null,
        "captured_at" timestamp not null default now()
      );
      create table if not exists "design_library_items" (
        "id" serial primary key, "type" varchar(30) not null, "name" text not null, "description" text,
        "images" jsonb not null default '[]'::jsonb, "material_product_ids" jsonb not null default '[]'::jsonb,
        "execution_cost" numeric(16,2) not null default 0, "execution_minutes" integer not null default 0,
        "order_count" integer not null default 0, "is_active" boolean not null default true,
        "created_by" integer references "staff" ("id") on delete set null,
        "created_at" timestamp not null default now(), "updated_at" timestamp not null default now()
      );
      create table if not exists "daily_closing_checklists" (
        "id" serial primary key, "closing_date" date not null, "branch_code" varchar(30) not null default 'MAIN',
        "equipment_returned" boolean not null default false, "payments_approved" boolean not null default false,
        "bookings_closed" boolean not null default false, "cash_closed" boolean not null default false,
        "backup_completed" boolean not null default false, "notes" text, "status" varchar(20) not null default 'open',
        "closed_by" integer references "staff" ("id") on delete set null, "closed_by_name" text not null default '',
        "closed_at" timestamp, "created_at" timestamp not null default now(), "updated_at" timestamp not null default now()
      );
      create unique index if not exists "daily_closing_checklists_date_branch_idx" on "daily_closing_checklists" ("closing_date", "branch_code");
      create table if not exists "knowledge_articles" (
        "id" serial primary key, "category" varchar(40) not null default 'general', "title" text not null,
        "content" text not null, "video_url" text, "tags" jsonb not null default '[]'::jsonb,
        "is_active" boolean not null default true, "created_by" integer references "staff" ("id") on delete set null,
        "created_by_name" text not null default '', "created_at" timestamp not null default now(), "updated_at" timestamp not null default now()
      );
      create table if not exists "knowledge_cases" (
        "id" serial primary key, "problem" text not null, "solution" text not null, "entity_type" varchar(40), "entity_id" integer,
        "tags" jsonb not null default '[]'::jsonb, "times_reused" integer not null default 0,
        "created_by" integer references "staff" ("id") on delete set null,
        "created_at" timestamp not null default now(), "updated_at" timestamp not null default now()
      );
      create table if not exists "management_decisions" (
        "id" serial primary key, "title" text not null, "decision" text not null, "reason" text not null,
        "entity_type" varchar(40), "entity_id" integer, "decided_by" integer references "staff" ("id") on delete set null,
        "decided_by_name" text not null default '', "decided_at" timestamp not null default now(), "created_at" timestamp not null default now()
      );
      create table if not exists "customer_attributions" (
        "id" serial primary key, "customer_id" integer references "customers" ("id") on delete cascade, "phone" varchar(30),
        "source" varchar(30) not null, "campaign" text, "entity_type" varchar(40), "entity_id" integer,
        "created_by" integer references "staff" ("id") on delete set null, "created_at" timestamp not null default now()
      );
      create index if not exists "customer_attributions_source_idx" on "customer_attributions" ("source", "created_at");
;

-- Migrated from src/server/api.ts:11155
create table if not exists "kosha_work_orders" (
        "id" serial primary key, "work_order_no" varchar(40) not null unique,
        "booking_id" integer not null unique references "kosha_bookings"("id") on delete restrict,
        "leader_id" integer references "staff"("id") on delete set null,
        "status" varchar(40) not null default 'UNASSIGNED', "priority" varchar(20) not null default 'normal',
        "required_arrival_at" timestamp, "event_start_at" timestamp, "expected_dismantle_at" timestamp,
        "assigned_at" timestamp, "accepted_at" timestamp, "started_at" timestamp,
        "started_by" integer references "staff"("id") on delete set null, "started_lat" numeric(10,7), "started_lng" numeric(10,7),
        "arrived_at" timestamp, "completed_at" timestamp, "special_instructions" text,
        "require_acknowledgment" boolean not null default false, "instructions_acknowledged_at" timestamp,
        "instructions_acknowledged_by" integer references "staff"("id") on delete set null,
        "cancelled_at" timestamp, "created_by" integer references "staff"("id") on delete set null,
        "created_at" timestamp not null default now(), "updated_at" timestamp not null default now()
      );
      create table if not exists "kosha_work_order_members" (
        "id" serial primary key, "work_order_id" integer not null references "kosha_work_orders"("id") on delete restrict,
        "staff_id" integer not null references "staff"("id") on delete restrict, "role" varchar(20) not null default 'MEMBER',
        "status" varchar(30) not null default 'ASSIGNED', "accepted_at" timestamp, "declined_at" timestamp,
        "decline_reason" varchar(40), "decline_note" text, "removed_at" timestamp, "created_at" timestamp not null default now(),
        unique("work_order_id", "staff_id")
      );
      create table if not exists "kosha_work_order_events" (
        "id" serial primary key, "work_order_id" integer not null references "kosha_work_orders"("id") on delete restrict,
        "staff_id" integer references "staff"("id") on delete set null, "staff_name" text not null default '',
        "type" varchar(50) not null, "title" text not null, "details" text, "metadata" jsonb not null default '{}'::jsonb,
        "created_at" timestamp not null default now()
      );
      create table if not exists "kosha_work_order_checklist" (
        "id" serial primary key, "work_order_id" integer not null references "kosha_work_orders"("id") on delete restrict,
        "label" text not null, "product_id" integer references "products"("id") on delete set null, "sort_order" integer not null default 0,
        "is_completed" boolean not null default false, "completed_by" integer references "staff"("id") on delete set null,
        "completed_at" timestamp, "note" text, "photo_url" text, "created_at" timestamp not null default now(), "updated_at" timestamp not null default now()
      );
      create table if not exists "kosha_work_order_assets" (
        "id" serial primary key, "work_order_id" integer not null references "kosha_work_orders"("id") on delete restrict,
        "product_id" integer not null references "products"("id") on delete restrict, "asset_code" varchar(160),
        "checked_out_by" integer references "staff"("id") on delete set null, "checked_out_at" timestamp,
        "returned_by" integer references "staff"("id") on delete set null, "returned_at" timestamp,
        "return_condition" varchar(30), "note" text, "created_at" timestamp not null default now(), unique("work_order_id", "product_id")
      );
      create index if not exists "kosha_work_orders_status_time_idx" on "kosha_work_orders"("status", "required_arrival_at");
      create index if not exists "kosha_work_order_members_staff_idx" on "kosha_work_order_members"("staff_id", "status");
      create index if not exists "kosha_work_order_events_order_idx" on "kosha_work_order_events"("work_order_id", "created_at");
;

-- Migrated from src/server/api.ts:13643
create table if not exists "product_recipes" (
        "id" serial primary key,
        "product_id" integer not null references "products" ("id") on delete cascade,
        "component_product_id" integer not null references "products" ("id"),
        "quantity" numeric(12,3) not null default 1,
        "unit" varchar(30) not null default 'قطعة',
        "unit_cost" numeric(14,2) not null default 0,
        "notes" text,
        "sort_order" integer not null default 0,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );
      create index if not exists "product_recipes_product_idx" on "product_recipes" ("product_id");
      create table if not exists "production_orders" (
        "id" serial primary key,
        "order_no" varchar(50) not null unique,
        "status" varchar(20) not null default 'pending',
        "items" jsonb not null default '[]'::jsonb,
        "materials" jsonb not null default '[]'::jsonb,
        "total_cost" numeric(16,2) not null default 0,
        "expected_revenue" numeric(16,2) not null default 0,
        "expected_profit" numeric(16,2) not null default 0,
        "notes" text,
        "created_by" integer references "staff" ("id"),
        "created_by_name" text not null default '',
        "delivered_at" timestamp,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );
      create index if not exists "production_orders_status_idx" on "production_orders" ("status", "created_at");
      -- Enterprise columns (labor / equipment / wastage / booking / approval) added idempotently.
      alter table "production_orders" add column if not exists "material_cost" numeric(16,2) not null default 0;
      alter table "production_orders" add column if not exists "labor_cost" numeric(16,2) not null default 0;
      alter table "production_orders" add column if not exists "equipment_cost" numeric(16,2) not null default 0;
      alter table "production_orders" add column if not exists "wastage_percent" numeric(6,2) not null default 0;
      alter table "production_orders" add column if not exists "labor" jsonb not null default '[]'::jsonb;
      alter table "production_orders" add column if not exists "equipment" jsonb not null default '[]'::jsonb;
      alter table "production_orders" add column if not exists "booking_type" varchar(40);
      alter table "production_orders" add column if not exists "booking_id" integer;
      alter table "production_orders" add column if not exists "approved_by" integer;
      alter table "production_orders" add column if not exists "approved_by_name" text;
      alter table "production_orders" add column if not exists "approved_at" timestamp;
      alter table "production_orders" add column if not exists "cancelled_at" timestamp;
      alter table "production_orders" add column if not exists "stock_applied" integer not null default 0;
      alter table "production_orders" add column if not exists "produced" jsonb not null default '{}'::jsonb;
      alter table "production_orders" add column if not exists "applied_materials" jsonb not null default '[]'::jsonb;
      alter table "production_orders" add column if not exists "expense_id" integer;
      create index if not exists "production_orders_booking_idx" on "production_orders" ("booking_type", "booking_id");
      -- Recipe-level overhead (labor lines + wastage) kept 1:1 with a finished product.
      create table if not exists "product_recipe_settings" (
        "product_id" integer primary key references "products" ("id") on delete cascade,
        "labor_cost" numeric(14,2) not null default 0,
        "labor" jsonb not null default '[]'::jsonb,
        "wastage_percent" numeric(6,2) not null default 0,
        "notes" text,
        "updated_at" timestamp not null default now()
      );
;

-- Migrated from src/server/api.ts:13720
create table if not exists "product_variants" (
        "id" serial primary key,
        "product_id" integer not null references "products" ("id") on delete cascade,
        "color" varchar(60),
        "color_hex" varchar(16),
        "size" varchar(60),
        "sku" varchar(80),
        "barcode" varchar(100),
        "qr_token" varchar(80),
        "image" text,
        "price" numeric(12,2),
        "cost" numeric(12,2),
        "stock" integer not null default 0,
        "min_stock" integer not null default 0,
        "max_stock" integer not null default 0,
        "warehouse_id" integer,
        "is_active" boolean not null default true,
        "notes" text,
        "sort_order" integer not null default 0,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );
      create index if not exists "product_variants_product_idx" on "product_variants" ("product_id");
      create index if not exists "product_variants_barcode_idx" on "product_variants" ("barcode");
      create index if not exists "product_variants_sku_idx" on "product_variants" ("sku");
      alter table "product_variants" add column if not exists "max_stock" integer not null default 0, add column if not exists "notes" text;
      create table if not exists "stock_reservations" (
        "id" serial primary key,
        "product_id" integer not null,
        "variant_id" integer,
        "quantity" numeric(12,3) not null default 0,
        "source_type" varchar(40) not null,
        "source_id" integer not null,
        "source_label" text,
        "status" varchar(20) not null default 'reserved',
        "consumed_at" timestamp,
        "released_at" timestamp,
        "created_by" integer,
        "created_by_name" text not null default '',
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );
      create index if not exists "stock_reservations_product_idx" on "stock_reservations" ("product_id", "status");
      create index if not exists "stock_reservations_variant_idx" on "stock_reservations" ("variant_id", "status");
      create index if not exists "stock_reservations_source_idx" on "stock_reservations" ("source_type", "source_id");
;

-- Migrated from src/server/api.ts:27068
create table if not exists "asset_links" (
      "id" serial primary key,
      "product_id" integer not null,
      "entity_type" varchar(30) not null,
      "entity_id" integer not null,
      "quantity" integer not null default 1,
      "created_by" integer,
      "created_at" timestamp not null default now()
    )
;

-- Migrated from src/server/api.ts:27080
create unique index if not exists "asset_links_uq" on "asset_links" ("product_id","entity_type","entity_id")
;

-- Migrated from src/server/api.ts:27083
create index if not exists "asset_links_entity_idx" on "asset_links" ("entity_type","entity_id")
;

-- Migrated from src/server/api.ts:31152
create table if not exists employee_custody_groups (
      id serial primary key, name text not null, staff_id integer not null references staff(id) on delete restrict,
      department text, group_type varchar(40) not null default 'general', description text,
      status varchar(20) not null default 'active', last_inspection_date date, next_inspection_date date,
      notes text, created_by integer references staff(id) on delete set null,
      created_at timestamp not null default now(), updated_at timestamp not null default now()
    );
    create table if not exists employee_custody_group_assets (
      id serial primary key, group_id integer not null references employee_custody_groups(id) on delete cascade,
      product_id integer not null references products(id) on delete restrict, is_active boolean not null default true,
      added_by integer references staff(id) on delete set null, added_at timestamp not null default now(),
      removed_at timestamp, notes text, unique(group_id, product_id)
    );
    create unique index if not exists employee_custody_active_asset_unique
      on employee_custody_group_assets(product_id) where is_active;
    create index if not exists employee_custody_group_assets_group_idx on employee_custody_group_assets(group_id,is_active);
    create table if not exists employee_custody_reservations (
      id serial primary key, group_id integer not null references employee_custody_groups(id) on delete restrict,
      product_id integer not null references products(id) on delete restrict, staff_id integer not null references staff(id) on delete restrict,
      booking_type varchar(20) not null, booking_id integer not null, start_at timestamp not null, end_at timestamp not null,
      status varchar(24) not null default 'reserved', checkout_at timestamp, returned_at timestamp,
      depreciation_applied_at timestamp, condition_out varchar(20), condition_in varchar(20),
      damage_reason text, damage_photo_url text, signature_url text, created_by integer references staff(id) on delete set null,
      created_at timestamp not null default now(), updated_at timestamp not null default now(),
      unique(booking_type,booking_id,product_id)
    );
    create index if not exists employee_custody_reservations_product_time_idx on employee_custody_reservations(product_id,start_at,end_at);
    create index if not exists employee_custody_reservations_booking_idx on employee_custody_reservations(booking_type,booking_id,status);
    create table if not exists employee_custody_audit (
      id serial primary key, group_id integer references employee_custody_groups(id) on delete set null,
      product_id integer references products(id) on delete set null, staff_id integer references staff(id) on delete set null,
      booking_type varchar(20), booking_id integer, action varchar(50) not null,
      previous_value jsonb not null default '{}'::jsonb, new_value jsonb not null default '{}'::jsonb,
      actor_id integer references staff(id) on delete set null, actor_name text not null default '', created_at timestamp not null default now()
    );
    create index if not exists employee_custody_audit_group_idx on employee_custody_audit(group_id,created_at desc);
;

-- Migrated from src/server/api.ts:33019
create index if not exists service_orders_sound_source_ref_idx
        on service_orders ((custom_fields ->> 'externalReference'))
        where custom_fields ->> 'bookingType' = 'sound';
      create index if not exists service_orders_sound_booking_type_idx
        on service_orders ((custom_fields ->> 'bookingType'), created_at desc);
      create index if not exists service_orders_tracking_phone_idx
        on service_orders (tracking_code, phone);
;

-- Migrated from src/server/api.ts:33956
CREATE TABLE IF NOT EXISTS "asset_sales" (
          "id" serial PRIMARY KEY,
          "sale_no" varchar(50) NOT NULL,
          "product_id" integer NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT,
          "customer_id" integer REFERENCES "customers"("id") ON DELETE SET NULL,
          "buyer_name" text NOT NULL,
          "buyer_phone" varchar(30),
          "sale_date" date NOT NULL,
          "purchase_cost" numeric(16,2) NOT NULL,
          "book_value" numeric(16,2) NOT NULL,
          "accumulated_depreciation" numeric(16,2) NOT NULL,
          "market_value" numeric(16,2),
          "sale_price" numeric(16,2) NOT NULL,
          "paid_amount" numeric(16,2) NOT NULL DEFAULT 0,
          "receivable_amount" numeric(16,2) NOT NULL DEFAULT 0,
          "profit_amount" numeric(16,2) NOT NULL DEFAULT 0,
          "loss_amount" numeric(16,2) NOT NULL DEFAULT 0,
          "payment_method" varchar(20) NOT NULL,
          "collection_method" varchar(20),
          "financial_account_id" integer REFERENCES "financial_accounts"("id") ON DELETE RESTRICT,
          "payment_status" varchar(20) NOT NULL DEFAULT 'paid',
          "invoice_number" varchar(120),
          "reason" text NOT NULL,
          "notes" text,
          "disposal_reference" varchar(80) NOT NULL,
          "accounting_reference" varchar(80),
          "financial_transaction_id" integer REFERENCES "financial_transactions"("id") ON DELETE RESTRICT,
          "sold_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
          "sold_by_name" text NOT NULL DEFAULT '',
          "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
          "created_at" timestamp NOT NULL DEFAULT now(),
          "updated_at" timestamp NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS "asset_sales_sale_no_idx" ON "asset_sales" ("sale_no");
        CREATE UNIQUE INDEX IF NOT EXISTS "asset_sales_product_idx" ON "asset_sales" ("product_id");
        CREATE INDEX IF NOT EXISTS "asset_sales_date_idx" ON "asset_sales" ("sale_date");
        CREATE INDEX IF NOT EXISTS "asset_sales_buyer_idx" ON "asset_sales" ("buyer_phone");
        CREATE INDEX IF NOT EXISTS "asset_sales_account_idx" ON "asset_sales" ("financial_account_id");
        CREATE OR REPLACE FUNCTION ajn_prevent_asset_sale_delete() RETURNS trigger AS $immutable$
        BEGIN
          RAISE EXCEPTION 'Asset sale records are immutable and cannot be deleted';
        END;
        $immutable$ LANGUAGE plpgsql;
        DO $triggers$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_sales_no_delete') THEN
            CREATE TRIGGER asset_sales_no_delete BEFORE DELETE ON asset_sales
            FOR EACH ROW EXECUTE FUNCTION ajn_prevent_asset_sale_delete();
          END IF;
        END $triggers$;
;

-- Migrated from src/server/api.ts:35033
alter table products add column if not exists preview_position jsonb;
      alter table products add column if not exists accessory_type varchar(60);
      alter table products add column if not exists maximum_quantity_per_bouquet integer;
      create table if not exists bouquet_templates (
        id serial primary key, name text not null, description text, product_id integer references products(id) on delete set null,
        preview_asset_url text, configuration jsonb not null default '{}'::jsonb, default_colors jsonb not null default '{}'::jsonb,
        is_default boolean not null default false, is_active boolean not null default true, archived_at timestamp,
        display_order integer not null default 0, created_at timestamp not null default now(), updated_at timestamp not null default now()
      );
      create table if not exists bouquet_template_items (
        id serial primary key, template_id integer not null references bouquet_templates(id) on delete cascade,
        product_id integer not null references products(id) on delete restrict, quantity integer not null default 1,
        role varchar(32) not null default 'FLOWER', position jsonb not null default '{}'::jsonb,
        display_order integer not null default 0, created_at timestamp not null default now()
      );
      create table if not exists bouquet_preview_settings (
        id serial primary key, default_template_id integer references bouquet_templates(id) on delete set null,
        background_url text, settings jsonb not null default '{}'::jsonb, updated_by integer, updated_at timestamp not null default now()
      );
;

-- Migrated from src/server/api.ts:35681
ALTER TABLE product_bundles
      ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC(14,2) NOT NULL DEFAULT 0;
    ALTER TABLE sales_invoice_bundle_snapshots
      ADD COLUMN IF NOT EXISTS delivery_fee_per_bundle NUMERIC(14,2) NOT NULL DEFAULT 0;
    ALTER TABLE sales_invoices
      ADD COLUMN IF NOT EXISTS offer_delivery_fee NUMERIC(14,2) NOT NULL DEFAULT 0;
;

-- Migrated from src/server/api.ts:48412
CREATE TABLE IF NOT EXISTS sales_invoices (
        id SERIAL PRIMARY KEY, invoice_no VARCHAR(40) NOT NULL UNIQUE, date DATE NOT NULL,
        customer_name TEXT NOT NULL DEFAULT '', customer_phone VARCHAR(30), customer_id INTEGER REFERENCES customers(id),
        subtotal NUMERIC(14,2) NOT NULL DEFAULT 0, discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        coupon_code VARCHAR(60), coupon_discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0, offer_delivery_fee NUMERIC(14,2) NOT NULL DEFAULT 0,
        total NUMERIC(14,2) NOT NULL DEFAULT 0,
        paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0, remaining_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        payment_method VARCHAR(20) NOT NULL DEFAULT 'cash', payment_status VARCHAR(20) NOT NULL DEFAULT 'paid',
        status VARCHAR(20) NOT NULL DEFAULT 'active', is_internal INTEGER NOT NULL DEFAULT 0,
        notes TEXT, created_by INTEGER REFERENCES staff(id), created_by_name TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS sales_invoice_items (
        id SERIAL PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id), product_name TEXT NOT NULL, barcode VARCHAR(100),
        quantity NUMERIC(12,3) NOT NULL DEFAULT 1, unit_price NUMERIC(14,2) NOT NULL DEFAULT 0,
        discount NUMERIC(14,2) NOT NULL DEFAULT 0, discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
        total NUMERIC(14,2) NOT NULL DEFAULT 0, cost_price NUMERIC(14,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      ALTER TABLE sales_invoices
        ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(60),
        ADD COLUMN IF NOT EXISTS coupon_discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS offer_delivery_fee NUMERIC(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS supplier_name TEXT,
        ADD COLUMN IF NOT EXISTS stock_applied INTEGER NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS stock_restored_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS cancelled_by INTEGER REFERENCES staff(id),
        ADD COLUMN IF NOT EXISTS cancelled_by_name TEXT,
        ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
        ADD COLUMN IF NOT EXISTS cancelled_original_paid_amount NUMERIC(14,2),
        ADD COLUMN IF NOT EXISTS cancelled_original_remaining_amount NUMERIC(14,2),
        ADD COLUMN IF NOT EXISTS reversal_references JSONB NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS reversal_completed_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS inventory_reversed BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS finance_reversed BOOLEAN NOT NULL DEFAULT false;
      DO $receivable$
      BEGIN
        IF to_regclass('public.customer_receivable_ledger') IS NOT NULL THEN
          ALTER TABLE customer_receivable_ledger
            DROP CONSTRAINT IF EXISTS customer_receivable_ledger_status_chk;
          ALTER TABLE customer_receivable_ledger
            ADD CONSTRAINT customer_receivable_ledger_status_chk
            CHECK (status IN ('open', 'paid', 'review', 'cancelled'));
        END IF;
      END
      $receivable$;
      CREATE INDEX IF NOT EXISTS idx_sales_invoices_date ON sales_invoices(date);
      CREATE INDEX IF NOT EXISTS idx_sales_invoices_customer ON sales_invoices(customer_id);
      CREATE INDEX IF NOT EXISTS idx_sales_invoice_items_invoice ON sales_invoice_items(invoice_id);
;

-- Migrated from src/server/api.ts:48477
CREATE TABLE IF NOT EXISTS suppliers (
        id SERIAL PRIMARY KEY, name TEXT NOT NULL, phone VARCHAR(30), email TEXT, address TEXT,
        notes TEXT, balance TEXT NOT NULL DEFAULT '0', is_active INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS supplier_code VARCHAR(40), ADD COLUMN IF NOT EXISTS company TEXT, ADD COLUMN IF NOT EXISTS contact_person TEXT, ADD COLUMN IF NOT EXISTS whatsapp VARCHAR(30), ADD COLUMN IF NOT EXISTS category VARCHAR(60), ADD COLUMN IF NOT EXISTS payment_terms VARCHAR(80), ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(16,2) NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS opening_balance NUMERIC(16,2) NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';
      CREATE UNIQUE INDEX IF NOT EXISTS suppliers_code_unique_idx ON suppliers(supplier_code) WHERE supplier_code IS NOT NULL;
      CREATE TABLE IF NOT EXISTS supplier_products (id SERIAL PRIMARY KEY, supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE, product_id INTEGER NOT NULL, last_purchase_price NUMERIC(16,2) NOT NULL DEFAULT 0, supplier_sku VARCHAR(100), supplier_barcode VARCHAR(100), is_default BOOLEAN NOT NULL DEFAULT false, is_preferred BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW());
      CREATE UNIQUE INDEX IF NOT EXISTS supplier_products_supplier_product_idx ON supplier_products(supplier_id, product_id);
      CREATE INDEX IF NOT EXISTS supplier_products_product_idx ON supplier_products(product_id);
      CREATE TABLE IF NOT EXISTS purchase_invoices (
        id SERIAL PRIMARY KEY, invoice_no VARCHAR(40) NOT NULL UNIQUE, date DATE NOT NULL,
        supplier_name TEXT NOT NULL DEFAULT '', supplier_id INTEGER REFERENCES suppliers(id),
        subtotal NUMERIC(14,2) NOT NULL DEFAULT 0, discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0, shipping_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
        total NUMERIC(14,2) NOT NULL DEFAULT 0, paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        remaining_amount NUMERIC(14,2) NOT NULL DEFAULT 0, payment_method VARCHAR(20) NOT NULL DEFAULT 'cash',
        payment_status VARCHAR(20) NOT NULL DEFAULT 'paid', status VARCHAR(20) NOT NULL DEFAULT 'active',
        notes TEXT, created_by INTEGER REFERENCES staff(id), created_by_name TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS purchase_invoice_items (
        id SERIAL PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id), product_name TEXT NOT NULL, barcode VARCHAR(100),
        quantity NUMERIC(12,3) NOT NULL DEFAULT 1, cost_price NUMERIC(14,2) NOT NULL DEFAULT 0,
        sale_price NUMERIC(14,2) NOT NULL DEFAULT 0, discount NUMERIC(14,2) NOT NULL DEFAULT 0,
        total NUMERIC(14,2) NOT NULL DEFAULT 0, created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_purchase_invoices_date ON purchase_invoices(date);
      CREATE INDEX IF NOT EXISTS idx_purchase_invoice_items_invoice ON purchase_invoice_items(invoice_id);
;

-- Migrated from src/server/api.ts:48519
CREATE TABLE IF NOT EXISTS print_templates (
        id SERIAL PRIMARY KEY, name TEXT NOT NULL, type VARCHAR(30) NOT NULL DEFAULT 'sales',
        paper_size VARCHAR(20) NOT NULL DEFAULT 'a4', is_default INTEGER NOT NULL DEFAULT 0,
        config TEXT NOT NULL DEFAULT '{}', created_by INTEGER REFERENCES staff(id),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
;

-- Migrated from src/server/api.ts:48580
create table if not exists "asset_categories" (
          "id" serial primary key,
          "name" text not null,
          "description" text,
          "color" varchar(20),
          "icon" varchar(80),
          "created_at" timestamp not null default now(),
          "updated_at" timestamp not null default now()
        );
        create unique index if not exists "asset_categories_name_idx" on "asset_categories" ("name");
        create index if not exists "asset_categories_created_idx" on "asset_categories" ("created_at");
        alter table "products" add column if not exists "asset_category_id" integer references "asset_categories" ("id") on delete restrict;
        create index if not exists "products_asset_category_id_idx" on "products" ("asset_category_id");
        insert into "asset_categories" ("name", "icon") values
          ('كاميرا', 'camera'), ('عدسة', 'aperture'), ('درون', 'drone'),
          ('إضاءة', 'lightbulb'), ('صوت', 'audio-lines'), ('سماعة', 'speaker'),
          ('مكسر صوت', 'sliders-horizontal'), ('شاشة', 'monitor'), ('ديكور', 'lamp'),
          ('مركبة', 'car-front'), ('أثاث', 'armchair'), ('أخرى', 'package')
        on conflict ("name") do nothing;
        update "products" p set "asset_category_id" = c."id"
        from "asset_categories" c
        where p."asset_category_id" is null and p."is_asset" = true and p."category" = c."name";
;

-- Migrated from src/server/api.ts:53515
CREATE TABLE IF NOT EXISTS "expense_categories" (
        "id" serial PRIMARY KEY,
        "name" text NOT NULL,
        "name_ar" text NOT NULL,
        "is_active" integer NOT NULL DEFAULT 1,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS "expenses" (
        "id" serial PRIMARY KEY,
        "date" date NOT NULL DEFAULT now(),
        "name" text NOT NULL DEFAULT '',
        "amount" numeric(12,2) NOT NULL,
        "category_id" integer REFERENCES "expense_categories" ("id") ON DELETE SET NULL,
        "category_name" text NOT NULL DEFAULT '',
        "payment_method" varchar(20) NOT NULL DEFAULT 'cash',
        "receipt_image" text,
        "notes" text,
        "created_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
        "created_by_name" text NOT NULL DEFAULT '',
        "updated_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
        "updated_by_name" text NOT NULL DEFAULT '',
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        "deleted_at" timestamp
      );

      ALTER TABLE "expense_categories"
        ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now();

      ALTER TABLE "expenses"
        ADD COLUMN IF NOT EXISTS "name" text NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS "payment_method" varchar(20) NOT NULL DEFAULT 'cash',
        ADD COLUMN IF NOT EXISTS "receipt_image" text,
        ADD COLUMN IF NOT EXISTS "updated_by" integer,
        ADD COLUMN IF NOT EXISTS "updated_by_name" text NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now(),
        ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;

      CREATE INDEX IF NOT EXISTS "expenses_date_idx" ON "expenses" ("date");
      CREATE INDEX IF NOT EXISTS "expenses_category_id_idx" ON "expenses" ("category_id");
      CREATE INDEX IF NOT EXISTS "expenses_payment_method_idx" ON "expenses" ("payment_method");
      CREATE INDEX IF NOT EXISTS "expenses_created_by_idx" ON "expenses" ("created_by");
      CREATE INDEX IF NOT EXISTS "expenses_deleted_at_idx" ON "expenses" ("deleted_at");
;

-- Migrated from src/server/api.ts:53576
CREATE TABLE IF NOT EXISTS "receipt_vouchers" (
          "id" serial PRIMARY KEY,
          "voucher_no" varchar(30) NOT NULL UNIQUE,
          "date" date NOT NULL DEFAULT now(),
          "amount" numeric(12,2) NOT NULL,
          "payer_name" text NOT NULL,
          "customer_id" integer REFERENCES "customers" ("id") ON DELETE SET NULL,
          "order_id" integer REFERENCES "orders" ("id") ON DELETE SET NULL,
          "booking_id" integer REFERENCES "service_orders" ("id") ON DELETE SET NULL,
          "reference" text,
          "method" varchar(20) NOT NULL DEFAULT 'cash',
          "notes" text,
          "created_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
          "created_by_name" text NOT NULL DEFAULT '',
          "created_at" timestamp NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS "payment_vouchers" (
          "id" serial PRIMARY KEY,
          "voucher_no" varchar(30) NOT NULL UNIQUE,
          "date" date NOT NULL DEFAULT now(),
          "amount" numeric(12,2) NOT NULL,
          "payee_name" text NOT NULL,
          "customer_id" integer REFERENCES "customers" ("id") ON DELETE SET NULL,
          "reference" text,
          "method" varchar(20) NOT NULL DEFAULT 'cash',
          "notes" text,
          "created_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
          "created_by_name" text NOT NULL DEFAULT '',
          "created_at" timestamp NOT NULL DEFAULT now()
        );

        ALTER TABLE "receipt_vouchers"
          ADD COLUMN IF NOT EXISTS "voucher_no" varchar(30),
          ADD COLUMN IF NOT EXISTS "date" date NOT NULL DEFAULT now(),
          ADD COLUMN IF NOT EXISTS "amount" numeric(12,2) NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS "payer_name" text NOT NULL DEFAULT '',
          ADD COLUMN IF NOT EXISTS "customer_id" integer,
          ADD COLUMN IF NOT EXISTS "order_id" integer,
          ADD COLUMN IF NOT EXISTS "booking_id" integer,
          ADD COLUMN IF NOT EXISTS "kosha_booking_id" integer,
          ADD COLUMN IF NOT EXISTS "reference" text,
          ADD COLUMN IF NOT EXISTS "method" varchar(20) NOT NULL DEFAULT 'cash',
          ADD COLUMN IF NOT EXISTS "notes" text,
          ADD COLUMN IF NOT EXISTS "created_by" integer,
          ADD COLUMN IF NOT EXISTS "created_by_name" text NOT NULL DEFAULT '',
          ADD COLUMN IF NOT EXISTS "approval_status" varchar(20) NOT NULL DEFAULT 'executed',
          ADD COLUMN IF NOT EXISTS "financial_transaction_id" integer,
          ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now();

        CREATE TABLE IF NOT EXISTS "receipt_voucher_allocations" (
          "id" serial PRIMARY KEY,
          "receipt_voucher_id" integer NOT NULL REFERENCES "receipt_vouchers" ("id") ON DELETE CASCADE,
          "customer_id" integer NOT NULL REFERENCES "customers" ("id"),
          "source_type" varchar(40) NOT NULL,
          "source_id" integer,
          "amount" numeric(14,2) NOT NULL CHECK ("amount" > 0),
          "reversed_amount" numeric(14,2) NOT NULL DEFAULT 0,
          "posted_at" timestamp,
          "reversed_at" timestamp,
          "reversed_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
          "reversal_reason" text,
          "reversal_transaction_id" integer,
          "created_at" timestamp NOT NULL DEFAULT now(),
          CHECK (("source_type" = 'customer_credit' AND "source_id" IS NULL) OR ("source_type" <> 'customer_credit' AND "source_id" IS NOT NULL))
        );

        ALTER TABLE "receipt_voucher_allocations"
          ADD COLUMN IF NOT EXISTS "reversed_amount" numeric(14,2) NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS "reversed_at" timestamp,
          ADD COLUMN IF NOT EXISTS "reversed_by" integer,
          ADD COLUMN IF NOT EXISTS "reversal_reason" text,
          ADD COLUMN IF NOT EXISTS "reversal_transaction_id" integer;

        ALTER TABLE "payment_vouchers"
          ADD COLUMN IF NOT EXISTS "voucher_no" varchar(30),
          ADD COLUMN IF NOT EXISTS "date" date NOT NULL DEFAULT now(),
          ADD COLUMN IF NOT EXISTS "amount" numeric(12,2) NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS "payee_name" text NOT NULL DEFAULT '',
          ADD COLUMN IF NOT EXISTS "customer_id" integer,
          ADD COLUMN IF NOT EXISTS "reference" text,
          ADD COLUMN IF NOT EXISTS "method" varchar(20) NOT NULL DEFAULT 'cash',
          ADD COLUMN IF NOT EXISTS "notes" text,
          ADD COLUMN IF NOT EXISTS "created_by" integer,
          ADD COLUMN IF NOT EXISTS "created_by_name" text NOT NULL DEFAULT '',
          ADD COLUMN IF NOT EXISTS "approval_status" varchar(20) NOT NULL DEFAULT 'executed',
          ADD COLUMN IF NOT EXISTS "financial_transaction_id" integer,
          ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now();

        CREATE UNIQUE INDEX IF NOT EXISTS "receipt_vouchers_voucher_no_idx" ON "receipt_vouchers" ("voucher_no");
        CREATE INDEX IF NOT EXISTS "receipt_vouchers_date_idx" ON "receipt_vouchers" ("date");
        CREATE INDEX IF NOT EXISTS "receipt_vouchers_customer_id_idx" ON "receipt_vouchers" ("customer_id");
        CREATE INDEX IF NOT EXISTS "receipt_vouchers_created_by_idx" ON "receipt_vouchers" ("created_by");

        CREATE UNIQUE INDEX IF NOT EXISTS "payment_vouchers_voucher_no_idx" ON "payment_vouchers" ("voucher_no");
        CREATE INDEX IF NOT EXISTS "payment_vouchers_date_idx" ON "payment_vouchers" ("date");
        CREATE INDEX IF NOT EXISTS "payment_vouchers_customer_id_idx" ON "payment_vouchers" ("customer_id");
        CREATE INDEX IF NOT EXISTS "payment_vouchers_created_by_idx" ON "payment_vouchers" ("created_by");
        CREATE INDEX IF NOT EXISTS "receipt_vouchers_approval_status_idx" ON "receipt_vouchers" ("approval_status");
        CREATE INDEX IF NOT EXISTS "receipt_vouchers_financial_transaction_id_idx" ON "receipt_vouchers" ("financial_transaction_id");
        CREATE INDEX IF NOT EXISTS "receipt_vouchers_kosha_booking_idx" ON "receipt_vouchers" ("kosha_booking_id");
        CREATE UNIQUE INDEX IF NOT EXISTS "receipt_voucher_allocations_source_unique" ON "receipt_voucher_allocations" ("receipt_voucher_id", "source_type", "source_id") WHERE "source_id" IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS "receipt_voucher_allocations_credit_unique" ON "receipt_voucher_allocations" ("receipt_voucher_id") WHERE "source_type" = 'customer_credit';
        CREATE INDEX IF NOT EXISTS "receipt_voucher_allocations_customer_idx" ON "receipt_voucher_allocations" ("customer_id", "posted_at");
        CREATE INDEX IF NOT EXISTS "receipt_voucher_allocations_source_idx" ON "receipt_voucher_allocations" ("source_type", "source_id", "posted_at");
        CREATE INDEX IF NOT EXISTS "payment_vouchers_approval_status_idx" ON "payment_vouchers" ("approval_status");
        CREATE INDEX IF NOT EXISTS "payment_vouchers_financial_transaction_id_idx" ON "payment_vouchers" ("financial_transaction_id");
;

-- Migrated from src/server/api.ts:59785
create table if not exists asset_depreciation_categories (
      id serial primary key, name varchar(160) not null, code varchar(50), asset_type varchar(80), description text,
      method varchar(30) not null default 'straight_line', useful_life_years integer not null default 0, useful_life_months integer not null default 0,
      annual_rate numeric(8,3) not null default 0, monthly_rate numeric(8,3) not null default 0, residual_value numeric(16,2) not null default 0,
      per_booking numeric(16,2) not null default 0, per_hour numeric(16,2) not null default 0, max_uses integer not null default 0, maintenance_threshold integer not null default 0,
      is_active boolean not null default true, is_archived boolean not null default false, notes text,
      created_by integer, created_by_name text not null default '', updated_by integer, updated_by_name text not null default '', created_at timestamp not null default now(), updated_at timestamp not null default now()
    );
    create unique index if not exists asset_depreciation_categories_name_uq on asset_depreciation_categories (lower(name));
    create unique index if not exists asset_depreciation_categories_code_uq on asset_depreciation_categories (lower(code)) where code is not null;
    create table if not exists asset_depreciation_category_audit (
      id serial primary key, category_id integer not null references asset_depreciation_categories(id), action varchar(30) not null,
      previous_value jsonb, new_value jsonb, changed_by integer, changed_by_name text not null default '', effective_date date not null,
      reason text, manager_note text, apply_mode varchar(20), selected_asset_ids jsonb not null default '[]'::jsonb, created_at timestamp not null default now()
    );
    create index if not exists asset_depreciation_category_audit_category_idx on asset_depreciation_category_audit(category_id, created_at desc);
;

-- Migrated from src/server/api.ts:65133
create table if not exists catering_categories (id serial primary key, name varchar(160) not null, description text, image_url text, sort_order integer not null default 0, is_active boolean not null default true, archived_at timestamp, created_by integer, updated_by integer, created_at timestamp not null default now(), updated_at timestamp not null default now());
    create table if not exists catering_menu_items (id serial primary key, code varchar(40) not null unique, name text not null, category varchar(60) not null default 'general', cost numeric not null default 0, selling_price numeric not null default 0, preparation_minutes integer not null default 0, created_at timestamp not null default now());
    alter table catering_menu_items add column if not exists category_id integer references catering_categories(id) on delete restrict, add column if not exists barcode varchar(100), add column if not exists unit varchar(40) not null default 'حبة', add column if not exists stock_quantity numeric(14,3) not null default 0, add column if not exists min_stock numeric(14,3) not null default 0, add column if not exists supplier_id integer references suppliers(id) on delete set null, add column if not exists inventory_product_id integer references products(id) on delete set null, add column if not exists image_url text, add column if not exists packaging_cost numeric(14,2) not null default 0, add column if not exists preparation_labor_cost numeric(14,2) not null default 0, add column if not exists notes text, add column if not exists track_inventory boolean not null default false, add column if not exists available_for_sale boolean not null default true, add column if not exists is_active boolean not null default true, add column if not exists archived_at timestamp, add column if not exists updated_at timestamp not null default now(), add column if not exists updated_by integer;
    create table if not exists catering_orders (id serial primary key, order_no varchar(48) not null unique, customer_id integer references customers(id) on delete set null, customer_name text not null default '', customer_phone varchar(30), customer_address text, occasion varchar(100), event_date date, status varchar(32) not null default 'draft', payment_status varchar(32) not null default 'unpaid', payment_method varchar(20) not null default 'cash', cost_settlement_mode varchar(32) not null default 'immediate', supplier_id integer references suppliers(id) on delete set null, subtotal numeric(14,2) not null default 0, discount_amount numeric(14,2) not null default 0, delivery_fee numeric(14,2) not null default 0, service_fee numeric(14,2) not null default 0, total_amount numeric(14,2) not null default 0, paid_amount numeric(14,2) not null default 0, remaining_amount numeric(14,2) not null default 0, food_cost numeric(14,2) not null default 0, expense_amount numeric(14,2) not null default 0, refund_amount numeric(14,2) not null default 0, final_profit numeric(14,2) not null default 0, notes text, stock_applied boolean not null default false, stock_restored_at timestamp, cancelled_at timestamp, cancelled_by integer, cancellation_reason text, created_by integer, created_by_name text not null default '', updated_at timestamp not null default now(), created_at timestamp not null default now());
    create table if not exists catering_order_items (id serial primary key, order_id integer not null references catering_orders(id) on delete restrict, menu_item_id integer references catering_menu_items(id) on delete set null, inventory_product_id integer references products(id) on delete set null, category_id integer references catering_categories(id) on delete set null, item_name text not null, item_code varchar(100), item_image_url text, unit varchar(40) not null default 'حبة', quantity numeric(14,3) not null, unit_selling_price numeric(14,2) not null default 0, unit_cost_price numeric(14,2) not null default 0, packaging_cost numeric(14,2) not null default 0, preparation_labor_cost numeric(14,2) not null default 0, discount_amount numeric(14,2) not null default 0, line_total numeric(14,2) not null default 0, line_cost numeric(14,2) not null default 0, notes text, created_at timestamp not null default now());
    create table if not exists catering_payments (id serial primary key, order_id integer not null references catering_orders(id) on delete restrict, amount numeric(14,2) not null check(amount>0), payment_method varchar(20) not null default 'cash', payment_date timestamp not null default now(), reference varchar(160), notes text, attachment_url text, status varchar(20) not null default 'confirmed', financial_transaction_id integer references financial_transactions(id) on delete restrict, reversal_transaction_id integer references financial_transactions(id) on delete restrict, collected_by integer, created_at timestamp not null default now(), reversed_at timestamp, reversed_by integer, reversal_reason text);
    create table if not exists catering_order_expenses (id serial primary key, order_id integer not null references catering_orders(id) on delete restrict, expense_type varchar(40) not null, amount numeric(14,2) not null check(amount>=0), supplier_id integer references suppliers(id) on delete set null, notes text, financial_transaction_id integer references financial_transactions(id) on delete restrict, created_by integer, created_at timestamp not null default now(), reversed_at timestamp);
    create table if not exists catering_supplier_payables (id serial primary key, order_id integer not null references catering_orders(id) on delete restrict, supplier_id integer not null references suppliers(id) on delete restrict, amount numeric(14,2) not null check(amount>=0), paid_amount numeric(14,2) not null default 0, status varchar(20) not null default 'open', due_date date, notes text, created_at timestamp not null default now(), settled_at timestamp);
    create table if not exists catering_stock_events (id serial primary key, order_id integer not null references catering_orders(id) on delete restrict, order_item_id integer not null references catering_order_items(id) on delete restrict, event varchar(20) not null, quantity numeric(14,3) not null, created_at timestamp not null default now(), unique(order_item_id,event));
    create unique index if not exists catering_categories_name_active_idx on catering_categories(lower(name)) where archived_at is null;
    create unique index if not exists catering_menu_items_barcode_idx on catering_menu_items(barcode) where barcode is not null;
    create index if not exists catering_orders_status_date_idx on catering_orders(status,event_date,created_at desc);
;

-- Migrated from src/server/api.ts:65960
create table if not exists catering_bookings (id serial primary key, code varchar(32) not null unique, customer_id integer, customer_name text not null, mobile1 varchar(30), mobile2 varchar(30), address text, map_url text, event_type varchar(30) not null, event_date date not null, start_time varchar(20), finish_time varchar(20), hall text, location text, gps text, guest_count integer not null, male_count integer not null default 0, female_count integer not null default 0, children_count integer not null default 0, vip_count integer not null default 0, notes text, package_name text, total_amount numeric not null default 0, estimated_cost numeric not null default 0, balance_amount numeric not null default 0, qr_token varchar(64) not null unique, status varchar(24) not null default 'confirmed', chef_name text, created_by integer, created_at timestamp not null default now(), updated_at timestamp not null default now())
;

-- Migrated from src/server/api.ts:65963
create table if not exists catering_menu_items (id serial primary key, code varchar(40) not null unique, name text not null, category varchar(60) not null, cost numeric not null default 0, selling_price numeric not null default 0, preparation_minutes integer not null default 0, calories integer, inventory_product_id integer, image_url text, created_at timestamp not null default now())
;

-- Migrated from src/server/api.ts:65966
create table if not exists catering_packages (id serial primary key, name varchar(120) not null, tier varchar(20) not null, price numeric not null default 0, details jsonb not null default '{}'::jsonb, created_at timestamp not null default now())
;

-- Migrated from src/server/api.ts:65969
create index if not exists catering_bookings_date_idx on catering_bookings(event_date, status)
;

-- Migrated from src/server/api.ts:66108
create table if not exists "invitation_cards" (
      "id" serial primary key,
      "slug" varchar(24) not null unique,
      "code" varchar(24),
      "type" varchar(30) not null default 'wedding',
      "booking_id" integer,
      "customer_id" integer,
      "bride_name" text, "groom_name" text, "event_name" text,
      "event_date" varchar(20), "event_time" varchar(20),
      "venue_name" text, "venue_address" text, "map_url" text,
      "customer_phone" varchar(30), "customer_email" text,
      "welcome_message" text, "thank_you_message" text,
      "main_image_url" text, "gallery_images" jsonb not null default '[]',
      "font_family" varchar(80) not null default 'Cairo', "custom_font_url" text,
      "text_color" varchar(20) not null default '#2a2118',
      "background_color" varchar(20) not null default '#f7f1e8',
      "animation_style" varchar(30) not null default 'fade',
      "music_url" text, "video_url" text,
      "status" varchar(20) not null default 'draft',
      "is_active" boolean not null default true, "views" integer not null default 0,
      "created_by" integer,
      "created_at" timestamp not null default now(),
      "updated_at" timestamp not null default now()
    )
;

-- Migrated from src/server/api.ts:66134
create table if not exists "invitation_card_rsvps" (
      "id" serial primary key,
      "card_id" integer not null,
      "guest_name" text, "guest_phone" varchar(30), "guest_token" varchar(24),
      "attendance_status" varchar(12) not null default 'pending',
      "companions_count" integer not null default 0,
      "guest_message" text, "viewed_at" timestamp, "responded_at" timestamp,
      "created_at" timestamp not null default now()
    )
;

-- Migrated from src/server/api.ts:66146
create index if not exists "invitation_rsvps_card_idx" on "invitation_card_rsvps" ("card_id")
;

-- Migrated from src/server/api.ts:66149
alter table "invitation_cards" add column if not exists "social_links" jsonb not null default '{}'::jsonb
;

-- Migrated from src/server/api.ts:66153
alter table "invitation_cards" add column if not exists "opening_style" varchar(40) not null default 'ring_box'
;

-- Migrated from src/server/api.ts:66156
alter table "invitation_cards" add column if not exists "experience_settings" jsonb not null default '{}'::jsonb
;

-- Migrated from src/server/api.ts:66158
create table if not exists "invitation_guests" (
      "id" serial primary key, "card_id" integer not null,
      "guest_name" text not null, "family" text, "guest_type" varchar(24) not null default 'friends',
      "phone" varchar(30), "photo_url" text, "hall" text, "table_number" varchar(40), "seat_number" varchar(40),
      "allowed_guests" integer not null default 1, "checked_in_count" integer not null default 0,
      "qr_token" varchar(64) not null unique, "expires_at" timestamp, "created_at" timestamp not null default now(), "updated_at" timestamp not null default now()
    )
;

-- Migrated from src/server/api.ts:66167
create table if not exists "invitation_guest_checkins" (
      "id" serial primary key, "guest_id" integer not null, "card_id" integer not null,
      "entry_number" integer not null, "staff_id" integer, "staff_name" text, "location" text,
      "checked_in_at" timestamp not null default now(), "qr_fingerprint" varchar(96)
    )
;

-- Migrated from src/server/api.ts:66175
create index if not exists "invitation_guests_card_idx" on "invitation_guests" ("card_id")
;

-- Migrated from src/server/api.ts:66178
create index if not exists "invitation_guest_checkins_guest_idx" on "invitation_guest_checkins" ("guest_id")
;

-- Migrated from src/server/bride-dashboard.ts:36
CREATE TABLE IF NOT EXISTS bride_dashboard_requests (
      id serial PRIMARY KEY, booking_id integer NOT NULL REFERENCES kosha_bookings(id) ON DELETE RESTRICT,
      customer_id integer NOT NULL REFERENCES customers(id) ON DELETE RESTRICT, request_type varchar(40) NOT NULL,
      department varchar(40) NOT NULL DEFAULT 'support', body text NOT NULL, status varchar(20) NOT NULL DEFAULT 'new',
      task_id integer REFERENCES tasks(id) ON DELETE SET NULL, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS bride_dashboard_requests_customer_idx ON bride_dashboard_requests(customer_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS wedding_workspace_members (
      id serial PRIMARY KEY, booking_id integer NOT NULL REFERENCES kosha_bookings(id) ON DELETE CASCADE,
      customer_id integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      role varchar(24) NOT NULL DEFAULT 'family', permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamp NOT NULL DEFAULT now(), UNIQUE(booking_id, customer_id)
    );
    CREATE TABLE IF NOT EXISTS wedding_workspace_items (
      id serial PRIMARY KEY, booking_id integer NOT NULL REFERENCES kosha_bookings(id) ON DELETE CASCADE,
      customer_id integer NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
      kind varchar(32) NOT NULL, title text NOT NULL, status varchar(40) NOT NULL DEFAULT 'pending',
      data jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS wedding_workspace_items_booking_idx ON wedding_workspace_items(booking_id, kind, updated_at DESC);
    CREATE INDEX IF NOT EXISTS wedding_workspace_members_customer_idx ON wedding_workspace_members(customer_id, booking_id);
;

-- Migrated from src/server/daily-cash.ts:86
CREATE TABLE IF NOT EXISTS "daily_cash_reports" (
        "id" serial PRIMARY KEY,
        "report_date" date NOT NULL,
        "opening_balance" numeric(14,2) NOT NULL DEFAULT 0,
        "total_sales" numeric(14,2) NOT NULL DEFAULT 0,
        "total_expenses" numeric(14,2) NOT NULL DEFAULT 0,
        "closing_balance" numeric(14,2) NOT NULL DEFAULT 0,
        "notes" text,
        "created_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
        "created_by_name" text NOT NULL DEFAULT '',
        "updated_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
        "updated_by_name" text NOT NULL DEFAULT '',
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS "daily_cash_reports_report_date_idx"
        ON "daily_cash_reports" ("report_date");
      CREATE INDEX IF NOT EXISTS "daily_cash_reports_created_by_idx"
        ON "daily_cash_reports" ("created_by");
      CREATE INDEX IF NOT EXISTS "daily_cash_reports_updated_at_idx"
        ON "daily_cash_reports" ("updated_at");

      CREATE TABLE IF NOT EXISTS "daily_cash_reconciliations" (
        "id" serial PRIMARY KEY,
        "report_date" date NOT NULL,
        "opening_balance" numeric(14,2) NOT NULL DEFAULT 0,
        "total_sales" numeric(14,2) NOT NULL DEFAULT 0,
        "total_expenses" numeric(14,2) NOT NULL DEFAULT 0,
        "expected_cash_balance" numeric(14,2) NOT NULL DEFAULT 0,
        "actual_cash_in_drawer" numeric(14,2) NOT NULL DEFAULT 0,
        "difference" numeric(14,2) NOT NULL DEFAULT 0,
        "status" varchar(20) NOT NULL DEFAULT 'balanced',
        "notes" text,
        "created_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
        "created_by_name" text NOT NULL DEFAULT '',
        "updated_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
        "updated_by_name" text NOT NULL DEFAULT '',
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS "daily_cash_reconciliations_report_date_idx"
        ON "daily_cash_reconciliations" ("report_date");
      CREATE INDEX IF NOT EXISTS "daily_cash_reconciliations_status_idx"
        ON "daily_cash_reconciliations" ("status");
      CREATE INDEX IF NOT EXISTS "daily_cash_reconciliations_created_by_idx"
        ON "daily_cash_reconciliations" ("created_by");
      CREATE INDEX IF NOT EXISTS "daily_cash_reconciliations_updated_at_idx"
        ON "daily_cash_reconciliations" ("updated_at");

      ALTER TABLE "daily_cash_reports" ADD COLUMN IF NOT EXISTS "status" varchar(20) NOT NULL DEFAULT 'open';
      ALTER TABLE "daily_cash_reports" ADD COLUMN IF NOT EXISTS "closed_by" integer;
      ALTER TABLE "daily_cash_reports" ADD COLUMN IF NOT EXISTS "closed_by_name" text NOT NULL DEFAULT '';
      ALTER TABLE "daily_cash_reports" ADD COLUMN IF NOT EXISTS "closed_at" timestamp;
      CREATE INDEX IF NOT EXISTS "daily_cash_reports_status_idx" ON "daily_cash_reports" ("status");

      ALTER TABLE "daily_cash_reconciliations" ADD COLUMN IF NOT EXISTS "approval_status" varchar(20) NOT NULL DEFAULT 'none';
      ALTER TABLE "daily_cash_reconciliations" ADD COLUMN IF NOT EXISTS "approved_by" integer;
      ALTER TABLE "daily_cash_reconciliations" ADD COLUMN IF NOT EXISTS "approved_by_name" text NOT NULL DEFAULT '';
      ALTER TABLE "daily_cash_reconciliations" ADD COLUMN IF NOT EXISTS "approval_note" text;
      ALTER TABLE "daily_cash_reconciliations" ADD COLUMN IF NOT EXISTS "approved_at" timestamp;

      ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "name" text NOT NULL DEFAULT '';
      ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "payment_method" varchar(20) NOT NULL DEFAULT 'cash';
      ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "receipt_image" text;
;

-- Migrated from src/server/delivery-details.ts:313
ALTER TABLE delivery_zones
        ADD COLUMN IF NOT EXISTS express_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS same_day_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS cod_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS free_delivery_threshold NUMERIC(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS delivery_company TEXT,
        ADD COLUMN IF NOT EXISTS max_weight NUMERIC(10,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS notes TEXT,
        ADD COLUMN IF NOT EXISTS priced_regions JSONB NOT NULL DEFAULT '[]'::jsonb;

      ALTER TABLE customer_addresses
        ADD COLUMN IF NOT EXISTS province_id INTEGER REFERENCES delivery_zones(id),
        ADD COLUMN IF NOT EXISTS district TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS area TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS alt_phone VARCHAR(20),
        ADD COLUMN IF NOT EXISTS maps_url TEXT;

      CREATE TABLE IF NOT EXISTS delivery_details (
        id SERIAL PRIMARY KEY,
        sales_invoice_id INTEGER REFERENCES sales_invoices(id) ON DELETE CASCADE,
        order_id INTEGER REFERENCES orders(id),
        customer_id INTEGER REFERENCES customers(id),
        customer_address_id INTEGER REFERENCES customer_addresses(id),
        province_id INTEGER REFERENCES delivery_zones(id),
        method VARCHAR(20) NOT NULL DEFAULT 'pickup',
        province_name TEXT NOT NULL DEFAULT '',
        city TEXT NOT NULL DEFAULT '',
        district TEXT NOT NULL DEFAULT '',
        area TEXT NOT NULL DEFAULT '',
        landmark TEXT NOT NULL DEFAULT '',
        full_address TEXT NOT NULL DEFAULT '',
        maps_url TEXT,
        receiver_name TEXT NOT NULL DEFAULT '',
        receiver_phone VARCHAR(20),
        receiver_alt_phone VARCHAR(20),
        delivery_company TEXT,
        delivery_type VARCHAR(20) NOT NULL DEFAULT 'standard',
        delivery_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
        base_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
        fee_overridden BOOLEAN NOT NULL DEFAULT false,
        fee_override_reason TEXT,
        fee_paid_by VARCHAR(20) NOT NULL DEFAULT 'customer',
        cod_enabled BOOLEAN NOT NULL DEFAULT false,
        cod_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
        cod_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        cod_collected_at TIMESTAMP,
        expected_ship_date DATE,
        expected_arrival_date DATE,
        preferred_time VARCHAR(40),
        notes TEXT,
        is_fragile BOOLEAN NOT NULL DEFAULT false,
        needs_refrigeration BOOLEAN NOT NULL DEFAULT false,
        created_by INTEGER REFERENCES staff(id),
        created_by_name TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS delivery_details_sales_invoice_unique
        ON delivery_details(sales_invoice_id) WHERE sales_invoice_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS delivery_details_province_idx ON delivery_details(province_id);
      CREATE INDEX IF NOT EXISTS delivery_details_customer_idx ON delivery_details(customer_id);

      CREATE TABLE IF NOT EXISTS delivery_orders (
        id SERIAL PRIMARY KEY,
        delivery_no VARCHAR(40) NOT NULL UNIQUE,
        delivery_details_id INTEGER REFERENCES delivery_details(id) ON DELETE CASCADE,
        sales_invoice_id INTEGER REFERENCES sales_invoices(id) ON DELETE CASCADE,
        order_id INTEGER REFERENCES orders(id),
        customer_id INTEGER REFERENCES customers(id),
        customer_address_id INTEGER REFERENCES customer_addresses(id),
        province_id INTEGER REFERENCES delivery_zones(id),
        financial_transaction_id INTEGER,
        qr_token VARCHAR(80),
        status VARCHAR(30) NOT NULL DEFAULT 'pending_prep',
        status_updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        delivered_at TIMESTAMP,
        returned_at TIMESTAMP,
        label_printed_at TIMESTAMP,
        label_print_count INTEGER NOT NULL DEFAULT 0,
        created_by INTEGER REFERENCES staff(id),
        created_by_name TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS delivery_orders_details_unique
        ON delivery_orders(delivery_details_id) WHERE delivery_details_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS delivery_orders_status_idx ON delivery_orders(status);
      CREATE INDEX IF NOT EXISTS delivery_orders_province_idx ON delivery_orders(province_id);

      CREATE TABLE IF NOT EXISTS delivery_order_status_history (
        id SERIAL PRIMARY KEY,
        delivery_order_id INTEGER NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
        status VARCHAR(30) NOT NULL,
        reason TEXT,
        notes TEXT,
        created_by INTEGER REFERENCES staff(id),
        created_by_name TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS delivery_order_history_order_idx
        ON delivery_order_status_history(delivery_order_id);

      -- Phase 3: return metadata on the delivery order.
      ALTER TABLE delivery_orders
        ADD COLUMN IF NOT EXISTS return_reason TEXT,
        ADD COLUMN IF NOT EXISTS returned_items JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS cancel_reason TEXT,
        ADD COLUMN IF NOT EXISTS cod_settled_at TIMESTAMP;

      -- Phase 3: COD settlement ledger. One settlement per delivery order.
      CREATE TABLE IF NOT EXISTS delivery_cod_settlements (
        id SERIAL PRIMARY KEY,
        delivery_order_id INTEGER NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
        sales_invoice_id INTEGER REFERENCES sales_invoices(id) ON DELETE SET NULL,
        customer_id INTEGER REFERENCES customers(id),
        delivery_company TEXT,
        expected_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        received_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        settlement_date DATE NOT NULL,
        reference_no TEXT,
        account VARCHAR(20) NOT NULL DEFAULT 'cash',
        accounting_mode VARCHAR(20) NOT NULL DEFAULT 'revenue',
        notes TEXT,
        attachment_url TEXT,
        receipt_voucher_id INTEGER,
        financial_transaction_id INTEGER,
        status VARCHAR(20) NOT NULL DEFAULT 'completed',
        created_by INTEGER REFERENCES staff(id),
        created_by_name TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS delivery_cod_settlements_order_unique
        ON delivery_cod_settlements(delivery_order_id);
;

-- Migrated from src/server/desktop-idempotency.ts:12
CREATE TABLE IF NOT EXISTS "desktop_idempotency_keys" (
        "id" serial PRIMARY KEY,
        "idempotency_key" varchar(100) NOT NULL,
        "request_method" varchar(10) NOT NULL,
        "request_path" text NOT NULL,
        "request_hash" varchar(64) NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'processing',
        "response_status" varchar(3),
        "response_body" jsonb,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "completed_at" timestamp
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "desktop_idempotency_key_unique_idx"
        ON "desktop_idempotency_keys" ("idempotency_key");
      CREATE INDEX IF NOT EXISTS "desktop_idempotency_created_at_idx"
        ON "desktop_idempotency_keys" ("created_at");
      CREATE INDEX IF NOT EXISTS "desktop_idempotency_status_idx"
        ON "desktop_idempotency_keys" ("status");
;

-- Migrated from src/server/document-scanner.ts:155
CREATE TABLE IF NOT EXISTS scanned_documents (
        id SERIAL PRIMARY KEY,
        document_type VARCHAR(40) NOT NULL,
        owner_type VARCHAR(40),
        owner_id INTEGER,
        owner_name TEXT,
        notes TEXT,
        front_image TEXT,
        back_image TEXT,
        width_mm NUMERIC(8,2),
        height_mm NUMERIC(8,2),
        created_by INTEGER REFERENCES staff(id),
        created_by_name TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMP,
        deleted_by INTEGER REFERENCES staff(id),
        delete_reason TEXT
      );
      CREATE INDEX IF NOT EXISTS scanned_documents_owner_idx
        ON scanned_documents(owner_type, owner_id);
      CREATE INDEX IF NOT EXISTS scanned_documents_created_idx
        ON scanned_documents(created_at DESC);

      -- Enterprise metadata. Every column is additive so existing rows survive.
      ALTER TABLE scanned_documents
        ADD COLUMN IF NOT EXISTS title TEXT,
        ADD COLUMN IF NOT EXISTS document_number TEXT,
        ADD COLUMN IF NOT EXISTS full_name TEXT,
        ADD COLUMN IF NOT EXISTS national_id TEXT,
        ADD COLUMN IF NOT EXISTS passport_number TEXT,
        ADD COLUMN IF NOT EXISTS phone VARCHAR(30),
        ADD COLUMN IF NOT EXISTS issue_date DATE,
        ADD COLUMN IF NOT EXISTS expiry_date DATE,
        ADD COLUMN IF NOT EXISTS ocr_text TEXT,
        ADD COLUMN IF NOT EXISTS ocr_language VARCHAR(20),
        ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active',
        ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS qr_token VARCHAR(80),
        ADD COLUMN IF NOT EXISTS page_count INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS updated_by INTEGER,
        ADD COLUMN IF NOT EXISTS updated_by_name TEXT;

      CREATE INDEX IF NOT EXISTS scanned_documents_expiry_idx
        ON scanned_documents(expiry_date) WHERE expiry_date IS NOT NULL;
      CREATE INDEX IF NOT EXISTS scanned_documents_number_idx
        ON scanned_documents(document_number);
      CREATE UNIQUE INDEX IF NOT EXISTS scanned_documents_qr_idx
        ON scanned_documents(qr_token) WHERE qr_token IS NOT NULL;

      /*
       * Pages. An image lives EITHER at storage_path (an object path, never a
       * public URL) OR inline as base64 when object storage is unavailable.
       * Both are read back only through the authenticated proxy endpoint.
       */
      CREATE TABLE IF NOT EXISTS scanned_document_pages (
        id SERIAL PRIMARY KEY,
        document_id INTEGER NOT NULL REFERENCES scanned_documents(id) ON DELETE CASCADE,
        page_index INTEGER NOT NULL DEFAULT 0,
        side VARCHAR(20) NOT NULL DEFAULT 'page',
        storage_path TEXT,
        inline_data TEXT,
        mime_type VARCHAR(60) NOT NULL DEFAULT 'image/jpeg',
        width_px INTEGER,
        height_px INTEGER,
        width_mm NUMERIC(8,2),
        height_mm NUMERIC(8,2),
        ocr_text TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS scanned_document_pages_doc_idx
        ON scanned_document_pages(document_id, page_index);

      -- Version history keeps metadata snapshots only; page images are not duplicated.
      CREATE TABLE IF NOT EXISTS scanned_document_versions (
        id SERIAL PRIMARY KEY,
        document_id INTEGER NOT NULL REFERENCES scanned_documents(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
        change_summary TEXT,
        created_by INTEGER REFERENCES staff(id),
        created_by_name TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS scanned_document_versions_doc_idx
        ON scanned_document_versions(document_id, version DESC);
;

-- Migrated from src/server/employee-advances.ts:134
ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "department" varchar(60) NOT NULL DEFAULT 'general';
    ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "base_salary" numeric(16,2) NOT NULL DEFAULT 0;
    ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "hired_at" date NOT NULL DEFAULT CURRENT_DATE;
    CREATE TABLE IF NOT EXISTS "employee_advances" (
      "id" serial PRIMARY KEY, "advance_no" varchar(40) NOT NULL UNIQUE,
      "employee_id" integer NOT NULL REFERENCES "staff"("id") ON DELETE RESTRICT,
      "request_date" date NOT NULL, "advance_type" varchar(30) NOT NULL DEFAULT 'salary_advance',
      "amount" numeric(16,2) NOT NULL, "repaid_amount" numeric(16,2) NOT NULL DEFAULT 0,
      "remaining_amount" numeric(16,2) NOT NULL DEFAULT 0, "monthly_deduction" numeric(16,2) NOT NULL DEFAULT 0,
      "reason" text NOT NULL DEFAULT '', "notes" text, "attachment_url" text,
      "status" varchar(20) NOT NULL DEFAULT 'pending',
      "requested_by" integer REFERENCES "staff"("id") ON DELETE SET NULL, "requested_by_name" text NOT NULL DEFAULT '',
      "approved_by" integer REFERENCES "staff"("id") ON DELETE SET NULL, "approved_by_name" text NOT NULL DEFAULT '', "approved_at" timestamp,
      "rejected_by" integer REFERENCES "staff"("id") ON DELETE SET NULL, "rejected_by_name" text NOT NULL DEFAULT '', "rejected_at" timestamp, "rejection_reason" text,
      "paid_at" timestamp, "due_date" date, "last_deduction_at" timestamp, "financial_transaction_id" integer,
      "payroll_reference" varchar(80), "created_at" timestamp NOT NULL DEFAULT now(), "updated_at" timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS "employee_advances_employee_idx" ON "employee_advances" ("employee_id", "created_at");
    CREATE INDEX IF NOT EXISTS "employee_advances_status_idx" ON "employee_advances" ("status", "request_date");
    CREATE TABLE IF NOT EXISTS "employee_advance_repayments" (
      "id" serial PRIMARY KEY, "advance_id" integer NOT NULL REFERENCES "employee_advances"("id") ON DELETE RESTRICT,
      "employee_id" integer NOT NULL REFERENCES "staff"("id") ON DELETE RESTRICT, "payment_date" date NOT NULL,
      "amount" numeric(16,2) NOT NULL, "method" varchar(20) NOT NULL DEFAULT 'cash', "kind" varchar(20) NOT NULL DEFAULT 'manual',
      "notes" text, "payroll_reference" varchar(80), "financial_transaction_id" integer,
      "received_by" integer REFERENCES "staff"("id") ON DELETE SET NULL, "received_by_name" text NOT NULL DEFAULT '',
      "created_at" timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS "employee_advance_repayments_advance_idx" ON "employee_advance_repayments" ("advance_id", "payment_date");
    CREATE TABLE IF NOT EXISTS "employee_advance_settings" (
      "id" serial PRIMARY KEY, "max_advance_amount" numeric(16,2) NOT NULL DEFAULT 0,
      "max_salary_percentage" numeric(5,2) NOT NULL DEFAULT 100, "max_active_advances" integer NOT NULL DEFAULT 1,
      "minimum_employment_days" integer NOT NULL DEFAULT 0, "manager_approval_amount" numeric(16,2) NOT NULL DEFAULT 0,
      "updated_by" integer REFERENCES "staff"("id") ON DELETE SET NULL, "updated_at" timestamp NOT NULL DEFAULT now()
    );
    INSERT INTO "employee_advance_settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;
;

-- Migrated from src/server/employee-advances.ts:172
CREATE UNIQUE INDEX IF NOT EXISTS "employee_advance_repayments_payroll_unique_idx"
        ON "employee_advance_repayments" ("advance_id", "payroll_reference")
        WHERE "kind" = 'payroll' AND "payroll_reference" IS NOT NULL
;

-- Migrated from src/server/employee-performance.ts:125
create table if not exists "employee_performance_actions" (
      "id" serial primary key,
      "staff_id" integer not null,
      "kind" varchar(20) not null,
      "points" integer not null default 0,
      "title" text,
      "note" text,
      "created_by" integer,
      "created_by_name" text not null default '',
      "created_at" timestamp not null default now()
    )
;

-- Migrated from src/server/employee-performance.ts:138
create index if not exists "emp_perf_actions_staff_idx" on "employee_performance_actions" ("staff_id")
;

-- Migrated from src/server/employee-salaries.ts:48
create table if not exists employee_salary_payments (
      id serial primary key,
      payroll_run_id integer not null references payroll_runs(id) on delete restrict,
      payroll_line_id integer not null references payroll_lines(id) on delete restrict,
      staff_id integer not null references staff(id) on delete restrict,
      amount numeric(16,2) not null,
      payment_date date not null,
      payment_method varchar(30) not null default 'cash',
      reference_no varchar(120),
      financial_transaction_id integer not null references financial_transactions(id) on delete restrict,
      status varchar(20) not null default 'paid',
      origin varchar(30) not null default 'salary_module',
      idempotency_key varchar(180) not null unique,
      notes text,
      attachment text,
      created_by integer references staff(id) on delete set null,
      created_by_name text not null default '',
      reversed_transaction_id integer references financial_transactions(id) on delete restrict,
      reversed_at timestamp,
      reversed_by integer references staff(id) on delete set null,
      reversal_reason text,
      created_at timestamp not null default now(),
      updated_at timestamp not null default now()
    );
    create index if not exists employee_salary_payments_line_idx on employee_salary_payments(payroll_line_id,created_at);
    create unique index if not exists employee_salary_payments_financial_uq on employee_salary_payments(financial_transaction_id);
    create table if not exists employee_salary_adjustments (
      id serial primary key,
      payroll_run_id integer not null references payroll_runs(id) on delete restrict,
      payroll_line_id integer not null references payroll_lines(id) on delete restrict,
      staff_id integer not null references staff(id) on delete restrict,
      direction varchar(20) not null,
      adjustment_type varchar(60) not null,
      amount numeric(16,2) not null,
      reason text not null,
      notes text,
      attachment text,
      effective_date date not null,
      include_in varchar(20) not null default 'current',
      status varchar(20) not null default 'applied',
      old_values jsonb not null default '{}'::jsonb,
      new_values jsonb not null default '{}'::jsonb,
      created_by integer references staff(id) on delete set null,
      created_by_name text not null default '',
      created_at timestamp not null default now()
    );
    create index if not exists employee_salary_adjustments_line_idx on employee_salary_adjustments(payroll_line_id,created_at);
    create table if not exists employee_salary_attachments (
      id serial primary key,
      payroll_run_id integer not null references payroll_runs(id) on delete restrict,
      payroll_line_id integer not null references payroll_lines(id) on delete restrict,
      name varchar(240) not null,
      mime_type varchar(120) not null,
      data_url text not null,
      notes text,
      uploaded_by integer references staff(id) on delete set null,
      uploaded_by_name text not null default '',
      created_at timestamp not null default now()
    );
    create index if not exists employee_salary_attachments_line_idx on employee_salary_attachments(payroll_line_id,created_at);
    create table if not exists employee_salary_events (
      id serial primary key,
      payroll_run_id integer not null references payroll_runs(id) on delete restrict,
      payroll_line_id integer not null references payroll_lines(id) on delete restrict,
      staff_id integer not null references staff(id) on delete restrict,
      action varchar(60) not null,
      reason text,
      old_values jsonb not null default '{}'::jsonb,
      new_values jsonb not null default '{}'::jsonb,
      actor_id integer references staff(id) on delete set null,
      actor_name text not null default '',
      ip_address varchar(80),
      device text,
      financial_transaction_id integer references financial_transactions(id) on delete restrict,
      created_at timestamp not null default now()
    );
    create index if not exists employee_salary_events_line_idx on employee_salary_events(payroll_line_id,created_at);
;

-- Migrated from src/server/event-brain.ts:32
CREATE TABLE IF NOT EXISTS ai_event_brain_settings (
      id integer PRIMARY KEY DEFAULT 1,
      alerts_enabled boolean NOT NULL DEFAULT true,
      recommendations_enabled boolean NOT NULL DEFAULT true,
      daily_brief_enabled boolean NOT NULL DEFAULT true,
      executive_summary_enabled boolean NOT NULL DEFAULT true,
      warehouse_analysis_enabled boolean NOT NULL DEFAULT true,
      payroll_analysis_enabled boolean NOT NULL DEFAULT true,
      accounting_analysis_enabled boolean NOT NULL DEFAULT true,
      customer_analysis_enabled boolean NOT NULL DEFAULT true,
      updated_by integer,
      updated_at timestamp NOT NULL DEFAULT now(),
      CHECK (id = 1)
    );
    INSERT INTO ai_event_brain_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
    CREATE TABLE IF NOT EXISTS ai_event_brain_feedback (
      id serial PRIMARY KEY,
      insight_id varchar(160) NOT NULL,
      action varchar(20) NOT NULL,
      note text,
      actor_id integer,
      actor_name text NOT NULL DEFAULT '',
      created_at timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS ai_event_brain_feedback_insight_idx ON ai_event_brain_feedback (insight_id, created_at DESC);
;

-- Migrated from src/server/graduation-enterprise-schema.ts:15
CREATE TABLE IF NOT EXISTS graduation_packages (
          id serial PRIMARY KEY, code varchar(80) NOT NULL, name text NOT NULL,
          description text, preview_image_url text,
          template_id integer REFERENCES graduation_templates(id) ON DELETE SET NULL,
          template_version_id integer REFERENCES graduation_template_versions(id) ON DELETE SET NULL,
          configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
          default_price numeric(14,2) NOT NULL DEFAULT 0,
          default_cost numeric(14,2) NOT NULL DEFAULT 0,
          discount_amount numeric(14,2) NOT NULL DEFAULT 0,
          production_days integer NOT NULL DEFAULT 7,
          is_active boolean NOT NULL DEFAULT true, is_featured boolean NOT NULL DEFAULT false,
          is_archived boolean NOT NULL DEFAULT false, sort_order integer NOT NULL DEFAULT 0,
          created_by integer REFERENCES staff(id) ON DELETE SET NULL,
          created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS graduation_packages_code_idx ON graduation_packages(code);
        CREATE INDEX IF NOT EXISTS graduation_packages_active_idx ON graduation_packages(is_active,is_archived,sort_order);

        CREATE TABLE IF NOT EXISTS graduation_package_items (
          id serial PRIMARY KEY, package_id integer NOT NULL REFERENCES graduation_packages(id) ON DELETE CASCADE,
          item_type varchar(30) NOT NULL, template_id integer REFERENCES graduation_templates(id) ON DELETE SET NULL,
          product_id integer REFERENCES products(id) ON DELETE SET NULL, code varchar(100), name text NOT NULL,
          quantity numeric(12,3) NOT NULL DEFAULT 1, unit_price numeric(14,2) NOT NULL DEFAULT 0,
          unit_cost numeric(14,2) NOT NULL DEFAULT 0, is_required boolean NOT NULL DEFAULT true,
          configuration jsonb NOT NULL DEFAULT '{}'::jsonb, sort_order integer NOT NULL DEFAULT 0,
          created_at timestamp NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS graduation_package_items_package_idx ON graduation_package_items(package_id,sort_order);

        CREATE TABLE IF NOT EXISTS graduation_university_profiles (
          id serial PRIMARY KEY, code varchar(80) NOT NULL, name_ar text NOT NULL, name_en text,
          college text, department text, logo_url text, official_colors jsonb NOT NULL DEFAULT '[]'::jsonb,
          approved_template_ids jsonb NOT NULL DEFAULT '[]'::jsonb, recommended_fonts jsonb NOT NULL DEFAULT '[]'::jsonb,
          rules jsonb NOT NULL DEFAULT '{}'::jsonb, is_active boolean NOT NULL DEFAULT true,
          sort_order integer NOT NULL DEFAULT 0, created_by integer REFERENCES staff(id) ON DELETE SET NULL,
          created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS graduation_university_profiles_code_idx ON graduation_university_profiles(code);
        CREATE INDEX IF NOT EXISTS graduation_university_profiles_name_idx ON graduation_university_profiles(name_ar);

        CREATE TABLE IF NOT EXISTS graduation_color_combinations (
          id serial PRIMARY KEY, code varchar(80) NOT NULL, name text NOT NULL,
          colors jsonb NOT NULL DEFAULT '{}'::jsonb, is_active boolean NOT NULL DEFAULT true,
          is_featured boolean NOT NULL DEFAULT false, sort_order integer NOT NULL DEFAULT 0,
          created_by integer REFERENCES staff(id) ON DELETE SET NULL,
          created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS graduation_color_combinations_code_idx ON graduation_color_combinations(code);
        CREATE INDEX IF NOT EXISTS graduation_color_combinations_active_idx ON graduation_color_combinations(is_active,sort_order);

        CREATE TABLE IF NOT EXISTS graduation_favorites (
          id serial PRIMARY KEY, customer_id integer REFERENCES customers(id) ON DELETE CASCADE,
          session_key varchar(96), favorite_type varchar(30) NOT NULL, reference_id integer,
          configuration jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamp NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS graduation_favorites_owner_reference_idx
          ON graduation_favorites(COALESCE(customer_id,0),COALESCE(session_key,''),favorite_type,COALESCE(reference_id,0));

        CREATE TABLE IF NOT EXISTS graduation_measurements (
          id serial PRIMARY KEY, graduation_order_id integer NOT NULL REFERENCES graduation_orders(id) ON DELETE CASCADE,
          height numeric(7,2), weight numeric(7,2), shoulder numeric(7,2), sleeve_length numeric(7,2),
          chest numeric(7,2), waist numeric(7,2), robe_length numeric(7,2), suggested_size varchar(30),
          confirmed_size varchar(30), notes text, version integer NOT NULL DEFAULT 1,
          measured_by integer REFERENCES staff(id) ON DELETE SET NULL, created_at timestamp NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS graduation_measurements_order_version_idx ON graduation_measurements(graduation_order_id,version);

        CREATE TABLE IF NOT EXISTS graduation_components (
          id serial PRIMARY KEY, graduation_order_id integer NOT NULL REFERENCES graduation_orders(id) ON DELETE CASCADE,
          group_id integer REFERENCES graduation_groups(id) ON DELETE SET NULL, component_code varchar(120) NOT NULL,
          qr_value varchar(160) NOT NULL, barcode_value varchar(160) NOT NULL, component_type varchar(30) NOT NULL,
          template_id integer REFERENCES graduation_templates(id) ON DELETE SET NULL,
          product_id integer REFERENCES products(id) ON DELETE SET NULL, model text, color varchar(80), size varchar(30),
          configuration jsonb NOT NULL DEFAULT '{}'::jsonb, production_status varchar(40) NOT NULL DEFAULT 'pending',
          packaging_status varchar(40) NOT NULL DEFAULT 'pending', is_required boolean NOT NULL DEFAULT true,
          packed_at timestamp, packed_by integer REFERENCES staff(id) ON DELETE SET NULL,
          created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS graduation_components_code_idx ON graduation_components(component_code);
        CREATE UNIQUE INDEX IF NOT EXISTS graduation_components_qr_idx ON graduation_components(qr_value);
        CREATE UNIQUE INDEX IF NOT EXISTS graduation_components_barcode_idx ON graduation_components(barcode_value);
        CREATE INDEX IF NOT EXISTS graduation_components_order_idx ON graduation_components(graduation_order_id);
        CREATE INDEX IF NOT EXISTS graduation_components_status_idx ON graduation_components(production_status,packaging_status);

        CREATE TABLE IF NOT EXISTS graduation_kits (
          id serial PRIMARY KEY, graduation_order_id integer NOT NULL REFERENCES graduation_orders(id) ON DELETE CASCADE,
          group_id integer REFERENCES graduation_groups(id) ON DELETE SET NULL, kit_code varchar(120) NOT NULL,
          qr_value varchar(160) NOT NULL, barcode_value varchar(160) NOT NULL,
          status varchar(40) NOT NULL DEFAULT 'awaiting_packaging', required_checklist jsonb NOT NULL DEFAULT '{}'::jsonb,
          package_image_url text, packaged_by integer REFERENCES staff(id) ON DELETE SET NULL,
          packaged_at timestamp, ready_at timestamp, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS graduation_kits_order_idx ON graduation_kits(graduation_order_id);
        CREATE UNIQUE INDEX IF NOT EXISTS graduation_kits_code_idx ON graduation_kits(kit_code);
        CREATE UNIQUE INDEX IF NOT EXISTS graduation_kits_qr_idx ON graduation_kits(qr_value);
        CREATE UNIQUE INDEX IF NOT EXISTS graduation_kits_barcode_idx ON graduation_kits(barcode_value);
        CREATE INDEX IF NOT EXISTS graduation_kits_status_idx ON graduation_kits(status);

        CREATE TABLE IF NOT EXISTS graduation_kit_items (
          id serial PRIMARY KEY, kit_id integer NOT NULL REFERENCES graduation_kits(id) ON DELETE CASCADE,
          component_id integer NOT NULL REFERENCES graduation_components(id) ON DELETE CASCADE,
          verified boolean NOT NULL DEFAULT false, verified_at timestamp,
          verified_by integer REFERENCES staff(id) ON DELETE SET NULL, created_at timestamp NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS graduation_kit_items_component_idx ON graduation_kit_items(component_id);
        CREATE UNIQUE INDEX IF NOT EXISTS graduation_kit_items_kit_component_idx ON graduation_kit_items(kit_id,component_id);

        CREATE TABLE IF NOT EXISTS graduation_packaging_events (
          id serial PRIMARY KEY, graduation_order_id integer NOT NULL REFERENCES graduation_orders(id) ON DELETE CASCADE,
          kit_id integer REFERENCES graduation_kits(id) ON DELETE SET NULL,
          component_id integer REFERENCES graduation_components(id) ON DELETE SET NULL,
          event_type varchar(40) NOT NULL, scan_value varchar(180), result varchar(30) NOT NULL,
          expected_order_id integer, actual_order_id integer, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          employee_id integer REFERENCES staff(id) ON DELETE SET NULL, employee_name text NOT NULL DEFAULT '',
          created_at timestamp NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS graduation_packaging_events_order_idx ON graduation_packaging_events(graduation_order_id,created_at);
        CREATE INDEX IF NOT EXISTS graduation_packaging_events_result_idx ON graduation_packaging_events(result);

        CREATE TABLE IF NOT EXISTS graduation_material_requirements (
          id serial PRIMARY KEY, graduation_order_id integer NOT NULL REFERENCES graduation_orders(id) ON DELETE CASCADE,
          product_id integer REFERENCES products(id) ON DELETE SET NULL, material_code varchar(100) NOT NULL,
          name text NOT NULL, unit varchar(24) NOT NULL DEFAULT 'piece', required_quantity numeric(14,3) NOT NULL DEFAULT 0,
          reserved_quantity numeric(14,3) NOT NULL DEFAULT 0, consumed_quantity numeric(14,3) NOT NULL DEFAULT 0,
          status varchar(30) NOT NULL DEFAULT 'planned', metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS graduation_material_requirements_order_code_idx ON graduation_material_requirements(graduation_order_id,material_code);
        CREATE INDEX IF NOT EXISTS graduation_material_requirements_status_idx ON graduation_material_requirements(status);

        CREATE TABLE IF NOT EXISTS graduation_inventory_reservations (
          id serial PRIMARY KEY, graduation_order_id integer NOT NULL REFERENCES graduation_orders(id) ON DELETE CASCADE,
          product_id integer NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
          quantity numeric(14,3) NOT NULL DEFAULT 0, status varchar(30) NOT NULL DEFAULT 'reserved',
          idempotency_key varchar(160) NOT NULL, reserved_at timestamp NOT NULL DEFAULT now(), released_at timestamp,
          consumed_at timestamp, created_by integer REFERENCES staff(id) ON DELETE SET NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS graduation_inventory_reservations_key_idx ON graduation_inventory_reservations(idempotency_key);
        CREATE INDEX IF NOT EXISTS graduation_inventory_reservations_order_idx ON graduation_inventory_reservations(graduation_order_id,status);

        CREATE TABLE IF NOT EXISTS graduation_production_sheets (
          id serial PRIMARY KEY, graduation_order_id integer NOT NULL REFERENCES graduation_orders(id) ON DELETE CASCADE,
          sheet_type varchar(40) NOT NULL, version integer NOT NULL DEFAULT 1,
          snapshot jsonb NOT NULL DEFAULT '{}'::jsonb, generated_by integer REFERENCES staff(id) ON DELETE SET NULL,
          created_at timestamp NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS graduation_production_sheets_order_type_version_idx ON graduation_production_sheets(graduation_order_id,sheet_type,version);

        CREATE TABLE IF NOT EXISTS graduation_delivery_sessions (
          id serial PRIMARY KEY, session_code varchar(100) NOT NULL,
          group_id integer REFERENCES graduation_groups(id) ON DELETE SET NULL,
          session_date date NOT NULL, status varchar(30) NOT NULL DEFAULT 'open', delivered_count integer NOT NULL DEFAULT 0,
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_by integer REFERENCES staff(id) ON DELETE SET NULL,
          created_at timestamp NOT NULL DEFAULT now(), closed_at timestamp
        );
        CREATE UNIQUE INDEX IF NOT EXISTS graduation_delivery_sessions_code_idx ON graduation_delivery_sessions(session_code);
        CREATE INDEX IF NOT EXISTS graduation_delivery_sessions_group_idx ON graduation_delivery_sessions(group_id);
;

-- Migrated from src/server/graduation-media-schema.ts:12
CREATE TABLE IF NOT EXISTS gallery_items (
          id serial PRIMARY KEY, media_url text NOT NULL,
          media_type varchar(10) NOT NULL DEFAULT 'image',
          image_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          title text, title_ar text, category varchar(50) NOT NULL DEFAULT 'general',
          created_at timestamp NOT NULL DEFAULT now()
        );
        ALTER TABLE gallery_items ADD COLUMN IF NOT EXISTS description text;
        ALTER TABLE gallery_items ADD COLUMN IF NOT EXISTS thumbnail_url text;
        ALTER TABLE gallery_items ADD COLUMN IF NOT EXISTS scope varchar(40) NOT NULL DEFAULT 'general';
        ALTER TABLE gallery_items ADD COLUMN IF NOT EXISTS display_location varchar(40) NOT NULL DEFAULT 'gallery';
        ALTER TABLE gallery_items ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0;
        ALTER TABLE gallery_items ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
        ALTER TABLE gallery_items ADD COLUMN IF NOT EXISTS is_featured boolean NOT NULL DEFAULT false;
        ALTER TABLE gallery_items ADD COLUMN IF NOT EXISTS customer_visible boolean NOT NULL DEFAULT true;
        ALTER TABLE gallery_items ADD COLUMN IF NOT EXISTS archived_at timestamp;
        ALTER TABLE gallery_items ADD COLUMN IF NOT EXISTS deleted_at timestamp;
        ALTER TABLE gallery_items ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now();
        CREATE INDEX IF NOT EXISTS gallery_items_scope_order_idx ON gallery_items(scope,display_order);
        CREATE INDEX IF NOT EXISTS gallery_items_visibility_idx ON gallery_items(scope,is_active,customer_visible);

        CREATE TABLE IF NOT EXISTS graduation_media_links (
          id serial PRIMARY KEY,
          media_id integer NOT NULL REFERENCES gallery_items(id) ON DELETE RESTRICT,
          target_type varchar(24) NOT NULL,
          template_id integer REFERENCES graduation_templates(id) ON DELETE RESTRICT,
          package_id integer REFERENCES graduation_packages(id) ON DELETE RESTRICT,
          is_primary boolean NOT NULL DEFAULT false,
          sort_order integer NOT NULL DEFAULT 0,
          created_at timestamp NOT NULL DEFAULT now(),
          CHECK ((target_type='template' AND template_id IS NOT NULL AND package_id IS NULL)
            OR (target_type='package' AND package_id IS NOT NULL AND template_id IS NULL))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS graduation_media_links_template_unique_idx
          ON graduation_media_links(media_id,template_id) WHERE template_id IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS graduation_media_links_package_unique_idx
          ON graduation_media_links(media_id,package_id) WHERE package_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS graduation_media_links_media_idx ON graduation_media_links(media_id);
        CREATE INDEX IF NOT EXISTS graduation_media_links_template_idx ON graduation_media_links(template_id,sort_order);
        CREATE INDEX IF NOT EXISTS graduation_media_links_package_idx ON graduation_media_links(package_id,sort_order);
;

-- Migrated from src/server/graduation-schema.ts:13
CREATE TABLE IF NOT EXISTS graduation_templates (
          id serial PRIMARY KEY, code varchar(80) NOT NULL, name text NOT NULL,
          template_type varchar(40) NOT NULL DEFAULT 'package', university text,
          college text, department text, preview_image_url text, model_url text,
          current_version integer NOT NULL DEFAULT 1,
          default_price numeric(14,2) NOT NULL DEFAULT 0,
          configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
          is_active boolean NOT NULL DEFAULT true,
          is_featured boolean NOT NULL DEFAULT false,
          sort_order integer NOT NULL DEFAULT 0,
          created_by integer REFERENCES staff(id) ON DELETE SET NULL,
          created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS graduation_templates_code_idx ON graduation_templates(code);
        CREATE INDEX IF NOT EXISTS graduation_templates_type_idx ON graduation_templates(template_type);
        CREATE INDEX IF NOT EXISTS graduation_templates_active_idx ON graduation_templates(is_active);

        -- Additive product economics/inventory columns (Hybrid model).
        ALTER TABLE graduation_templates ADD COLUMN IF NOT EXISTS cost_price numeric(14,2) NOT NULL DEFAULT 0;
        ALTER TABLE graduation_templates ADD COLUMN IF NOT EXISTS discount_price numeric(14,2);
        ALTER TABLE graduation_templates ADD COLUMN IF NOT EXISTS sku varchar(80);
        ALTER TABLE graduation_templates ADD COLUMN IF NOT EXISTS barcode varchar(120);
        ALTER TABLE graduation_templates ADD COLUMN IF NOT EXISTS track_stock boolean NOT NULL DEFAULT false;
        ALTER TABLE graduation_templates ADD COLUMN IF NOT EXISTS stock integer NOT NULL DEFAULT 0;
        ALTER TABLE graduation_templates ADD COLUMN IF NOT EXISTS min_stock integer NOT NULL DEFAULT 0;
        ALTER TABLE graduation_templates ADD COLUMN IF NOT EXISTS images jsonb NOT NULL DEFAULT '[]'::jsonb;
        ALTER TABLE graduation_templates ADD COLUMN IF NOT EXISTS archived_at timestamp;

        CREATE TABLE IF NOT EXISTS graduation_template_versions (
          id serial PRIMARY KEY,
          template_id integer NOT NULL REFERENCES graduation_templates(id) ON DELETE CASCADE,
          version integer NOT NULL, snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_by integer REFERENCES staff(id) ON DELETE SET NULL,
          created_at timestamp NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS graduation_template_versions_unique_idx ON graduation_template_versions(template_id, version);
        CREATE INDEX IF NOT EXISTS graduation_template_versions_template_idx ON graduation_template_versions(template_id);

        ALTER TABLE graduation_groups ADD COLUMN IF NOT EXISTS group_credit_amount numeric(14,2) NOT NULL DEFAULT 0;
        ALTER TABLE graduation_orders ADD COLUMN IF NOT EXISTS student_code varchar(80);
        ALTER TABLE graduation_orders ADD COLUMN IF NOT EXISTS order_type varchar(20) NOT NULL DEFAULT 'individual';
        ALTER TABLE graduation_orders ADD COLUMN IF NOT EXISTS barcode_value varchar(120);
        ALTER TABLE graduation_orders ADD COLUMN IF NOT EXISTS receipt_no varchar(80);
        ALTER TABLE graduation_orders ADD COLUMN IF NOT EXISTS phone_2 varchar(30);
        ALTER TABLE graduation_orders ADD COLUMN IF NOT EXISTS student_profile jsonb NOT NULL DEFAULT '{}'::jsonb;
        ALTER TABLE graduation_orders ADD COLUMN IF NOT EXISTS garment_details jsonb NOT NULL DEFAULT '{}'::jsonb;
        ALTER TABLE graduation_orders ADD COLUMN IF NOT EXISTS template_version_id integer REFERENCES graduation_template_versions(id) ON DELETE SET NULL;
        ALTER TABLE graduation_orders ADD COLUMN IF NOT EXISTS template_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;
        ALTER TABLE graduation_orders ADD COLUMN IF NOT EXISTS accessories_total numeric(14,2) NOT NULL DEFAULT 0;
        ALTER TABLE graduation_orders ADD COLUMN IF NOT EXISTS extras jsonb NOT NULL DEFAULT '{}'::jsonb;

        UPDATE graduation_orders o
        SET order_type = CASE WHEN o.group_id IS NULL THEN 'individual' ELSE 'group' END,
            student_code = COALESCE(o.student_code,
              CASE WHEN o.group_id IS NULL
                THEN 'AJN-GR-' || EXTRACT(YEAR FROM o.created_at)::int || '-' || LPAD(o.id::text, 6, '0')
                ELSE 'AJN-GR-G' || LPAD(o.group_id::text, 3, '0') || '-' || LPAD(o.id::text, 6, '0') END),
            barcode_value = COALESCE(o.barcode_value, o.student_code,
              CASE WHEN o.group_id IS NULL
                THEN 'AJN-GR-' || EXTRACT(YEAR FROM o.created_at)::int || '-' || LPAD(o.id::text, 6, '0')
                ELSE 'AJN-GR-G' || LPAD(o.group_id::text, 3, '0') || '-' || LPAD(o.id::text, 6, '0') END),
            receipt_no = COALESCE(o.receipt_no, 'AJN-GR-R-' || EXTRACT(YEAR FROM o.created_at)::int || '-' || LPAD(o.id::text, 6, '0'))
        WHERE o.student_code IS NULL OR o.barcode_value IS NULL OR o.receipt_no IS NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS graduation_orders_student_code_idx ON graduation_orders(student_code);
        CREATE UNIQUE INDEX IF NOT EXISTS graduation_orders_receipt_no_idx ON graduation_orders(receipt_no);
        CREATE INDEX IF NOT EXISTS graduation_orders_barcode_idx ON graduation_orders(barcode_value);

        CREATE TABLE IF NOT EXISTS graduation_group_students (
          id serial PRIMARY KEY, group_id integer NOT NULL REFERENCES graduation_groups(id) ON DELETE CASCADE,
          graduation_order_id integer NOT NULL REFERENCES graduation_orders(id) ON DELETE CASCADE,
          customer_id integer REFERENCES customers(id) ON DELETE SET NULL,
          template_version_id integer REFERENCES graduation_template_versions(id) ON DELETE SET NULL,
          student_code varchar(80) NOT NULL, sequence integer NOT NULL,
          is_design_locked boolean NOT NULL DEFAULT false,
          created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS graduation_group_students_order_idx ON graduation_group_students(graduation_order_id);
        CREATE UNIQUE INDEX IF NOT EXISTS graduation_group_students_code_idx ON graduation_group_students(student_code);
        CREATE UNIQUE INDEX IF NOT EXISTS graduation_group_students_sequence_idx ON graduation_group_students(group_id, sequence);
        CREATE INDEX IF NOT EXISTS graduation_group_students_group_idx ON graduation_group_students(group_id);

        INSERT INTO graduation_group_students (group_id, graduation_order_id, customer_id, template_version_id, student_code, sequence)
        SELECT o.group_id, o.id, o.customer_id, o.template_version_id, o.student_code,
               ROW_NUMBER() OVER (PARTITION BY o.group_id ORDER BY o.id)::int
        FROM graduation_orders o
        WHERE o.group_id IS NOT NULL AND o.student_code IS NOT NULL
        ON CONFLICT (graduation_order_id) DO NOTHING;

        CREATE TABLE IF NOT EXISTS graduation_student_payments (
          id serial PRIMARY KEY, payment_batch_id varchar(96) NOT NULL,
          idempotency_key varchar(120) NOT NULL,
          graduation_order_id integer REFERENCES graduation_orders(id) ON DELETE SET NULL,
          group_id integer REFERENCES graduation_groups(id) ON DELETE SET NULL,
          customer_id integer REFERENCES customers(id) ON DELETE SET NULL,
          amount numeric(14,2) NOT NULL DEFAULT 0,
          payment_method varchar(30) NOT NULL DEFAULT 'cash',
          allocation_strategy varchar(40) NOT NULL DEFAULT 'individual',
          receipt_voucher_id integer, financial_transaction_id integer, notes text,
          received_by integer REFERENCES staff(id) ON DELETE SET NULL,
          received_by_name text NOT NULL DEFAULT '', created_at timestamp NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS graduation_student_payments_idempotency_idx ON graduation_student_payments(idempotency_key);
        CREATE INDEX IF NOT EXISTS graduation_student_payments_order_idx ON graduation_student_payments(graduation_order_id);
        CREATE INDEX IF NOT EXISTS graduation_student_payments_group_idx ON graduation_student_payments(group_id);
        CREATE INDEX IF NOT EXISTS graduation_student_payments_batch_idx ON graduation_student_payments(payment_batch_id);

        CREATE TABLE IF NOT EXISTS graduation_receipts (
          id serial PRIMARY KEY, receipt_no varchar(80) NOT NULL,
          receipt_type varchar(30) NOT NULL DEFAULT 'student',
          graduation_order_id integer REFERENCES graduation_orders(id) ON DELETE SET NULL,
          group_id integer REFERENCES graduation_groups(id) ON DELETE SET NULL,
          payment_id integer REFERENCES graduation_student_payments(id) ON DELETE SET NULL,
          snapshot jsonb NOT NULL DEFAULT '{}'::jsonb, reprint_count integer NOT NULL DEFAULT 0,
          issued_by integer REFERENCES staff(id) ON DELETE SET NULL,
          issued_by_name text NOT NULL DEFAULT '', issued_at timestamp NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS graduation_receipts_no_idx ON graduation_receipts(receipt_no);
        CREATE INDEX IF NOT EXISTS graduation_receipts_order_idx ON graduation_receipts(graduation_order_id);
        CREATE INDEX IF NOT EXISTS graduation_receipts_group_idx ON graduation_receipts(group_id);

        INSERT INTO graduation_receipts (receipt_no, receipt_type, graduation_order_id, group_id, snapshot, issued_by_name, issued_at)
        SELECT o.receipt_no, 'student', o.id, o.group_id,
          jsonb_build_object('orderNo', o.order_no, 'studentCode', o.student_code,
            'studentName', o.customer_name, 'phone', o.phone, 'total', o.total_amount,
            'paid', o.paid_amount, 'remaining', o.remaining_amount),
          COALESCE(NULLIF(o.created_by_name, ''), 'النظام'), o.created_at
        FROM graduation_orders o WHERE o.receipt_no IS NOT NULL
        ON CONFLICT (receipt_no) DO NOTHING;

        CREATE TABLE IF NOT EXISTS graduation_previews (
          id serial PRIMARY KEY,
          graduation_order_id integer NOT NULL REFERENCES graduation_orders(id) ON DELETE CASCADE,
          version integer NOT NULL, status varchar(30) NOT NULL DEFAULT 'ready',
          assets jsonb NOT NULL DEFAULT '{}'::jsonb,
          configuration_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
          generated_by integer REFERENCES staff(id) ON DELETE SET NULL,
          created_at timestamp NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS graduation_previews_order_version_idx ON graduation_previews(graduation_order_id, version);
        CREATE INDEX IF NOT EXISTS graduation_previews_order_idx ON graduation_previews(graduation_order_id);

        CREATE TABLE IF NOT EXISTS graduation_approvals (
          id serial PRIMARY KEY,
          graduation_order_id integer NOT NULL REFERENCES graduation_orders(id) ON DELETE CASCADE,
          preview_id integer REFERENCES graduation_previews(id) ON DELETE SET NULL,
          approval_token varchar(96) NOT NULL, status varchar(30) NOT NULL DEFAULT 'pending',
          note text, signature_data_url text, approved_version integer,
          responded_at timestamp, created_at timestamp NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS graduation_approvals_token_idx ON graduation_approvals(approval_token);
        CREATE INDEX IF NOT EXISTS graduation_approvals_order_idx ON graduation_approvals(graduation_order_id);

        CREATE TABLE IF NOT EXISTS graduation_production_events (
          id serial PRIMARY KEY,
          graduation_order_id integer NOT NULL REFERENCES graduation_orders(id) ON DELETE CASCADE,
          stage varchar(40) NOT NULL, previous_stage varchar(40), scan_type varchar(40),
          evidence_url text, notes text, employee_id integer REFERENCES staff(id) ON DELETE SET NULL,
          employee_name text NOT NULL DEFAULT '', created_at timestamp NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS graduation_production_events_order_idx ON graduation_production_events(graduation_order_id);
        CREATE INDEX IF NOT EXISTS graduation_production_events_stage_idx ON graduation_production_events(stage);

        CREATE TABLE IF NOT EXISTS graduation_delivery_events (
          id serial PRIMARY KEY,
          graduation_order_id integer NOT NULL REFERENCES graduation_orders(id) ON DELETE CASCADE,
          group_id integer REFERENCES graduation_groups(id) ON DELETE SET NULL,
          session_code varchar(80), status varchar(30) NOT NULL DEFAULT 'delivered',
          delivered_by integer REFERENCES staff(id) ON DELETE SET NULL,
          delivered_by_name text NOT NULL DEFAULT '', received_by text,
          signature_data_url text, package_image_url text,
          balance_confirmed boolean NOT NULL DEFAULT false,
          verification jsonb NOT NULL DEFAULT '{}'::jsonb, notes text,
          created_at timestamp NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS graduation_delivery_events_order_idx ON graduation_delivery_events(graduation_order_id);
        CREATE INDEX IF NOT EXISTS graduation_delivery_events_group_idx ON graduation_delivery_events(group_id);

        CREATE TABLE IF NOT EXISTS graduation_order_items (
          id serial PRIMARY KEY,
          graduation_order_id integer NOT NULL REFERENCES graduation_orders(id) ON DELETE CASCADE,
          group_id integer REFERENCES graduation_groups(id) ON DELETE SET NULL,
          item_type varchar(30) NOT NULL DEFAULT 'custom',
          template_id integer REFERENCES graduation_templates(id) ON DELETE SET NULL,
          product_id integer REFERENCES products(id) ON DELETE SET NULL,
          product_name text NOT NULL DEFAULT '', product_sku varchar(80),
          variant_label text, size varchar(60), color varchar(80),
          quantity numeric(12,3) NOT NULL DEFAULT 1,
          original_unit_price numeric(14,2) NOT NULL DEFAULT 0,
          final_unit_price numeric(14,2) NOT NULL DEFAULT 0,
          customization_charge numeric(14,2) NOT NULL DEFAULT 0,
          line_total numeric(14,2) NOT NULL DEFAULT 0,
          customization jsonb NOT NULL DEFAULT '{}'::jsonb, image_url text,
          snapshot jsonb NOT NULL DEFAULT '{}'::jsonb, notes text,
          sort_order integer NOT NULL DEFAULT 0, created_at timestamp NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS graduation_order_items_order_idx ON graduation_order_items(graduation_order_id, sort_order);
        CREATE INDEX IF NOT EXISTS graduation_order_items_template_idx ON graduation_order_items(template_id);
;

-- Migrated from src/server/graduation.ts:188
CREATE TABLE IF NOT EXISTS graduation_groups (
        id serial PRIMARY KEY, group_no varchar(50) NOT NULL, join_token varchar(96) NOT NULL,
        title text NOT NULL, representative_name text NOT NULL DEFAULT '', representative_phone varchar(30) NOT NULL DEFAULT '',
        university text, college text, department text, graduation_year varchar(10), event_date date,
        default_configuration jsonb NOT NULL DEFAULT '{}'::jsonb, status varchar(24) NOT NULL DEFAULT 'open',
        expires_at timestamp, created_by integer REFERENCES staff(id) ON DELETE SET NULL,
        created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS graduation_groups_no_idx ON graduation_groups(group_no);
      CREATE UNIQUE INDEX IF NOT EXISTS graduation_groups_token_idx ON graduation_groups(join_token);
      CREATE INDEX IF NOT EXISTS graduation_groups_status_idx ON graduation_groups(status);

      CREATE TABLE IF NOT EXISTS graduation_orders (
        id serial PRIMARY KEY, order_no varchar(50) NOT NULL, qr_token varchar(96) NOT NULL,
        customer_id integer REFERENCES customers(id) ON DELETE SET NULL, group_id integer REFERENCES graduation_groups(id) ON DELETE SET NULL,
        customer_name text NOT NULL, phone varchar(30) NOT NULL, phone_last4 varchar(4), status varchar(30) NOT NULL DEFAULT 'draft',
        measurements jsonb NOT NULL DEFAULT '{}'::jsonb, colors jsonb NOT NULL DEFAULT '{}'::jsonb,
        fabric jsonb NOT NULL DEFAULT '{}'::jsonb, decoration jsonb NOT NULL DEFAULT '{}'::jsonb,
        custom_text jsonb NOT NULL DEFAULT '{}'::jsonb, accessories jsonb NOT NULL DEFAULT '[]'::jsonb,
        university_template jsonb NOT NULL DEFAULT '{}'::jsonb, preview_assets jsonb NOT NULL DEFAULT '{}'::jsonb,
        inventory_items jsonb NOT NULL DEFAULT '[]'::jsonb, pricing jsonb NOT NULL DEFAULT '{}'::jsonb,
        subtotal numeric(14,2) NOT NULL DEFAULT 0, discount_amount numeric(14,2) NOT NULL DEFAULT 0,
        total_amount numeric(14,2) NOT NULL DEFAULT 0, paid_amount numeric(14,2) NOT NULL DEFAULT 0,
        remaining_amount numeric(14,2) NOT NULL DEFAULT 0, payment_method varchar(20) NOT NULL DEFAULT 'cash',
        payment_status varchar(20) NOT NULL DEFAULT 'unpaid', invoice_id integer, financial_transaction_id integer,
        inventory_applied boolean NOT NULL DEFAULT false, production_estimate jsonb NOT NULL DEFAULT '{}'::jsonb,
        quality_checklist jsonb NOT NULL DEFAULT '{}'::jsonb, design_approved_at timestamp,
        assigned_staff_id integer REFERENCES staff(id) ON DELETE SET NULL, delivery jsonb NOT NULL DEFAULT '{}'::jsonb,
        due_date date, notes text, internal_notes text, submitted_at timestamp, ready_at timestamp, delivered_at timestamp,
        archived_at timestamp, created_by integer REFERENCES staff(id) ON DELETE SET NULL, created_by_name text NOT NULL DEFAULT '',
        created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS graduation_orders_no_idx ON graduation_orders(order_no);
      CREATE UNIQUE INDEX IF NOT EXISTS graduation_orders_qr_token_idx ON graduation_orders(qr_token);
      CREATE INDEX IF NOT EXISTS graduation_orders_phone_idx ON graduation_orders(phone);
      CREATE INDEX IF NOT EXISTS graduation_orders_customer_idx ON graduation_orders(customer_id);
      CREATE INDEX IF NOT EXISTS graduation_orders_group_idx ON graduation_orders(group_id);
      CREATE INDEX IF NOT EXISTS graduation_orders_status_idx ON graduation_orders(status);
      CREATE INDEX IF NOT EXISTS graduation_orders_stage_idx ON graduation_orders(production_stage);
      CREATE INDEX IF NOT EXISTS graduation_orders_due_idx ON graduation_orders(due_date);

      CREATE TABLE IF NOT EXISTS graduation_resources (
        id serial PRIMARY KEY, resource_type varchar(30) NOT NULL, code varchar(80) NOT NULL, name text NOT NULL,
        product_id integer REFERENCES products(id) ON DELETE SET NULL, operator_id integer REFERENCES staff(id) ON DELETE SET NULL,
        operator_name text NOT NULL DEFAULT '', status varchar(30) NOT NULL DEFAULT 'available', metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
        usage_count integer NOT NULL DEFAULT 0, maintenance_due_at timestamp, notes text, is_active boolean NOT NULL DEFAULT true,
        created_by integer REFERENCES staff(id) ON DELETE SET NULL, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS graduation_resources_code_idx ON graduation_resources(code);
      CREATE INDEX IF NOT EXISTS graduation_resources_type_idx ON graduation_resources(resource_type);
      CREATE INDEX IF NOT EXISTS graduation_resources_status_idx ON graduation_resources(status);
;

-- Migrated from src/server/hr-intelligence.ts:107
alter table "staff" add column if not exists "department" varchar(60) not null default 'general';
    alter table "staff" add column if not exists "base_salary" numeric(16,2) not null default 0;
    alter table "staff" add column if not exists "hired_at" date not null default current_date;
    create table if not exists employee_salary_settings (id serial primary key, staff_id integer not null unique references staff(id) on delete cascade, employment_type varchar(30) not null default 'full_time', first_payroll_date date, monthly_working_hours numeric(8,2) not null default 0, shift_start time, shift_end time, weekly_days_off jsonb not null default '[]'::jsonb, risk_allowance numeric(16,2) not null default 0, weekend_hour_rate numeric(16,2) not null default 0, holiday_hour_rate numeric(16,2) not null default 0, max_monthly_overtime numeric(8,2) not null default 0, tax_deduction numeric(16,2) not null default 0, insurance_deduction numeric(16,2) not null default 0, retirement_deduction numeric(16,2) not null default 0, late_deduction numeric(16,2) not null default 0, absence_deduction numeric(16,2) not null default 0, other_deduction numeric(16,2) not null default 0, monthly_bonus numeric(16,2) not null default 0, performance_bonus numeric(16,2) not null default 0, commission numeric(16,2) not null default 0, annual_bonus numeric(16,2) not null default 0, other_bonus numeric(16,2) not null default 0, bank_name text, account_number text, iban varchar(64), generate_payroll_automatically boolean not null default false, enable_overtime boolean not null default true, enable_attendance_integration boolean not null default true, enable_advance_deduction boolean not null default true, enable_bonuses boolean not null default true, enable_penalties boolean not null default true, approval_status varchar(20) not null default 'approved', approved_by integer references staff(id) on delete set null, approved_at timestamp, created_at timestamp not null default now(), updated_at timestamp not null default now());
    create table if not exists employee_salary_setting_audits (id serial primary key, staff_id integer not null references staff(id) on delete restrict, actor_id integer references staff(id) on delete set null, actor_name text not null default '', action varchar(40) not null, old_value jsonb not null default '{}'::jsonb, new_value jsonb not null default '{}'::jsonb, ip_address varchar(80), created_at timestamp not null default now());
    create index if not exists employee_salary_setting_audits_staff_created_idx on employee_salary_setting_audits(staff_id, created_at);
    create table if not exists hr_incentive_rules (id serial primary key, code varchar(60) not null unique, name text not null, kind varchar(20) not null default 'bonus', metric varchar(60) not null, operator varchar(10) not null default 'gte', threshold numeric(16,2) not null default 0, amount numeric(16,2) not null default 0, department varchar(60), is_active integer not null default 1, metadata jsonb not null default '{}'::jsonb, created_at timestamp not null default now(), updated_at timestamp not null default now());
    create table if not exists hr_incentive_events (id serial primary key, staff_id integer not null references staff(id) on delete restrict, rule_id integer references hr_incentive_rules(id) on delete set null, period varchar(7) not null, kind varchar(20) not null, amount numeric(16,2) not null default 0, points integer not null default 0, title text not null default '', reason text, status varchar(20) not null default 'pending', payroll_line_id integer, created_by integer references staff(id) on delete set null, created_by_name text not null default 'system', created_at timestamp not null default now());
    alter table hr_incentive_events add column if not exists bonus_type varchar(60) not null default 'manual', add column if not exists bonus_source varchar(60) not null default 'manual', add column if not exists source_type varchar(60), add column if not exists source_id varchar(120), add column if not exists calculation_method varchar(20) not null default 'fixed', add column if not exists quantity numeric(16,2) not null default 1, add column if not exists rate_per_unit numeric(16,2) not null default 0, add column if not exists percentage numeric(8,4) not null default 0, add column if not exists base_amount numeric(16,2) not null default 0, add column if not exists calculation_formula text, add column if not exists related_department varchar(60), add column if not exists notes text, add column if not exists performance_score numeric(6,2), add column if not exists customer_rating numeric(6,2), add column if not exists attachment text, add column if not exists approved_by integer references staff(id) on delete set null, add column if not exists approved_by_name text, add column if not exists approval_date timestamp;
    create index if not exists hr_incentive_events_source_idx on hr_incentive_events(source_type,source_id);
    create unique index if not exists hr_incentive_events_source_period_uq on hr_incentive_events(staff_id,source_type,source_id,period,bonus_type) where source_type is not null and source_id is not null;
    create index if not exists hr_incentive_events_staff_period_idx on hr_incentive_events(staff_id, period);
    create table if not exists payroll_runs (id serial primary key, run_no varchar(40) not null unique, period varchar(7) not null, status varchar(20) not null default 'draft', notes text, total_gross numeric(16,2) not null default 0, total_deductions numeric(16,2) not null default 0, total_net numeric(16,2) not null default 0, created_by integer references staff(id) on delete set null, created_by_name text not null default '', approved_by integer references staff(id) on delete set null, approved_by_name text not null default '', approved_at timestamp, paid_at timestamp, created_at timestamp not null default now(), updated_at timestamp not null default now());
    alter table payroll_runs add column if not exists period_start_date date, add column if not exists period_end_date date, add column if not exists period_type varchar(20) not null default 'monthly', add column if not exists period_key varchar(80), add column if not exists run_kind varchar(20) not null default 'standard', add column if not exists parent_payroll_run_id integer references payroll_runs(id) on delete restrict, add column if not exists supplement_reason text, add column if not exists version_no integer not null default 1, add column if not exists reviewed_at timestamp, add column if not exists reviewed_by integer references staff(id) on delete set null, add column if not exists locked_at timestamp, add column if not exists locked_by integer references staff(id) on delete set null, add column if not exists closed_at timestamp, add column if not exists closed_by integer references staff(id) on delete set null, add column if not exists payment_date date, add column if not exists payment_reference varchar(80), add column if not exists paid_by integer references staff(id) on delete set null, add column if not exists paid_by_name text not null default '', add column if not exists department varchar(60), add column if not exists attendance_warning text, add column if not exists deleted_at timestamp, add column if not exists deleted_by integer references staff(id) on delete set null, add column if not exists delete_reason text, add column if not exists cancelled_at timestamp, add column if not exists cancelled_by integer references staff(id) on delete set null, add column if not exists cancel_reason text, add column if not exists reopened_at timestamp, add column if not exists reopened_by integer references staff(id) on delete set null, add column if not exists reopen_reason text;
    update payroll_runs set period_type=coalesce(nullif(period_type,''),'monthly'), period_key=coalesce(period_key, concat(coalesce(nullif(period_type,''),'monthly'),':',coalesce(period_start_date,(period || '-01')::date)::text,':',coalesce(period_end_date,((period || '-01')::date + interval '1 month - 1 day')::date)::text)) where period_key is null;
    alter table payroll_runs drop constraint if exists payroll_runs_period_key;
    drop index if exists payroll_runs_active_period_uq;
    create unique index if not exists payroll_runs_active_period_key_uq on payroll_runs(period_key) where deleted_at is null;
    create index if not exists payroll_runs_period_type_start_idx on payroll_runs(period_type,period_start_date desc);
    create index if not exists payroll_runs_parent_idx on payroll_runs(parent_payroll_run_id);
    create index if not exists payroll_runs_status_period_idx on payroll_runs(status,period_start_date desc);
    create table if not exists payroll_lines (id serial primary key, payroll_run_id integer not null references payroll_runs(id) on delete restrict, staff_id integer not null references staff(id) on delete restrict, base_salary numeric(16,2) not null default 0, overtime_amount numeric(16,2) not null default 0, bonus_amount numeric(16,2) not null default 0, penalty_amount numeric(16,2) not null default 0, advance_deduction numeric(16,2) not null default 0, insurance_amount numeric(16,2) not null default 0, gross_salary numeric(16,2) not null default 0, net_salary numeric(16,2) not null default 0, financial_transaction_id integer, signature_name text, signed_at timestamp, created_at timestamp not null default now());
    alter table payroll_lines add column if not exists salary_type varchar(20) not null default 'monthly', add column if not exists payment_method varchar(30) not null default 'cash', add column if not exists scheduled_working_days integer not null default 0, add column if not exists attendance_days integer not null default 0, add column if not exists absence_days integer not null default 0, add column if not exists paid_leave_days integer not null default 0, add column if not exists unpaid_leave_days integer not null default 0, add column if not exists late_arrivals integer not null default 0, add column if not exists total_late_minutes integer not null default 0, add column if not exists early_leave_count integer not null default 0, add column if not exists total_working_hours numeric(16,2) not null default 0, add column if not exists overtime_hours numeric(16,2) not null default 0, add column if not exists missing_check_in integer not null default 0, add column if not exists missing_check_out integer not null default 0, add column if not exists attendance_allowance numeric(16,2) not null default 0, add column if not exists transportation_allowance numeric(16,2) not null default 0, add column if not exists food_allowance numeric(16,2) not null default 0, add column if not exists phone_allowance numeric(16,2) not null default 0, add column if not exists housing_allowance numeric(16,2) not null default 0, add column if not exists other_fixed_allowances numeric(16,2) not null default 0, add column if not exists absence_deduction numeric(16,2) not null default 0, add column if not exists late_deduction numeric(16,2) not null default 0, add column if not exists early_leave_deduction numeric(16,2) not null default 0, add column if not exists unpaid_leave_deduction numeric(16,2) not null default 0, add column if not exists fixed_deduction numeric(16,2) not null default 0, add column if not exists manual_earnings numeric(16,2) not null default 0, add column if not exists commission_amount numeric(16,2) not null default 0, add column if not exists attendance_deduction numeric(16,2) not null default 0, add column if not exists manual_deduction numeric(16,2) not null default 0, add column if not exists other_deductions numeric(16,2) not null default 0, add column if not exists line_notes text, add column if not exists amount_paid numeric(16,2) not null default 0, add column if not exists payment_status varchar(20) not null default 'unpaid', add column if not exists calculation_details jsonb not null default '{}'::jsonb;
    create index if not exists payroll_lines_run_staff_idx on payroll_lines(payroll_run_id,staff_id);
    create unique index if not exists payroll_lines_run_staff_unique_idx on payroll_lines(payroll_run_id,staff_id);
    create table if not exists employee_targets (id serial primary key, staff_id integer references staff(id) on delete cascade, department varchar(60), period varchar(7) not null, metric varchar(60) not null, target numeric(16,2) not null, completed numeric(16,2) not null default 0, reward_amount numeric(16,2) not null default 0, status varchar(20) not null default 'active', created_by integer references staff(id) on delete set null, created_at timestamp not null default now(), updated_at timestamp not null default now());
    create table if not exists employee_evaluations (id serial primary key, staff_id integer not null references staff(id) on delete restrict, evaluator_id integer references staff(id) on delete set null, evaluator_name text not null default '', period varchar(7) not null, discipline integer not null default 0, communication integer not null default 0, leadership integer not null default 0, quality integer not null default 0, responsibility integer not null default 0, speed integer not null default 0, innovation integer not null default 0, comments text, created_at timestamp not null default now());
    create table if not exists employee_career_history (id serial primary key, staff_id integer not null references staff(id) on delete restrict, title varchar(100) not null, level varchar(60) not null default 'worker', effective_date date not null, notes text, created_by integer references staff(id) on delete set null, created_at timestamp not null default now());
    create table if not exists customer_employee_ratings (id serial primary key, token varchar(80) not null unique, staff_id integer references staff(id) on delete set null, source_type varchar(40) not null, source_id integer not null, quality integer, speed integer, behavior integer, professionalism integer, overall integer, message text, submitted_at timestamp, created_at timestamp not null default now());
;

-- Migrated from src/server/installments.ts:34
CREATE TABLE IF NOT EXISTS installment_contracts (id serial PRIMARY KEY, contract_no varchar(48) NOT NULL UNIQUE, public_token varchar(96) NOT NULL UNIQUE, source_type varchar(50) NOT NULL DEFAULT 'sales_invoice', source_id integer NOT NULL, sales_invoice_id integer REFERENCES sales_invoices(id) ON DELETE RESTRICT, customer_id integer REFERENCES customers(id) ON DELETE SET NULL, customer_name text NOT NULL DEFAULT '', customer_phone varchar(30), department varchar(50) NOT NULL DEFAULT 'general', original_total numeric(14,2) NOT NULL DEFAULT 0, paid_before_conversion numeric(14,2) NOT NULL DEFAULT 0, balance_at_conversion numeric(14,2) NOT NULL DEFAULT 0, down_payment_amount numeric(14,2) NOT NULL DEFAULT 0, financed_amount numeric(14,2) NOT NULL DEFAULT 0, scheduled_paid_amount numeric(14,2) NOT NULL DEFAULT 0, collected_amount numeric(14,2) NOT NULL DEFAULT 0, remaining_amount numeric(14,2) NOT NULL DEFAULT 0, installment_count integer NOT NULL DEFAULT 1, frequency varchar(24) NOT NULL DEFAULT 'monthly', installment_type varchar(24) NOT NULL DEFAULT 'fixed', first_due_date date, last_due_date date, grace_days integer NOT NULL DEFAULT 0, reminder_settings jsonb NOT NULL DEFAULT '{}'::jsonb, status varchar(24) NOT NULL DEFAULT 'active', internal_notes text, customer_notes text, created_by integer REFERENCES staff(id) ON DELETE SET NULL, created_by_name text NOT NULL DEFAULT '', created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now(), cancelled_at timestamp, cancelled_reason text);
    CREATE UNIQUE INDEX IF NOT EXISTS installment_contracts_active_source_idx ON installment_contracts(source_type, source_id) WHERE status IN ('draft','active','paused','overdue');
    CREATE TABLE IF NOT EXISTS installment_schedule (id serial PRIMARY KEY, contract_id integer NOT NULL REFERENCES installment_contracts(id) ON DELETE RESTRICT, installment_no integer NOT NULL, due_date date NOT NULL, original_amount numeric(14,2) NOT NULL, paid_amount numeric(14,2) NOT NULL DEFAULT 0, remaining_amount numeric(14,2) NOT NULL, status varchar(24) NOT NULL DEFAULT 'upcoming', days_overdue integer NOT NULL DEFAULT 0, payment_method varchar(30), receipt_number varchar(100), receipt_image text, notes text, last_reminder_at timestamp, paid_at timestamp, is_cancelled boolean NOT NULL DEFAULT false, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now(), UNIQUE(contract_id, installment_no));
    CREATE TABLE IF NOT EXISTS installment_payments (id serial PRIMARY KEY, payment_no varchar(48) NOT NULL UNIQUE, idempotency_key varchar(120) NOT NULL UNIQUE, contract_id integer NOT NULL REFERENCES installment_contracts(id) ON DELETE RESTRICT, amount numeric(14,2) NOT NULL, payment_method varchar(30) NOT NULL, receipt_number varchar(100), receipt_image text, paid_at timestamp NOT NULL DEFAULT now(), notes text, status varchar(20) NOT NULL DEFAULT 'posted', financial_transaction_id integer REFERENCES financial_transactions(id) ON DELETE SET NULL, received_by integer REFERENCES staff(id) ON DELETE SET NULL, received_by_name text NOT NULL DEFAULT '', reversed_at timestamp, reversal_reason text, created_at timestamp NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS installment_payment_allocations (id serial PRIMARY KEY, payment_id integer NOT NULL REFERENCES installment_payments(id) ON DELETE RESTRICT, installment_id integer NOT NULL REFERENCES installment_schedule(id) ON DELETE RESTRICT, amount numeric(14,2) NOT NULL, created_at timestamp NOT NULL DEFAULT now(), UNIQUE(payment_id, installment_id));
    CREATE TABLE IF NOT EXISTS installment_history (id serial PRIMARY KEY, contract_id integer NOT NULL REFERENCES installment_contracts(id) ON DELETE RESTRICT, installment_id integer REFERENCES installment_schedule(id) ON DELETE SET NULL, action varchar(50) NOT NULL, old_value jsonb NOT NULL DEFAULT '{}'::jsonb, new_value jsonb NOT NULL DEFAULT '{}'::jsonb, reason text, actor_id integer REFERENCES staff(id) ON DELETE SET NULL, actor_name text NOT NULL DEFAULT '', created_at timestamp NOT NULL DEFAULT now());
;

-- Migrated from src/server/master-cash-box.ts:123
CREATE TABLE IF NOT EXISTS "master_cash_box" (
        "id" serial PRIMARY KEY,
        "code" varchar(30) NOT NULL DEFAULT 'MASTER',
        "name" text NOT NULL DEFAULT 'الصندوق الرئيسي',
        "opening_balance" numeric(16,2) NOT NULL DEFAULT 0,
        "current_balance" numeric(16,2) NOT NULL DEFAULT 0,
        "total_revenue" numeric(16,2) NOT NULL DEFAULT 0,
        "total_expenses" numeric(16,2) NOT NULL DEFAULT 0,
        "net_profit" numeric(16,2) NOT NULL DEFAULT 0,
        "available_balance" numeric(16,2) NOT NULL DEFAULT 0,
        "version" integer NOT NULL DEFAULT 0,
        "updated_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
        "updated_by_name" text NOT NULL DEFAULT '',
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "master_cash_box_code_idx" ON "master_cash_box" ("code");

      CREATE TABLE IF NOT EXISTS "financial_accounts" (
        "id" serial PRIMARY KEY,
        "code" varchar(30) NOT NULL,
        "name_ar" text NOT NULL,
        "account_type" varchar(20) NOT NULL,
        "department" varchar(40),
        "is_system" boolean NOT NULL DEFAULT true,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "financial_accounts_code_idx" ON "financial_accounts" ("code");

      CREATE TABLE IF NOT EXISTS "financial_transactions" (
        "id" serial PRIMARY KEY,
        "transaction_no" varchar(50) NOT NULL,
        "transaction_date" date NOT NULL,
        "transaction_time" timestamp NOT NULL DEFAULT now(),
        "direction" varchar(20) NOT NULL,
        "amount" numeric(16,2) NOT NULL,
        "department" varchar(40) NOT NULL DEFAULT 'general',
        "transaction_type" varchar(60) NOT NULL,
        "reference_no" varchar(120),
        "description" text NOT NULL DEFAULT '',
        "payment_method" varchar(20) NOT NULL DEFAULT 'cash',
        "source_type" varchar(60),
        "source_id" varchar(80),
        "source_event" varchar(60) NOT NULL DEFAULT 'primary',
        "idempotency_key" varchar(180) NOT NULL,
        "approval_status" varchar(20) NOT NULL DEFAULT 'draft',
        "requested_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
        "requested_by_name" text NOT NULL DEFAULT '',
        "submitted_at" timestamp,
        "approved_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
        "approved_by_name" text NOT NULL DEFAULT '',
        "approved_at" timestamp,
        "rejected_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
        "rejected_by_name" text NOT NULL DEFAULT '',
        "rejected_at" timestamp,
        "rejection_reason" text,
        "executed_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
        "executed_by_name" text NOT NULL DEFAULT '',
        "executed_at" timestamp,
        "balance_before" numeric(16,2),
        "balance_after" numeric(16,2),
        "customer_id" integer REFERENCES "customers"("id") ON DELETE SET NULL,
        "customer_name" text,
        "customer_phone" varchar(30),
        "due_date" date,
        "inventory_item_id" integer REFERENCES "products"("id") ON DELETE SET NULL,
        "responsible_user_id" integer REFERENCES "staff"("id") ON DELETE SET NULL,
        "responsible_user_name" text,
        "notes" text,
        "attachments" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "financial_transactions_no_idx" ON "financial_transactions" ("transaction_no");
      CREATE UNIQUE INDEX IF NOT EXISTS "financial_transactions_idempotency_idx" ON "financial_transactions" ("idempotency_key");
      CREATE INDEX IF NOT EXISTS "financial_transactions_date_idx" ON "financial_transactions" ("transaction_date");
      CREATE INDEX IF NOT EXISTS "financial_transactions_status_idx" ON "financial_transactions" ("approval_status");
      CREATE INDEX IF NOT EXISTS "financial_transactions_department_idx" ON "financial_transactions" ("department");
      CREATE INDEX IF NOT EXISTS "financial_transactions_direction_idx" ON "financial_transactions" ("direction");
      CREATE INDEX IF NOT EXISTS "financial_transactions_source_idx" ON "financial_transactions" ("source_type", "source_id");
      CREATE INDEX IF NOT EXISTS "financial_transactions_customer_idx" ON "financial_transactions" ("customer_id");
      CREATE INDEX IF NOT EXISTS "financial_transactions_due_date_idx" ON "financial_transactions" ("due_date");

      CREATE TABLE IF NOT EXISTS "financial_ledger_entries" (
        "id" serial PRIMARY KEY,
        "transaction_id" integer NOT NULL REFERENCES "financial_transactions"("id") ON DELETE RESTRICT,
        "account_id" integer NOT NULL REFERENCES "financial_accounts"("id") ON DELETE RESTRICT,
        "entry_side" varchar(10) NOT NULL,
        "amount" numeric(16,2) NOT NULL,
        "description" text NOT NULL DEFAULT '',
        "created_at" timestamp NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS "financial_ledger_entries_transaction_idx" ON "financial_ledger_entries" ("transaction_id");
      CREATE INDEX IF NOT EXISTS "financial_ledger_entries_account_idx" ON "financial_ledger_entries" ("account_id");
      CREATE UNIQUE INDEX IF NOT EXISTS "financial_ledger_entries_unique_idx" ON "financial_ledger_entries" ("transaction_id", "account_id", "entry_side");

      CREATE TABLE IF NOT EXISTS "financial_audit_logs" (
        "id" serial PRIMARY KEY,
        "transaction_id" integer REFERENCES "financial_transactions"("id") ON DELETE RESTRICT,
        "action" varchar(60) NOT NULL,
        "actor_id" integer REFERENCES "staff"("id") ON DELETE SET NULL,
        "actor_name" text NOT NULL DEFAULT '',
        "old_values" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "new_values" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "reason" text,
        "created_at" timestamp NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS "financial_audit_logs_transaction_idx" ON "financial_audit_logs" ("transaction_id");
      CREATE INDEX IF NOT EXISTS "financial_audit_logs_actor_idx" ON "financial_audit_logs" ("actor_id");
      CREATE INDEX IF NOT EXISTS "financial_audit_logs_created_at_idx" ON "financial_audit_logs" ("created_at");

      INSERT INTO "master_cash_box" ("code", "name") VALUES ('MASTER', 'الصندوق الرئيسي')
      ON CONFLICT ("code") DO NOTHING;

      ALTER TABLE IF EXISTS "expenses" ADD COLUMN IF NOT EXISTS "approval_status" varchar(20) NOT NULL DEFAULT 'executed';
      ALTER TABLE IF EXISTS "expenses" ADD COLUMN IF NOT EXISTS "financial_transaction_id" integer;
      ALTER TABLE IF EXISTS "receipt_vouchers" ADD COLUMN IF NOT EXISTS "approval_status" varchar(20) NOT NULL DEFAULT 'executed';
      ALTER TABLE IF EXISTS "receipt_vouchers" ADD COLUMN IF NOT EXISTS "financial_transaction_id" integer;
      ALTER TABLE IF EXISTS "receipt_voucher_allocations" ADD COLUMN IF NOT EXISTS "reversed_amount" numeric(14,2) NOT NULL DEFAULT 0;
      ALTER TABLE IF EXISTS "payment_vouchers" ADD COLUMN IF NOT EXISTS "approval_status" varchar(20) NOT NULL DEFAULT 'executed';
      ALTER TABLE IF EXISTS "payment_vouchers" ADD COLUMN IF NOT EXISTS "financial_transaction_id" integer;
      ALTER TABLE IF EXISTS "orders" ADD COLUMN IF NOT EXISTS "due_date" date;
      ALTER TABLE IF EXISTS "service_orders" ADD COLUMN IF NOT EXISTS "due_date" date;
      ALTER TABLE IF EXISTS "sales_invoices" ADD COLUMN IF NOT EXISTS "due_date" date;
      ALTER TABLE IF EXISTS "kosha_bookings" ADD COLUMN IF NOT EXISTS "total_amount" numeric(14,2) NOT NULL DEFAULT 0;
      ALTER TABLE IF EXISTS "kosha_bookings" ADD COLUMN IF NOT EXISTS "paid_amount" numeric(14,2) NOT NULL DEFAULT 0;
      ALTER TABLE IF EXISTS "kosha_bookings" ADD COLUMN IF NOT EXISTS "remaining_amount" numeric(14,2) NOT NULL DEFAULT 0;
      ALTER TABLE IF EXISTS "kosha_bookings" ADD COLUMN IF NOT EXISTS "payment_status" varchar(20) NOT NULL DEFAULT 'unpaid';
      ALTER TABLE IF EXISTS "kosha_bookings" ADD COLUMN IF NOT EXISTS "due_date" date;

      CREATE OR REPLACE FUNCTION ajn_prevent_financial_delete() RETURNS trigger AS $immutable$
      BEGIN
        RAISE EXCEPTION 'Financial records are immutable and cannot be deleted';
      END;
      $immutable$ LANGUAGE plpgsql;

      DO $triggers$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'financial_transactions_no_delete') THEN
          CREATE TRIGGER financial_transactions_no_delete BEFORE DELETE ON financial_transactions
          FOR EACH ROW EXECUTE FUNCTION ajn_prevent_financial_delete();
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'financial_ledger_entries_no_delete') THEN
          CREATE TRIGGER financial_ledger_entries_no_delete BEFORE DELETE ON financial_ledger_entries
          FOR EACH ROW EXECUTE FUNCTION ajn_prevent_financial_delete();
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'financial_audit_logs_no_delete') THEN
          CREATE TRIGGER financial_audit_logs_no_delete BEFORE DELETE ON financial_audit_logs
          FOR EACH ROW EXECUTE FUNCTION ajn_prevent_financial_delete();
        END IF;
      END $triggers$;
;

-- Migrated from src/server/master-cash-box.ts:280
ALTER TABLE "financial_transactions" ADD COLUMN IF NOT EXISTS "reversed_transaction_id" integer;
        ALTER TABLE "financial_transactions" ADD COLUMN IF NOT EXISTS "reference_no" varchar(120);
        CREATE INDEX IF NOT EXISTS "financial_transactions_reference_no_idx" ON "financial_transactions" ("reference_no");
        ALTER TABLE "financial_transactions" ADD COLUMN IF NOT EXISTS "reversal_txn_id" integer;
        ALTER TABLE "financial_transactions" ADD COLUMN IF NOT EXISTS "reversal_reason" text;
        ALTER TABLE "financial_transactions" ADD COLUMN IF NOT EXISTS "reversed_by" integer;
        ALTER TABLE "financial_transactions" ADD COLUMN IF NOT EXISTS "reversed_by_name" text;
        ALTER TABLE "financial_transactions" ADD COLUMN IF NOT EXISTS "reversed_at" timestamp;
        ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "financially_reversed" boolean NOT NULL DEFAULT false;
        ALTER TABLE "service_orders" ADD COLUMN IF NOT EXISTS "financially_reversed" boolean NOT NULL DEFAULT false;
        ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "financially_reversed" boolean NOT NULL DEFAULT false;
;

-- Migrated from src/server/photography-approval.ts:63
CREATE TABLE IF NOT EXISTS photography_shoot_approvals (
        id serial PRIMARY KEY,
        shoot_id integer NOT NULL UNIQUE REFERENCES photography_shoots(id) ON DELETE CASCADE,
        status varchar(30) NOT NULL DEFAULT 'draft',
        locked boolean NOT NULL DEFAULT false,
        manager_note text,
        last_edited_by integer, last_edited_by_name text NOT NULL DEFAULT '', last_edited_at timestamp,
        submitted_by integer, submitted_at timestamp,
        approved_by integer, approved_by_name text NOT NULL DEFAULT '', approved_at timestamp,
        returned_by integer, returned_at timestamp,
        created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS photography_work_versions (
        id serial PRIMARY KEY,
        shoot_id integer NOT NULL REFERENCES photography_shoots(id) ON DELETE CASCADE,
        version integer NOT NULL,
        change_type varchar(30) NOT NULL DEFAULT 'edit',
        snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
        edited_by integer, edited_by_name text NOT NULL DEFAULT '', note text,
        created_at timestamp NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS photography_work_versions_shoot_idx ON photography_work_versions(shoot_id, version DESC);
;

-- Migrated from src/server/remote-printing.ts:41
create table if not exists print_agents (
        id serial primary key, agent_id varchar(64) not null, name text not null,
        registration_token_hash varchar(128), token_hash varchar(128),
        branch_id integer references enterprise_branches(id) on delete set null,
        status varchar(20) not null default 'pending', hostname varchar(255), app_version varchar(40),
        detected_printers jsonb not null default '[]'::jsonb, last_seen_at timestamp,
        credential_rotated_at timestamp, disabled_at timestamp, created_by integer references staff(id) on delete set null,
        created_at timestamp not null default now(), updated_at timestamp not null default now()
      )
;

-- Migrated from src/server/remote-printing.ts:50
create unique index if not exists print_agents_agent_id_unique_idx on print_agents(agent_id)
;

-- Migrated from src/server/remote-printing.ts:51
create unique index if not exists print_agents_token_hash_unique_idx on print_agents(token_hash) where token_hash is not null
;

-- Migrated from src/server/remote-printing.ts:52
create table if not exists printers (
        id serial primary key, agent_id integer not null references print_agents(id) on delete cascade,
        branch_id integer references enterprise_branches(id) on delete set null, name varchar(255) not null,
        display_name varchar(255), driver_type varchar(20) not null default 'windows', paper_size varchar(10) not null default '80mm',
        default_copies integer not null default 1, auto_print_enabled boolean not null default true,
        allowed_document_types jsonb not null default '["sales_invoice"]'::jsonb, is_default boolean not null default false,
        horizontal_offset_mm numeric(3,1) not null default 0, vertical_offset_mm numeric(3,1) not null default 0,
        is_active boolean not null default true, created_at timestamp not null default now(), updated_at timestamp not null default now(),
        constraint printers_agent_name_unique unique(agent_id, name)
      )
;

-- Migrated from src/server/remote-printing.ts:62
alter table printers add column if not exists horizontal_offset_mm numeric(3,1) not null default 0
;

-- Migrated from src/server/remote-printing.ts:63
alter table printers add column if not exists vertical_offset_mm numeric(3,1) not null default 0
;

-- Migrated from src/server/remote-printing.ts:64
create table if not exists print_jobs (
        id serial primary key, job_no varchar(64) not null unique, document_type varchar(40) not null, document_id integer not null,
        invoice_id integer references sales_invoices(id) on delete restrict, printer_id integer references printers(id) on delete set null,
        branch_id integer references enterprise_branches(id) on delete set null, computer_agent_id integer references print_agents(id) on delete set null,
        paper_size varchar(10) not null default '80mm', copies integer not null default 1, payload jsonb not null default '{}'::jsonb,
        status varchar(20) not null default 'queued', idempotency_key varchar(140) not null unique,
        requested_by integer references staff(id) on delete set null, requested_by_name text not null default '', requested_at timestamp not null default now(),
        claimed_at timestamp, started_at timestamp, completed_at timestamp, failed_at timestamp, cancelled_at timestamp, error_message text,
        retry_count integer not null default 0, next_attempt_at timestamp, original_print_job_id integer references print_jobs(id) on delete restrict,
        reprint_reason text, created_at timestamp not null default now(), updated_at timestamp not null default now()
      )
;

-- Migrated from src/server/remote-printing.ts:75
create index if not exists print_jobs_queue_idx on print_jobs(computer_agent_id, status, next_attempt_at, requested_at)
;

-- Migrated from src/server/remote-printing.ts:76
create index if not exists print_jobs_invoice_idx on print_jobs(invoice_id, created_at)
;

-- Migrated from src/server/representative.ts:38
CREATE TABLE IF NOT EXISTS representative_group_assignments (
      id serial PRIMARY KEY, staff_id integer NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
      group_id integer NOT NULL REFERENCES graduation_groups(id) ON DELETE CASCADE,
      is_active boolean NOT NULL DEFAULT true, created_at timestamp NOT NULL DEFAULT now(),
      UNIQUE(staff_id, group_id)
    );
    CREATE TABLE IF NOT EXISTS representative_payment_requests (
      id serial PRIMARY KEY, group_id integer NOT NULL REFERENCES graduation_groups(id) ON DELETE RESTRICT,
      graduation_order_id integer NOT NULL REFERENCES graduation_orders(id) ON DELETE RESTRICT,
      amount numeric(14,2) NOT NULL, payment_method varchar(30) NOT NULL, receipt_number varchar(100),
      receipt_image text, occurred_at timestamp NOT NULL DEFAULT now(), notes text, status varchar(20) NOT NULL DEFAULT 'pending',
      representative_id integer NOT NULL REFERENCES staff(id) ON DELETE RESTRICT, representative_name text NOT NULL DEFAULT '',
      approved_by integer REFERENCES staff(id) ON DELETE SET NULL, approved_at timestamp, rejection_note text,
      posted_payment_id integer REFERENCES graduation_student_payments(id) ON DELETE SET NULL, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS representative_payment_requests_group_idx ON representative_payment_requests(group_id, status);
    CREATE TABLE IF NOT EXISTS representative_custody_handovers (
      id serial PRIMARY KEY, representative_id integer NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
      amount numeric(14,2) NOT NULL, receipt_image text, notes text, status varchar(20) NOT NULL DEFAULT 'pending',
      confirmed_by integer REFERENCES staff(id) ON DELETE SET NULL, confirmed_at timestamp, created_at timestamp NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS representative_issues (
      id serial PRIMARY KEY, group_id integer NOT NULL REFERENCES graduation_groups(id) ON DELETE CASCADE,
      graduation_order_id integer NOT NULL REFERENCES graduation_orders(id) ON DELETE CASCADE,
      type varchar(40) NOT NULL, priority varchar(20) NOT NULL DEFAULT 'medium', status varchar(20) NOT NULL DEFAULT 'open',
      notes text NOT NULL, photos jsonb NOT NULL DEFAULT '[]'::jsonb, reporter_id integer NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
      assigned_to integer REFERENCES staff(id) ON DELETE SET NULL, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
    );
;

-- Migrated from src/server/research-center-schema.ts:9
CREATE TABLE IF NOT EXISTS research_universities (id serial PRIMARY KEY,code varchar(80) NOT NULL,name_ar text NOT NULL,name_en text,country text,city text,logo_url text,colleges jsonb NOT NULL DEFAULT '[]'::jsonb,citation_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,is_active boolean NOT NULL DEFAULT true,created_by integer REFERENCES staff(id) ON DELETE SET NULL,created_at timestamp NOT NULL DEFAULT now(),updated_at timestamp NOT NULL DEFAULT now());
      CREATE UNIQUE INDEX IF NOT EXISTS research_universities_code_idx ON research_universities(code);
      CREATE TABLE IF NOT EXISTS research_orders (id serial PRIMARY KEY,research_no varchar(50) NOT NULL,qr_token varchar(96) NOT NULL,customer_id integer NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,invoice_id integer REFERENCES sales_invoices(id) ON DELETE SET NULL,title text NOT NULL,research_type varchar(30) NOT NULL,university_id integer REFERENCES research_universities(id) ON DELETE SET NULL,university_name text NOT NULL DEFAULT '',college text NOT NULL DEFAULT '',department text NOT NULL DEFAULT '',supervisor_name text,language varchar(20) NOT NULL DEFAULT 'ar',research_field text NOT NULL DEFAULT '',keywords jsonb NOT NULL DEFAULT '[]'::jsonb,required_pages integer NOT NULL DEFAULT 1,deadline date,citation_style varchar(20) NOT NULL DEFAULT 'APA7',urgency varchar(20) NOT NULL DEFAULT 'normal',notes text,status varchar(30) NOT NULL DEFAULT 'new',progress integer NOT NULL DEFAULT 0,assigned_writer_id integer REFERENCES staff(id) ON DELETE SET NULL,assigned_reviewer_id integer REFERENCES staff(id) ON DELETE SET NULL,assigned_proofreader_id integer REFERENCES staff(id) ON DELETE SET NULL,assigned_formatter_id integer REFERENCES staff(id) ON DELETE SET NULL,assigned_supervisor_id integer REFERENCES staff(id) ON DELETE SET NULL,estimated_price numeric(14,2) NOT NULL DEFAULT 0,discount_amount numeric(14,2) NOT NULL DEFAULT 0,total_amount numeric(14,2) NOT NULL DEFAULT 0,paid_amount numeric(14,2) NOT NULL DEFAULT 0,remaining_amount numeric(14,2) NOT NULL DEFAULT 0,payment_status varchar(20) NOT NULL DEFAULT 'unpaid',source_count integer NOT NULL DEFAULT 0,chapter_count integer NOT NULL DEFAULT 0,submitted_at timestamp NOT NULL DEFAULT now(),accepted_at timestamp,completed_at timestamp,delivered_at timestamp,archived_at timestamp,created_by integer REFERENCES staff(id) ON DELETE SET NULL,created_by_name text NOT NULL DEFAULT '',created_at timestamp NOT NULL DEFAULT now(),updated_at timestamp NOT NULL DEFAULT now());
      CREATE UNIQUE INDEX IF NOT EXISTS research_orders_no_idx ON research_orders(research_no); CREATE UNIQUE INDEX IF NOT EXISTS research_orders_qr_idx ON research_orders(qr_token); CREATE INDEX IF NOT EXISTS research_orders_status_idx ON research_orders(status,deadline); CREATE INDEX IF NOT EXISTS research_orders_customer_idx ON research_orders(customer_id,created_at);
      CREATE TABLE IF NOT EXISTS research_chapters (id serial PRIMARY KEY,research_order_id integer NOT NULL REFERENCES research_orders(id) ON DELETE CASCADE,chapter_type varchar(40) NOT NULL,title text NOT NULL,sort_order integer NOT NULL DEFAULT 0,status varchar(30) NOT NULL DEFAULT 'not_started',progress integer NOT NULL DEFAULT 0,assigned_writer_id integer REFERENCES staff(id) ON DELETE SET NULL,deadline date,content text,word_count integer NOT NULL DEFAULT 0,current_version integer NOT NULL DEFAULT 1,approval_status varchar(30) NOT NULL DEFAULT 'pending',approved_at timestamp,created_at timestamp NOT NULL DEFAULT now(),updated_at timestamp NOT NULL DEFAULT now()); CREATE UNIQUE INDEX IF NOT EXISTS research_chapters_order_type_idx ON research_chapters(research_order_id,chapter_type);
      CREATE TABLE IF NOT EXISTS research_chapter_versions (id serial PRIMARY KEY,chapter_id integer NOT NULL REFERENCES research_chapters(id) ON DELETE CASCADE,version integer NOT NULL,content text NOT NULL DEFAULT '',word_count integer NOT NULL DEFAULT 0,change_note text,created_by integer REFERENCES staff(id) ON DELETE SET NULL,created_by_name text NOT NULL DEFAULT '',created_at timestamp NOT NULL DEFAULT now()); CREATE UNIQUE INDEX IF NOT EXISTS research_chapter_versions_unique_idx ON research_chapter_versions(chapter_id,version);
      CREATE TABLE IF NOT EXISTS research_sources (id serial PRIMARY KEY,provider varchar(30) NOT NULL,external_id varchar(240) NOT NULL,title text NOT NULL,authors jsonb NOT NULL DEFAULT '[]'::jsonb,journal text,publication_year integer,abstract text,doi varchar(240),language varchar(20),category text,url text,pdf_url text,is_open_access boolean NOT NULL DEFAULT false,metadata jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamp NOT NULL DEFAULT now(),updated_at timestamp NOT NULL DEFAULT now()); CREATE UNIQUE INDEX IF NOT EXISTS research_sources_provider_external_idx ON research_sources(provider,external_id); CREATE INDEX IF NOT EXISTS research_sources_doi_idx ON research_sources(doi);
      CREATE TABLE IF NOT EXISTS research_order_sources (id serial PRIMARY KEY,research_order_id integer NOT NULL REFERENCES research_orders(id) ON DELETE CASCADE,source_id integer NOT NULL REFERENCES research_sources(id) ON DELETE RESTRICT,citation_key varchar(120),notes text,selected_by_customer boolean NOT NULL DEFAULT false,added_by integer REFERENCES staff(id) ON DELETE SET NULL,created_at timestamp NOT NULL DEFAULT now()); CREATE UNIQUE INDEX IF NOT EXISTS research_order_sources_unique_idx ON research_order_sources(research_order_id,source_id);
      CREATE TABLE IF NOT EXISTS research_assignments (id serial PRIMARY KEY,research_order_id integer NOT NULL REFERENCES research_orders(id) ON DELETE CASCADE,staff_id integer NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,role varchar(30) NOT NULL,status varchar(30) NOT NULL DEFAULT 'assigned',hourly_rate numeric(14,2) NOT NULL DEFAULT 0,working_minutes integer NOT NULL DEFAULT 0,rating numeric(4,2),assigned_by integer REFERENCES staff(id) ON DELETE SET NULL,assigned_at timestamp NOT NULL DEFAULT now(),accepted_at timestamp,completed_at timestamp); CREATE UNIQUE INDEX IF NOT EXISTS research_assignments_unique_idx ON research_assignments(research_order_id,staff_id,role);
      CREATE TABLE IF NOT EXISTS research_files (id serial PRIMARY KEY,research_order_id integer NOT NULL REFERENCES research_orders(id) ON DELETE CASCADE,chapter_id integer REFERENCES research_chapters(id) ON DELETE SET NULL,file_type varchar(30) NOT NULL,title text NOT NULL,file_url text NOT NULL,file_name text NOT NULL,mime_type varchar(120),file_size integer,version integer NOT NULL DEFAULT 1,checksum varchar(128),is_customer_visible boolean NOT NULL DEFAULT false,uploaded_by integer REFERENCES staff(id) ON DELETE SET NULL,uploaded_by_name text NOT NULL DEFAULT '',created_at timestamp NOT NULL DEFAULT now()); CREATE INDEX IF NOT EXISTS research_files_order_idx ON research_files(research_order_id,file_type,created_at);
      CREATE TABLE IF NOT EXISTS research_plagiarism_reports (id serial PRIMARY KEY,research_order_id integer NOT NULL REFERENCES research_orders(id) ON DELETE CASCADE,file_id integer REFERENCES research_files(id) ON DELETE SET NULL,similarity_percentage numeric(5,2) NOT NULL,status varchar(30) NOT NULL,provider varchar(80),report_url text,notes text,checked_by integer REFERENCES staff(id) ON DELETE SET NULL,created_at timestamp NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS research_citations (id serial PRIMARY KEY,research_order_id integer NOT NULL REFERENCES research_orders(id) ON DELETE CASCADE,source_id integer REFERENCES research_sources(id) ON DELETE SET NULL,style varchar(20) NOT NULL,citation_text text NOT NULL,bibliography_text text NOT NULL,created_at timestamp NOT NULL DEFAULT now()); CREATE UNIQUE INDEX IF NOT EXISTS research_citations_unique_idx ON research_citations(research_order_id,source_id,style);
      CREATE TABLE IF NOT EXISTS research_messages (id serial PRIMARY KEY,research_order_id integer NOT NULL REFERENCES research_orders(id) ON DELETE CASCADE,chapter_id integer REFERENCES research_chapters(id) ON DELETE SET NULL,sender_type varchar(20) NOT NULL,sender_id integer,sender_name text NOT NULL,message text NOT NULL,attachments jsonb NOT NULL DEFAULT '[]'::jsonb,is_internal boolean NOT NULL DEFAULT false,created_at timestamp NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS research_templates (id serial PRIMARY KEY,code varchar(80) NOT NULL,name text NOT NULL,research_type varchar(30),university_id integer REFERENCES research_universities(id) ON DELETE SET NULL,language varchar(20) NOT NULL DEFAULT 'ar',citation_style varchar(20) NOT NULL DEFAULT 'APA7',structure jsonb NOT NULL DEFAULT '[]'::jsonb,formatting jsonb NOT NULL DEFAULT '{}'::jsonb,is_active boolean NOT NULL DEFAULT true,created_by integer REFERENCES staff(id) ON DELETE SET NULL,created_at timestamp NOT NULL DEFAULT now(),updated_at timestamp NOT NULL DEFAULT now()); CREATE UNIQUE INDEX IF NOT EXISTS research_templates_code_idx ON research_templates(code);
      CREATE TABLE IF NOT EXISTS research_status_events (id serial PRIMARY KEY,research_order_id integer NOT NULL REFERENCES research_orders(id) ON DELETE CASCADE,from_status varchar(30),to_status varchar(30) NOT NULL,notes text,changed_by integer REFERENCES staff(id) ON DELETE SET NULL,changed_by_name text NOT NULL DEFAULT '',created_at timestamp NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS research_ai_generations (id serial PRIMARY KEY,research_order_id integer NOT NULL REFERENCES research_orders(id) ON DELETE CASCADE,chapter_id integer REFERENCES research_chapters(id) ON DELETE SET NULL,action varchar(50) NOT NULL,prompt text NOT NULL,output text NOT NULL,source_ids jsonb NOT NULL DEFAULT '[]'::jsonb,model varchar(80),created_by integer REFERENCES staff(id) ON DELETE SET NULL,created_at timestamp NOT NULL DEFAULT now());
;

-- Migrated from src/server/tailoring.ts:51
CREATE TABLE IF NOT EXISTS graduation_measurement_history (
          id serial PRIMARY KEY,
          graduation_order_id integer NOT NULL REFERENCES graduation_orders(id) ON DELETE CASCADE,
          previous jsonb NOT NULL DEFAULT '{}'::jsonb,
          next jsonb NOT NULL DEFAULT '{}'::jsonb,
          action varchar(40) NOT NULL DEFAULT 'edit',
          changed_by integer,
          changed_by_name text NOT NULL DEFAULT '',
          reason text,
          notes text,
          created_at timestamp NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS graduation_measurement_history_order_idx
          ON graduation_measurement_history(graduation_order_id, created_at DESC);;

-- Migrated from src/server/photography-integration-schema.ts:8 (sql.raw)
ALTER TABLE photography_events ADD COLUMN IF NOT EXISTS booking_id integer REFERENCES service_orders(id) ON DELETE SET NULL;
      ALTER TABLE photography_events ADD COLUMN IF NOT EXISTS booking_code varchar(80);
      ALTER TABLE photography_events ADD COLUMN IF NOT EXISTS map_url text;
      ALTER TABLE photography_events ADD COLUMN IF NOT EXISTS phone varchar(30);
      ALTER TABLE photography_events ADD COLUMN IF NOT EXISTS phone_2 varchar(30);
      ALTER TABLE photography_events ADD COLUMN IF NOT EXISTS event_start_time varchar(10);
      ALTER TABLE photography_events ADD COLUMN IF NOT EXISTS event_end_time varchar(10);
      ALTER TABLE photography_events ADD COLUMN IF NOT EXISTS photography_items jsonb NOT NULL DEFAULT '[]'::jsonb;
      ALTER TABLE photography_events ADD COLUMN IF NOT EXISTS required_photographers integer NOT NULL DEFAULT 1;
      ALTER TABLE photography_events ADD COLUMN IF NOT EXISTS customer_notes text;
      ALTER TABLE photography_events ADD COLUMN IF NOT EXISTS internal_notes text;
      ALTER TABLE photography_events ADD COLUMN IF NOT EXISTS sync_state varchar(30) NOT NULL DEFAULT 'legacy';
      ALTER TABLE photography_events ADD COLUMN IF NOT EXISTS sync_reason text;
      ALTER TABLE photography_events ADD COLUMN IF NOT EXISTS last_synced_at timestamp;
      CREATE UNIQUE INDEX IF NOT EXISTS photography_events_booking_idx ON photography_events(booking_id) WHERE booking_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS photography_events_booking_code_idx ON photography_events(booking_code);
      ALTER TABLE photography_shoots ADD COLUMN IF NOT EXISTS booking_id integer REFERENCES service_orders(id) ON DELETE SET NULL;
      ALTER TABLE photography_shoot_events ADD COLUMN IF NOT EXISTS booking_id integer REFERENCES service_orders(id) ON DELETE SET NULL;
      ALTER TABLE photography_shoot_crew ADD COLUMN IF NOT EXISTS booking_id integer REFERENCES service_orders(id) ON DELETE SET NULL;
      ALTER TABLE photography_shoot_crew ADD COLUMN IF NOT EXISTS assignment_status varchar(30) NOT NULL DEFAULT 'assigned';
      ALTER TABLE photography_shoot_crew ADD COLUMN IF NOT EXISTS assigned_by integer REFERENCES staff(id) ON DELETE SET NULL;
      ALTER TABLE photography_shoot_crew ADD COLUMN IF NOT EXISTS assigned_at timestamp NOT NULL DEFAULT now();
      ALTER TABLE photography_shoot_crew ADD COLUMN IF NOT EXISTS accepted_at timestamp;
      ALTER TABLE photography_shoot_crew ADD COLUMN IF NOT EXISTS rejected_at timestamp;
      ALTER TABLE photography_shoot_crew ADD COLUMN IF NOT EXISTS started_at timestamp;
      ALTER TABLE photography_shoot_crew ADD COLUMN IF NOT EXISTS completed_at timestamp;
      ALTER TABLE photography_shoot_crew ADD COLUMN IF NOT EXISTS conflict_reason text;
      ALTER TABLE photography_shoot_crew ADD COLUMN IF NOT EXISTS override_reason text;
      CREATE UNIQUE INDEX IF NOT EXISTS photography_shoots_booking_idx ON photography_shoots(booking_id) WHERE booking_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS photography_shoot_crew_booking_idx ON photography_shoot_crew(booking_id, staff_id, assignment_status);
      ALTER TABLE photography_edit_projects ADD COLUMN IF NOT EXISTS booking_id integer REFERENCES service_orders(id) ON DELETE SET NULL;
      ALTER TABLE photography_edit_events ADD COLUMN IF NOT EXISTS booking_id integer REFERENCES service_orders(id) ON DELETE SET NULL;
      ALTER TABLE photography_card_assignments ADD COLUMN IF NOT EXISTS booking_id integer REFERENCES service_orders(id) ON DELETE SET NULL;
      ALTER TABLE photography_media_batches ADD COLUMN IF NOT EXISTS booking_id integer REFERENCES service_orders(id) ON DELETE SET NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS photography_edit_projects_booking_idx ON photography_edit_projects(booking_id) WHERE booking_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS photography_card_assignments_booking_idx ON photography_card_assignments(booking_id, status);
      CREATE INDEX IF NOT EXISTS photography_media_batches_booking_idx ON photography_media_batches(booking_id, kind);
      UPDATE photography_shoots s SET booking_id=e.booking_id FROM photography_events e WHERE s.event_id=e.id AND s.booking_id IS NULL AND e.booking_id IS NOT NULL;
      UPDATE photography_shoot_events se SET booking_id=s.booking_id FROM photography_shoots s WHERE se.shoot_id=s.id AND se.booking_id IS NULL AND s.booking_id IS NOT NULL;
      UPDATE photography_shoot_crew c SET booking_id=s.booking_id FROM photography_shoots s WHERE c.shoot_id=s.id AND c.booking_id IS NULL AND s.booking_id IS NOT NULL;
      UPDATE photography_edit_projects p SET booking_id=s.booking_id FROM photography_shoots s WHERE p.shoot_id=s.id AND p.booking_id IS NULL AND s.booking_id IS NOT NULL;
      UPDATE photography_edit_events e SET booking_id=p.booking_id FROM photography_edit_projects p WHERE e.project_id=p.id AND e.booking_id IS NULL AND p.booking_id IS NOT NULL;
      UPDATE photography_card_assignments a SET booking_id=s.booking_id FROM photography_shoots s WHERE a.shoot_id=s.id AND a.booking_id IS NULL AND s.booking_id IS NOT NULL;
      UPDATE photography_media_batches b SET booking_id=s.booking_id FROM photography_shoots s WHERE b.shoot_id=s.id AND b.booking_id IS NULL AND s.booking_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS photography_checklist_items (
        id serial PRIMARY KEY, booking_id integer NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
        shoot_id integer REFERENCES photography_shoots(id) ON DELETE CASCADE, phase varchar(20) NOT NULL,
        item_key varchar(80) NOT NULL, label text NOT NULL, is_required boolean NOT NULL DEFAULT true,
        is_completed boolean NOT NULL DEFAULT false, completed_by integer REFERENCES staff(id) ON DELETE SET NULL,
        completed_at timestamp, evidence_url text, note text, created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now(), CONSTRAINT photography_checklist_items_unique UNIQUE(booking_id, phase, item_key)
      );
      CREATE INDEX IF NOT EXISTS photography_checklist_items_booking_idx ON photography_checklist_items(booking_id, phase);
      CREATE TABLE IF NOT EXISTS photography_uploads (
        id serial PRIMARY KEY, booking_id integer NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
        shoot_id integer REFERENCES photography_shoots(id) ON DELETE SET NULL, kind varchar(40) NOT NULL,
        storage_path text, file_url text NOT NULL, file_name text, mime_type varchar(120),
        access_level varchar(20) NOT NULL DEFAULT 'team', metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        uploaded_by integer REFERENCES staff(id) ON DELETE SET NULL, created_at timestamp NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS photography_uploads_booking_idx ON photography_uploads(booking_id, kind, created_at);
      CREATE TABLE IF NOT EXISTS photography_workflow_settings (
        id serial PRIMARY KEY, code varchar(40) NOT NULL UNIQUE DEFAULT 'default', active_stages jsonb NOT NULL DEFAULT '[]'::jsonb,
        require_reaccept_on_schedule_change boolean NOT NULL DEFAULT true,
        updated_by integer REFERENCES staff(id) ON DELETE SET NULL, updated_at timestamp NOT NULL DEFAULT now()
      );
      INSERT INTO photography_workflow_settings(code,active_stages) VALUES ('default','["new_booking","awaiting_assignment","crew_assigned","accepted","waiting_event","on_the_way","arrived","shooting","shoot_ended","files_received","transferring","sorting","editing","customer_review","revising","ready_print","printing","ready_delivery","delivered","completed","cancelled"]'::jsonb) ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS ajn_schema_revisions (
  revision integer PRIMARY KEY,
  description text NOT NULL,
  applied_at timestamp with time zone NOT NULL DEFAULT now()
);
INSERT INTO ajn_schema_revisions (revision, description)
VALUES (96, 'Phase 2 production hardening: runtime DDL removal and distributed rate limiting')
ON CONFLICT (revision) DO NOTHING;
