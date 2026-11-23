-- Optional mobile contact. Existing staff identities and historical records stay intact.
ALTER TABLE staff ADD COLUMN IF NOT EXISTS phone text;

-- Fail closed if a previously created column has an incompatible definition.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'staff'::regclass AND attname = 'phone'
      AND atttypid = 'text'::regtype AND NOT attnotnull AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'staff.phone must be nullable text';
  END IF;
END $$;
