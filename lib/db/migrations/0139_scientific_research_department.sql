-- Isolated, additive research department extension. No historical value rewrites.
ALTER TABLE research_orders ADD COLUMN IF NOT EXISTS title_english text;
ALTER TABLE research_orders ADD COLUMN IF NOT EXISTS academic_level varchar(30);
ALTER TABLE research_orders ADD COLUMN IF NOT EXISTS research_category varchar(40);
ALTER TABLE research_orders ADD COLUMN IF NOT EXISTS payment_due_date date;
-- Durable optional creation identity. PostgreSQL unique indexes allow legacy NULLs.
ALTER TABLE research_orders ADD COLUMN IF NOT EXISTS creation_key varchar(180);
CREATE UNIQUE INDEX IF NOT EXISTS research_orders_creation_key_idx ON research_orders(creation_key);
CREATE INDEX IF NOT EXISTS research_orders_payment_due_idx ON research_orders(payment_due_date, status);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS research_order_id integer;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_research_order_id_fk' AND conrelid = 'expenses'::regclass) THEN
  ALTER TABLE expenses ADD CONSTRAINT expenses_research_order_id_fk FOREIGN KEY (research_order_id) REFERENCES research_orders(id) ON DELETE SET NULL;
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS expenses_research_order_idx ON expenses(research_order_id, date);
-- Link the original procurement document; no copied cost or supplier payment.
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS research_order_id integer;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='purchase_invoices_research_order_fk' AND conrelid='purchase_invoices'::regclass) THEN
  ALTER TABLE purchase_invoices ADD CONSTRAINT purchase_invoices_research_order_fk FOREIGN KEY(research_order_id) REFERENCES research_orders(id) ON DELETE SET NULL;
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS purchase_invoices_research_order_idx ON purchase_invoices(research_order_id);
