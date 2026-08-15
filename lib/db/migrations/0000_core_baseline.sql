-- AJN baseline tables that predate the numbered migration chain.
-- Additive and idempotent: existing production installations are unchanged.

CREATE TABLE IF NOT EXISTS "admin_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"token" text,
	"token_hash" varchar(64),
	"user_id" integer NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"session_id" uuid DEFAULT gen_random_uuid(),
	"portal" varchar(24),
	"device_id" text,
	"user_agent" text,
	"ip_address" varchar(80),
	"last_active_at" timestamp,
	"revoked_at" timestamp,
	"revoked_by" integer,
	"revoke_reason" text,
	CONSTRAINT "admin_sessions_token_unique" UNIQUE("token")
);
CREATE TABLE IF NOT EXISTS "cart_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"product_id" integer NOT NULL,
	"variant_id" integer,
	"quantity" integer DEFAULT 1 NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"selected_color" text,
	"selected_color_data" jsonb,
	"customization" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_ku" text,
	"name_tr" text,
	"slug" varchar(100) NOT NULL,
	"parent_id" integer,
	"image_url" text,
	"image_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);

CREATE TABLE IF NOT EXISTS "customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"phone" varchar(20) NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"full_name" text,
	"email" text,
	"avatar_url" text,
	"avatar_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"address" text,
	"city" text,
	"role" varchar(20) DEFAULT 'customer' NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"reward_points" integer DEFAULT 0 NOT NULL,
	"reward_level" varchar(20) DEFAULT 'bronze' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "customers_phone_unique" UNIQUE("phone")
);

CREATE TABLE IF NOT EXISTS "delivery_zones" (
	"id" serial PRIMARY KEY NOT NULL,
	"governorate" text NOT NULL,
	"governorate_ar" text NOT NULL,
	"areas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"priced_regions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"estimated_days" integer DEFAULT 2 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"express_fee" numeric(12, 2) DEFAULT '0' NOT NULL,
	"same_day_fee" numeric(12, 2) DEFAULT '0' NOT NULL,
	"cod_fee" numeric(12, 2) DEFAULT '0' NOT NULL,
	"free_delivery_threshold" numeric(14, 2) DEFAULT '0' NOT NULL,
	"delivery_company" text,
	"max_weight" numeric(10, 2) DEFAULT '0' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"notes" text
);

CREATE TABLE IF NOT EXISTS "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_ku" text,
	"name_tr" text,
	"description" text,
	"description_ar" text,
	"description_ku" text,
	"description_tr" text,
	"price" numeric(10, 2) NOT NULL,
	"original_price" numeric(10, 2),
	"cost_price" numeric(14, 2) DEFAULT '0' NOT NULL,
	"stock" numeric(14,3) DEFAULT 0 NOT NULL,
	"min_stock" numeric(14,3) DEFAULT 0 NOT NULL,
	"shared_stock_product_id" integer,
	"is_rental" boolean DEFAULT false NOT NULL,
	"price_per_day" numeric(12, 2) DEFAULT '0' NOT NULL,
	"is_asset" boolean DEFAULT false NOT NULL,
	"barcode" varchar(100),
	"category_id" integer,
	"subcategory_id" integer,
	"subcategory_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"category" varchar(100),
	"subcategory" varchar(100),
	"asset_category_id" integer,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"videos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"image_metadata" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"colors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"available_in_bouquet_designer" boolean DEFAULT false NOT NULL,
	"show_in_bouquet_builder" boolean DEFAULT false NOT NULL,
	"bouquet_element_type" varchar(24),
	"preview_cutout_url" text,
	"ready_made_preview_url" text,
	"preview_asset_url" text,
	"preview_color" varchar(32),
	"preview_scale" numeric(6, 3),
	"preview_rotation" numeric(7, 2),
	"preview_layer" integer,
	"preview_position" jsonb,
	"accessory_type" varchar(60),
	"maximum_quantity_per_bouquet" integer,
	"bouquet_recipe" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_ready_made_bouquet" boolean DEFAULT false NOT NULL,
	"is_bouquet_template" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "service_order_status_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"service_order_id" integer NOT NULL,
	"status" varchar(30) NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "service_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"service_id" integer NOT NULL,
	"tracking_code" varchar(40),
	"qr_token" varchar(80),
	"phone_last4" varchar(4),
	"customer_name" text NOT NULL,
	"phone" varchar(20) NOT NULL,
	"event_date" text,
	"event_location" text,
	"notes" text,
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"total_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"deposit_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"remaining_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"payment_status" varchar(20) DEFAULT 'unpaid' NOT NULL,
	"due_date" date,
	"reward_points_awarded" integer DEFAULT 0 NOT NULL,
	"custom_fields" jsonb,
	"internal_notes" text,
	"customer_confirmation" varchar(30),
	"requested_date" text,
	"confirmation_note" text,
	"confirmation_at" timestamp,
	"pre_reschedule_status" varchar(30),
	"archived_at" timestamp,
	"financially_reversed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "services" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_ku" text,
	"name_tr" text,
	"description" text,
	"description_ar" text,
	"description_ku" text,
	"description_tr" text,
	"type" varchar(50) NOT NULL,
	"icon" text,
	"image" text,
	"image_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "order_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"variant_id" integer,
	"product_name" text NOT NULL,
	"product_name_ar" text DEFAULT '' NOT NULL,
	"quantity" integer NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"selected_color" text,
	"selected_color_data" jsonb,
	"customization" text,
	"image" text
);

