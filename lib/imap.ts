import { createHash } from "node:crypto";
import { ImapFlow, type FetchMessageObject, type MessageStructureObject } from "imapflow";
import { simpleParser, type AddressObject, type HeaderValue, type ParsedMail } from "mailparser";
import type { Prisma } from "@/generated/prisma/client";

import { decryptSecret } from "./crypto.ts";
import { classifyInbound, normalizeMessageId, safeHtml } from "./inbound.ts";
import { getPrisma } from "./prisma.ts";
import { SETTINGS_ROW_ID, settingsValues } from "./settings.ts";

const RAW_LIMIT = 25 * 1024 * 1024;
const SYNC_LEASE_MS = 5 * 60 * 1_000;

export interface InboxSyncResult {
  ok: boolean;
  synced: number;
  skipped: number;
  message: string;
}

export async function probeImap(target: { host: string; port: number; tlsMode: string; username: string; password: string; timeoutMs: number }) {
  if (!target.host || !target.port || Number.isNaN(target.port)) return { ok: false, message: "IMAP host and port are required." };
  const client = new ImapFlow({
    host: target.host,
    port: target.port,
    secure: target.tlsMode === "TLS",
    doSTARTTLS: target.tlsMode === "STARTTLS" ? true : target.tlsMode === "NONE" ? false : undefined,
    auth: { user: target.username, pass: target.password },
    logger: false,
    greetingTimeout: target.timeoutMs,
    socketTimeout: target.timeoutMs,
  });
  client.on("error", () => undefined);
  try {
    await client.connect();
    await client.logout();
    return { ok: true, message: "" };
  } catch (error) {
    client.close();
    return { ok: false, message: error instanceof Error ? error.message : "The IMAP connection failed." };
  }
}

function accountId(host: string, username: string, folder: string) {
  return createHash("sha256").update(`${host}\0${username}\0${folder}`).digest("hex");
}

export function imapSearchPlan(state: { uidValidity: string; lastUid: number }, currentUidValidity: string, uidNext: number, lookbackDays: number, now: Date) {
  if (state.uidValidity === currentUidValidity && state.lastUid > 0) {
    return uidNext <= state.lastUid + 1 ? null : { uid: `${state.lastUid + 1}:*` };
  }
  return { since: new Date(now.getTime() - lookbackDays * 86_400_000) };
}

function headerText(value: HeaderValue | undefined) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(String).join(" ");
  if (value instanceof Date) return value.toISOString();
  if (value && "value" in value && typeof value.value === "string") return value.value;
  return "";
}

function addressList(value: AddressObject | AddressObject[] | undefined) {
  const groups = Array.isArray(value) ? value : value ? [value] : [];
  return groups.flatMap((group) => group.value).flatMap((entry) => entry.group ?? [entry]);
}

function attachmentMetadata(structure: MessageStructureObject | undefined): Array<{ filename: string; contentType: string; size: number }> {
  if (!structure) return [];
  const children = structure.childNodes?.flatMap(attachmentMetadata) ?? [];
  const filename = structure.dispositionParameters?.filename ?? structure.parameters?.name ?? "";
  return structure.disposition === "attachment" || filename
    ? [{ filename: filename.slice(0, 255), contentType: structure.type.slice(0, 120), size: structure.size ?? 0 }, ...children]
    : children;
}

function fallbackMail(message: FetchMessageObject): ParsedMail {
  const from = message.envelope?.from?.[0];
  const to = message.envelope?.to ?? [];
  const address = (entry: { address?: string; name?: string }) => ({ address: entry.address, name: entry.name ?? "" });
  return {
    attachments: [],
    headers: new Map(),
    headerLines: [],
    html: false,
    subject: message.envelope?.subject ?? "",
    date: message.envelope?.date ? new Date(message.envelope.date) : undefined,
    messageId: message.envelope?.messageId,
    inReplyTo: message.envelope?.inReplyTo,
    from: from ? { value: [address(from)], html: "", text: from.address ?? "" } : undefined,
    to: to.length ? { value: to.map(address), html: "", text: to.map((entry) => entry.address).join(", ") } : undefined,
  };
}

