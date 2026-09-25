import { decryptSecret } from "./crypto.ts";
import { operationalLog } from "./operations.ts";
import { getPrisma } from "./prisma.ts";
import { settingsValues } from "./settings.ts";
import { sendSmtpEmail } from "./smtp.ts";

export interface Incident {
  id: string;
  kind: string;
  detail: string;
}

export function workerIncident(lastSeenAt: Date | null, now = new Date(), staleMs = 120_000): Incident | null {
  return lastSeenAt && now.getTime() - lastSeenAt.getTime() <= staleMs
    ? null
    : { id: "worker:stale", kind: "WORKER", detail: lastSeenAt ? `Worker last reported at ${lastSeenAt.toISOString()}.` : "No worker heartbeat has been recorded." };
}

export async function syncOperationalAlerts(incidents: Incident[], cooldownMinutes: number, notify: (incident: Incident) => Promise<void>, now = new Date()) {
  const prisma = getPrisma();
  const activeIds = incidents.map(({ id }) => id);
  await prisma.operationalAlert.updateMany({
    where: { active: true, ...(activeIds.length ? { id: { notIn: activeIds } } : {}) },
    data: { active: false, resolvedAt: now },
  });

  let notified = 0;
  for (const incident of incidents) {
    const existing = await prisma.operationalAlert.findUnique({ where: { id: incident.id } });
    const due = !existing?.active || !existing.lastNotifiedAt || now.getTime() - existing.lastNotifiedAt.getTime() >= cooldownMinutes * 60_000;
    await prisma.operationalAlert.upsert({
      where: { id: incident.id },
      create: { ...incident, lastNotifiedAt: due ? now : null },
      update: { kind: incident.kind, detail: incident.detail.slice(0, 500), active: true, resolvedAt: null, ...(due ? { lastNotifiedAt: now } : {}) },
    });
    if (due) {
      await notify(incident);
      notified += 1;
    }
  }
  return notified;
}

async function emailNotification(incident: Incident) {
  const settings = await getPrisma().appSettings.findUnique({ where: { id: "singleton" } });
  if (!settings) return;
  const values = settingsValues(settings.values);
  const password = settings.smtpPasswordEnc ? decryptSecret(process.env.SETTINGS_ENCRYPTION_KEY ?? "", settings.smtpPasswordEnc) : null;
  if (!values.notificationEmail || !values.smtpHost || !values.smtpFromAddress || !password) return;
  await sendSmtpEmail({
    host: values.smtpHost,
    port: Number(values.smtpPort),
    tlsMode: values.smtpTlsMode,
    username: values.smtpUsername,
    password,
    timeoutMs: Number(values.smtpConnectionTimeoutSeconds) * 1_000,
    heloName: values.smtpHeloName || values.smtpHost,
  }, {
    from: values.smtpFromAddress,
    to: values.notificationEmail,
    subject: `[Cold Emailer] ${incident.kind} alert`,
    text: incident.detail,
  });
}

export async function monitorOnce(now = new Date(), notify = emailNotification) {
  const prisma = getPrisma();
  const [settings, heartbeat, services, failedJobs, campaigns, deliveryGroups] = await Promise.all([
    prisma.appSettings.findUnique({ where: { id: "singleton" } }),
    prisma.workerHeartbeat.findFirst({ orderBy: { lastSeenAt: "desc" } }),
    prisma.serviceStatus.findMany({ where: { state: "ERROR" } }),
    prisma.job.count({ where: { status: "FAILED" } }),
    prisma.campaign.findMany({ where: { status: { in: ["RUNNING", "PAUSED", "COMPLETED"] } }, select: { id: true, name: true, status: true } }),
    prisma.emailMessage.groupBy({ by: ["campaignId", "status"], where: { status: { in: ["SMTP_ACCEPTED", "BOUNCED"] } }, _count: true }),
  ]);
  if (!settings) return 0;
  const values = settingsValues(settings.values);
  const incidents: Incident[] = [];
  const worker = workerIncident(heartbeat?.lastSeenAt ?? null, now);
  if (worker && values.alertWorkerInactivity === "Enabled") incidents.push(worker);
  if (values.alertConnectionFailures === "Enabled") {
    incidents.push(...services.filter(({ id }) => id === "smtp" || id === "imap" || id === "ai").map((service) => ({ id: `service:${service.id}`, kind: service.id.toUpperCase(), detail: service.message || `${service.id.toUpperCase()} health check failed.` })));
  }
  if (failedJobs && values.alertSendFailures === "Enabled") incidents.push({ id: "jobs:failed", kind: "SEND", detail: `${failedJobs} delivery job${failedJobs === 1 ? " has" : "s have"} exhausted retries.` });
  if (values.alertHighBounceRate === "Enabled") {
    for (const campaign of campaigns) {
      const groups = deliveryGroups.filter(({ campaignId }) => campaignId === campaign.id);
      const accepted = groups.reduce((sum, group) => sum + group._count, 0);
      const bounced = groups.find(({ status }) => status === "BOUNCED")?._count ?? 0;
      if (accepted && bounced / accepted * 100 >= Number(values.bounceRateThresholdPercent)) incidents.push({ id: `bounce:${campaign.id}`, kind: "BOUNCE", detail: `${campaign.name} has ${bounced} bounces among ${accepted} SMTP-accepted messages.` });
    }
  }
  if (values.alertCampaignCompletion === "Enabled") incidents.push(...campaigns.filter(({ status }) => status === "COMPLETED").map((campaign) => ({ id: `campaign:${campaign.id}:completed`, kind: "CAMPAIGN", detail: `${campaign.name} completed.` })));
  return syncOperationalAlerts(incidents, Number(values.alertCooldownMinutes), async (incident) => {
    operationalLog("error", "operational_alert", { alertId: incident.id, kind: incident.kind });
    try { await notify(incident); } catch (error) { operationalLog("error", "alert_delivery_failed", { alertId: incident.id, error: error instanceof Error ? error.message.slice(0, 200) : "Unknown error" }); }
  }, now);
}
