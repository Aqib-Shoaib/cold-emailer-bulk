CREATE TYPE "InboundMessageKind" AS ENUM ('REPLY', 'HARD_BOUNCE', 'AUTO_REPLY', 'UNMATCHED', 'REVIEW');

CREATE TABLE "imap_sync_states" (
  "id" CHAR(64) NOT NULL,
  "host" VARCHAR(255) NOT NULL,
  "username" VARCHAR(320) NOT NULL,
  "folder" VARCHAR(100) NOT NULL,
  "uid_validity" VARCHAR(30) NOT NULL DEFAULT '',
  "last_uid" INTEGER NOT NULL DEFAULT 0,
  "sync_started_at" TIMESTAMPTZ(3),
  "last_synced_at" TIMESTAMPTZ(3),
  "last_error" VARCHAR(500) NOT NULL DEFAULT '',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "imap_sync_states_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inbound_messages" (
  "id" UUID NOT NULL,
  "folder" VARCHAR(100) NOT NULL,
  "uid_validity" VARCHAR(30) NOT NULL,
  "uid" INTEGER NOT NULL,
  "message_id" VARCHAR(500) NOT NULL DEFAULT '',
  "in_reply_to" VARCHAR(500) NOT NULL DEFAULT '',
  "references" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "from_name" VARCHAR(320) NOT NULL DEFAULT '',
  "from_email" VARCHAR(320) NOT NULL DEFAULT '',
  "to_emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "subject" VARCHAR(500) NOT NULL DEFAULT '',
  "text_body" TEXT NOT NULL DEFAULT '',
  "html_body" TEXT NOT NULL DEFAULT '',
  "attachments" JSONB NOT NULL DEFAULT '[]',
  "received_at" TIMESTAMPTZ(3) NOT NULL,
  "read_at" TIMESTAMPTZ(3),
  "kind" "InboundMessageKind" NOT NULL DEFAULT 'UNMATCHED',
  "review_reason" VARCHAR(500) NOT NULL DEFAULT '',
  "parse_error" VARCHAR(500) NOT NULL DEFAULT '',
  "contact_id" UUID,
  "campaign_id" UUID,
  "outbound_message_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "inbound_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inbox_replies" (
  "id" UUID NOT NULL,
  "inbound_message_id" UUID NOT NULL,
  "contact_id" UUID,
  "campaign_id" UUID,
  "sent_by_user_id" UUID,
  "message_id" VARCHAR(255) NOT NULL,
  "to_email" VARCHAR(320) NOT NULL,
  "subject" VARCHAR(500) NOT NULL,
  "text_body" TEXT NOT NULL,
  "status" "EmailDeliveryStatus" NOT NULL DEFAULT 'DELIVERING',
  "smtp_accepted_at" TIMESTAMPTZ(3),
  "last_error" VARCHAR(500) NOT NULL DEFAULT '',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "inbox_replies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inbound_messages_folder_uid_validity_uid_key" ON "inbound_messages"("folder", "uid_validity", "uid");
CREATE INDEX "inbound_messages_message_id_idx" ON "inbound_messages"("message_id");
CREATE INDEX "inbound_messages_contact_id_received_at_idx" ON "inbound_messages"("contact_id", "received_at");
CREATE INDEX "inbound_messages_campaign_id_received_at_idx" ON "inbound_messages"("campaign_id", "received_at");
CREATE INDEX "inbound_messages_read_at_received_at_idx" ON "inbound_messages"("read_at", "received_at");
CREATE UNIQUE INDEX "inbox_replies_message_id_key" ON "inbox_replies"("message_id");
CREATE INDEX "inbox_replies_inbound_message_id_created_at_idx" ON "inbox_replies"("inbound_message_id", "created_at");

ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_outbound_message_id_fkey" FOREIGN KEY ("outbound_message_id") REFERENCES "email_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inbox_replies" ADD CONSTRAINT "inbox_replies_inbound_message_id_fkey" FOREIGN KEY ("inbound_message_id") REFERENCES "inbound_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inbox_replies" ADD CONSTRAINT "inbox_replies_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inbox_replies" ADD CONSTRAINT "inbox_replies_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inbox_replies" ADD CONSTRAINT "inbox_replies_sent_by_user_id_fkey" FOREIGN KEY ("sent_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