CREATE TABLE IF NOT EXISTS "order_status_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"status" varchar(30) NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"tracking_code" varchar(40) NOT NULL,
	"qr_token" varchar(80),
	"phone_last4" varchar(4),
	"customer_id" integer,
	"customer_name" text NOT NULL,
	"customer_phone" varchar(20) NOT NULL,
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"service_type" varchar(30),
	"total" numeric(10, 2) NOT NULL,
	"delivery_fee" numeric(10, 2) DEFAULT '0' NOT NULL,
	"coupon_code" varchar(60),
	"coupon_discount_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"loyalty_points_redeemed" integer DEFAULT 0 NOT NULL,
	"loyalty_discount_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"payment_method" varchar(20) DEFAULT 'cod' NOT NULL,
	"deposit_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"remaining_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"payment_status" varchar(20) DEFAULT 'unpaid' NOT NULL,
	"due_date" date,
	"reward_points_awarded" integer DEFAULT 0 NOT NULL,
	"governorate" text,
	"area" text,
	"address" text,
	"maps_url" text,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"internal_notes" text,
	"archived_at" timestamp,
	"financially_reversed" boolean DEFAULT false NOT NULL,
	"stock_applied" integer DEFAULT 1 NOT NULL,
	"stock_restored_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"customer_id" integer,
	"customer_name" text NOT NULL,
	"rating" integer NOT NULL,
	"comment" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "settings" (
	"key" varchar(100) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "whatsapp_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"phone" varchar(30) NOT NULL,
	"event" varchar(40) NOT NULL,
	"message" text NOT NULL,
	"status" varchar(20) NOT NULL,
	"error" text,
	"provider" varchar(30),
	"sent_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "whatsapp_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" varchar(30) DEFAULT 'ultramsg' NOT NULL,
	"enabled_events" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"templates" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"automation_enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "staff" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" varchar(50) NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" text DEFAULT '' NOT NULL,
	"role" varchar(30) DEFAULT 'employee' NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"department" varchar(60) DEFAULT 'general' NOT NULL,
	"base_salary" numeric(16, 2) DEFAULT '0' NOT NULL,
	"hired_at" date DEFAULT now() NOT NULL,
	"job_title" varchar(100),
	"salary_type" varchar(20) DEFAULT 'monthly' NOT NULL,
	"currency" varchar(10) DEFAULT 'IQD' NOT NULL,
	"working_days_per_week" numeric(4, 1) DEFAULT '6' NOT NULL,
	"daily_working_hours" numeric(5, 2) DEFAULT '8' NOT NULL,
	"hourly_rate" numeric(16, 2) DEFAULT '0' NOT NULL,
	"overtime_rate" numeric(16, 2) DEFAULT '0' NOT NULL,
	"attendance_allowance" numeric(16, 2) DEFAULT '0' NOT NULL,
	"transportation_allowance" numeric(16, 2) DEFAULT '0' NOT NULL,
	"food_allowance" numeric(16, 2) DEFAULT '0' NOT NULL,
	"phone_allowance" numeric(16, 2) DEFAULT '0' NOT NULL,
	"housing_allowance" numeric(16, 2) DEFAULT '0' NOT NULL,
	"other_fixed_allowances" numeric(16, 2) DEFAULT '0' NOT NULL,
	"fixed_deduction" numeric(16, 2) DEFAULT '0' NOT NULL,
	"sales_commission_percentage" numeric(6, 2) DEFAULT '0' NOT NULL,
	"profit_commission_percentage" numeric(6, 2) DEFAULT '0' NOT NULL,
	"payment_method" varchar(30) DEFAULT 'cash' NOT NULL,
	"payment_reference" text,
	"salary_status" varchar(20) DEFAULT 'active' NOT NULL,
	"salary_notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_activity_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "staff_username_unique" UNIQUE("username")
);

