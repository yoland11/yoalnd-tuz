-- Koshat work orders are operational records linked one-to-one to a booking.
-- All foreign keys restrict deletion to preserve execution and assignment history.
CREATE TABLE IF NOT EXISTS "kosha_work_orders" (
  "id" serial PRIMARY KEY,
  "work_order_no" varchar(40) NOT NULL UNIQUE,
  "booking_id" integer NOT NULL UNIQUE REFERENCES "kosha_bookings"("id") ON DELETE RESTRICT,
  "leader_id" integer REFERENCES "staff"("id") ON DELETE SET NULL,
  "status" varchar(40) NOT NULL DEFAULT 'UNASSIGNED',
  "priority" varchar(20) NOT NULL DEFAULT 'normal',
  "required_arrival_at" timestamp, "event_start_at" timestamp, "expected_dismantle_at" timestamp,
  "assigned_at" timestamp, "accepted_at" timestamp, "started_at" timestamp,
  "started_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
  "started_lat" numeric(10,7), "started_lng" numeric(10,7), "arrived_at" timestamp, "completed_at" timestamp,
  "special_instructions" text, "require_acknowledgment" boolean NOT NULL DEFAULT false,
  "instructions_acknowledged_at" timestamp, "instructions_acknowledged_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
  "cancelled_at" timestamp, "created_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(), "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "kosha_work_orders_status_time_idx" ON "kosha_work_orders"("status", "required_arrival_at");
CREATE TABLE IF NOT EXISTS "kosha_work_order_members" (
  "id" serial PRIMARY KEY, "work_order_id" integer NOT NULL REFERENCES "kosha_work_orders"("id") ON DELETE RESTRICT,
  "staff_id" integer NOT NULL REFERENCES "staff"("id") ON DELETE RESTRICT, "role" varchar(20) NOT NULL DEFAULT 'MEMBER',
  "status" varchar(30) NOT NULL DEFAULT 'ASSIGNED', "accepted_at" timestamp, "declined_at" timestamp,
  "decline_reason" varchar(40), "decline_note" text, "removed_at" timestamp, "created_at" timestamp NOT NULL DEFAULT now(),
  UNIQUE("work_order_id", "staff_id")
);
CREATE INDEX IF NOT EXISTS "kosha_work_order_members_staff_idx" ON "kosha_work_order_members"("staff_id", "status");
CREATE TABLE IF NOT EXISTS "kosha_work_order_events" (
  "id" serial PRIMARY KEY, "work_order_id" integer NOT NULL REFERENCES "kosha_work_orders"("id") ON DELETE RESTRICT,
  "staff_id" integer REFERENCES "staff"("id") ON DELETE SET NULL, "staff_name" text NOT NULL DEFAULT '',
  "type" varchar(50) NOT NULL, "title" text NOT NULL, "details" text, "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "kosha_work_order_events_order_idx" ON "kosha_work_order_events"("work_order_id", "created_at");
CREATE TABLE IF NOT EXISTS "kosha_work_order_checklist" (
  "id" serial PRIMARY KEY, "work_order_id" integer NOT NULL REFERENCES "kosha_work_orders"("id") ON DELETE RESTRICT,
  "label" text NOT NULL, "product_id" integer REFERENCES "products"("id") ON DELETE SET NULL, "sort_order" integer NOT NULL DEFAULT 0,
  "is_completed" boolean NOT NULL DEFAULT false, "completed_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
  "completed_at" timestamp, "note" text, "photo_url" text, "created_at" timestamp NOT NULL DEFAULT now(), "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "kosha_work_order_assets" (
  "id" serial PRIMARY KEY, "work_order_id" integer NOT NULL REFERENCES "kosha_work_orders"("id") ON DELETE RESTRICT,
  "product_id" integer NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT, "asset_code" varchar(160),
  "checked_out_by" integer REFERENCES "staff"("id") ON DELETE SET NULL, "checked_out_at" timestamp,
  "returned_by" integer REFERENCES "staff"("id") ON DELETE SET NULL, "returned_at" timestamp, "return_condition" varchar(30),
  "note" text, "created_at" timestamp NOT NULL DEFAULT now(), UNIQUE("work_order_id", "product_id")
);
