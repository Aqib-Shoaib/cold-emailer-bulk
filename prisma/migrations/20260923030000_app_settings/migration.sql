-- One explicitly validated settings row. Only infrastructure bootstrap values
-- (DATABASE_URL, encryption keys, session secret) live outside it.
CREATE TABLE "app_settings" (
    "id" VARCHAR(20) NOT NULL DEFAULT 'singleton',
    "sending_paused" BOOLEAN NOT NULL DEFAULT true,
    "sending_paused_reason" VARCHAR(300) NOT NULL DEFAULT 'Initial setup',
    "smtp_password_enc" TEXT,
    "imap_password_enc" TEXT,
    "ai_api_key_enc" TEXT,
    "values" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_user_id" UUID,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "app_settings"
ADD CONSTRAINT "app_settings_updated_by_user_id_fkey"
FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
