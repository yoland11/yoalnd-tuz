-- Equipment Passport: serial number for assets (Digital DNA + duplicate-serial protection).
-- Additive only. Uniqueness is enforced in the application layer (case-insensitive,
-- empty serials allowed) so existing rows with no serial are never blocked.
ALTER TABLE "asset_profiles" ADD COLUMN IF NOT EXISTS "serial_number" varchar(120);