CREATE TABLE IF NOT EXISTS "gallery_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"media_url" text NOT NULL,
	"media_type" varchar(10) DEFAULT 'image' NOT NULL,
	"image_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"title" text,
	"title_ar" text,
	"description" text,
	"thumbnail_url" text,
	"category" varchar(50) DEFAULT 'general' NOT NULL,
	"scope" varchar(40) DEFAULT 'general' NOT NULL,
	"display_location" varchar(40) DEFAULT 'gallery' NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"customer_visible" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date DEFAULT now() NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"category_id" integer,
	"category_name" text DEFAULT '' NOT NULL,
	"payment_method" varchar(20) DEFAULT 'cash' NOT NULL,
	"receipt_image" text,
	"notes" text,
	"created_by" integer,
	"created_by_name" text DEFAULT '' NOT NULL,
	"updated_by" integer,
	"updated_by_name" text DEFAULT '' NOT NULL,
	"approval_status" varchar(20) DEFAULT 'executed' NOT NULL,
	"financial_transaction_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);

CREATE TABLE IF NOT EXISTS "expense_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_ar" text NOT NULL,
	"is_active" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "photography_shoots" (
	"id" serial PRIMARY KEY NOT NULL,
	"booking_id" integer,
	"event_id" integer NOT NULL,
	"stage" varchar(30) DEFAULT 'awaiting_assignment' NOT NULL,
	"venue" text,
	"gps_lat" numeric(10, 7),
	"gps_lng" numeric(10, 7),
	"event_time" varchar(10),
	"checklist" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"checklist_completed_at" timestamp,
	"checklist_completed_by" integer,
	"departed_at" timestamp,
	"arrived_at" timestamp,
	"arrived_lat" numeric(10, 7),
	"arrived_lng" numeric(10, 7),
	"shooting_started_at" timestamp,
	"shooting_ended_at" timestamp,
	"delivered_at" timestamp,
	"completed_at" timestamp,
	"notes" text,
	"cancelled_at" timestamp,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "photography_shoots_booking_id_unique" UNIQUE("booking_id"),
	CONSTRAINT "photography_shoots_event_id_unique" UNIQUE("event_id")
);

CREATE TABLE IF NOT EXISTS "photography_shoot_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"booking_id" integer,
	"shoot_id" integer NOT NULL,
	"staff_id" integer,
	"staff_name" text DEFAULT '' NOT NULL,
	"type" varchar(40) NOT NULL,
	"from_stage" varchar(30),
	"to_stage" varchar(30),
	"note" text,
	"lat" numeric(10, 7),
	"lng" numeric(10, 7),
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "photography_shoot_crew" (
	"id" serial PRIMARY KEY NOT NULL,
	"booking_id" integer,
	"shoot_id" integer NOT NULL,
	"staff_id" integer NOT NULL,
	"staff_name" text DEFAULT '' NOT NULL,
	"role" varchar(30) DEFAULT 'photographer' NOT NULL,
	"is_lead" boolean DEFAULT false NOT NULL,
	"assignment_status" varchar(30) DEFAULT 'assigned' NOT NULL,
	"assigned_by" integer,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	"accepted_at" timestamp,
	"rejected_at" timestamp,
	"started_at" timestamp,
	"completed_at" timestamp,
	"conflict_reason" text,
	"override_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "photography_shoot_crew_unique" UNIQUE("shoot_id","staff_id")
);

CREATE TABLE IF NOT EXISTS "photography_edit_projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"booking_id" integer,
	"shoot_id" integer NOT NULL,
	"status" varchar(30) DEFAULT 'waiting' NOT NULL,
	"editor_staff_id" integer,
	"editor_name" text,
	"due_date" varchar(10),
	"notes" text,
	"assigned_at" timestamp,
	"started_at" timestamp,
	"ready_at" timestamp,
	"delivered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "photography_edit_projects_booking_id_unique" UNIQUE("booking_id"),
	CONSTRAINT "photography_edit_projects_shoot_id_unique" UNIQUE("shoot_id")
);

CREATE TABLE IF NOT EXISTS "photography_edit_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"booking_id" integer,
	"project_id" integer NOT NULL,
	"staff_id" integer,
	"staff_name" text DEFAULT '' NOT NULL,
	"type" varchar(40) NOT NULL,
	"from_status" varchar(30),
	"to_status" varchar(30),
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "photography_card_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"booking_id" integer,
	"card_id" integer NOT NULL,
	"shoot_id" integer NOT NULL,
	"photographer_staff_id" integer,
	"photographer_name" text DEFAULT '' NOT NULL,
	"camera_product_id" integer,
	"camera_name" text,
	"status" varchar(20) DEFAULT 'assigned' NOT NULL,
	"files_copied" integer DEFAULT 0 NOT NULL,
	"copied_at" timestamp,
	"delivered_at" timestamp,
	"returned_at" timestamp,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "photography_card_assignments_unique" UNIQUE("card_id","shoot_id")
);

CREATE TABLE IF NOT EXISTS "photography_media_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"booking_id" integer,
	"shoot_id" integer NOT NULL,
	"kind" varchar(20) NOT NULL,
	"file_count" integer DEFAULT 0 NOT NULL,
	"total_bytes" bigint DEFAULT 0 NOT NULL,
	"card_id" integer,
	"external_url" text,
	"note" text,
	"recorded_by" integer,
	"recorded_by_name" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
