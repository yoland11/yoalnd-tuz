-- Safe recovery for indexes verified as absent by the production read-only
-- schema audit. This migration is additive only: no table data is changed.

CREATE INDEX IF NOT EXISTS "catering_categories_active_idx" ON "catering_categories" ("is_active", "sort_order");
CREATE INDEX IF NOT EXISTS "catering_menu_items_category_schema_idx" ON "catering_menu_items" ("category_id", "is_active");
CREATE INDEX IF NOT EXISTS "catering_orders_status_schema_idx" ON "catering_orders" ("status", "event_date");
CREATE INDEX IF NOT EXISTS "customer_attributions_customer_idx" ON "customer_attributions" ("customer_id", "created_at");
CREATE INDEX IF NOT EXISTS "customer_private_photos_customer_idx" ON "customer_private_photos" ("customer_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "customer_sessions_account_idx" ON "customer_sessions" ("account_id");
CREATE INDEX IF NOT EXISTS "design_library_items_type_idx" ON "design_library_items" ("type", "is_active");
CREATE INDEX IF NOT EXISTS "dispatch_assignments_status_idx" ON "dispatch_assignments" ("status", "created_at");
CREATE INDEX IF NOT EXISTS "employee_advance_repayments_employee_idx" ON "employee_advance_repayments" ("employee_id", "payment_date");
CREATE INDEX IF NOT EXISTS "employee_advances_request_date_idx" ON "employee_advances" ("request_date");
CREATE INDEX IF NOT EXISTS "employee_custody_group_assets_product_active_idx" ON "employee_custody_group_assets" ("product_id", "is_active");
CREATE INDEX IF NOT EXISTS "employee_custody_groups_staff_status_idx" ON "employee_custody_groups" ("staff_id", "status");
CREATE INDEX IF NOT EXISTS "enterprise_branches_active_idx" ON "enterprise_branches" ("is_active");
CREATE INDEX IF NOT EXISTS "equipment_custody_product_status_idx" ON "equipment_custody" ("product_id", "status");
CREATE INDEX IF NOT EXISTS "equipment_custody_staff_status_idx" ON "equipment_custody" ("staff_id", "status");
CREATE INDEX IF NOT EXISTS "field_locations_entity_idx" ON "field_locations" ("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "fleet_vehicles_branch_idx" ON "fleet_vehicles" ("branch_id");
CREATE UNIQUE INDEX IF NOT EXISTS "graduation_favorites_owner_reference_idx" ON "graduation_favorites" ("customer_id", "session_key", "favorite_type", "reference_id");
CREATE INDEX IF NOT EXISTS "graduation_orders_created_idx" ON "graduation_orders" ("created_at");
CREATE INDEX IF NOT EXISTS "graduation_resources_product_idx" ON "graduation_resources" ("product_id");
CREATE INDEX IF NOT EXISTS "hr_incentive_events_rule_period_idx" ON "hr_incentive_events" ("rule_id", "staff_id", "period");
CREATE INDEX IF NOT EXISTS "internal_channels_department_idx" ON "internal_channels" ("department", "updated_at");
CREATE INDEX IF NOT EXISTS "internal_channels_entity_idx" ON "internal_channels" ("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "knowledge_articles_category_idx" ON "knowledge_articles" ("category", "is_active");
CREATE INDEX IF NOT EXISTS "knowledge_cases_entity_idx" ON "knowledge_cases" ("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "lost_time_entries_entity_idx" ON "lost_time_entries" ("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "management_decisions_date_idx" ON "management_decisions" ("decided_at");
CREATE INDEX IF NOT EXISTS "management_decisions_entity_idx" ON "management_decisions" ("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "payroll_lines_staff_idx" ON "payroll_lines" ("staff_id", "created_at");
CREATE INDEX IF NOT EXISTS "print_agents_branch_idx" ON "print_agents" ("branch_id", "status");
CREATE INDEX IF NOT EXISTS "print_agents_last_seen_idx" ON "print_agents" ("last_seen_at");
CREATE INDEX IF NOT EXISTS "print_jobs_branch_idx" ON "print_jobs" ("branch_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "printers_agent_idx" ON "printers" ("agent_id", "is_active");
CREATE INDEX IF NOT EXISTS "printers_branch_idx" ON "printers" ("branch_id", "is_active");
CREATE INDEX IF NOT EXISTS "research_ai_generations_order_idx" ON "research_ai_generations" ("research_order_id", "created_at");
CREATE INDEX IF NOT EXISTS "research_chapters_writer_idx" ON "research_chapters" ("assigned_writer_id", "status");
CREATE INDEX IF NOT EXISTS "research_messages_order_idx" ON "research_messages" ("research_order_id", "created_at");
CREATE INDEX IF NOT EXISTS "research_orders_search_idx" ON "research_orders" ("university_name", "department");
CREATE INDEX IF NOT EXISTS "research_plagiarism_reports_order_idx" ON "research_plagiarism_reports" ("research_order_id", "created_at");
CREATE INDEX IF NOT EXISTS "research_sources_year_idx" ON "research_sources" ("publication_year");
CREATE INDEX IF NOT EXISTS "research_status_events_order_idx" ON "research_status_events" ("research_order_id", "created_at");
CREATE INDEX IF NOT EXISTS "research_universities_name_idx" ON "research_universities" ("name_ar");
CREATE INDEX IF NOT EXISTS "warehouse_camera_snapshots_entity_idx" ON "warehouse_camera_snapshots" ("entity_type", "entity_id", "captured_at");

INSERT INTO ajn_schema_revisions(revision, description)
VALUES (101, 'Production schema index recovery from read-only audit')
ON CONFLICT (revision) DO NOTHING;
INSERT INTO ajn_migration_history(migration_id, checksum, description)
VALUES ('0101_schema_index_recovery', 'manual-reviewed', 'Safe additive indexes confirmed missing by schema preflight')
ON CONFLICT (migration_id) DO NOTHING;
