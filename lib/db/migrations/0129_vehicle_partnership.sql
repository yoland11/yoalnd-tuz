-- Feature-only additive migration. No historical backfill or cash movement.
-- Apply this file only, transactionally, after feature review. Never auto-drop to roll back.
CREATE TABLE "vehicle_partnership_activity" (
	"id" serial PRIMARY KEY NOT NULL,
	"partnership_id" integer NOT NULL,
	"agreement_id" integer NOT NULL,
	"kosha_booking_id" integer,
	"service_order_id" integer,
	"delivery_order_id" integer,
	"operation_key" varchar(120) NOT NULL,
	"income_basis" varchar(20) NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	"recognition_date" date NOT NULL,
	"status" varchar(24) DEFAULT 'draft' NOT NULL,
	"source_digest" varchar(64) NOT NULL,
	"source_snapshot" jsonb NOT NULL,
	"financial_transaction_id" integer,
	"idempotency_key" varchar(180) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer,
	"reason" text NOT NULL,
	CONSTRAINT "vp_activity_source_check" CHECK (num_nonnulls("vehicle_partnership_activity"."kosha_booking_id","vehicle_partnership_activity"."service_order_id","vehicle_partnership_activity"."delivery_order_id")=1),
	CONSTRAINT "vp_activity_basis_check" CHECK ("vehicle_partnership_activity"."income_basis" IN ('internal','external')),
	CONSTRAINT "vp_activity_amount_check" CHECK ("vehicle_partnership_activity"."amount">=0 AND "vehicle_partnership_activity"."revision">0),
	CONSTRAINT "vp_activity_status_check" CHECK ("vehicle_partnership_activity"."status" IN ('draft','pending','approved','rejected','cancelled','reversed'))
);

CREATE TABLE "vehicle_partnership_agreements" (
	"id" serial PRIMARY KEY NOT NULL,
	"partnership_id" integer NOT NULL,
	"revision" integer NOT NULL,
	"effective_from" date NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"idempotency_key" varchar(180) NOT NULL,
	"approved_by" integer,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer,
	"reason" text NOT NULL,
	CONSTRAINT "vp_agreement_scope_unique" UNIQUE("id","partnership_id"),
	CONSTRAINT "vp_agreement_revision_check" CHECK ("vehicle_partnership_agreements"."revision">0),
	CONSTRAINT "vp_agreement_status_check" CHECK ("vehicle_partnership_agreements"."status" IN ('draft','pending','approved','rejected','superseded'))
);

CREATE TABLE "vehicle_partnership_closing_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"closing_id" integer NOT NULL,
	"revision" integer NOT NULL,
	"source_key" varchar(240) NOT NULL,
	"line_kind" varchar(30) NOT NULL,
	"agreement_id" integer,
	"member_id" integer,
	"amount" numeric(16, 2) NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer,
	"reason" text NOT NULL,
	CONSTRAINT "vp_closing_line_scope_unique" UNIQUE("id","member_id","agreement_id"),
	CONSTRAINT "vp_closing_line_revision_check" CHECK ("vehicle_partnership_closing_lines"."revision">0),
	CONSTRAINT "vp_closing_line_kind_check" CHECK ("vehicle_partnership_closing_lines"."line_kind" IN ('income','cost','adjustment','reserve','loss_recovery','profit_allocation','loss_allocation','summary'))
);

CREATE TABLE "vehicle_partnership_closings" (
	"id" serial PRIMARY KEY NOT NULL,
	"partnership_id" integer NOT NULL,
	"period" date NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"status" varchar(24) DEFAULT 'draft' NOT NULL,
	"source_digest" varchar(64),
	"financial_transaction_id" integer,
	"policy_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"approved_by" integer,
	"approved_at" timestamp with time zone,
	"idempotency_key" varchar(180) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer,
	"reason" text NOT NULL,
	CONSTRAINT "vp_closing_period_check" CHECK (extract(day from "vehicle_partnership_closings"."period")=1),
	CONSTRAINT "vp_closing_version_check" CHECK ("vehicle_partnership_closings"."revision">0 AND "vehicle_partnership_closings"."version">=0),
	CONSTRAINT "vp_closing_status_check" CHECK ("vehicle_partnership_closings"."status" IN ('draft','review','pending','approved','distributed'))
);

