-- Additive only. Apply this file alone after 0134_customer_followups.sql.
BEGIN;
ALTER TABLE customer_followups ADD COLUMN IF NOT EXISTS expected_event_date date;
ALTER TABLE customer_followups ADD COLUMN IF NOT EXISTS contact_stage varchar(20);
ALTER TABLE customer_followups ADD COLUMN IF NOT EXISTS occasion_key varchar(40);
CREATE TABLE IF NOT EXISTS event_message_consents (
 recipient_key varchar(80) NOT NULL,
 phone varchar(30) NOT NULL,
 opted_in boolean NOT NULL DEFAULT false,
 blocked boolean NOT NULL DEFAULT false,
 evidence text NOT NULL,
 actor_id integer NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(recipient_key,phone)
);
CREATE TABLE IF NOT EXISTS event_message_campaigns (
 id serial PRIMARY KEY,
 title text NOT NULL,
 template_key varchar(40) NOT NULL,
 channel varchar(12) NOT NULL CHECK(channel IN ('manual','meta')),
 status varchar(20) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled','complete','suspended')),
 suspension_code varchar(80),
 created_by integer NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
 approved_by integer REFERENCES staff(id) ON DELETE RESTRICT,
 approved_at timestamptz,
 scheduled_at timestamptz NOT NULL DEFAULT now(),
 snapshot_hash varchar(64) NOT NULL,
 provider_template jsonb,
 request_token varchar(160) NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(status NOT IN ('approved','complete') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS event_message_campaigns_due_idx ON event_message_campaigns(status,scheduled_at,id);
CREATE TABLE IF NOT EXISTS event_message_recipients (
 id serial PRIMARY KEY,
 campaign_id integer NOT NULL REFERENCES event_message_campaigns(id) ON DELETE RESTRICT,
 recipient_key varchar(80) NOT NULL,
 phone varchar(30) NOT NULL,
 snapshot jsonb NOT NULL,
 message text NOT NULL,
 status varchar(20) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','accepted','sent','delivered','read','failed','unknown','manual_opened','blocked')),
 provider_message_id text UNIQUE,
 claim_token varchar(64),
 attempted_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 error_code varchar(80),
 UNIQUE(campaign_id,phone),
 UNIQUE(campaign_id,recipient_key)
);
CREATE INDEX IF NOT EXISTS event_message_recipients_pending_idx ON event_message_recipients(campaign_id,status,id);
CREATE TABLE IF NOT EXISTS event_message_events (
 id serial PRIMARY KEY,
 campaign_id integer REFERENCES event_message_campaigns(id) ON DELETE RESTRICT,
 recipient_id integer REFERENCES event_message_recipients(id) ON DELETE RESTRICT,
 actor_id integer REFERENCES staff(id) ON DELETE RESTRICT,
 action varchar(40) NOT NULL,
 details jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
-- Signed status callbacks can arrive before the sending request stores its response.
-- Keep only identifiers/status, not webhook bodies or student data; purge after 7 days.
CREATE TABLE IF NOT EXISTS event_message_delivery_inbox (
 provider_message_id text PRIMARY KEY,
 phone varchar(30) NOT NULL,
 status varchar(20) NOT NULL CHECK(status IN ('sent','delivered','read','failed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS event_followup_reminders (
 followup_id integer NOT NULL REFERENCES customer_followups(id) ON DELETE RESTRICT,
 followup_at timestamptz NOT NULL,
 staff_id integer NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
 notification_id integer NOT NULL REFERENCES notifications(id) ON DELETE RESTRICT,
 PRIMARY KEY(followup_id,followup_at,staff_id)
);
DO $$
DECLARE required record;
BEGIN
 FOR required IN SELECT * FROM (VALUES
  ('customer_followups','expected_event_date','date'),('customer_followups','contact_stage','character varying'),('customer_followups','occasion_key','character varying'),
  ('event_message_campaigns','snapshot_hash','character varying'),('event_message_campaigns','suspension_code','character varying'),
  ('event_message_recipients','snapshot','jsonb'),('event_message_recipients','provider_message_id','text'),
  ('event_message_delivery_inbox','provider_message_id','text'),('event_message_consents','opted_in','boolean'),
  ('event_message_events','details','jsonb'),('event_followup_reminders','notification_id','integer')
 ) AS expected(table_name,column_name,data_type)
 LOOP
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns c WHERE c.table_schema=current_schema() AND c.table_name=required.table_name AND c.column_name=required.column_name AND c.data_type=required.data_type) THEN
    RAISE EXCEPTION 'Incompatible event messaging schema: %.%',required.table_name,required.column_name;
  END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid='event_message_recipients'::regclass AND i.indisunique AND i.indisvalid AND pg_get_indexdef(i.indexrelid) LIKE '%(campaign_id, phone)%') THEN
  RAISE EXCEPTION 'Event messaging recipient uniqueness is unavailable';
 END IF;
END $$;
COMMIT;
