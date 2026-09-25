import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { getRequestSession, isSameOrigin, requestOrigin } from "@/lib/auth";
import { decryptSecret } from "@/lib/crypto";
import { syncInboxNow } from "@/lib/imap";
import { replySubject } from "@/lib/inbound";
import { getPrisma } from "@/lib/prisma";
import { SETTINGS_ROW_ID, settingsValues } from "@/lib/settings";
import { sendSmtpEmail, SmtpDeliveryError } from "@/lib/smtp";

function back(request: NextRequest, query: string) {
  return NextResponse.redirect(new URL(`/inbox?${query}`, requestOrigin(request)), 303);
}

function value(form: FormData, key: string) {
  const raw = form.get(key);
  return typeof raw === "string" ? raw.trim() : "";
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const session = await getRequestSession(request);
  if (!session) return NextResponse.redirect(new URL("/login", requestOrigin(request)), 303);

  const action = (await params).action;
  if (!["sync", "read", "unread", "associate", "reply"].includes(action)) return new NextResponse("Not found", { status: 404 });
  const prisma = getPrisma();

  if (action === "sync") {
    const result = await syncInboxNow();
    await prisma.auditEvent.create({ data: { actorUserId: session.user.id, action: "inbox.synced", targetType: "Inbox" } });
    return back(request, result.ok ? `notice=synced&count=${result.synced}` : `error=sync&detail=${encodeURIComponent(result.message)}`);
  }

  const form = await request.formData();
  const messageId = value(form, "messageId");
  if (!messageId) return back(request, "error=missing");
  const message = await prisma.inboundMessage.findUnique({ where: { id: messageId } });
  if (!message) return back(request, "error=missing");

  if (action === "read" || action === "unread") {
    await prisma.inboundMessage.update({ where: { id: message.id }, data: { readAt: action === "read" ? new Date() : null } });
    return back(request, `message=${message.id}&notice=${action}`);
  }

  if (action === "associate") {
    const contactId = value(form, "contactId") || null;
    const campaignId = value(form, "campaignId") || null;
    const [contact, campaign] = await Promise.all([
      contactId ? prisma.contact.findUnique({ where: { id: contactId } }) : null,
      campaignId ? prisma.campaign.findUnique({ where: { id: campaignId } }) : null,
    ]);
    if ((contactId && !contact) || (campaignId && !campaign)) return back(request, `message=${message.id}&error=association`);
    const settings = await prisma.appSettings.findUnique({ where: { id: SETTINGS_ROW_ID } });
    const stopOnReply = settingsValues(settings?.values).stopOnReply === "Enabled";
    await prisma.$transaction(async (tx) => {
      await tx.inboundMessage.update({ where: { id: message.id }, data: {
        contactId,
        campaignId,
        ...(message.kind === "UNMATCHED" && contactId ? { kind: "REPLY", reviewReason: "Manually associated by an administrator." } : {}),
      } });
      if (contact && message.kind === "UNMATCHED") {
        await tx.contact.update({ where: { id: contact.id }, data: { lastRepliedAt: message.receivedAt, lastEmailReceivedAt: message.receivedAt, lastReceivedSubject: message.subject } });
        if (stopOnReply) await tx.job.updateMany({ where: { recipient: { contactId: contact.id }, status: "PENDING" }, data: { status: "CANCELED", completedAt: new Date(), lastError: "Canceled after manually associated reply." } });
        if (stopOnReply) await tx.campaign.updateMany({ where: { status: { in: ["SCHEDULED", "RUNNING"] }, jobs: { none: { status: { in: ["PENDING", "LEASED", "DELIVERING"] } } } }, data: { status: "COMPLETED", completedAt: new Date() } });
      }
      await tx.auditEvent.create({ data: { actorUserId: session.user.id, action: "inbox.associated", targetType: "InboundMessage", targetId: message.id } });
    });
    return back(request, `message=${message.id}&notice=associated`);
  }

  const body = value(form, "body");
  if (!body || body.length > 100_000 || !message.fromEmail) return back(request, `message=${message.id}&error=reply`);
  const settings = await prisma.appSettings.findUnique({ where: { id: SETTINGS_ROW_ID } });
  const values = settingsValues(settings?.values);
  const password = settings?.smtpPasswordEnc ? decryptSecret(process.env.SETTINGS_ENCRYPTION_KEY ?? "", settings.smtpPasswordEnc) : null;
  if (!password || !values.smtpHost || !values.smtpFromAddress) return back(request, `message=${message.id}&error=smtp`);

  const domain = values.smtpFromAddress.split("@")[1];
  const outboundId = `<${randomUUID()}@${domain}>`;
  const subject = replySubject(message.subject);
  const references = [...new Set([...message.references, message.messageId].filter(Boolean))];
  const reply = await prisma.inboxReply.create({ data: {
    inboundMessageId: message.id,
    contactId: message.contactId,
    campaignId: message.campaignId,
    sentByUserId: session.user.id,
    messageId: outboundId,
    toEmail: message.fromEmail,
    subject,
    textBody: body,
  } });
  try {
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
      to: message.fromEmail,
      replyTo: values.smtpReplyTo || values.defaultReplyTo || undefined,
      subject,
      text: body,
      messageId: outboundId,
      inReplyTo: message.messageId || undefined,
      references,
    });
    await prisma.$transaction([
      prisma.inboxReply.update({ where: { id: reply.id }, data: { status: "SMTP_ACCEPTED", smtpAcceptedAt: new Date() } }),
      prisma.inboundMessage.update({ where: { id: message.id }, data: { readAt: message.readAt ?? new Date() } }),
      prisma.auditEvent.create({ data: { actorUserId: session.user.id, action: "inbox.replied", targetType: "InboundMessage", targetId: message.id } }),
    ]);
    return back(request, `message=${message.id}&notice=replied`);
  } catch (error) {
    const uncertain = error instanceof SmtpDeliveryError && error.deliveryUncertain;
    const detail = `${uncertain ? "Delivery outcome is unknown" : "SMTP delivery failed"}: ${error instanceof Error ? error.message : "Unknown error"}`.slice(0, 500);
    await prisma.inboxReply.update({ where: { id: reply.id }, data: { status: uncertain ? "UNKNOWN" : "FAILED", lastError: detail } });
    return back(request, `message=${message.id}&error=send&detail=${encodeURIComponent(detail)}`);
  }
}

export const dynamic = "force-dynamic";
