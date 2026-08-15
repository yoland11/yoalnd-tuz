-- Production-safety hardening for administrator sessions.
-- Existing administrator sessions are intentionally revoked once because the
-- historical raw tokens cannot be migrated without retaining replayable secrets.
ALTER TABLE admin_sessions
  ADD COLUMN IF NOT EXISTS token_hash varchar(64);

ALTER TABLE admin_sessions
  ALTER COLUMN token DROP NOT NULL;

UPDATE admin_sessions
SET revoked_at = COALESCE(revoked_at, now()),
    revoke_reason = COALESCE(revoke_reason, 'token_hash_migration'),
    token = NULL
WHERE token IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS admin_sessions_token_hash_idx
  ON admin_sessions(token_hash)
  WHERE token_hash IS NOT NULL;

-- One financial movement may be referenced by several legacy payments after a
-- reconciliation report, so uniqueness remains enforced by the financial
-- transaction idempotency key rather than on this nullable foreign key.
CREATE INDEX IF NOT EXISTS installment_payments_financial_transaction_idx
  ON installment_payments(financial_transaction_id)
  WHERE financial_transaction_id IS NOT NULL;
