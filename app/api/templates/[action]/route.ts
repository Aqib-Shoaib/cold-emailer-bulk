import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { getRequestSession, isSameOrigin, requestOrigin } from "@/lib/auth";
import { decryptSecret } from "@/lib/crypto";
import { getPrisma } from "@/lib/prisma";
import { settingsValues, SETTINGS_ROW_ID } from "@/lib/settings";
import { sendSmtpEmail } from "@/lib/smtp";
import { appendBulkFooter, parseTemplateInput, renderTemplate, templateContext } from "@/lib/templates";
import { createUnsubscribeToken } from "@/lib/unsubscribe";

function back(request: NextRequest, query: string) {
  return NextResponse.redirect(new URL(`/templates?${query}`, requestOrigin(request)), 303);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const session = await getRequestSession(request);
  if (!session) return NextResponse.redirect(new URL("/login", requestOrigin(request)), 303);

  const action = (await params).action;
  const form = await request.formData();
  const prisma = getPrisma();

  try {
    if (action === "create") {
      const data = parseTemplateInput(form);
      if (!data) return back(request, "error=invalid");
      const id = randomUUID();
      await prisma.$transaction([
        prisma.template.create({ data: { id, ...data } }),
        prisma.templateVersion.create({ data: { templateId: id, version: 1, subject: data.subject, textBody: data.textBody, htmlBody: data.htmlBody, createdByUserId: session.user.id } }),
        prisma.auditEvent.create({ data: { actorUserId: session.user.id, action: "template.created", targetType: "Template", targetId: id } }),
      ]);
      return back(request, `notice=created&template=${id}`);
    }

    const templateId = String(form.get("templateId") ?? "");
    const template = await prisma.template.findUnique({ where: { id: templateId } });
    if (!template) return back(request, "error=invalid");

    if (action === "update") {
      const data = parseTemplateInput(form);
      if (!data) return back(request, `error=invalid&template=${template.id}`);
      await prisma.$transaction(async (tx) => {
        const version = template.currentVersion + 1;
        const updated = await tx.template.updateMany({ where: { id: template.id, currentVersion: template.currentVersion }, data: { ...data, currentVersion: version } });
        if (!updated.count) throw new Error("Template changed while it was being saved");
        await tx.templateVersion.create({ data: { templateId: template.id, version, subject: data.subject, textBody: data.textBody, htmlBody: data.htmlBody, createdByUserId: session.user.id } });
        await tx.auditEvent.create({ data: { actorUserId: session.user.id, action: "template.updated", targetType: "Template", targetId: template.id } });
      });
      return back(request, `notice=updated&template=${template.id}`);
    }

    if (action === "duplicate") {
      const id = randomUUID();
      await prisma.$transaction([
        prisma.template.create({ data: { id, name: `${template.name} copy`.slice(0, 160), subject: template.subject, textBody: template.textBody, htmlBody: template.htmlBody } }),
        prisma.templateVersion.create({ data: { templateId: id, version: 1, subject: template.subject, textBody: template.textBody, htmlBody: template.htmlBody, createdByUserId: session.user.id } }),
        prisma.auditEvent.create({ data: { actorUserId: session.user.id, action: "template.duplicated", targetType: "Template", targetId: id } }),
      ]);
      return back(request, `notice=created&template=${id}`);
    }

    if (action === "archive" || action === "restore") {
      await prisma.$transaction([
        prisma.template.update({ where: { id: template.id }, data: { archivedAt: action === "archive" ? new Date() : null } }),
        prisma.auditEvent.create({ data: { actorUserId: session.user.id, action: `template.${action}d`, targetType: "Template", targetId: template.id } }),
      ]);
      return back(request, "notice=updated");
    }

    if (action === "test-send") {
      const contact = await prisma.contact.findUnique({ where: { id: String(form.get("contactId") ?? "") } });
      const recipient = String(form.get("recipient") ?? "").trim().toLowerCase();
      const campaignName = String(form.get("campaignName") ?? "").trim();
      if (!contact || !campaignName || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(recipient)) return back(request, `error=invalid&template=${template.id}`);

      const settings = await prisma.appSettings.findUnique({ where: { id: SETTINGS_ROW_ID } });
      const values = settingsValues(settings?.values);
      const encryptionKey = process.env.SETTINGS_ENCRYPTION_KEY ?? "";
      const password = settings?.smtpPasswordEnc ? decryptSecret(encryptionKey, settings.smtpPasswordEnc) : null;
      if (!password || !values.smtpHost || !values.smtpFromAddress || !values.publicBaseUrl) return back(request, `error=smtp&template=${template.id}`);

      const rendered = appendBulkFooter(
        renderTemplate(template, templateContext({ contact, campaignName, senderName: values.senderDisplayName, senderCompany: values.companyName })),
        {
          senderName: values.senderDisplayName,
          companyName: values.companyName,
          physicalAddress: values.physicalAddress,
          footerText: values.unsubscribeFooter,
          unsubscribeUrl: `${values.publicBaseUrl.replace(/\/$/, "")}/unsubscribe?token=${encodeURIComponent(createUnsubscribeToken(contact.email))}`,
        },
      );
      if (rendered.missing.length) return back(request, `error=missing&template=${template.id}&missing=${encodeURIComponent(rendered.missing.join(","))}`);

      await sendSmtpEmail({
        host: values.smtpHost,
        port: Number(values.smtpPort),
        tlsMode: values.smtpTlsMode,
        username: values.smtpUsername,
        password,
        timeoutMs: Number(values.smtpConnectionTimeoutSeconds) * 1_000,
        heloName: values.smtpHeloName || values.smtpHost,
      }, { from: values.smtpFromAddress, to: recipient, subject: rendered.subject, text: rendered.text, html: rendered.html });
      await prisma.auditEvent.create({ data: { actorUserId: session.user.id, action: "template.test_sent", targetType: "Template", targetId: template.id } });
      return back(request, `notice=test-sent&template=${template.id}`);
    }

    return back(request, "error=invalid");
  } catch {
    return back(request, action === "test-send" ? "error=smtp" : "error=invalid");
  }
}

export const dynamic = "force-dynamic";
