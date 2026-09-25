ALTER TABLE "contacts"
  ADD COLUMN "last_email_received_at" TIMESTAMPTZ(3),
  ADD COLUMN "last_received_subject" VARCHAR(500) NOT NULL DEFAULT '';
