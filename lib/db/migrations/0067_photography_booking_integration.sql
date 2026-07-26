-- Central photography booking integration. Additive only: legacy events, orders and files remain intact.

ALTER TABLE photography_events ADD COLUMN IF NOT EXISTS booking_id integer REFERENCES service_orders(id) ON DELETE SET NULL;
ALTER TABLE photography_events ADD COLUMN IF NOT EXISTS booking_code varchar(80);
ALTER TABLE photography_events ADD COLUMN IF NOT EXISTS map_url text;
ALTER TABLE photography_events ADD COLUMN IF NOT EXISTS phone varchar(30);
ALTER TABLE photography_events ADD COLUMN IF NOT EXISTS phone_2 varchar(30);
ALTER TABLE photography_events ADD COLUMN IF NOT EXISTS event_start_time varchar(10);
ALTER TABLE photography_events ADD COLUMN IF NOT EXISTS event_end_time varchar(10);
ALTER TABLE photography_events ADD COLUMN IF NOT EXISTS photography_items jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE photography_events ADD COLUMN IF NOT EXISTS required_photographers integer NOT NULL DEFAULT 1;
ALTER TABLE photography_events ADD COLUMN IF NOT EXISTS customer_notes text;
ALTER TABLE photography_events ADD COLUMN IF NOT EXISTS internal_notes text;
ALTER TABLE photography_events ADD COLUMN IF NOT EXISTS sync_state varchar(30) NOT NULL DEFAULT 'legacy';
ALTER TABLE photography_events ADD COLUMN IF NOT EXISTS sync_reason text;
ALTER TABLE photography_events ADD COLUMN IF NOT EXISTS last_synced_at timestamp;
CREATE UNIQUE INDEX IF NOT EXISTS photography_events_booking_idx ON photography_events(booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS photography_events_booking_code_idx ON photography_events(booking_code);

ALTER TABLE photography_shoots ADD COLUMN IF NOT EXISTS booking_id integer REFERENCES service_orders(id) ON DELETE SET NULL;
ALTER TABLE photography_shoot_events ADD COLUMN IF NOT EXISTS booking_id integer REFERENCES service_orders(id) ON DELETE SET NULL;
ALTER TABLE photography_shoot_crew ADD COLUMN IF NOT EXISTS booking_id integer REFERENCES service_orders(id) ON DELETE SET NULL;
ALTER TABLE photography_shoot_crew ADD COLUMN IF NOT EXISTS assignment_status varchar(30) NOT NULL DEFAULT 'assigned';
ALTER TABLE photography_shoot_crew ADD COLUMN IF NOT EXISTS assigned_by integer REFERENCES staff(id) ON DELETE SET NULL;
ALTER TABLE photography_shoot_crew ADD COLUMN IF NOT EXISTS assigned_at timestamp NOT NULL DEFAULT now();
ALTER TABLE photography_shoot_crew ADD COLUMN IF NOT EXISTS accepted_at timestamp;
ALTER TABLE photography_shoot_crew ADD COLUMN IF NOT EXISTS rejected_at timestamp;
ALTER TABLE photography_shoot_crew ADD COLUMN IF NOT EXISTS started_at timestamp;
ALTER TABLE photography_shoot_crew ADD COLUMN IF NOT EXISTS completed_at timestamp;
ALTER TABLE photography_shoot_crew ADD COLUMN IF NOT EXISTS conflict_reason text;
ALTER TABLE photography_shoot_crew ADD COLUMN IF NOT EXISTS override_reason text;
CREATE UNIQUE INDEX IF NOT EXISTS photography_shoots_booking_idx ON photography_shoots(booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS photography_shoot_crew_booking_idx ON photography_shoot_crew(booking_id, staff_id, assignment_status);

ALTER TABLE photography_edit_projects ADD COLUMN IF NOT EXISTS booking_id integer REFERENCES service_orders(id) ON DELETE SET NULL;
ALTER TABLE photography_edit_events ADD COLUMN IF NOT EXISTS booking_id integer REFERENCES service_orders(id) ON DELETE SET NULL;
ALTER TABLE photography_card_assignments ADD COLUMN IF NOT EXISTS booking_id integer REFERENCES service_orders(id) ON DELETE SET NULL;
ALTER TABLE photography_media_batches ADD COLUMN IF NOT EXISTS booking_id integer REFERENCES service_orders(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS photography_edit_projects_booking_idx ON photography_edit_projects(booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS photography_card_assignments_booking_idx ON photography_card_assignments(booking_id, status);
CREATE INDEX IF NOT EXISTS photography_media_batches_booking_idx ON photography_media_batches(booking_id, kind);

UPDATE photography_shoots s SET booking_id = e.booking_id
FROM photography_events e WHERE s.event_id = e.id AND s.booking_id IS NULL AND e.booking_id IS NOT NULL;
UPDATE photography_shoot_events se SET booking_id = s.booking_id
FROM photography_shoots s WHERE se.shoot_id = s.id AND se.booking_id IS NULL AND s.booking_id IS NOT NULL;
UPDATE photography_shoot_crew c SET booking_id = s.booking_id
FROM photography_shoots s WHERE c.shoot_id = s.id AND c.booking_id IS NULL AND s.booking_id IS NOT NULL;
UPDATE photography_edit_projects p SET booking_id = s.booking_id
FROM photography_shoots s WHERE p.shoot_id = s.id AND p.booking_id IS NULL AND s.booking_id IS NOT NULL;
UPDATE photography_edit_events e SET booking_id = p.booking_id
FROM photography_edit_projects p WHERE e.project_id = p.id AND e.booking_id IS NULL AND p.booking_id IS NOT NULL;
UPDATE photography_card_assignments a SET booking_id = s.booking_id
FROM photography_shoots s WHERE a.shoot_id = s.id AND a.booking_id IS NULL AND s.booking_id IS NOT NULL;
UPDATE photography_media_batches b SET booking_id = s.booking_id
FROM photography_shoots s WHERE b.shoot_id = s.id AND b.booking_id IS NULL AND s.booking_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS photography_checklist_items (
  id serial PRIMARY KEY,
  booking_id integer NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  shoot_id integer REFERENCES photography_shoots(id) ON DELETE CASCADE,
  phase varchar(20) NOT NULL,
  item_key varchar(80) NOT NULL,
  label text NOT NULL,
  is_required boolean NOT NULL DEFAULT true,
  is_completed boolean NOT NULL DEFAULT false,
  completed_by integer REFERENCES staff(id) ON DELETE SET NULL,
  completed_at timestamp,
  evidence_url text,
  note text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT photography_checklist_items_unique UNIQUE(booking_id, phase, item_key)
);
CREATE INDEX IF NOT EXISTS photography_checklist_items_booking_idx ON photography_checklist_items(booking_id, phase);

CREATE TABLE IF NOT EXISTS photography_uploads (
  id serial PRIMARY KEY,
  booking_id integer NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  shoot_id integer REFERENCES photography_shoots(id) ON DELETE SET NULL,
  kind varchar(40) NOT NULL,
  storage_path text,
  file_url text NOT NULL,
  file_name text,
  mime_type varchar(120),
  access_level varchar(20) NOT NULL DEFAULT 'team',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  uploaded_by integer REFERENCES staff(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS photography_uploads_booking_idx ON photography_uploads(booking_id, kind, created_at);

CREATE TABLE IF NOT EXISTS photography_workflow_settings (
  id serial PRIMARY KEY,
  code varchar(40) NOT NULL UNIQUE DEFAULT 'default',
  active_stages jsonb NOT NULL DEFAULT '["new_booking","awaiting_assignment","crew_assigned","accepted","waiting_event","on_the_way","arrived","shooting","shoot_ended","files_received","transferring","sorting","editing","customer_review","revising","ready_print","printing","ready_delivery","delivered","completed","cancelled"]'::jsonb,
  require_reaccept_on_schedule_change boolean NOT NULL DEFAULT true,
  updated_by integer REFERENCES staff(id) ON DELETE SET NULL,
  updated_at timestamp NOT NULL DEFAULT now()
);
INSERT INTO photography_workflow_settings(code) VALUES ('default') ON CONFLICT (code) DO NOTHING;

UPDATE staff SET permissions = COALESCE(permissions, '[]'::jsonb) ||
  '["photography.portal.view","photography.booking.view","photography.assignment.manage","photography.job.accept","photography.status.update","photography.checklist.update","photography.upload.create","photography.files.manage","photography.editing.manage","photography.delivery.confirm","photography.financials.view","photography.reports.view"]'::jsonb
WHERE role IN ('admin','manager');

UPDATE staff SET permissions = COALESCE(permissions, '[]'::jsonb) ||
  '["photography.portal.view","photography.booking.view","photography.job.accept","photography.status.update","photography.checklist.update","photography.upload.create"]'::jsonb
WHERE role = 'photographer';
