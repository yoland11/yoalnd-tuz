-- Customer authentication is separate from staff/admin authentication and never
-- duplicates the business customer, order, invoice or payment records.
CREATE TABLE IF NOT EXISTS customer_accounts (
  id serial PRIMARY KEY,
  customer_id integer NOT NULL UNIQUE REFERENCES customers(id) ON DELETE RESTRICT,
  customer_code varchar(32) NOT NULL UNIQUE,
  username varchar(80) NOT NULL UNIQUE,
  phone_normalized varchar(20) NOT NULL,
  email text,
  password_hash text NOT NULL,
  recovery_code_hash text NOT NULL,
  recovery_generated_at timestamp NOT NULL DEFAULT now(),
  recovery_acknowledged_at timestamp,
  failed_login_count integer NOT NULL DEFAULT 0,
  locked_until timestamp,
  link_status varchar(24) NOT NULL DEFAULT 'linked',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_accounts_phone_normalized_idx ON customer_accounts(phone_normalized);

CREATE TABLE IF NOT EXISTS customer_sessions (
  id serial PRIMARY KEY,
  session_id uuid NOT NULL UNIQUE,
  account_id integer NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
  customer_id integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamp NOT NULL,
  user_agent text,
  device_id text,
  ip_address varchar(80),
  last_active_at timestamp,
  revoked_at timestamp,
  revoke_reason text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_sessions_customer_idx ON customer_sessions(customer_id, expires_at);
CREATE INDEX IF NOT EXISTS customer_sessions_account_idx ON customer_sessions(account_id);

CREATE TABLE IF NOT EXISTS customer_account_recovery_requests (
  id serial PRIMARY KEY,
  customer_id integer REFERENCES customers(id) ON DELETE SET NULL,
  account_id integer REFERENCES customer_accounts(id) ON DELETE SET NULL,
  identifier varchar(120) NOT NULL,
  phone_normalized varchar(20),
  notes text,
  status varchar(24) NOT NULL DEFAULT 'pending',
  reviewed_by integer REFERENCES staff(id) ON DELETE SET NULL,
  review_notes text,
  created_at timestamp NOT NULL DEFAULT now(),
  reviewed_at timestamp
);

CREATE TABLE IF NOT EXISTS customer_private_photos (
  id serial PRIMARY KEY,
  customer_id integer NOT NULL UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  mime_type varchar(80) NOT NULL,
  file_size integer NOT NULL,
  width integer,
  height integer,
  checksum varchar(128) NOT NULL,
  deleted_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_account_audit_logs (
  id serial PRIMARY KEY,
  customer_id integer REFERENCES customers(id) ON DELETE SET NULL,
  account_id integer REFERENCES customer_accounts(id) ON DELETE SET NULL,
  actor_staff_id integer REFERENCES staff(id) ON DELETE SET NULL,
  action varchar(100) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address varchar(80),
  user_agent text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_account_audit_customer_idx
  ON customer_account_audit_logs(customer_id, created_at DESC);