async function collectRaw(client: ImapFlow, uid: number) {
  const downloaded = await client.download(uid, undefined, { uid: true, maxBytes: RAW_LIMIT + 1 });
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of downloaded.content) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > RAW_LIMIT) throw new Error("Message exceeds the 25 MB parsing limit");
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function associations(references: string[], fromEmail: string) {
  const prisma = getPrisma();
  const outbound = references.length
    ? await prisma.emailMessage.findFirst({ where: { messageId: { in: references } }, orderBy: { createdAt: "desc" } })
    : null;
  if (outbound) return { outbound, contactId: outbound.contactId, campaignId: outbound.campaignId };

  const sentReply = references.length
    ? await prisma.inboxReply.findFirst({
        where: { messageId: { in: references } },
        include: { inboundMessage: { select: { contactId: true, campaignId: true, outboundMessageId: true } } },
        orderBy: { createdAt: "desc" },
      })
    : null;
  if (sentReply) {
    const original = sentReply.inboundMessage;
    const linkedOutbound = original.outboundMessageId
      ? await prisma.emailMessage.findUnique({ where: { id: original.outboundMessageId } })
      : null;
    return { outbound: linkedOutbound, contactId: original.contactId, campaignId: original.campaignId };
  }

  const contact = fromEmail ? await prisma.contact.findUnique({ where: { email: fromEmail } }) : null;
  return { outbound: null, contactId: contact?.id ?? null, campaignId: null };
}

