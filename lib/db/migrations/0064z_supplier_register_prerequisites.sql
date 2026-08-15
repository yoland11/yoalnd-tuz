-- 0065 indexes supplier fields that historical installs added lazily.
ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS supplier_code varchar(40),
  ADD COLUMN IF NOT EXISTS company text,
  ADD COLUMN IF NOT EXISTS contact_person text,
  ADD COLUMN IF NOT EXISTS whatsapp varchar(30),
  ADD COLUMN IF NOT EXISTS category varchar(60),
  ADD COLUMN IF NOT EXISTS payment_terms varchar(80),
  ADD COLUMN IF NOT EXISTS credit_limit numeric(16,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_balance numeric(16,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'active';
