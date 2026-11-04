-- Isolated additive customer followup storage; no booking, financial or communication writes.
CREATE TABLE IF NOT EXISTS "customer_followups" (
  "id" serial PRIMARY KEY,
  "customer_id" integer NOT NULL REFERENCES "customers"("id") ON DELETE RESTRICT,
  "service_key" varchar(40) NOT NULL,
  "assigned_staff_id" integer NOT NULL REFERENCES "staff"("id") ON DELETE RESTRICT,
  "followup_at" timestamptz NOT NULL,
  "note" text NOT NULL DEFAULT '',
  "status" varchar(20) NOT NULL DEFAULT 'interested',
  "completed_at" timestamptz,
  "source_booking_source" varchar(10),
  "source_booking_id" integer,
  "booking_source" varchar(10),
  "booking_id" integer,
  "parent_id" integer REFERENCES "customer_followups"("id") ON DELETE RESTRICT,
  "version" integer NOT NULL DEFAULT 1,
  "created_by" integer NOT NULL REFERENCES "staff"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "create_token" varchar(100) NOT NULL,
  "payload_hash" varchar(64) NOT NULL,
  "suggestion_key" varchar(160),
  CONSTRAINT "customer_followups_service_ck" CHECK ("service_key" IN ('photography', 'kosha', 'sound', 'wedding', 'henna', 'engagement', 'graduation', 'album', 'printing', 'booking_confirmation', 'other')),
  CONSTRAINT "customer_followups_status_ck" CHECK ("status" IN ('interested', 'waiting', 'converted', 'uninterested')),
  CONSTRAINT "customer_followups_version_ck" CHECK ("version" > 0),
  CONSTRAINT "customer_followups_source_booking_ck" CHECK (("source_booking_source" IS NULL AND "source_booking_id" IS NULL) OR ("source_booking_source" IS NOT NULL AND "source_booking_source" IN ('service', 'kosha') AND "source_booking_id" IS NOT NULL AND "source_booking_id" > 0)),
  CONSTRAINT "customer_followups_booking_ck" CHECK (("booking_source" IS NULL AND "booking_id" IS NULL) OR ("booking_source" IS NOT NULL AND "booking_source" IN ('service', 'kosha') AND "booking_id" IS NOT NULL AND "booking_id" > 0)),
  CONSTRAINT "customer_followups_converted_ck" CHECK ("status" <> 'converted' OR ("booking_source" IS NOT NULL AND "booking_id" IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS "customer_followups_create_token_uq" ON "customer_followups" ("create_token");
CREATE UNIQUE INDEX IF NOT EXISTS "customer_followups_open_pair_uq" ON "customer_followups" ("customer_id", "service_key") WHERE "completed_at" IS NULL AND "status" IN ('interested', 'waiting');
CREATE UNIQUE INDEX IF NOT EXISTS "customer_followups_suggestion_uq" ON "customer_followups" ("suggestion_key") WHERE "suggestion_key" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "customer_followups_assignee_due_idx" ON "customer_followups" ("assigned_staff_id", "followup_at");
CREATE INDEX IF NOT EXISTS "customer_followups_customer_idx" ON "customer_followups" ("customer_id");

CREATE TABLE IF NOT EXISTS "customer_followup_events" (
  "id" serial PRIMARY KEY,
  "followup_id" integer NOT NULL REFERENCES "customer_followups"("id") ON DELETE RESTRICT,
  "actor_id" integer NOT NULL REFERENCES "staff"("id") ON DELETE RESTRICT,
  "action" varchar(40) NOT NULL,
  "request_token" varchar(160) NOT NULL,
  "payload_hash" varchar(64) NOT NULL,
  "result" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "customer_followup_events_request_uq" ON "customer_followup_events" ("request_token");
CREATE INDEX IF NOT EXISTS "customer_followup_events_followup_idx" ON "customer_followup_events" ("followup_id", "created_at");

CREATE TABLE IF NOT EXISTS "customer_followup_contact_preferences" (
  "customer_id" integer PRIMARY KEY REFERENCES "customers"("id") ON DELETE RESTRICT,
  "contact_blocked" boolean NOT NULL DEFAULT false,
  "actor_id" integer NOT NULL REFERENCES "staff"("id") ON DELETE RESTRICT,
  "version" integer NOT NULL DEFAULT 1,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "customer_followup_contact_version_ck" CHECK ("version" > 0)
);

-- Same-name incompatible objects fail closed in the isolated migration transaction.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('customer_followups', 'id', 'integer', 'NO'),
      ('customer_followups', 'customer_id', 'integer', 'NO'),
      ('customer_followups', 'service_key', 'character varying', 'NO'),
      ('customer_followups', 'assigned_staff_id', 'integer', 'NO'),
      ('customer_followups', 'followup_at', 'timestamp with time zone', 'NO'),
      ('customer_followups', 'note', 'text', 'NO'),
      ('customer_followups', 'status', 'character varying', 'NO'),
      ('customer_followups', 'completed_at', 'timestamp with time zone', 'YES'),
      ('customer_followups', 'source_booking_source', 'character varying', 'YES'),
      ('customer_followups', 'source_booking_id', 'integer', 'YES'),
      ('customer_followups', 'booking_source', 'character varying', 'YES'),
      ('customer_followups', 'booking_id', 'integer', 'YES'),
      ('customer_followups', 'parent_id', 'integer', 'YES'),
      ('customer_followups', 'version', 'integer', 'NO'),
      ('customer_followups', 'created_by', 'integer', 'NO'),
      ('customer_followups', 'created_at', 'timestamp with time zone', 'NO'),
      ('customer_followups', 'updated_at', 'timestamp with time zone', 'NO'),
      ('customer_followups', 'create_token', 'character varying', 'NO'),
      ('customer_followups', 'payload_hash', 'character varying', 'NO'),
      ('customer_followups', 'suggestion_key', 'character varying', 'YES'),
      ('customer_followup_events', 'id', 'integer', 'NO'),
      ('customer_followup_events', 'followup_id', 'integer', 'NO'),
      ('customer_followup_events', 'actor_id', 'integer', 'NO'),
      ('customer_followup_events', 'action', 'character varying', 'NO'),
      ('customer_followup_events', 'request_token', 'character varying', 'NO'),
      ('customer_followup_events', 'payload_hash', 'character varying', 'NO'),
      ('customer_followup_events', 'result', 'jsonb', 'NO'),
      ('customer_followup_events', 'created_at', 'timestamp with time zone', 'NO'),
      ('customer_followup_contact_preferences', 'customer_id', 'integer', 'NO'),
      ('customer_followup_contact_preferences', 'contact_blocked', 'boolean', 'NO'),
      ('customer_followup_contact_preferences', 'actor_id', 'integer', 'NO'),
      ('customer_followup_contact_preferences', 'version', 'integer', 'NO'),
      ('customer_followup_contact_preferences', 'updated_at', 'timestamp with time zone', 'NO')
    ) AS expected(table_name, column_name, data_type, is_nullable)
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns actual
      WHERE actual.table_schema = current_schema()
        AND actual.table_name = expected.table_name AND actual.column_name = expected.column_name
        AND actual.data_type = expected.data_type AND actual.is_nullable = expected.is_nullable
    )
  ) OR EXISTS (
    SELECT 1 FROM (VALUES
      ('customer_followups', 'customer_followups_create_token_uq'),
      ('customer_followups', 'customer_followups_open_pair_uq'),
      ('customer_followups', 'customer_followups_suggestion_uq'),
      ('customer_followups', 'customer_followups_assignee_due_idx'),
      ('customer_followups', 'customer_followups_customer_idx'),
      ('customer_followup_events', 'customer_followup_events_request_uq'),
      ('customer_followup_events', 'customer_followup_events_followup_idx')
    ) AS expected(table_name, index_name)
    WHERE NOT EXISTS (SELECT 1 FROM pg_indexes actual WHERE actual.schemaname = current_schema()
      AND actual.tablename = expected.table_name AND actual.indexname = expected.index_name)
  ) OR EXISTS (
    SELECT 1 FROM (VALUES
      ('customer_followups', 'service_key', 40),
      ('customer_followups', 'status', 20),
      ('customer_followups', 'source_booking_source', 10),
      ('customer_followups', 'booking_source', 10),
      ('customer_followups', 'create_token', 100),
      ('customer_followups', 'payload_hash', 64),
      ('customer_followups', 'suggestion_key', 160),
      ('customer_followup_events', 'action', 40),
      ('customer_followup_events', 'request_token', 160),
      ('customer_followup_events', 'payload_hash', 64)
    ) AS expected(table_name, column_name, max_length)
    WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns actual
      WHERE actual.table_schema = current_schema() AND actual.table_name = expected.table_name
        AND actual.column_name = expected.column_name AND actual.character_maximum_length = expected.max_length)
  ) OR EXISTS (
    SELECT 1 FROM (VALUES
      ('customer_followups', 'customer_followups_create_token_uq', ARRAY['create_token'], NULL::text),
      ('customer_followups', 'customer_followups_open_pair_uq', ARRAY['customer_id', 'service_key'], 'completed_atISNULLANDstatus=ANYARRAY[''interested'',''waiting'']'),
      ('customer_followups', 'customer_followups_suggestion_uq', ARRAY['suggestion_key'], 'suggestion_keyISNOTNULL'),
      ('customer_followup_events', 'customer_followup_events_request_uq', ARRAY['request_token'], NULL::text)
    ) AS expected(table_name, index_name, column_names, normalized_predicate)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_index actual
      JOIN pg_class indexed_table ON indexed_table.oid = actual.indrelid
      JOIN pg_namespace table_namespace ON table_namespace.oid = indexed_table.relnamespace
      JOIN pg_class named_index ON named_index.oid = actual.indexrelid
      WHERE table_namespace.nspname = current_schema() AND indexed_table.relname = expected.table_name
        AND named_index.relname = expected.index_name AND actual.indisunique AND actual.indisvalid
        AND actual.indnkeyatts = cardinality(expected.column_names) AND actual.indnatts = actual.indnkeyatts
        AND NOT EXISTS (SELECT 1 FROM unnest(expected.column_names) WITH ORDINALITY AS expected_column(name, ordinality)
          WHERE pg_get_indexdef(actual.indexrelid, expected_column.ordinality::integer, true) IS DISTINCT FROM expected_column.name)
        AND regexp_replace(regexp_replace(pg_get_expr(actual.indpred, actual.indrelid),
          '::(text|character varying)(\[\])?', '', 'g'), '[[:space:]()]', '', 'g') IS NOT DISTINCT FROM expected.normalized_predicate
    )
  ) OR EXISTS (
    SELECT 1 FROM (VALUES
      ('customer_followups', 'customer_id', 'customers', 'id'),
      ('customer_followups', 'assigned_staff_id', 'staff', 'id'),
      ('customer_followups', 'parent_id', 'customer_followups', 'id'),
      ('customer_followups', 'created_by', 'staff', 'id'),
      ('customer_followup_events', 'followup_id', 'customer_followups', 'id'),
      ('customer_followup_events', 'actor_id', 'staff', 'id'),
      ('customer_followup_contact_preferences', 'customer_id', 'customers', 'id'),
      ('customer_followup_contact_preferences', 'actor_id', 'staff', 'id')
    ) AS expected(table_name, column_name, foreign_table_name, foreign_column_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_constraint actual
      JOIN pg_class local_table ON local_table.oid = actual.conrelid
      JOIN pg_namespace local_namespace ON local_namespace.oid = local_table.relnamespace
      JOIN pg_attribute local_column ON local_column.attrelid = local_table.oid AND local_column.attname = expected.column_name
      JOIN pg_class foreign_table ON foreign_table.oid = actual.confrelid
      JOIN pg_namespace foreign_namespace ON foreign_namespace.oid = foreign_table.relnamespace
      JOIN pg_attribute foreign_column ON foreign_column.attrelid = foreign_table.oid AND foreign_column.attname = expected.foreign_column_name
      WHERE local_namespace.nspname = current_schema() AND local_table.relname = expected.table_name
        AND foreign_namespace.nspname = current_schema() AND foreign_table.relname = expected.foreign_table_name
        AND actual.contype = 'f' AND actual.convalidated AND actual.confdeltype = 'r'
        AND actual.conkey = ARRAY[local_column.attnum] AND actual.confkey = ARRAY[foreign_column.attnum]
    )
  ) OR EXISTS (
    SELECT 1 FROM (VALUES
      ('customer_followups', 'customer_followups_service_ck', ARRAY['service_key', '''photography''', '''kosha''', '''sound''', '''wedding''', '''henna''', '''engagement''', '''graduation''', '''album''', '''printing''', '''booking_confirmation''', '''other''']),
      ('customer_followups', 'customer_followups_status_ck', ARRAY['status', '''interested''', '''waiting''', '''converted''', '''uninterested''']),
      ('customer_followups', 'customer_followups_version_ck', ARRAY['version > 0']),
      ('customer_followups', 'customer_followups_source_booking_ck', ARRAY['source_booking_source', 'source_booking_id', '''service''', '''kosha''', 'IS NULL', 'IS NOT NULL', '> 0', ' OR ', ' AND ']),
      ('customer_followups', 'customer_followups_booking_ck', ARRAY['booking_source', 'booking_id', '''service''', '''kosha''', 'IS NULL', 'IS NOT NULL', '> 0', ' OR ', ' AND ']),
      ('customer_followups', 'customer_followups_converted_ck', ARRAY['status', '<>', '''converted''', 'booking_source IS NOT NULL', 'booking_id IS NOT NULL', ' OR ']),
      ('customer_followup_contact_preferences', 'customer_followup_contact_version_ck', ARRAY['version > 0'])
    ) AS expected(table_name, constraint_name, required_fragments)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_constraint actual
      JOIN pg_class constrained_table ON constrained_table.oid = actual.conrelid
      JOIN pg_namespace table_namespace ON table_namespace.oid = constrained_table.relnamespace
      WHERE table_namespace.nspname = current_schema() AND constrained_table.relname = expected.table_name
        AND actual.conname = expected.constraint_name AND actual.contype = 'c' AND actual.convalidated
        AND NOT EXISTS (SELECT 1 FROM unnest(expected.required_fragments) AS expected_fragment(value)
          WHERE strpos(pg_get_constraintdef(actual.oid), expected_fragment.value) = 0)
    )
  ) THEN
    RAISE EXCEPTION 'Customer followup migration verification failed';
  END IF;
END $$;
