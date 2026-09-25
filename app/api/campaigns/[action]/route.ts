import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { getRequestSession, isSameOrigin, requestOrigin } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { zonedDateTimeToUtc } from "@/lib/scheduler";
import { sendingReadinessErrors, settingsValues, SETTINGS_ROW_ID } from "@/lib/settings";
import { contactsMissingVariables } from "@/lib/templates";

function back(request: NextRequest, query: string) {
  return NextResponse.redirect(new URL(`/campaigns?${query}`, requestOrigin(request)), 303);
}

function integer(value: FormDataEntryValue | null, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function validTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const session = await getRequestSession(request);
  if (!session) return NextResponse.redirect(new URL("/login", requestOrigin(request)), 303);

  const action = (await params).action;
  const form = await request.formData();
  const prisma = getPrisma();
  const settings = await prisma.appSettings.findUnique({ where: { id: SETTINGS_ROW_ID } });
  const values = settingsValues(settings?.values);

  try {
    if (action === "create") {
      const name = String(form.get("name") ?? "").trim();
      const contactListId = String(form.get("contactListId") ?? "");
      const templateId = String(form.get("templateId") ?? "");
      const timezone = String(form.get("timezone") ?? "");
      const dailyCap = integer(form.get("dailyCap"), 1, Number(values.smtpMaxPerDay));
      if (!name || name.length > 160 || !dailyCap || !validTimezone(timezone)) return back(request, "error=invalid");
      const [list, template] = await Promise.all([
        prisma.contactList.findUnique({ where: { id: contactListId }, select: { id: true } }),
        prisma.template.findUnique({ where: { id: templateId }, select: { id: true, archivedAt: true } }),
      ]);
      if (!list || !template || template.archivedAt) return back(request, "error=invalid");
      const id = randomUUID();
      await prisma.$transaction([
        prisma.campaign.create({ data: { id, name, contactListId, timezone, dailyCap, createdByUserId: session.user.id } }),
        prisma.campaignStep.create({ data: { campaignId: id, templateId, position: 0, delayMinutes: 0 } }),
        prisma.auditEvent.create({ data: { actorUserId: session.user.id, action: "campaign.created", targetType: "Campaign", targetId: id } }),
      ]);
      return back(request, `notice=created&campaign=${id}`);
    }

    const campaignId = String(form.get("campaignId") ?? "");
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, include: { steps: { orderBy: { position: "asc" }, include: { template: true } } } });
    if (!campaign) return back(request, "error=invalid");

    if (action === "add-step") {
      if (campaign.status !== "DRAFT") return back(request, `error=state&campaign=${campaign.id}`);
      const templateId = String(form.get("templateId") ?? "");
      const delayMinutes = integer(form.get("delayMinutes"), 1, 525_600);
      const last = campaign.steps.at(-1);
      const template = await prisma.template.findUnique({ where: { id: templateId }, select: { id: true, archivedAt: true } });
      if (!delayMinutes || !template || template.archivedAt || (last && delayMinutes <= last.delayMinutes)) return back(request, `error=invalid&campaign=${campaign.id}`);
      await prisma.campaignStep.create({ data: { campaignId: campaign.id, templateId, position: campaign.steps.length, delayMinutes } });
      return back(request, `notice=updated&campaign=${campaign.id}`);
    }

    if (action === "remove-step") {
      if (campaign.status !== "DRAFT" || campaign.steps.length <= 1) return back(request, `error=state&campaign=${campaign.id}`);
      const stepId = String(form.get("stepId") ?? "");
      const step = campaign.steps.find(({ id }) => id === stepId);
      if (!step || step.position === 0) return back(request, `error=invalid&campaign=${campaign.id}`);
      await prisma.campaignStep.delete({ where: { id: step.id } });
      return back(request, `notice=updated&campaign=${campaign.id}`);
    }

    if (action === "review") {
      if ((campaign.status !== "DRAFT" && campaign.status !== "REVIEW") || !campaign.contactListId || !campaign.steps.length) return back(request, `error=state&campaign=${campaign.id}`);
      const contacts = await prisma.$queryRaw<Array<{ id: string; email: string; firstName: string; lastName: string; company: string; title: string; tags: string[]; customFields: Prisma.JsonValue }>>`
        SELECT contact."id", contact."email", contact."first_name" AS "firstName", contact."last_name" AS "lastName",
               contact."company", contact."title", contact."tags", contact."custom_fields" AS "customFields"
        FROM "contacts" AS contact
        JOIN "contact_list_members" AS member ON member."contact_id" = contact."id"
        WHERE member."list_id" = ${campaign.contactListId}::uuid
          AND contact."archived_at" IS NULL
          AND NOT EXISTS (SELECT 1 FROM "suppressions" AS suppression WHERE suppression."email" = contact."email")
        ORDER BY contact."id"
      `;
      const maxAudience = Number(values.maxAudienceSize);
      if (!contacts.length || contacts.length > maxAudience) {
        await prisma.campaign.update({ where: { id: campaign.id }, data: { reviewErrors: [`Eligible audience is ${contacts.length}; it must be between 1 and ${maxAudience}.`] } });
        return back(request, `error=audience&campaign=${campaign.id}`);
      }
      const errors = campaign.steps.flatMap((step) => contactsMissingVariables(step.template, contacts, {
        campaignName: campaign.name,
        senderName: values.senderDisplayName,
        senderCompany: values.companyName,
      }).map(({ email, missing }) => `${email}: ${missing.join(", ")}`));
      if (errors.length) {
        await prisma.campaign.update({ where: { id: campaign.id }, data: { reviewErrors: errors.slice(0, 200) } });
        return back(request, `error=missing&campaign=${campaign.id}`);
      }
      const listTotal = await prisma.contactListMember.count({ where: { listId: campaign.contactListId } });
      await prisma.$transaction(async (tx) => {
        await tx.campaignRecipient.deleteMany({ where: { campaignId: campaign.id } });
        for (let offset = 0; offset < contacts.length; offset += 1_000) {
          await tx.campaignRecipient.createMany({ data: contacts.slice(offset, offset + 1_000).map((contact) => ({
            campaignId: campaign.id,
            contactId: contact.id,
            email: contact.email,
            dataSnapshot: {
              email: contact.email, firstName: contact.firstName, lastName: contact.lastName,
              company: contact.company, title: contact.title, tags: contact.tags, customFields: contact.customFields,
            },
          })) });
        }
        await tx.campaign.update({ where: { id: campaign.id }, data: {
          status: "REVIEW", audienceCount: contacts.length, excludedCount: Math.max(0, listTotal - contacts.length),
          reviewErrors: [], reviewedAt: new Date(),
        } });
        await tx.auditEvent.create({ data: { actorUserId: session.user.id, action: "campaign.reviewed", targetType: "Campaign", targetId: campaign.id } });
      });
      return back(request, `notice=reviewed&campaign=${campaign.id}`);
    }

    if (action === "schedule") {
      if (campaign.status !== "REVIEW" || campaign.reviewErrors && Array.isArray(campaign.reviewErrors) && campaign.reviewErrors.length) return back(request, `error=state&campaign=${campaign.id}`);
      if (sendingReadinessErrors(values, Boolean(settings?.smtpPasswordEnc)).length) return back(request, `error=config&campaign=${campaign.id}`);
      const scheduledAt = zonedDateTimeToUtc(String(form.get("scheduledLocal") ?? ""), campaign.timezone);
      const minimum = new Date(Date.now() + Number(values.minimumStartDelayMinutes) * 60_000);
      if (!scheduledAt || scheduledAt < minimum) return back(request, `error=schedule&campaign=${campaign.id}`);
      const recipients = await prisma.campaignRecipient.findMany({ where: { campaignId: campaign.id }, select: { id: true } });
      if (!recipients.length) return back(request, `error=state&campaign=${campaign.id}`);
      const jobs = recipients.flatMap((recipient) => campaign.steps.map((step) => ({
        campaignId: campaign.id,
        recipientId: recipient.id,
        stepId: step.id,
        runAt: new Date(scheduledAt.getTime() + step.delayMinutes * 60_000),
        maxAttempts: Number(values.smtpRetryCount) + 1,
        idempotencyKey: `${campaign.id}:${recipient.id}:${step.id}`,
      })));
      await prisma.$transaction(async (tx) => {
        for (let offset = 0; offset < jobs.length; offset += 1_000) await tx.job.createMany({ data: jobs.slice(offset, offset + 1_000), skipDuplicates: true });
        await tx.campaign.update({ where: { id: campaign.id }, data: { status: "SCHEDULED", scheduledAt } });
        await tx.auditEvent.create({ data: { actorUserId: session.user.id, action: "campaign.scheduled", targetType: "Campaign", targetId: campaign.id } });
      });
      return back(request, `notice=scheduled&campaign=${campaign.id}`);
    }

    if (action === "pause") {
      if (campaign.status !== "SCHEDULED" && campaign.status !== "RUNNING") return back(request, `error=state&campaign=${campaign.id}`);
      await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "PAUSED", pausedAt: new Date() } });
    } else if (action === "resume") {
      if (campaign.status !== "PAUSED") return back(request, `error=state&campaign=${campaign.id}`);
      await prisma.campaign.update({ where: { id: campaign.id }, data: { status: campaign.scheduledAt && campaign.scheduledAt <= new Date() ? "RUNNING" : "SCHEDULED", pausedAt: null } });
    } else if (action === "cancel") {
      if (["COMPLETED", "CANCELED"].includes(campaign.status)) return back(request, `error=state&campaign=${campaign.id}`);
      await prisma.$transaction([
        prisma.campaign.update({ where: { id: campaign.id }, data: { status: "CANCELED", canceledAt: new Date() } }),
        prisma.job.updateMany({ where: { campaignId: campaign.id, status: { in: ["PENDING", "LEASED"] } }, data: { status: "CANCELED", lastError: "Campaign canceled before delivery." } }),
        prisma.campaignRecipient.updateMany({ where: { campaignId: campaign.id, status: "PENDING" }, data: { status: "CANCELED", lastError: "Campaign canceled before delivery." } }),
      ]);
    } else return back(request, "error=invalid");

    await prisma.auditEvent.create({ data: { actorUserId: session.user.id, action: `campaign.${action}d`, targetType: "Campaign", targetId: campaign.id } });
    return back(request, `notice=updated&campaign=${campaign.id}`);
  } catch {
    return back(request, "error=invalid");
  }
}

export const dynamic = "force-dynamic";
