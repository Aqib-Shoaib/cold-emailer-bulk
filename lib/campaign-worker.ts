import { randomInt, randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";

import { decryptSecret } from "./crypto.ts";
import { getPrisma } from "./prisma.ts";
import { operationalLog } from "./operations.ts";
import { nextAllowedSendAt, nextZonedDay, startOfZonedDay } from "./scheduler.ts";
import { sendingReadinessErrors, settingsValues, SETTINGS_ROW_ID } from "./settings.ts";
import { sendSmtpEmail, SmtpDeliveryError, type SmtpMessage, type SmtpTarget } from "./smtp.ts";
import { appendBulkFooter, renderTemplate, templateContext } from "./templates.ts";
import { applyTracking } from "./tracking.ts";
import { createUnsubscribeToken } from "./unsubscribe.ts";

const STALE_MS = 5 * 60 * 1_000;

interface Delivery {
  workerId: string;
  jobId: string;
  messageDbId: string;
  campaignId: string;
  recipientId: string;
  contactId: string | null;
  email: string;
  attempt: number;
  maxAttempts: number;
  backoffSeconds: number;
  target: SmtpTarget;
  message: SmtpMessage;
}

function number(values: Record<string, string>, key: string) {
  return Number(values[key]);
}

function randomBetween(minimum: number, maximum: number) {
  return randomInt(Math.min(minimum, maximum), Math.max(minimum, maximum) + 1);
}

function snapshot(value: Prisma.JsonValue) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  const field = (key: string) => typeof data[key] === "string" ? data[key] as string : "";
  const contact = { firstName: field("firstName"), lastName: field("lastName"), email: field("email"), company: field("company"), title: field("title") };
  return contact.email ? contact : null;
}

