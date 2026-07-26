import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

let operationsTablesReady: Promise<void> | null = null;

/**
 * Additive runtime guard for installations that have not applied the latest
 * migration yet. It never drops, renames, or rewrites historical orders.
 */
export async function ensureGraduationOperationsTables() {
  if (!operationsTablesReady) {
    operationsTablesReady = db
      .execute(sql`
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
      `)
      .then(() => undefined)
      .catch((error) => {
        operationsTablesReady = null;
        throw error;
      });
  }
  await operationsTablesReady;
}
