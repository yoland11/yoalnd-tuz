-- Presence evidence is separate from attendance punches and payroll.
-- Device coordinates, accuracy and distances are never stored here.
CREATE TABLE IF NOT EXISTS attendance_geofence_sessions (
  record_id integer PRIMARY KEY REFERENCES attendance_records(id) ON DELETE CASCADE,
  auth_session_id integer REFERENCES admin_sessions(id) ON DELETE SET NULL,
  consented_at timestamptz NOT NULL,
  revoked_at timestamptz,
  ends_at timestamptz NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'unavailable' CHECK (status IN ('inside', 'outside', 'returned', 'unavailable')),
  last_observed_at timestamptz,
  last_received_at timestamptz,
  last_trusted_at timestamptz,
  outside_since timestamptz,
  outside_since_received_at timestamptz,
  CONSTRAINT attendance_geofence_sessions_window_check CHECK (ends_at > consented_at),
  CONSTRAINT attendance_geofence_sessions_evidence_check CHECK ((outside_since IS NULL) = (outside_since_received_at IS NULL))
);
CREATE INDEX IF NOT EXISTS attendance_geofence_sessions_end_idx ON attendance_geofence_sessions (ends_at);

CREATE TABLE IF NOT EXISTS attendance_geofence_visits (
  id serial PRIMARY KEY,
  record_id integer NOT NULL REFERENCES attendance_records(id) ON DELETE CASCADE,
  staff_id integer NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  workplace text NOT NULL,
  exit_at timestamptz NOT NULL,
  return_at timestamptz,
  ended_at timestamptz,
  outside_ms integer NOT NULL CHECK (outside_ms >= 0),
  verification varchar(20) NOT NULL DEFAULT 'verified' CHECK (verification IN ('verified', 'interrupted')),
  review_status varchar(20) NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected')),
  reviewed_at timestamptz,
  reviewed_by integer REFERENCES staff(id) ON DELETE SET NULL,
  reviewed_by_name text,
  review_note text,
  CONSTRAINT attendance_geofence_visits_time_check CHECK (
    (ended_at IS NULL OR ended_at >= exit_at) AND
    (return_at IS NULL OR (return_at >= exit_at AND return_at = ended_at))
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_geofence_visits_open_idx ON attendance_geofence_visits (record_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS attendance_geofence_visits_exit_idx ON attendance_geofence_visits (exit_at DESC);
CREATE INDEX IF NOT EXISTS attendance_geofence_visits_staff_exit_idx ON attendance_geofence_visits (staff_id, exit_at DESC);
CREATE INDEX IF NOT EXISTS attendance_geofence_visits_end_idx ON attendance_geofence_visits (ended_at) WHERE ended_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS attendance_geofence_exceptions (
  id serial PRIMARY KEY,
  staff_id integer NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  kind varchar(20) NOT NULL CHECK (kind IN ('temporary_exit', 'delivery', 'external_event')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  approved_by integer REFERENCES staff(id) ON DELETE SET NULL,
  approved_by_name text NOT NULL,
  revoked_at timestamptz,
  revoked_by integer REFERENCES staff(id) ON DELETE SET NULL,
  revoked_by_name text,
  CONSTRAINT attendance_geofence_exceptions_window_check CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS attendance_geofence_exceptions_staff_window_idx ON attendance_geofence_exceptions (staff_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS attendance_geofence_exceptions_end_idx ON attendance_geofence_exceptions (ends_at);

-- Only the AJN server connection may read or write these tables.
ALTER TABLE attendance_geofence_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_geofence_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_geofence_exceptions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'attendance_geofence_sessions'
      AND column_name = 'last_trusted_at' AND data_type = 'timestamp with time zone'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'attendance_geofence_visits' AND column_name = 'outside_ms'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'attendance_geofence_exceptions' AND column_name = 'revoked_at'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_index
    WHERE indexrelid = to_regclass('attendance_geofence_visits_open_idx')
      AND indrelid = to_regclass('attendance_geofence_visits') AND indisunique AND indpred IS NOT NULL
  ) OR (
    SELECT count(*) FROM pg_class WHERE relrowsecurity AND oid IN (
      to_regclass('attendance_geofence_sessions'), to_regclass('attendance_geofence_visits'),
      to_regclass('attendance_geofence_exceptions')
    )
  ) <> 3
  THEN
    RAISE EXCEPTION 'Attendance geofence migration verification failed';
  END IF;
END $$;
