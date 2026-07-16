-- Persistent configuration and human feedback for the database-grounded AI Event Brain.
CREATE TABLE IF NOT EXISTS ai_event_brain_settings (
  id integer PRIMARY KEY DEFAULT 1,
  alerts_enabled boolean NOT NULL DEFAULT true,
  recommendations_enabled boolean NOT NULL DEFAULT true,
  daily_brief_enabled boolean NOT NULL DEFAULT true,
  executive_summary_enabled boolean NOT NULL DEFAULT true,
  warehouse_analysis_enabled boolean NOT NULL DEFAULT true,
  payroll_analysis_enabled boolean NOT NULL DEFAULT true,
  accounting_analysis_enabled boolean NOT NULL DEFAULT true,
  customer_analysis_enabled boolean NOT NULL DEFAULT true,
  updated_by integer,
  updated_at timestamp NOT NULL DEFAULT now(),
  CHECK (id = 1)
);
INSERT INTO ai_event_brain_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS ai_event_brain_feedback (
  id serial PRIMARY KEY,
  insight_id varchar(160) NOT NULL,
  action varchar(20) NOT NULL CHECK (action IN ('accepted', 'ignored')),
  note text,
  actor_id integer,
  actor_name text NOT NULL DEFAULT '',
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_event_brain_feedback_insight_idx
  ON ai_event_brain_feedback (insight_id, created_at DESC);