CREATE TABLE "vehicle_partnership_cost_funding" (
	"id" serial PRIMARY KEY NOT NULL,
	"partnership_id" integer NOT NULL,
	"vehicle_expense_id" integer NOT NULL,
	"payer_member_id" integer,
	"employee_finance_entry_id" integer,
	"activity_id" integer,
	"funding_kind" varchar(30) NOT NULL,
	"cost_class" varchar(20) NOT NULL,
	"status" varchar(24) DEFAULT 'pending' NOT NULL,
	"source_digest" varchar(64) NOT NULL,
	"source_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"financial_transaction_id" integer,
	"idempotency_key" varchar(180) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer,
	"reason" text NOT NULL,
	CONSTRAINT "vp_cost_payer_scope_unique" UNIQUE("id","payer_member_id"),
	CONSTRAINT "vp_cost_funding_check" CHECK ("vehicle_partnership_cost_funding"."funding_kind" IN ('company_cash','partner_advance','partner_capital','other') AND ("vehicle_partnership_cost_funding"."funding_kind" NOT IN ('partner_advance','partner_capital') OR "vehicle_partnership_cost_funding"."payer_member_id" IS NOT NULL)),
	CONSTRAINT "vp_cost_class_check" CHECK ("vehicle_partnership_cost_funding"."cost_class" IN ('operating','capital')),
	CONSTRAINT "vp_cost_status_check" CHECK ("vehicle_partnership_cost_funding"."status" IN ('pending','approved','rejected','reversed'))
);

CREATE TABLE "vehicle_partnership_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"agreement_id" integer NOT NULL,
	"party_kind" varchar(20) NOT NULL,
	"customer_id" integer,
	"supplier_id" integer,
	"staff_id" integer,
	"ownership_basis_points" integer NOT NULL,
	"profit_basis_points" integer NOT NULL,
	"expense_basis_points" integer NOT NULL,
	"capital_contribution" numeric(16, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer,
	"reason" text NOT NULL,
	CONSTRAINT "vp_member_scope_unique" UNIQUE("id","agreement_id"),
	CONSTRAINT "vp_member_party_check" CHECK (num_nonnulls("vehicle_partnership_members"."customer_id","vehicle_partnership_members"."supplier_id","vehicle_partnership_members"."staff_id")=1 AND (("vehicle_partnership_members"."party_kind"='customer' AND "vehicle_partnership_members"."customer_id" IS NOT NULL) OR ("vehicle_partnership_members"."party_kind"='supplier' AND "vehicle_partnership_members"."supplier_id" IS NOT NULL) OR ("vehicle_partnership_members"."party_kind"='staff' AND "vehicle_partnership_members"."staff_id" IS NOT NULL))),
	CONSTRAINT "vp_member_shares_check" CHECK ("vehicle_partnership_members"."ownership_basis_points" BETWEEN 0 AND 10000 AND "vehicle_partnership_members"."profit_basis_points" BETWEEN 0 AND 10000 AND "vehicle_partnership_members"."expense_basis_points" BETWEEN 0 AND 10000),
	CONSTRAINT "vp_member_capital_check" CHECK ("vehicle_partnership_members"."capital_contribution">=0)
);

