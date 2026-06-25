ALTER TABLE "expense_categories"
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now();

ALTER TABLE "expenses"
  ADD COLUMN IF NOT EXISTS "updated_by" integer,
  ADD COLUMN IF NOT EXISTS "updated_by_name" text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;

CREATE INDEX IF NOT EXISTS "expenses_date_idx" ON "expenses" ("date");
CREATE INDEX IF NOT EXISTS "expenses_category_id_idx" ON "expenses" ("category_id");
CREATE INDEX IF NOT EXISTS "expenses_payment_method_idx" ON "expenses" ("payment_method");
CREATE INDEX IF NOT EXISTS "expenses_created_by_idx" ON "expenses" ("created_by");
CREATE INDEX IF NOT EXISTS "expenses_deleted_at_idx" ON "expenses" ("deleted_at");

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
