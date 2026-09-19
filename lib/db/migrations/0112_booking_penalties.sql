-- Booking Damage & Penalty system — additive only.
--
-- Records penalties owed for damaged / lost / unreturned center equipment on a
-- booking. It NEVER changes the original booking total, deposit, remaining,
-- payment status, cash box, receipts, or any existing row. Actual penalty
-- payments reuse the master cash-box `financial_transactions` engine
-- (source_type = 'booking_penalty'), so only an EXECUTED payment moves cash, and
-- paid/remaining are derived from those movements — nothing is stored mutably.
CREATE TABLE IF NOT EXISTS "booking_penalties" (
  "id" serial PRIMARY KEY,
  "penalty_no" varchar(50) NOT NULL UNIQUE,
  "source_type" varchar(30) NOT NULL,
  "source_id" integer NOT NULL,
  "customer_id" integer,
  "customer_name" text NOT NULL DEFAULT '',
  "product_id" integer,
  "item_label" text NOT NULL DEFAULT '',
  "damage_type" varchar(30) NOT NULL,
  "item_condition" varchar(30),
  "quantity" numeric(12,2) NOT NULL DEFAULT 1,
  "unit_value" numeric(16,2) NOT NULL DEFAULT 0,
  "penalty_amount" numeric(16,2) NOT NULL DEFAULT 0,
  "reason" text NOT NULL DEFAULT '',
  "evidence" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "notes" text,
  "status" varchar(24) NOT NULL DEFAULT 'pending_review',
  "origin" varchar(20) NOT NULL DEFAULT 'manager',
  "correction_of" integer,
  "employee_report" jsonb,
  "reviewed_by" integer,
  "reviewed_by_name" text,
  "reviewed_at" timestamp,
  "rejected_reason" text,
  "cancelled_reason" text,
  "cancelled_by" integer,
  "cancelled_at" timestamp,
  "inventory_movement_id" integer,
  "created_by" integer,
  "created_by_name" text NOT NULL DEFAULT '',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "booking_penalties_source_idx" ON "booking_penalties" ("source_type", "source_id");
CREATE INDEX IF NOT EXISTS "booking_penalties_status_idx" ON "booking_penalties" ("status");
CREATE INDEX IF NOT EXISTS "booking_penalties_customer_idx" ON "booking_penalties" ("customer_id");

-- Separate revenue classification for COLLECTED penalties (never normal sales).
-- Mirrors the runtime ACCOUNT_SEEDS upsert so both paths converge.
INSERT INTO "financial_accounts" ("code", "name_ar", "account_type", "department")
VALUES ('4070', 'غرامات وتلفيات', 'revenue', 'penalties')
ON CONFLICT DO NOTHING;
