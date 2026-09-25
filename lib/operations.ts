import type { EmailDeliveryStatus, JobStatus, ServiceState } from "../generated/prisma/client.ts";

import { getPrisma } from "./prisma.ts";
import { settingsValues } from "./settings.ts";

export function retryIsSafe(jobStatus: JobStatus, deliveryStatus: EmailDeliveryStatus | null) {
  return jobStatus === "FAILED" && (deliveryStatus === null || deliveryStatus === "FAILED");
}

export async function recordServiceStatus(id: "smtp" | "imap" | "ai", state: ServiceState, message = "") {
  const now = new Date();
  await getPrisma().serviceStatus.upsert({
    where: { id },
    create: { id, state, message: message.slice(0, 500), checkedAt: now },
    update: { state, message: message.slice(0, 500), checkedAt: now },
  });
}

export function operationalLog(level: "info" | "error", event: string, fields: Record<string, string | number | boolean | null> = {}) {
  const line = JSON.stringify({ level, event, at: new Date().toISOString(), ...fields });
  if (level === "error") console.error(line);
  else console.log(line);
}

export async function applyRetention(now = new Date()) {
  const prisma = getPrisma();
  const settings = await prisma.appSettings.findFirst();
  if (!settings) return { events: 0, bodies: 0, jobs: 0, audits: 0 };
  const values = settingsValues(settings.values);
  const before = (days: number) => new Date(now.getTime() - days * 86_400_000);
  const [events, bodies, jobs, audits] = await prisma.$transaction([
    prisma.trackingEvent.deleteMany({ where: { occurredAt: { lt: before(Number(values.rawEventRetentionDays)) } } }),
    prisma.inboundMessage.updateMany({ where: { receivedAt: { lt: before(Number(values.messageBodyRetentionDays)) }, OR: [{ textBody: { not: "" } }, { htmlBody: { not: "" } }] }, data: { textBody: "", htmlBody: "" } }),
    prisma.job.deleteMany({ where: { status: { in: ["COMPLETED", "FAILED", "CANCELED"] }, updatedAt: { lt: before(Number(values.jobRetentionDays)) } } }),
    prisma.auditEvent.deleteMany({ where: { createdAt: { lt: before(Number(values.auditRetentionDays)) } } }),
  ]);
  return { events: events.count, bodies: bodies.count, jobs: jobs.count, audits: audits.count };
}