async function finishCampaign(tx: Prisma.TransactionClient, campaignId: string) {
  const pending = await tx.job.count({ where: { campaignId, status: { in: ["PENDING", "LEASED", "DELIVERING"] } } });
  if (!pending) await tx.campaign.updateMany({
    where: { id: campaignId, status: { in: ["SCHEDULED", "RUNNING"] } },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
}

async function skipJob(tx: Prisma.TransactionClient, job: { id: string; campaignId: string; recipientId: string }, reason: string) {
  await tx.job.update({ where: { id: job.id }, data: { status: "COMPLETED", completedAt: new Date(), lastError: reason } });
  await tx.campaignRecipient.update({ where: { id: job.recipientId }, data: { status: "SKIPPED", lastError: reason } });
  await finishCampaign(tx, job.campaignId);
}

async function deferJob(tx: Prisma.TransactionClient, jobId: string, runAt: Date) {
  await tx.job.update({ where: { id: jobId }, data: { runAt } });
}

async function failBeforeDelivery(
  tx: Prisma.TransactionClient,
  job: { id: string; campaignId: string; recipientId: string; attempt: number; maxAttempts: number },
  message: string,
  backoffSeconds: number,
) {
  const attempt = job.attempt + 1;
  const exhausted = attempt >= job.maxAttempts;
  await tx.job.update({ where: { id: job.id }, data: {
    attempt,
    status: exhausted ? "FAILED" : "PENDING",
    runAt: exhausted ? undefined : new Date(Date.now() + backoffSeconds * 1_000 * 2 ** (attempt - 1)),
    lastError: message.slice(0, 500),
  } });
  if (exhausted) {
    await tx.campaignRecipient.update({ where: { id: job.recipientId }, data: { status: "FAILED", lastError: message.slice(0, 500) } });
    await finishCampaign(tx, job.campaignId);
  }
}

export async function recoverStaleDeliveries(now = new Date()) {
  const prisma = getPrisma();
  const stale = await prisma.job.findMany({
    where: { status: "DELIVERING", lockedAt: { lt: new Date(now.getTime() - STALE_MS) } },
    select: { id: true, recipientId: true, campaignId: true },
  });
  if (!stale.length) return 0;
  const jobIds = stale.map(({ id }) => id);
  const recipientIds = stale.map(({ recipientId }) => recipientId);
  const reason = "Delivery outcome is unknown after worker interruption; not retried to prevent a duplicate.";
  await prisma.$transaction(async (tx) => {
    await tx.emailMessage.updateMany({ where: { jobId: { in: jobIds }, status: "DELIVERING" }, data: { status: "UNKNOWN", lastError: reason } });
    await tx.job.updateMany({ where: { id: { in: jobIds }, status: "DELIVERING" }, data: { status: "FAILED", lastError: reason } });
    await tx.campaignRecipient.updateMany({ where: { id: { in: recipientIds } }, data: { status: "UNKNOWN", lastError: reason } });
    for (const campaignId of new Set(stale.map((job) => job.campaignId))) await finishCampaign(tx, campaignId);
  });
  return stale.length;
}

export async function claimDelivery(workerId: string, now = new Date()): Promise<Delivery | null> {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const settings = await tx.appSettings.findUnique({ where: { id: SETTINGS_ROW_ID } });
    if (!settings || settings.sendingPaused) return null;
    const values = settingsValues(settings.values);
    if (sendingReadinessErrors(values, Boolean(settings.smtpPasswordEnc)).length) return null;

    await tx.throttleState.upsert({ where: { id: "global" }, create: { id: "global" }, update: {} });
    // ponytail: one global row serializes claims; shard by mailbox only if throughput grows beyond the 2,500/day ceiling.
    const [throttle] = await tx.$queryRaw<Array<{ next_batch_at: Date; batch_remaining: number }>>`
      SELECT "next_batch_at", "batch_remaining" FROM "throttle_state" WHERE "id" = 'global' FOR UPDATE
    `;
    if (!throttle || (throttle.batch_remaining <= 0 && throttle.next_batch_at > now)) return null;

    const [candidate] = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT job."id"
      FROM "jobs" AS job
      JOIN "campaigns" AS campaign ON campaign."id" = job."campaign_id"
      WHERE job."status" = 'PENDING'
        AND job."run_at" <= ${now}
        AND campaign."status" IN ('SCHEDULED', 'RUNNING')
      ORDER BY job."run_at", job."created_at"
      FOR UPDATE OF job SKIP LOCKED
      LIMIT 1
    `;
    if (!candidate) return null;

    const baseJob = await tx.job.findUnique({ where: { id: candidate.id } });
    if (!baseJob) return null;
    const campaign = await tx.campaign.findUnique({ where: { id: baseJob.campaignId } });
    const recipient = await tx.campaignRecipient.findUnique({ where: { id: baseJob.recipientId } });
    const step = await tx.campaignStep.findUnique({ where: { id: baseJob.stepId } });
    if (!campaign || !recipient || !step) return null;
    const contact = recipient.contactId ? await tx.contact.findUnique({ where: { id: recipient.contactId } }) : null;
    const template = await tx.template.findUnique({ where: { id: step.templateId } });
    const emailMessage = await tx.emailMessage.findUnique({ where: { jobId: baseJob.id } });
    if (!template) return null;
    const job = { ...baseJob, campaign, recipient: { ...recipient, contact }, step: { ...step, template }, emailMessage };

    const blockedPrior = await tx.job.findFirst({
      where: { recipientId: job.recipientId, step: { position: { lt: job.step.position } }, lastError: { not: "" } },
    });
    if (blockedPrior) {
      await skipJob(tx, job, "An earlier sequence step did not complete.");
      return null;
    }
    const prior = await tx.job.findFirst({
      where: { recipientId: job.recipientId, step: { position: { lt: job.step.position } }, status: { not: "COMPLETED" } },
    });
    if (prior) {
      if (prior.status === "FAILED" || prior.status === "CANCELED") await skipJob(tx, job, "An earlier sequence step did not complete.");
      else await deferJob(tx, job.id, new Date(now.getTime() + 60_000));
      return null;
    }

    if (!job.recipient.contact || job.recipient.contact.archivedAt) {
      await skipJob(tx, job, "Contact was deleted or archived before sending.");
      return null;
    }
    if (await tx.suppression.findUnique({ where: { email: job.recipient.email } })) {
      await skipJob(tx, job, "Address is suppressed.");
      return null;
    }
    if (values.stopOnReply === "Enabled" && job.recipient.contact.lastRepliedAt) {
      await skipJob(tx, job, "Contact replied before this step.");
      return null;
    }
    const duplicateSince = new Date(now.getTime() - number(values, "duplicateSendWindowDays") * 86_400_000);
    if (number(values, "duplicateSendWindowDays") > 0 && await tx.emailMessage.findFirst({
      where: { toEmail: job.recipient.email, templateId: job.step.templateId, status: "SMTP_ACCEPTED", smtpAcceptedAt: { gte: duplicateSince } },
    })) {
      await skipJob(tx, job, "The same template was SMTP-accepted within the duplicate-send window.");
      return null;
    }

    const quietUntil = nextAllowedSendAt(now, values.smtpTimezone, values.smtpQuietDays, values.smtpQuietHours);
    if (quietUntil > now) {
      await deferJob(tx, job.id, quietUntil);
      return null;
    }

    const dayStart = startOfZonedDay(now, values.smtpTimezone);
    const reservations = (since: Date) => ({ OR: [
      { status: "SMTP_ACCEPTED" as const, smtpAcceptedAt: { gte: since } },
      { status: "DELIVERING" as const, updatedAt: { gte: since } },
    ] });
    const minuteCount = await tx.emailMessage.count({ where: reservations(new Date(now.getTime() - 60_000)) });
    const hourCount = await tx.emailMessage.count({ where: reservations(new Date(now.getTime() - 3_600_000)) });
    const dayCount = await tx.emailMessage.count({ where: reservations(dayStart) });
    const campaignDayCount = await tx.emailMessage.count({ where: { campaignId: job.campaignId, ...reservations(startOfZonedDay(now, job.campaign.timezone)) } });
    let rateResume: Date | null = null;
    if (minuteCount >= number(values, "smtpMaxPerMinute")) rateResume = new Date(now.getTime() + 60_000);
    else if (hourCount >= number(values, "smtpMaxPerHour")) rateResume = new Date(now.getTime() + 3_600_000);
    else if (dayCount >= number(values, "smtpMaxPerDay")) rateResume = nextZonedDay(now, values.smtpTimezone);
    else if (campaignDayCount >= job.campaign.dailyCap) rateResume = nextZonedDay(now, job.campaign.timezone);
    if (rateResume) {
      await deferJob(tx, job.id, rateResume);
      return null;
    }

    const renderedContact = snapshot(job.recipient.dataSnapshot);
    const encryptionKey = process.env.SETTINGS_ENCRYPTION_KEY ?? "";
    const password = settings.smtpPasswordEnc ? decryptSecret(encryptionKey, settings.smtpPasswordEnc) : null;
    try {
      if (!renderedContact || !password || !values.smtpHost || !values.smtpFromAddress || !values.publicBaseUrl) throw new Error("SMTP and sender settings are incomplete.");
      const messageDbId = job.emailMessage?.id ?? randomUUID();
      const unsubscribeToken = createUnsubscribeToken(job.recipient.email, messageDbId);
      let rendered = appendBulkFooter(
        renderTemplate(job.step.template, templateContext({ contact: renderedContact, campaignName: job.campaign.name, senderName: values.senderDisplayName, senderCompany: values.companyName })),
        {
          senderName: values.senderDisplayName,
          companyName: values.companyName,
          physicalAddress: values.physicalAddress,
          footerText: values.unsubscribeFooter,
          unsubscribeUrl: `${values.publicBaseUrl.replace(/\/$/, "")}/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`,
        },
      );
      if (rendered.missing.length) throw new Error(`Missing template values: ${rendered.missing.join(", ")}`);
      const tracked = applyTracking(rendered, {
        baseUrl: values.publicBaseUrl,
        messageId: messageDbId,
        open: values.openTrackingEnabled === "Enabled",
        click: values.clickTrackingEnabled === "Enabled",
      });
      rendered = { ...rendered, ...tracked };

      let remaining = throttle.batch_remaining;
      if (remaining <= 0) remaining = randomBetween(number(values, "smtpBatchMinSize"), number(values, "smtpBatchMaxSize"));
      remaining -= 1;
      await tx.throttleState.update({ where: { id: "global" }, data: {
        batchRemaining: remaining,
        nextBatchAt: remaining === 0
          ? new Date(now.getTime() + randomBetween(number(values, "smtpBatchIntervalMinMinutes"), number(values, "smtpBatchIntervalMaxMinutes")) * 60_000)
          : now,
      } });

      const messageId = job.emailMessage?.messageId ?? `<${job.id}@cold-emailer.local>`;
      const messageData = {
        campaignId: job.campaignId,
        recipientId: job.recipientId,
        stepId: job.stepId,
        templateId: job.step.templateId,
        contactId: job.recipient.contactId,
        messageId,
        toEmail: job.recipient.email,
        subject: rendered.subject,
        textBody: rendered.text,
        htmlBody: rendered.html,
        status: "DELIVERING" as const,
        lastError: "",
      };
      if (job.emailMessage) await tx.emailMessage.update({ where: { id: job.emailMessage.id }, data: messageData });
      else await tx.emailMessage.create({ data: { id: messageDbId, jobId: job.id, ...messageData } });
      const attempt = job.attempt + 1;
      await tx.job.update({ where: { id: job.id }, data: { status: "DELIVERING", attempt, lockedAt: now, lockedBy: workerId, lastError: "" } });
      await tx.workerHeartbeat.upsert({ where: { workerId }, create: { workerId, startedAt: now, lastSeenAt: now, currentJobId: job.id }, update: { lastSeenAt: now, currentJobId: job.id } });
      return {
        workerId, jobId: job.id, messageDbId, campaignId: job.campaignId, recipientId: job.recipientId,
        contactId: job.recipient.contactId, email: job.recipient.email, attempt, maxAttempts: job.maxAttempts,
        backoffSeconds: number(values, "smtpRetryBackoffSeconds"),
        target: {
          host: values.smtpHost, port: number(values, "smtpPort"), tlsMode: values.smtpTlsMode,
          username: values.smtpUsername, password, timeoutMs: number(values, "smtpConnectionTimeoutSeconds") * 1_000,
          heloName: values.smtpHeloName || values.smtpHost,
        },
        message: {
          from: values.smtpFromAddress,
          to: job.recipient.email,
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
          messageId,
          replyTo: values.smtpReplyTo || values.defaultReplyTo || undefined,
          listUnsubscribe: `${values.publicBaseUrl.replace(/\/$/, "")}/api/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`,
        },
      };
    } catch (error) {
      await failBeforeDelivery(tx, job, error instanceof Error ? error.message : "Message preparation failed.", number(values, "smtpRetryBackoffSeconds"));
      return null;
    }
  });
}

export async function deliverClaimed(delivery: Delivery) {
  const prisma = getPrisma();
  const allowed = await prisma.$transaction(async (tx) => {
    const settings = await tx.appSettings.findUnique({ where: { id: SETTINGS_ROW_ID } });
    const campaign = await tx.campaign.findUnique({ where: { id: delivery.campaignId }, select: { status: true } });
    const contact = delivery.contactId ? await tx.contact.findUnique({ where: { id: delivery.contactId }, select: { email: true, archivedAt: true, lastRepliedAt: true } }) : null;
    const suppression = await tx.suppression.findUnique({ where: { email: delivery.email } });
    const paused = !settings || settings.sendingPaused || campaign?.status === "PAUSED";
    if (paused) {
      const reason = !settings || settings.sendingPaused ? "Global sending paused before SMTP delivery." : "Campaign paused before SMTP delivery.";
      await tx.emailMessage.update({ where: { id: delivery.messageDbId }, data: { status: "FAILED", lastError: reason } });
      await tx.job.update({ where: { id: delivery.jobId }, data: { status: "PENDING", attempt: { decrement: 1 }, lockedAt: null, lockedBy: "", lastError: reason } });
      await tx.workerHeartbeat.updateMany({ where: { workerId: delivery.workerId }, data: { lastSeenAt: new Date(), currentJobId: null } });
      return false;
    }
    const values = settingsValues(settings.values);
    const stopped = !campaign || campaign.status === "CANCELED" || !contact || contact.email !== delivery.email || contact.archivedAt || suppression || (values.stopOnReply === "Enabled" && contact.lastRepliedAt);
    if (stopped) {
      const reason = "Recipient became ineligible immediately before SMTP delivery.";
      await tx.emailMessage.update({ where: { id: delivery.messageDbId }, data: { status: "SKIPPED", lastError: reason } });
      await tx.job.update({ where: { id: delivery.jobId }, data: { status: campaign?.status === "CANCELED" ? "CANCELED" : "COMPLETED", completedAt: new Date(), lockedAt: null, lockedBy: "", lastError: reason } });
      await tx.campaignRecipient.update({ where: { id: delivery.recipientId }, data: { status: campaign?.status === "CANCELED" ? "CANCELED" : "SKIPPED", lastError: reason } });
      await tx.workerHeartbeat.updateMany({ where: { workerId: delivery.workerId }, data: { lastSeenAt: new Date(), currentJobId: null } });
      await finishCampaign(tx, delivery.campaignId);
      return false;
    }
    return true;
  });
  if (!allowed) return;
  try {
    await sendSmtpEmail(delivery.target, delivery.message);
    const acceptedAt = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.emailMessage.update({ where: { id: delivery.messageDbId }, data: { status: "SMTP_ACCEPTED", smtpAcceptedAt: acceptedAt } });
      await tx.job.update({ where: { id: delivery.jobId }, data: { status: "COMPLETED", completedAt: acceptedAt, lockedAt: null, lockedBy: "" } });
      await tx.campaignRecipient.update({ where: { id: delivery.recipientId }, data: { status: "SENT", sentCount: { increment: 1 }, lastEmailAt: acceptedAt, lastError: "" } });
      if (delivery.contactId) await tx.contact.updateMany({ where: { id: delivery.contactId, email: delivery.email }, data: { lastEmailAcceptedAt: acceptedAt, lastEmailSubject: delivery.message.subject } });
      await tx.campaign.updateMany({ where: { id: delivery.campaignId, status: "SCHEDULED" }, data: { status: "RUNNING" } });
      await tx.workerHeartbeat.updateMany({ where: { workerId: delivery.workerId }, data: { lastSeenAt: acceptedAt, currentJobId: null } });
      await tx.serviceStatus.upsert({ where: { id: "smtp" }, create: { id: "smtp", state: "OK", checkedAt: acceptedAt }, update: { state: "OK", message: "", checkedAt: acceptedAt } });
      await finishCampaign(tx, delivery.campaignId);
    });
  } catch (error) {
    const uncertain = error instanceof SmtpDeliveryError && error.deliveryUncertain;
    const message = `${uncertain ? "Delivery outcome is unknown" : "SMTP delivery failed"}: ${error instanceof Error ? error.message : "Unknown error"}`.slice(0, 500);
    await prisma.$transaction(async (tx) => {
      const exhausted = uncertain || delivery.attempt >= delivery.maxAttempts;
      await tx.emailMessage.update({ where: { id: delivery.messageDbId }, data: { status: uncertain ? "UNKNOWN" : "FAILED", lastError: message } });
      await tx.job.update({ where: { id: delivery.jobId }, data: exhausted
        ? { status: "FAILED", lastError: message, lockedAt: null, lockedBy: "" }
        : { status: "PENDING", runAt: new Date(Date.now() + delivery.backoffSeconds * 1_000 * 2 ** (delivery.attempt - 1)), lastError: message, lockedAt: null, lockedBy: "" },
      });
      if (exhausted) await tx.campaignRecipient.update({ where: { id: delivery.recipientId }, data: { status: uncertain ? "UNKNOWN" : "FAILED", lastError: message } });
      await tx.workerHeartbeat.updateMany({ where: { workerId: delivery.workerId }, data: { lastSeenAt: new Date(), currentJobId: null } });
      await tx.serviceStatus.upsert({ where: { id: "smtp" }, create: { id: "smtp", state: "ERROR", message, checkedAt: new Date() }, update: { state: "ERROR", message, checkedAt: new Date() } });
      if (exhausted) await finishCampaign(tx, delivery.campaignId);
    });
    operationalLog("error", "smtp_delivery_failed", { jobId: delivery.jobId, campaignId: delivery.campaignId, recipientId: delivery.recipientId, uncertain, error: message });
  }
}

export async function heartbeat(workerId: string, startedAt: Date) {
  const now = new Date();
  await getPrisma().workerHeartbeat.upsert({
    where: { workerId },
    create: { workerId, startedAt, lastSeenAt: now },
    update: { lastSeenAt: now },
  });
}