export async function storeMessage(folder: string, uidValidity: string, message: FetchMessageObject, raw: Buffer | null, parseError: string, stopOnReply = true) {
  const prisma = getPrisma();
  const existing = await prisma.inboundMessage.findUnique({
    where: { folder_uidValidity_uid: { folder, uidValidity, uid: message.uid } },
  });
  if (existing) return false;

  let mail = fallbackMail(message);
  if (raw) {
    try {
      mail = await simpleParser(raw, { skipImageLinks: true, skipTextToHtml: true, maxHtmlLengthToParse: 5_000_000 });
    } catch (error) {
      parseError = error instanceof Error ? error.message : "Malformed email";
    }
  }

  const from = addressList(mail.from)[0];
  const fromEmail = from?.address?.trim().toLowerCase().slice(0, 320) ?? "";
  const refs = [mail.inReplyTo ?? "", ...(Array.isArray(mail.references) ? mail.references : [mail.references ?? ""])]
    .map(normalizeMessageId).filter(Boolean);
  const linked = await associations([...new Set(refs)], fromEmail);
  const headers = Object.fromEntries(
    ["auto-submitted", "precedence", "x-autoreply", "x-failed-recipients", "content-type"]
      .map((key) => [key, headerText(mail.headers.get(key))]),
  );
  const text = (mail.text ?? "").slice(0, 1_000_000);
  const classificationText = `${text}\n${raw?.toString("utf8", 0, 1_000_000) ?? ""}`;
  const classification = parseError
    ? { kind: "REVIEW" as const, bounceEmail: "", reason: `Parsing failed: ${parseError}` }
    : classifyInbound({ fromEmail, subject: mail.subject ?? "", text: classificationText, headers, hasOutboundReference: Boolean(linked.outbound || linked.campaignId) });

  let contactId = linked.contactId;
  let campaignId = linked.campaignId;
  let bouncedOutbound = linked.outbound;
  if (classification.kind === "HARD_BOUNCE") {
    const bouncedContact = await prisma.contact.findUnique({ where: { email: classification.bounceEmail } });
    contactId = bouncedContact?.id ?? linked.contactId;
    bouncedOutbound ??= await prisma.emailMessage.findFirst({ where: { toEmail: classification.bounceEmail }, orderBy: { createdAt: "desc" } });
    campaignId ??= bouncedOutbound?.campaignId ?? null;
  }

  const receivedAt = mail.date && !Number.isNaN(mail.date.getTime())
    ? mail.date
    : message.internalDate ? new Date(message.internalDate) : new Date();
  const attachments = mail.attachments.length
    ? mail.attachments.map((item) => ({ filename: (item.filename ?? "").slice(0, 255), contentType: item.contentType.slice(0, 120), size: item.size, contentId: (item.contentId ?? "").slice(0, 255) }))
    : attachmentMetadata(message.bodyStructure);

  await prisma.$transaction(async (tx) => {
    await tx.inboundMessage.create({ data: {
      folder,
      uidValidity,
      uid: message.uid,
      messageId: normalizeMessageId(mail.messageId ?? message.envelope?.messageId ?? "").slice(0, 500),
      inReplyTo: normalizeMessageId(mail.inReplyTo ?? "").slice(0, 500),
      references: [...new Set(refs)].map((entry) => entry.slice(0, 500)),
      fromName: (from?.name ?? "").slice(0, 320),
      fromEmail,
      toEmails: addressList(mail.to).flatMap((entry) => entry.address?.trim().toLowerCase().slice(0, 320) ?? []).filter(Boolean),
      subject: (mail.subject ?? "(no subject)").slice(0, 500),
      textBody: text,
      // ponytail: render a safe plain-text projection; preserve rich HTML only if users later need it.
      htmlBody: safeHtml(text),
      attachments: attachments as Prisma.InputJsonValue,
      receivedAt,
      readAt: message.flags?.has("\\Seen") ? receivedAt : null,
      kind: classification.kind,
      reviewReason: classification.reason.slice(0, 500),
      parseError: parseError.slice(0, 500),
      contactId,
      campaignId,
      outboundMessageId: bouncedOutbound?.id ?? linked.outbound?.id ?? null,
    } });

    if (contactId && classification.kind !== "HARD_BOUNCE") {
      await tx.contact.update({ where: { id: contactId }, data: {
        lastEmailReceivedAt: receivedAt,
        lastReceivedSubject: (mail.subject ?? "(no subject)").slice(0, 500),
        ...(classification.kind === "REPLY" ? { lastRepliedAt: receivedAt } : {}),
      } });
      if (classification.kind === "REPLY" && stopOnReply) {
        await tx.job.updateMany({ where: { recipient: { contactId }, status: "PENDING" }, data: { status: "CANCELED", completedAt: receivedAt, lastError: "Canceled after recipient reply." } });
      }
    }

    if (classification.kind === "HARD_BOUNCE" && classification.bounceEmail) {
      const suppression = await tx.suppression.findUnique({ where: { email: classification.bounceEmail } });
      if (!suppression || suppression.reason === "MANUAL") {
        await tx.suppression.upsert({
          where: { email: classification.bounceEmail },
          create: { email: classification.bounceEmail, reason: "BOUNCED", detail: classification.reason },
          update: { reason: "BOUNCED", detail: classification.reason },
        });
      }
      await tx.job.updateMany({ where: { recipient: { email: classification.bounceEmail }, status: "PENDING" }, data: { status: "CANCELED", completedAt: receivedAt, lastError: "Canceled after hard bounce." } });
      if (bouncedOutbound) {
        await tx.emailMessage.update({ where: { id: bouncedOutbound.id }, data: { status: "BOUNCED", lastError: classification.reason } });
        await tx.campaignRecipient.update({ where: { id: bouncedOutbound.recipientId }, data: { status: "BOUNCED", lastError: classification.reason } });
      }
    }
    if ((classification.kind === "REPLY" && stopOnReply) || classification.kind === "HARD_BOUNCE") {
      await tx.campaign.updateMany({
        where: { status: { in: ["SCHEDULED", "RUNNING"] }, jobs: { none: { status: { in: ["PENDING", "LEASED", "DELIVERING"] } } } },
        data: { status: "COMPLETED", completedAt: receivedAt },
      });
    }
  });
  return true;
}

