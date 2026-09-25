import { Prisma } from "../generated/prisma/client.ts";

import { getPrisma } from "./prisma.ts";

export interface StatisticsFilters {
  from?: Date;
  to?: Date;
  campaignId?: string;
  templateId?: string;
  listId?: string;
}

export interface Statistics {
  queued: number;
  attempted: number;
  smtpAccepted: number;
  acceptedRecipients: number;
  failed: number;
  unknown: number;
  bounced: number;
  replied: number;
  unsubscribed: number;
  opened: number;
  clicked: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseStatisticsFilters(values: { from?: string; to?: string; campaign?: string; template?: string; list?: string }): StatisticsFilters {
  const from = values.from && DATE.test(values.from) ? new Date(`${values.from}T00:00:00.000Z`) : undefined;
  const inclusiveTo = values.to && DATE.test(values.to) ? new Date(`${values.to}T00:00:00.000Z`) : undefined;
  return {
    from: from && !Number.isNaN(from.getTime()) ? from : undefined,
    to: inclusiveTo && !Number.isNaN(inclusiveTo.getTime()) ? new Date(inclusiveTo.getTime() + 86_400_000) : undefined,
    campaignId: values.campaign && UUID.test(values.campaign) ? values.campaign : undefined,
    templateId: values.template && UUID.test(values.template) ? values.template : undefined,
    listId: values.list && UUID.test(values.list) ? values.list : undefined,
  };
}

function conditions(filters: StatisticsFilters, alias: "email" | "job") {
  const date = alias === "email" ? Prisma.raw('email."created_at"') : Prisma.raw('job."created_at"');
  const campaign = alias === "email" ? Prisma.raw('email."campaign_id"') : Prisma.raw('job."campaign_id"');
  const step = alias === "email" ? Prisma.raw('email."step_id"') : Prisma.raw('job."step_id"');
  const values: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (filters.from) values.push(Prisma.sql`${date} >= ${filters.from}`);
  if (filters.to) values.push(Prisma.sql`${date} < ${filters.to}`);
  if (filters.campaignId) values.push(Prisma.sql`${campaign} = ${filters.campaignId}::uuid`);
  if (filters.templateId) values.push(Prisma.sql`${step} IN (SELECT "id" FROM "campaign_steps" WHERE "template_id" = ${filters.templateId}::uuid)`);
  if (filters.listId) values.push(Prisma.sql`${campaign} IN (SELECT "id" FROM "campaigns" WHERE "contact_list_id" = ${filters.listId}::uuid)`);
  return Prisma.join(values, " AND ");
}

function count(value: bigint | number) {
  return Number(value);
}

export async function getStatistics(filters: StatisticsFilters): Promise<Statistics> {
  const [row] = await getPrisma().$queryRaw<Array<Record<keyof Statistics, bigint>>>(Prisma.sql`
    WITH filtered AS (
      SELECT email.* FROM "email_messages" AS email WHERE ${conditions(filters, "email")}
    ), accepted_contacts AS (
      SELECT DISTINCT "campaign_id", "contact_id" FROM filtered WHERE "smtp_accepted_at" IS NOT NULL AND "contact_id" IS NOT NULL
    )
    SELECT
      (SELECT COUNT(*) FROM "jobs" AS job WHERE ${conditions(filters, "job")}) AS queued,
      COUNT(*) AS attempted,
      COUNT(*) FILTER (WHERE "smtp_accepted_at" IS NOT NULL) AS "smtpAccepted",
      COUNT(DISTINCT ("campaign_id", "recipient_id")) FILTER (WHERE "smtp_accepted_at" IS NOT NULL) AS "acceptedRecipients",
      COUNT(*) FILTER (WHERE "status" = 'FAILED') AS failed,
      COUNT(*) FILTER (WHERE "status" = 'UNKNOWN') AS unknown,
      COUNT(*) FILTER (WHERE "status" = 'BOUNCED') AS bounced,
      (SELECT COUNT(DISTINCT (inbound."campaign_id", inbound."contact_id")) FROM "inbound_messages" AS inbound JOIN accepted_contacts USING ("campaign_id", "contact_id") WHERE inbound."kind" = 'REPLY') AS replied,
      (SELECT COUNT(DISTINCT (event."campaign_id", event."contact_id")) FROM "tracking_events" AS event JOIN accepted_contacts USING ("campaign_id", "contact_id") WHERE event."type" = 'UNSUBSCRIBED') AS unsubscribed,
      (SELECT COUNT(DISTINCT event."email_message_id") FROM "tracking_events" AS event JOIN filtered ON filtered."id" = event."email_message_id" WHERE event."type" = 'OPENED') AS opened,
      (SELECT COUNT(DISTINCT event."email_message_id") FROM "tracking_events" AS event JOIN filtered ON filtered."id" = event."email_message_id" WHERE event."type" = 'CLICKED') AS clicked
    FROM filtered
  `);
  const empty: Statistics = { queued: 0, attempted: 0, smtpAccepted: 0, acceptedRecipients: 0, failed: 0, unknown: 0, bounced: 0, replied: 0, unsubscribed: 0, opened: 0, clicked: 0 };
  if (!row) return empty;
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, count(value)])) as unknown as Statistics;
}

export function rate(numerator: number, denominator: number) {
  return denominator ? `${(numerator / denominator * 100).toFixed(1)}%` : "—";
}
