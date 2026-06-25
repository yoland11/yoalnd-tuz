-- إضافة حقول ترجمة المحتوى (كردي/تركي) للمنتجات والخدمات والأقسام.
-- كلها أعمدة نصية اختيارية (nullable) — إضافة آمنة ومتوافقة تماماً مع البيانات الحالية،
-- والعربية تبقى المرجع الافتراضي عند فراغ الترجمة.

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "name_ku" text;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "name_tr" text;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "description_ku" text;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "description_tr" text;

ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "name_ku" text;
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "name_tr" text;
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "description_ku" text;
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "description_tr" text;

ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "name_ku" text;
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "name_tr" text;