CREATE TABLE "vehicle_partnership_rights" (
	"id" serial PRIMARY KEY NOT NULL,
	"partnership_id" integer NOT NULL,
	"agreement_id" integer NOT NULL,
	"member_id" integer,
	"activity_id" integer,
	"cost_funding_id" integer,
	"closing_line_id" integer,
	"source_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"category" varchar(30) NOT NULL,
	"direction" varchar(10) NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"event_key" varchar(240) NOT NULL,
	"financial_transaction_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer,
	"reason" text NOT NULL,
	CONSTRAINT "vp_right_amount_check" CHECK ("vehicle_partnership_rights"."amount">=0 AND "vehicle_partnership_rights"."direction" IN ('credit','debit')),
	CONSTRAINT "vp_right_category_check" CHECK ("vehicle_partnership_rights"."category" IN ('capital','profit','loss','advance','loss_recovery','internal_entitlement') AND ("vehicle_partnership_rights"."category"='internal_entitlement' OR "vehicle_partnership_rights"."member_id" IS NOT NULL)),
	CONSTRAINT "vp_right_source_check" CHECK (num_nonnulls("vehicle_partnership_rights"."activity_id","vehicle_partnership_rights"."cost_funding_id","vehicle_partnership_rights"."closing_line_id")<=1 AND CASE WHEN "vehicle_partnership_rights"."category" IN ('profit','loss','loss_recovery') THEN "vehicle_partnership_rights"."closing_line_id" IS NOT NULL WHEN "vehicle_partnership_rights"."category"='advance' THEN "vehicle_partnership_rights"."cost_funding_id" IS NOT NULL WHEN "vehicle_partnership_rights"."category"='internal_entitlement' THEN "vehicle_partnership_rights"."activity_id" IS NOT NULL ELSE "vehicle_partnership_rights"."status"<>'approved' OR "vehicle_partnership_rights"."financial_transaction_id" IS NOT NULL END),
	CONSTRAINT "vp_right_status_check" CHECK ("vehicle_partnership_rights"."status" IN ('pending','approved','cancelled','reversed'))
);

CREATE TABLE "vehicle_partnership_settlement_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"right_id" integer NOT NULL,
	"financial_transaction_id" integer NOT NULL,
	"conversion_allocation_id" integer,
	"purpose" varchar(40) NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	"idempotency_key" varchar(180) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer,
	"reason" text NOT NULL,
	CONSTRAINT "vp_settlement_conversion_scope_unique" UNIQUE("id","right_id"),
	CONSTRAINT "vp_settlement_amount_check" CHECK ("vehicle_partnership_settlement_allocations"."amount">0),
	CONSTRAINT "vp_settlement_conversion_check" CHECK ("vehicle_partnership_settlement_allocations"."conversion_allocation_id" IS NULL OR ("vehicle_partnership_settlement_allocations"."purpose"='internal_entitlement_settlement' AND "vehicle_partnership_settlement_allocations"."conversion_allocation_id"<>"vehicle_partnership_settlement_allocations"."id")),
	CONSTRAINT "vp_settlement_purpose_check" CHECK ("vehicle_partnership_settlement_allocations"."purpose" IN ('distribution','advance_reimbursement','internal_entitlement_settlement','capital_transfer','internal_conversion'))
);

CREATE TABLE "vehicle_partnerships" (
	"id" serial PRIMARY KEY NOT NULL,
	"vehicle_id" integer NOT NULL,
	"singleton_slot" integer DEFAULT 1 NOT NULL,
	"ownership_type" varchar(20) NOT NULL,
	"registration_owner" text NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer,
	"reason" text NOT NULL,
	CONSTRAINT "vp_singleton_check" CHECK ("vehicle_partnerships"."singleton_slot"=1),
	CONSTRAINT "vp_ownership_check" CHECK ("vehicle_partnerships"."ownership_type" IN ('company','personal','partnership')),
	CONSTRAINT "vp_version_check" CHECK ("vehicle_partnerships"."version">=0)
);

