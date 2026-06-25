-- وحدة الإدارة المالية: إضافات آمنة (nullable / بقيم افتراضية) متوافقة مع البيانات الحالية.
-- إقفال نهاية اليوم + قفل اليوم
ALTER TABLE "daily_cash_reports" ADD COLUMN IF NOT EXISTS "status" varchar(20) NOT NULL DEFAULT 'open';
ALTER TABLE "daily_cash_reports" ADD COLUMN IF NOT EXISTS "closed_by" integer;
ALTER TABLE "daily_cash_reports" ADD COLUMN IF NOT EXISTS "closed_by_name" text NOT NULL DEFAULT '';
ALTER TABLE "daily_cash_reports" ADD COLUMN IF NOT EXISTS "closed_at" timestamp;
CREATE INDEX IF NOT EXISTS "daily_cash_reports_status_idx" ON "daily_cash_reports" ("status");

-- موافقة المدير على فروق الصندوق
ALTER TABLE "daily_cash_reconciliations" ADD COLUMN IF NOT EXISTS "approval_status" varchar(20) NOT NULL DEFAULT 'none';
ALTER TABLE "daily_cash_reconciliations" ADD COLUMN IF NOT EXISTS "approved_by" integer;
ALTER TABLE "daily_cash_reconciliations" ADD COLUMN IF NOT EXISTS "approved_by_name" text NOT NULL DEFAULT '';
ALTER TABLE "daily_cash_reconciliations" ADD COLUMN IF NOT EXISTS "approval_note" text;
ALTER TABLE "daily_cash_reconciliations" ADD COLUMN IF NOT EXISTS "approved_at" timestamp;

-- توسيع إدارة المصاريف
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "name" text NOT NULL DEFAULT '';
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "payment_method" varchar(20) NOT NULL DEFAULT 'cash';
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "receipt_image" text;
