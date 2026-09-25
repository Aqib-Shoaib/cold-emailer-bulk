CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'REVIEW', 'SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELED');
CREATE TYPE "CampaignRecipientStatus" AS ENUM ('PENDING', 'SENT', 'UNKNOWN', 'FAILED', 'SKIPPED', 'CANCELED');
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'LEASED', 'DELIVERING', 'COMPLETED', 'FAILED', 'CANCELED');
CREATE TYPE "EmailDeliveryStatus" AS ENUM ('DELIVERING', 'SMTP_ACCEPTED', 'UNKNOWN', 'FAILED', 'SKIPPED');

ALTER TABLE "contacts"
ADD COLUMN "last_email_accepted_at" TIMESTAMPTZ(3),
ADD COLUMN "last_email_subject" VARCHAR(300) NOT NULL DEFAULT '',
ADD COLUMN "last_replied_at" TIMESTAMPTZ(3);

CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "contact_list_id" UUID,
    "created_by_user_id" UUID,
    "timezone" VARCHAR(64) NOT NULL,
    "daily_cap" INTEGER NOT NULL,
    "audience_count" INTEGER NOT NULL DEFAULT 0,
    "excluded_count" INTEGER NOT NULL DEFAULT 0,
    "review_errors" JSONB NOT NULL DEFAULT '[]',
    "reviewed_at" TIMESTAMPTZ(3),
    "scheduled_at" TIMESTAMPTZ(3),
    "paused_at" TIMESTAMPTZ(3),
    "canceled_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "campaigns_daily_cap_positive" CHECK ("daily_cap" > 0)
);

CREATE TABLE "campaign_steps" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "delay_minutes" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "campaign_steps_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "campaign_steps_position_nonnegative" CHECK ("position" >= 0),
    CONSTRAINT "campaign_steps_delay_nonnegative" CHECK ("delay_minutes" >= 0)
);

CREATE TABLE "campaign_recipients" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "contact_id" UUID,
    "email" VARCHAR(320) NOT NULL,
    "data_snapshot" JSONB NOT NULL,
    "status" "CampaignRecipientStatus" NOT NULL DEFAULT 'PENDING',
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "last_email_at" TIMESTAMPTZ(3),
    "last_error" VARCHAR(500) NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "campaign_recipients_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "campaign_recipients_email_normalized" CHECK ("email" = lower(btrim("email")))
);

CREATE TABLE "jobs" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "step_id" UUID NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "run_at" TIMESTAMPTZ(3) NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL,
    "locked_at" TIMESTAMPTZ(3),
    "locked_by" VARCHAR(120) NOT NULL DEFAULT '',
    "completed_at" TIMESTAMPTZ(3),
    "last_error" VARCHAR(500) NOT NULL DEFAULT '',
    "idempotency_key" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "jobs_attempts_valid" CHECK ("attempt" >= 0 AND "max_attempts" > 0)
);

CREATE TABLE "email_messages" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "step_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "contact_id" UUID,
    "message_id" VARCHAR(255) NOT NULL,
    "to_email" VARCHAR(320) NOT NULL,
    "subject" VARCHAR(300) NOT NULL,
    "text_body" TEXT NOT NULL,
    "html_body" TEXT NOT NULL,
    "status" "EmailDeliveryStatus" NOT NULL DEFAULT 'DELIVERING',
    "smtp_accepted_at" TIMESTAMPTZ(3),
    "last_error" VARCHAR(500) NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "email_messages_to_email_normalized" CHECK ("to_email" = lower(btrim("to_email")))
);

CREATE TABLE "worker_heartbeats" (
    "worker_id" VARCHAR(120) NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "current_job_id" UUID,
    CONSTRAINT "worker_heartbeats_pkey" PRIMARY KEY ("worker_id")
);

CREATE TABLE "throttle_state" (
    "id" VARCHAR(20) NOT NULL DEFAULT 'global',
    "next_batch_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "batch_remaining" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "throttle_state_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "throttle_state_batch_nonnegative" CHECK ("batch_remaining" >= 0)
);

CREATE INDEX "campaigns_status_scheduled_at_idx" ON "campaigns"("status", "scheduled_at");
CREATE UNIQUE INDEX "campaign_steps_campaign_id_position_key" ON "campaign_steps"("campaign_id", "position");
CREATE UNIQUE INDEX "campaign_recipients_campaign_id_email_key" ON "campaign_recipients"("campaign_id", "email");
CREATE INDEX "campaign_recipients_email_idx" ON "campaign_recipients"("email");
CREATE UNIQUE INDEX "jobs_idempotency_key_key" ON "jobs"("idempotency_key");
CREATE INDEX "jobs_status_run_at_idx" ON "jobs"("status", "run_at");
CREATE INDEX "jobs_campaign_id_status_idx" ON "jobs"("campaign_id", "status");
CREATE UNIQUE INDEX "email_messages_job_id_key" ON "email_messages"("job_id");
CREATE UNIQUE INDEX "email_messages_message_id_key" ON "email_messages"("message_id");
CREATE INDEX "email_messages_to_email_smtp_accepted_at_idx" ON "email_messages"("to_email", "smtp_accepted_at");
CREATE INDEX "email_messages_campaign_id_status_idx" ON "email_messages"("campaign_id", "status");

ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_contact_list_id_fkey" FOREIGN KEY ("contact_list_id") REFERENCES "contact_lists"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "campaign_steps" ADD CONSTRAINT "campaign_steps_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campaign_steps" ADD CONSTRAINT "campaign_steps_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "campaign_recipients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "campaign_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "campaign_recipients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "campaign_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
