-- Feature-only additive migration: grouped multi-invoice sales returns.
-- Creates new tables only. No historical rows are changed, no cash moves.
-- Apply this file only, transactionally, after feature review. Never auto-drop to roll back.

CREATE TABLE IF NOT EXISTS "sales_returns" (
	"id" serial PRIMARY KEY NOT NULL,
	"return_no" varchar(30) NOT NULL,
	"customer_id" integer NOT NULL REFERENCES "customers"("id") ON DELETE RESTRICT,
	"status" varchar(24) DEFAULT 'draft' NOT NULL,
	"return_date" date NOT NULL,
	"warehouse_id" integer REFERENCES "warehouses"("id") ON DELETE SET NULL,
	"reason_code" varchar(40) NOT NULL,
	"notes" text,
	"attachment_url" text,
	"employee_id" integer REFERENCES "staff"("id") ON DELETE SET NULL,
	"employee_name" text DEFAULT '' NOT NULL,
	"total_quantity" numeric(14, 3) DEFAULT 0 NOT NULL,
	"total_amount" numeric(16, 2) DEFAULT 0 NOT NULL,
	"settlement_plan" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone,
	"submitted_by" integer,
	"received_at" timestamp with time zone,
	"received_by" integer,
	"received_by_name" text,
	"approved_at" timestamp with time zone,
	"approved_by" integer,
	"approved_by_name" text,
	"approval_note" text,
	"rejected_at" timestamp with time zone,
	"rejected_by" integer,
	"rejection_reason" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" integer,
	"cancellation_reason" text,
	"inventory_completed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"reversed_at" timestamp with time zone,
	"reversed_by" integer,
	"reversed_by_name" text,
	"reversal_reason" text,
	"reversal_no" varchar(30),
	"version" integer DEFAULT 1 NOT NULL,
	"idempotency_key" varchar(120) NOT NULL,
	"created_by" integer,
	"created_by_name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_returns_status_check" CHECK ("status" IN ('draft','pending_approval','approved','rejected','cancelled','completed','reversed')),
	CONSTRAINT "sales_returns_totals_check" CHECK ("total_quantity" >= 0 AND "total_amount" >= 0 AND "version" > 0),
	CONSTRAINT "sales_returns_reversal_check" CHECK (("status" = 'reversed') = ("reversed_at" IS NOT NULL AND "reversal_no" IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS "sales_returns_no_unique" ON "sales_returns" USING btree ("return_no");
CREATE UNIQUE INDEX IF NOT EXISTS "sales_returns_reversal_no_unique" ON "sales_returns" USING btree ("reversal_no") WHERE "reversal_no" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "sales_returns_replay_unique" ON "sales_returns" USING btree ("idempotency_key");
CREATE INDEX IF NOT EXISTS "sales_returns_customer_idx" ON "sales_returns" USING btree ("customer_id", "status", "return_date");
CREATE INDEX IF NOT EXISTS "sales_returns_status_idx" ON "sales_returns" USING btree ("status", "return_date");

-- One row per original invoice line a returned quantity is taken from.
CREATE TABLE IF NOT EXISTS "sales_return_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"return_id" integer NOT NULL REFERENCES "sales_returns"("id") ON DELETE RESTRICT,
	"invoice_id" integer NOT NULL REFERENCES "sales_invoices"("id") ON DELETE RESTRICT,
	"invoice_item_id" integer NOT NULL REFERENCES "sales_invoice_items"("id") ON DELETE RESTRICT,
	"product_id" integer REFERENCES "products"("id") ON DELETE RESTRICT,
	"product_key" varchar(200) NOT NULL,
	"product_name" text NOT NULL,
	"unit_snapshot" text,
	"quantity" numeric(12, 3) NOT NULL,
	"original_unit_price" numeric(14, 2) NOT NULL,
	"net_unit_amount" numeric(16, 4) NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	"condition" varchar(24) DEFAULT 'good' NOT NULL,
	"track_inventory" boolean DEFAULT true NOT NULL,
	"inventory_state" varchar(24) DEFAULT 'pending' NOT NULL,
	"inventory_processed_at" timestamp with time zone,
	"inventory_processed_by" integer,
	"stock_owner_product_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_return_items_quantity_check" CHECK ("quantity" > 0 AND "amount" >= 0 AND "original_unit_price" >= 0 AND "net_unit_amount" >= 0),
	CONSTRAINT "sales_return_items_condition_check" CHECK ("condition" IN ('good','inspection','damaged','unsellable')),
	CONSTRAINT "sales_return_items_inventory_check" CHECK ("inventory_state" IN ('pending','restocked','inspection','damaged','unsellable','not_tracked','reversed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "sales_return_items_line_unique" ON "sales_return_items" USING btree ("return_id", "invoice_item_id");
CREATE INDEX IF NOT EXISTS "sales_return_items_invoice_item_idx" ON "sales_return_items" USING btree ("invoice_item_id");
CREATE INDEX IF NOT EXISTS "sales_return_items_invoice_idx" ON "sales_return_items" USING btree ("invoice_id");
CREATE INDEX IF NOT EXISTS "sales_return_items_product_idx" ON "sales_return_items" USING btree ("product_id");

-- How an approved return value is settled. invoice_credit lowers an invoice's
-- remaining debt (read by the canonical payment-state reconciliation);
-- customer_credit is a balance for future invoices (used through child
-- invoice_credit rows); refund is a pending/executed financial request.
CREATE TABLE IF NOT EXISTS "sales_return_settlements" (
	"id" serial PRIMARY KEY NOT NULL,
	"return_id" integer NOT NULL REFERENCES "sales_returns"("id") ON DELETE RESTRICT,
	"customer_id" integer NOT NULL REFERENCES "customers"("id") ON DELETE RESTRICT,
	"kind" varchar(24) NOT NULL,
	"invoice_id" integer REFERENCES "sales_invoices"("id") ON DELETE RESTRICT,
	"parent_settlement_id" integer REFERENCES "sales_return_settlements"("id") ON DELETE RESTRICT,
	"amount" numeric(16, 2) NOT NULL,
	"status" varchar(20) DEFAULT 'applied' NOT NULL,
	"is_exchange" boolean DEFAULT false NOT NULL,
	"payment_method" varchar(20),
	"financial_transaction_id" integer REFERENCES "financial_transactions"("id") ON DELETE RESTRICT,
	"note" text,
	"idempotency_key" varchar(180) NOT NULL,
	"created_by" integer,
	"created_by_name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed_at" timestamp with time zone,
	"reversed_by" integer,
	"reversal_reason" text,
	CONSTRAINT "sales_return_settlements_kind_check" CHECK ("kind" IN ('invoice_credit','customer_credit','refund')),
	CONSTRAINT "sales_return_settlements_status_check" CHECK ("status" IN ('applied','requested','reversed','cancelled')),
	CONSTRAINT "sales_return_settlements_amount_check" CHECK ("amount" > 0),
	CONSTRAINT "sales_return_settlements_invoice_check" CHECK (("kind" = 'invoice_credit') = ("invoice_id" IS NOT NULL)),
	CONSTRAINT "sales_return_settlements_parent_check" CHECK ("parent_settlement_id" IS NULL OR "kind" = 'invoice_credit'),
	CONSTRAINT "sales_return_settlements_refund_check" CHECK (("kind" = 'refund') = ("financial_transaction_id" IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS "sales_return_settlements_replay_unique" ON "sales_return_settlements" USING btree ("idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "sales_return_settlements_tx_unique" ON "sales_return_settlements" USING btree ("financial_transaction_id") WHERE "financial_transaction_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "sales_return_settlements_invoice_idx" ON "sales_return_settlements" USING btree ("invoice_id", "status") WHERE "kind" = 'invoice_credit';
CREATE INDEX IF NOT EXISTS "sales_return_settlements_customer_idx" ON "sales_return_settlements" USING btree ("customer_id", "kind", "status");
CREATE INDEX IF NOT EXISTS "sales_return_settlements_return_idx" ON "sales_return_settlements" USING btree ("return_id");
CREATE INDEX IF NOT EXISTS "sales_return_settlements_parent_idx" ON "sales_return_settlements" USING btree ("parent_settlement_id") WHERE "parent_settlement_id" IS NOT NULL;

-- Append-only audit trail of every return action.
CREATE TABLE IF NOT EXISTS "sales_return_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"return_id" integer NOT NULL REFERENCES "sales_returns"("id") ON DELETE RESTRICT,
	"event" varchar(40) NOT NULL,
	"actor_id" integer,
	"actor_name" text DEFAULT '' NOT NULL,
	"note" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "sales_return_events_return_idx" ON "sales_return_events" USING btree ("return_id", "created_at");
