CREATE TABLE IF NOT EXISTS "otp_codes" (
  "id" serial PRIMARY KEY,
  "phone" varchar(20) NOT NULL,
  "code" varchar(10) NOT NULL,
  "expires_at" timestamp NOT NULL,
  "used" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "otp_codes_phone_idx" ON "otp_codes" ("phone");
