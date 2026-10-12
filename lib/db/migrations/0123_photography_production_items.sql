-- Photography Production Center: one work item per booking deliverable.
-- Additive only. Bookings stay in service_orders and employees in staff; status
-- history is written to the existing entity_timeline. No financial effect.
CREATE TABLE IF NOT EXISTS photography_production_items (
  id serial PRIMARY KEY,
  booking_id integer NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  kind varchar(20) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'remaining',
  assignee_staff_id integer REFERENCES staff(id) ON DELETE SET NULL,
  assignee_name text,
  due_date date,
  notes text,
  started_at timestamp,
  completed_at timestamp,
  status_changed_at timestamp NOT NULL DEFAULT now(),
  status_changed_by integer,
  status_changed_by_name text,
  created_by integer,
  created_by_name text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT photography_production_items_kind_check
    CHECK (kind IN ('video', 'photos', 'album', 'printing')),
  CONSTRAINT photography_production_items_status_check
    CHECK (status IN ('remaining', 'in_progress', 'waiting_files', 'completed')),
  CONSTRAINT photography_production_items_booking_kind_unique UNIQUE (booking_id, kind)
);

CREATE INDEX IF NOT EXISTS photography_production_items_status_idx
  ON photography_production_items (status);
CREATE INDEX IF NOT EXISTS photography_production_items_assignee_idx
  ON photography_production_items (assignee_staff_id);
CREATE INDEX IF NOT EXISTS photography_production_items_due_date_idx
  ON photography_production_items (due_date);