ALTER TABLE "vehicle_partnership_activity" ADD CONSTRAINT "vehicle_partnership_activity_partnership_id_vehicle_partnerships_id_fk" FOREIGN KEY ("partnership_id") REFERENCES "public"."vehicle_partnerships"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_activity" ADD CONSTRAINT "vehicle_partnership_activity_agreement_id_vehicle_partnership_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."vehicle_partnership_agreements"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_activity" ADD CONSTRAINT "vehicle_partnership_activity_kosha_booking_id_kosha_bookings_id_fk" FOREIGN KEY ("kosha_booking_id") REFERENCES "public"."kosha_bookings"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_activity" ADD CONSTRAINT "vehicle_partnership_activity_service_order_id_service_orders_id_fk" FOREIGN KEY ("service_order_id") REFERENCES "public"."service_orders"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_activity" ADD CONSTRAINT "vehicle_partnership_activity_delivery_order_id_delivery_orders_id_fk" FOREIGN KEY ("delivery_order_id") REFERENCES "public"."delivery_orders"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_activity" ADD CONSTRAINT "vehicle_partnership_activity_financial_transaction_id_financial_transactions_id_fk" FOREIGN KEY ("financial_transaction_id") REFERENCES "public"."financial_transactions"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_activity" ADD CONSTRAINT "vehicle_partnership_activity_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_agreements" ADD CONSTRAINT "vehicle_partnership_agreements_partnership_id_vehicle_partnerships_id_fk" FOREIGN KEY ("partnership_id") REFERENCES "public"."vehicle_partnerships"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_agreements" ADD CONSTRAINT "vehicle_partnership_agreements_approved_by_staff_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."staff"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_agreements" ADD CONSTRAINT "vehicle_partnership_agreements_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_closing_lines" ADD CONSTRAINT "vehicle_partnership_closing_lines_closing_id_vehicle_partnership_closings_id_fk" FOREIGN KEY ("closing_id") REFERENCES "public"."vehicle_partnership_closings"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_closing_lines" ADD CONSTRAINT "vehicle_partnership_closing_lines_agreement_id_vehicle_partnership_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."vehicle_partnership_agreements"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_closing_lines" ADD CONSTRAINT "vehicle_partnership_closing_lines_member_id_vehicle_partnership_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."vehicle_partnership_members"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_closing_lines" ADD CONSTRAINT "vehicle_partnership_closing_lines_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_closings" ADD CONSTRAINT "vehicle_partnership_closings_partnership_id_vehicle_partnerships_id_fk" FOREIGN KEY ("partnership_id") REFERENCES "public"."vehicle_partnerships"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_closings" ADD CONSTRAINT "vehicle_partnership_closings_financial_transaction_id_financial_transactions_id_fk" FOREIGN KEY ("financial_transaction_id") REFERENCES "public"."financial_transactions"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_closings" ADD CONSTRAINT "vehicle_partnership_closings_approved_by_staff_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."staff"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_closings" ADD CONSTRAINT "vehicle_partnership_closings_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_cost_funding" ADD CONSTRAINT "vehicle_partnership_cost_funding_partnership_id_vehicle_partnerships_id_fk" FOREIGN KEY ("partnership_id") REFERENCES "public"."vehicle_partnerships"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_cost_funding" ADD CONSTRAINT "vehicle_partnership_cost_funding_vehicle_expense_id_vehicle_expenses_id_fk" FOREIGN KEY ("vehicle_expense_id") REFERENCES "public"."vehicle_expenses"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_cost_funding" ADD CONSTRAINT "vehicle_partnership_cost_funding_payer_member_id_vehicle_partnership_members_id_fk" FOREIGN KEY ("payer_member_id") REFERENCES "public"."vehicle_partnership_members"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_cost_funding" ADD CONSTRAINT "vehicle_partnership_cost_funding_employee_finance_entry_id_employee_finance_entries_id_fk" FOREIGN KEY ("employee_finance_entry_id") REFERENCES "public"."employee_finance_entries"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_cost_funding" ADD CONSTRAINT "vehicle_partnership_cost_funding_activity_id_vehicle_partnership_activity_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."vehicle_partnership_activity"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_cost_funding" ADD CONSTRAINT "vehicle_partnership_cost_funding_financial_transaction_id_financial_transactions_id_fk" FOREIGN KEY ("financial_transaction_id") REFERENCES "public"."financial_transactions"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_cost_funding" ADD CONSTRAINT "vehicle_partnership_cost_funding_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_members" ADD CONSTRAINT "vehicle_partnership_members_agreement_id_vehicle_partnership_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."vehicle_partnership_agreements"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_members" ADD CONSTRAINT "vehicle_partnership_members_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_members" ADD CONSTRAINT "vehicle_partnership_members_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_members" ADD CONSTRAINT "vehicle_partnership_members_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_members" ADD CONSTRAINT "vehicle_partnership_members_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_rights" ADD CONSTRAINT "vehicle_partnership_rights_partnership_id_vehicle_partnerships_id_fk" FOREIGN KEY ("partnership_id") REFERENCES "public"."vehicle_partnerships"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_rights" ADD CONSTRAINT "vehicle_partnership_rights_agreement_id_vehicle_partnership_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."vehicle_partnership_agreements"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_rights" ADD CONSTRAINT "vehicle_partnership_rights_member_id_vehicle_partnership_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."vehicle_partnership_members"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_rights" ADD CONSTRAINT "vehicle_partnership_rights_activity_id_vehicle_partnership_activity_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."vehicle_partnership_activity"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_rights" ADD CONSTRAINT "vehicle_partnership_rights_cost_funding_id_vehicle_partnership_cost_funding_id_fk" FOREIGN KEY ("cost_funding_id") REFERENCES "public"."vehicle_partnership_cost_funding"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_rights" ADD CONSTRAINT "vehicle_partnership_rights_closing_line_id_vehicle_partnership_closing_lines_id_fk" FOREIGN KEY ("closing_line_id") REFERENCES "public"."vehicle_partnership_closing_lines"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_rights" ADD CONSTRAINT "vehicle_partnership_rights_financial_transaction_id_financial_transactions_id_fk" FOREIGN KEY ("financial_transaction_id") REFERENCES "public"."financial_transactions"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_rights" ADD CONSTRAINT "vehicle_partnership_rights_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_rights" ADD CONSTRAINT "vp_right_agreement_scope_fk" FOREIGN KEY ("agreement_id","partnership_id") REFERENCES "public"."vehicle_partnership_agreements"("id","partnership_id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_rights" ADD CONSTRAINT "vp_right_member_scope_fk" FOREIGN KEY ("member_id","agreement_id") REFERENCES "public"."vehicle_partnership_members"("id","agreement_id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_rights" ADD CONSTRAINT "vp_right_closing_scope_fk" FOREIGN KEY ("closing_line_id","member_id","agreement_id") REFERENCES "public"."vehicle_partnership_closing_lines"("id","member_id","agreement_id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_rights" ADD CONSTRAINT "vp_right_payer_scope_fk" FOREIGN KEY ("cost_funding_id","member_id") REFERENCES "public"."vehicle_partnership_cost_funding"("id","payer_member_id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_settlement_allocations" ADD CONSTRAINT "vehicle_partnership_settlement_allocations_right_id_vehicle_partnership_rights_id_fk" FOREIGN KEY ("right_id") REFERENCES "public"."vehicle_partnership_rights"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_settlement_allocations" ADD CONSTRAINT "vehicle_partnership_settlement_allocations_financial_transaction_id_financial_transactions_id_fk" FOREIGN KEY ("financial_transaction_id") REFERENCES "public"."financial_transactions"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_settlement_allocations" ADD CONSTRAINT "vehicle_partnership_settlement_allocations_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnership_settlement_allocations" ADD CONSTRAINT "vp_settlement_conversion_scope_fk" FOREIGN KEY ("conversion_allocation_id","right_id") REFERENCES "public"."vehicle_partnership_settlement_allocations"("id","right_id") ON DELETE restrict;
ALTER TABLE "vehicle_partnerships" ADD CONSTRAINT "vehicle_partnerships_vehicle_id_fleet_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fleet_vehicles"("id") ON DELETE restrict;
ALTER TABLE "vehicle_partnerships" ADD CONSTRAINT "vehicle_partnerships_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE restrict;
CREATE UNIQUE INDEX "vp_activity_replay_unique" ON "vehicle_partnership_activity" USING btree ("idempotency_key");
CREATE UNIQUE INDEX "vp_activity_kosha_revision_unique" ON "vehicle_partnership_activity" USING btree ("kosha_booking_id","operation_key","revision");
CREATE UNIQUE INDEX "vp_activity_service_revision_unique" ON "vehicle_partnership_activity" USING btree ("service_order_id","operation_key","revision");
CREATE UNIQUE INDEX "vp_activity_delivery_revision_unique" ON "vehicle_partnership_activity" USING btree ("delivery_order_id","operation_key","revision");
CREATE INDEX "vp_activity_period_idx" ON "vehicle_partnership_activity" USING btree ("partnership_id","recognition_date");
CREATE UNIQUE INDEX "vp_agreement_effective_unique" ON "vehicle_partnership_agreements" USING btree ("partnership_id","effective_from") WHERE "vehicle_partnership_agreements"."status" IN ('approved','superseded');
CREATE UNIQUE INDEX "vp_agreement_revision_unique" ON "vehicle_partnership_agreements" USING btree ("partnership_id","revision");
CREATE UNIQUE INDEX "vp_agreement_replay_unique" ON "vehicle_partnership_agreements" USING btree ("idempotency_key");
CREATE INDEX "vp_agreement_date_idx" ON "vehicle_partnership_agreements" USING btree ("partnership_id","effective_from");
CREATE UNIQUE INDEX "vp_closing_line_source_unique" ON "vehicle_partnership_closing_lines" USING btree ("closing_id","revision","source_key");
CREATE UNIQUE INDEX "vp_closing_period_unique" ON "vehicle_partnership_closings" USING btree ("partnership_id","period");
CREATE UNIQUE INDEX "vp_closing_financial_unique" ON "vehicle_partnership_closings" USING btree ("financial_transaction_id");
CREATE UNIQUE INDEX "vp_closing_replay_unique" ON "vehicle_partnership_closings" USING btree ("idempotency_key");
CREATE UNIQUE INDEX "vp_cost_expense_unique" ON "vehicle_partnership_cost_funding" USING btree ("vehicle_expense_id") WHERE "vehicle_partnership_cost_funding"."status" IN ('pending','approved');
CREATE UNIQUE INDEX "vp_cost_employee_unique" ON "vehicle_partnership_cost_funding" USING btree ("employee_finance_entry_id") WHERE "vehicle_partnership_cost_funding"."status" IN ('pending','approved');
CREATE UNIQUE INDEX "vp_cost_replay_unique" ON "vehicle_partnership_cost_funding" USING btree ("idempotency_key");
CREATE UNIQUE INDEX "vp_member_customer_unique" ON "vehicle_partnership_members" USING btree ("agreement_id","customer_id");
CREATE UNIQUE INDEX "vp_member_supplier_unique" ON "vehicle_partnership_members" USING btree ("agreement_id","supplier_id");
CREATE UNIQUE INDEX "vp_member_staff_unique" ON "vehicle_partnership_members" USING btree ("agreement_id","staff_id");
CREATE UNIQUE INDEX "vp_right_event_unique" ON "vehicle_partnership_rights" USING btree ("event_key");
CREATE INDEX "vp_right_member_idx" ON "vehicle_partnership_rights" USING btree ("partnership_id","member_id","category","status");
CREATE UNIQUE INDEX "vp_settlement_tx_right_purpose_unique" ON "vehicle_partnership_settlement_allocations" USING btree ("financial_transaction_id","right_id","purpose") WHERE "vehicle_partnership_settlement_allocations"."conversion_allocation_id" IS NULL;
CREATE UNIQUE INDEX "vp_settlement_converted_coverage_unique" ON "vehicle_partnership_settlement_allocations" USING btree ("financial_transaction_id","right_id","purpose","conversion_allocation_id") WHERE "vehicle_partnership_settlement_allocations"."conversion_allocation_id" IS NOT NULL;
CREATE UNIQUE INDEX "vp_settlement_replay_unique" ON "vehicle_partnership_settlement_allocations" USING btree ("idempotency_key");
CREATE INDEX "vp_settlement_right_idx" ON "vehicle_partnership_settlement_allocations" USING btree ("right_id");
CREATE UNIQUE INDEX "vp_vehicle_unique" ON "vehicle_partnerships" USING btree ("vehicle_id");
CREATE UNIQUE INDEX "vp_singleton_unique" ON "vehicle_partnerships" USING btree ("singleton_slot");
