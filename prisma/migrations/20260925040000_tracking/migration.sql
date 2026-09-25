CREATE TYPE "TrackingEventType" AS ENUM ('OPENED', 'CLICKED', 'UNSUBSCRIBED');

CREATE TABLE "tracking_events" (
  "id" UUID NOT NULL,
  "type" "TrackingEventType" NOT NULL,
  "email_message_id" UUID NOT NULL,
  "campaign_id" UUID NOT NULL,
  "contact_id" UUID,
  "target_hash" CHAR(64) NOT NULL DEFAULT '',
  "target_url" TEXT NOT NULL DEFAULT '',
  "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tracking_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tracking_events_email_message_id_type_target_hash_key" ON "tracking_events"("email_message_id", "type", "target_hash");
CREATE INDEX "tracking_events_campaign_id_type_occurred_at_idx" ON "tracking_events"("campaign_id", "type", "occurred_at");
CREATE INDEX "tracking_events_contact_id_occurred_at_idx" ON "tracking_events"("contact_id", "occurred_at");

ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_email_message_id_fkey" FOREIGN KEY ("email_message_id") REFERENCES "email_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
