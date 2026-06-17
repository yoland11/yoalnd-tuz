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
  "reference" text,
  "method" varchar(20) NOT NULL DEFAULT 'cash',
  "notes" text,
  "created_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
  "created_by_name" text NOT NULL DEFAULT '',
  "created_at" timestamp NOT NULL DEFAULT now()
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

ALTER TABLE "receipt_vouchers"
  ADD COLUMN IF NOT EXISTS "voucher_no" varchar(30),
  ADD COLUMN IF NOT EXISTS "date" date NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "amount" numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "payer_name" text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "customer_id" integer,
  ADD COLUMN IF NOT EXISTS "order_id" integer,
  ADD COLUMN IF NOT EXISTS "booking_id" integer,
  ADD COLUMN IF NOT EXISTS "reference" text,
  ADD COLUMN IF NOT EXISTS "method" varchar(20) NOT NULL DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS "notes" text,
  ADD COLUMN IF NOT EXISTS "created_by" integer,
  ADD COLUMN IF NOT EXISTS "created_by_name" text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now();

ALTER TABLE "payment_vouchers"
  ADD COLUMN IF NOT EXISTS "voucher_no" varchar(30),
  ADD COLUMN IF NOT EXISTS "date" date NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "amount" numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "payee_name" text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "reference" text,
  ADD COLUMN IF NOT EXISTS "method" varchar(20) NOT NULL DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS "notes" text,
  ADD COLUMN IF NOT EXISTS "created_by" integer,
  ADD COLUMN IF NOT EXISTS "created_by_name" text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS "expenses_date_idx" ON "expenses" ("date");
CREATE INDEX IF NOT EXISTS "expenses_category_id_idx" ON "expenses" ("category_id");
CREATE INDEX IF NOT EXISTS "expenses_payment_method_idx" ON "expenses" ("payment_method");
CREATE INDEX IF NOT EXISTS "expenses_created_by_idx" ON "expenses" ("created_by");
CREATE INDEX IF NOT EXISTS "expenses_deleted_at_idx" ON "expenses" ("deleted_at");

CREATE UNIQUE INDEX IF NOT EXISTS "receipt_vouchers_voucher_no_idx" ON "receipt_vouchers" ("voucher_no");
CREATE INDEX IF NOT EXISTS "receipt_vouchers_date_idx" ON "receipt_vouchers" ("date");
CREATE INDEX IF NOT EXISTS "receipt_vouchers_customer_id_idx" ON "receipt_vouchers" ("customer_id");
CREATE INDEX IF NOT EXISTS "receipt_vouchers_created_by_idx" ON "receipt_vouchers" ("created_by");

CREATE UNIQUE INDEX IF NOT EXISTS "payment_vouchers_voucher_no_idx" ON "payment_vouchers" ("voucher_no");
CREATE INDEX IF NOT EXISTS "payment_vouchers_date_idx" ON "payment_vouchers" ("date");
CREATE INDEX IF NOT EXISTS "payment_vouchers_created_by_idx" ON "payment_vouchers" ("created_by");

INSERT INTO "expense_categories" ("name", "name_ar")
SELECT seed.name, seed.name_ar
FROM (
  VALUES
    ('rent', 'الإيجار'),
    ('salaries', 'الرواتب'),
    ('fuel', 'الوقود'),
    ('transportation', 'النقل'),
    ('utilities', 'الخدمات'),
    ('purchases', 'المشتريات'),
    ('marketing', 'التسويق'),
    ('maintenance', 'الصيانة'),
    ('delivery', 'التوصيل'),
    ('miscellaneous', 'متفرقات')
) AS seed(name, name_ar)
WHERE NOT EXISTS (
  SELECT 1 FROM "expense_categories" c
  WHERE c."name" = seed.name OR c."name_ar" = seed.name_ar
);
