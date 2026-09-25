CREATE TYPE "ServiceState" AS ENUM ('OK', 'ERROR', 'UNCONFIGURED', 'UNCHECKED');

ALTER TABLE "email_messages" DROP CONSTRAINT "email_messages_job_id_fkey";
ALTER TABLE "email_messages" ALTER COLUMN "job_id" DROP NOT NULL;
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "service_statuses" (
  "id" VARCHAR(20) NOT NULL,
  "state" "ServiceState" NOT NULL DEFAULT 'UNCHECKED',
  "message" VARCHAR(500) NOT NULL DEFAULT '',
  "checked_at" TIMESTAMPTZ(3),
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "service_statuses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "operational_alerts" (
  "id" VARCHAR(160) NOT NULL,
  "kind" VARCHAR(40) NOT NULL,
  "detail" VARCHAR(500) NOT NULL DEFAULT '',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_notified_at" TIMESTAMPTZ(3),
  "resolved_at" TIMESTAMPTZ(3),
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "operational_alerts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "operational_alerts_active_updated_at_idx" ON "operational_alerts"("active", "updated_at");
