-- AJN task photo workflow: additive metadata only. Existing tasks and
-- attachments remain valid and keep their original identifiers.
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "location" text;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "completion_notes" text;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "completed_by" integer REFERENCES "staff" ("id");

ALTER TABLE "task_attachments" ADD COLUMN IF NOT EXISTS "thumbnail_url" text;
ALTER TABLE "task_attachments" ADD COLUMN IF NOT EXISTS "media_type" varchar(80) NOT NULL DEFAULT 'image';
ALTER TABLE "task_attachments" ADD COLUMN IF NOT EXISTS "category" varchar(40) NOT NULL DEFAULT 'attachment';
ALTER TABLE "task_attachments" ADD COLUMN IF NOT EXISTS "caption" text;
ALTER TABLE "task_attachments" ADD COLUMN IF NOT EXISTS "uploaded_by" integer REFERENCES "staff" ("id");
ALTER TABLE "task_attachments" ADD COLUMN IF NOT EXISTS "uploaded_by_name" text;
ALTER TABLE "task_attachments" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS "task_attachments_task_category_idx"
  ON "task_attachments" ("task_id", "category", "created_at");