async function configuredSync(force: boolean): Promise<InboxSyncResult> {
  const prisma = getPrisma();
  const settings = await prisma.appSettings.findUnique({ where: { id: SETTINGS_ROW_ID } });
  const key = process.env.SETTINGS_ENCRYPTION_KEY ?? "";
  const password = settings?.imapPasswordEnc ? decryptSecret(key, settings.imapPasswordEnc) : null;
  const values = settingsValues(settings?.values);
  if (!values.imapHost || !values.imapUsername || !password) {
    return { ok: !force, synced: 0, skipped: 0, message: "Save the IMAP host, username, and password first." };
  }

  const folder = values.imapFolder || "INBOX";
  const id = accountId(values.imapHost, values.imapUsername, folder);
  const now = new Date();
  await prisma.imapSyncState.upsert({ where: { id }, create: { id, host: values.imapHost, username: values.imapUsername, folder }, update: {} });
  const state = await prisma.imapSyncState.findUniqueOrThrow({ where: { id } });
  if (!force && state.lastSyncedAt && state.lastSyncedAt.getTime() + Number(values.imapPollIntervalSeconds) * 1_000 > now.getTime()) {
    return { ok: true, synced: 0, skipped: 0, message: "Inbox is not due for another sync yet." };
  }
  const claimed = await prisma.imapSyncState.updateMany({
    where: { id, OR: [{ syncStartedAt: null }, { syncStartedAt: { lt: new Date(now.getTime() - SYNC_LEASE_MS) } }] },
    data: { syncStartedAt: now, lastError: "" },
  });
  if (!claimed.count) return { ok: true, synced: 0, skipped: 0, message: "An inbox sync is already running." };

  const client = new ImapFlow({
    host: values.imapHost,
    port: Number(values.imapPort),
    secure: values.imapTlsMode === "TLS",
    doSTARTTLS: values.imapTlsMode === "STARTTLS" ? true : values.imapTlsMode === "NONE" ? false : undefined,
    auth: { user: values.imapUsername, pass: password },
    logger: false,
    greetingTimeout: 10_000,
    socketTimeout: 60_000,
  });
  client.on("error", () => undefined);

  let synced = 0;
  let skipped = 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock(folder, { acquireTimeout: 30_000 });
    try {
      if (!client.mailbox) throw new Error("The configured IMAP folder could not be opened.");
      const uidValidity = client.mailbox.uidValidity.toString();
      const cursorValid = state.uidValidity === uidValidity;
      const query = imapSearchPlan(state, uidValidity, client.mailbox.uidNext, Number(values.imapLookbackDays), now);
      const found = query ? await client.search(query, { uid: true }) : [];
      const uids = Array.isArray(found) ? found.sort((a, b) => a - b) : [];
      for (const uid of uids) {
        if (cursorValid && uid <= state.lastUid) continue;
        const message = await client.fetchOne(uid, { envelope: true, flags: true, internalDate: true, size: true, bodyStructure: true }, { uid: true });
        if (!message) continue;
        let raw: Buffer | null = null;
        let parseError = "";
        try {
          if ((message.size ?? 0) > RAW_LIMIT) throw new Error("Message exceeds the 25 MB parsing limit");
          raw = await collectRaw(client, uid);
        } catch (error) {
          parseError = error instanceof Error ? error.message : "Message download failed";
        }
        if (await storeMessage(folder, uidValidity, message, raw, parseError, values.stopOnReply === "Enabled")) synced += 1;
        else skipped += 1;
        await prisma.imapSyncState.update({ where: { id }, data: { uidValidity, lastUid: uid } });
        if (values.imapProcessedBehavior === "Mark as read") await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
        if (values.imapProcessedBehavior === "Archive" && values.imapArchiveFolder) await client.messageMove(uid, values.imapArchiveFolder, { uid: true });
      }
      if (!uids.length) await prisma.imapSyncState.update({ where: { id }, data: { uidValidity } });
    } finally {
      lock.release();
    }
    await client.logout();
    await prisma.$transaction([
      prisma.imapSyncState.update({ where: { id }, data: { syncStartedAt: null, lastSyncedAt: new Date(), lastError: "" } }),
      prisma.serviceStatus.upsert({ where: { id: "imap" }, create: { id: "imap", state: "OK", checkedAt: new Date() }, update: { state: "OK", message: "", checkedAt: new Date() } }),
    ]);
    return { ok: true, synced, skipped, message: `Synchronized ${synced} message${synced === 1 ? "" : "s"}.` };
  } catch (error) {
    client.close();
    const message = (error instanceof Error ? error.message : "Inbox synchronization failed").slice(0, 500);
    await prisma.$transaction([
      prisma.imapSyncState.update({ where: { id }, data: { syncStartedAt: null, lastError: message } }),
      prisma.serviceStatus.upsert({ where: { id: "imap" }, create: { id: "imap", state: "ERROR", message, checkedAt: new Date() }, update: { state: "ERROR", message, checkedAt: new Date() } }),
    ]);
    return { ok: false, synced, skipped, message };
  }
}

export function syncInboxNow() {
  return configuredSync(true);
}

export function syncInboxIfDue() {
  return configuredSync(false);
}
