import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { ensureGraduationOperationsTables } from "@/server/graduation-schema";

let enterpriseTablesReady: Promise<void> | null = null;

/**
 * Additive compatibility guard for branches that have not applied migration
 * 0068 yet. This deliberately performs no deletes and does not rewrite orders.
 */
export async function ensureGraduationEnterpriseTables() {
  if (!enterpriseTablesReady) {
    enterpriseTablesReady = (async () => {
      await ensureGraduationOperationsTables();
      await db.execute(sql`
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
      `);
    })().catch((error) => {
      enterpriseTablesReady = null;
      throw error;
    });
  }
  await enterpriseTablesReady;
}
