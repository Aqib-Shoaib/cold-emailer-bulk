import { NextRequest, NextResponse } from "next/server";
import { connect } from "node:net";
import tls from "node:tls";
import { getRequestSession, isSameOrigin, requestOrigin } from "@/lib/auth";
import { decryptSecret, type SecretField } from "@/lib/crypto";
import { getPrisma } from "@/lib/prisma";
import {
  computeSettingsUpdate,
  SETTINGS_ROW_ID,
  validateSettingsInput,
  type SettingsInput,
} from "@/lib/settings";
import type { InputJsonValue } from "@prisma/client/runtime/client";
import { SECRET_SETTING_FIELDS, SETTING_FIELDS, SETTING_SECTIONS } from "@/lib/settings-schema";

function back(request: NextRequest, query: string) {
  return NextResponse.redirect(new URL(`/settings?${query}`, requestOrigin(request)), 303);
}

function getEncryptionKey() {
  const encryptionKey = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!encryptionKey) throw new Error("SETTINGS_ENCRYPTION_KEY is required");
  return encryptionKey;
}

/**
 * Merges submitted fields with stored values: keys absent from the form keep
 * their stored value (or the registry default). Section-scoped forms must not
 * reset unrelated sections, and the kill switch must never move implicitly.
 */
function mergedInput(form: FormData, storedValues: Record<string, string> | null): SettingsInput {
  const present = new Set(form.keys());
  const input: SettingsInput = {};
  for (const field of SETTING_FIELDS) {
    if (present.has(field.key)) {
      const raw = form.get(field.key);
      input[field.key] = typeof raw === "string" ? raw : "";
    } else {
      input[field.key] = storedValues?.[field.key] ?? field.default;
    }
  }
  return input;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ action: string }> },
) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });

  const session = await getRequestSession(request);
  if (!session) return NextResponse.redirect(new URL("/login", requestOrigin(request)), 303);
  const action = (await params).action;
  if (action !== "save" && action !== "test-smtp" && action !== "test-imap") {
    return new NextResponse("Not found", { status: 404 });
  }

  const prisma = getPrisma();
  let encryptionKey: string;
  try {
    encryptionKey = getEncryptionKey();
  } catch {
    console.error("SETTINGS_ENCRYPTION_KEY is missing; settings changes are disabled");
    return back(request, "error=encryption");
  }

  const form = await request.formData();
  const row = await prisma.appSettings.findUnique({ where: { id: SETTINGS_ROW_ID } });
  const storedValues =
    row && typeof row.values === "object" && !Array.isArray(row.values)
      ? (row.values as unknown as Record<string, string>)
      : null;

  if (action === "save") {
    const input = mergedInput(form, storedValues);
    const submitted = new Set(form.keys());
    const errors = validateSettingsInput(input, { publicAppUrl: process.env.APP_URL })
      .filter((error) => submitted.has(error.field));
    if (errors.length > 0) {
      const fields = [...new Set(errors.map((error) => error.field))].join(",");
      return back(request, `error=validation&fields=${encodeURIComponent(fields)}`);
    }

    const removeSecrets = new Set<SecretField>();
    for (const field of SECRET_SETTING_FIELDS) {
      if (field.secretField && form.get(`${field.key}__remove`) === "on") removeSecrets.add(field.secretField);
    }
    const update = computeSettingsUpdate(input, { encryptionKey, removeSecrets });
    const data = {
      sendingPaused: update.sendingPaused,
      sendingPausedReason: update.sendingPausedReason,
      values: update.values as unknown as InputJsonValue,
      ...(update.secrets.smtp_password_enc !== undefined ? { smtpPasswordEnc: update.secrets.smtp_password_enc } : {}),
      ...(update.secrets.imap_password_enc !== undefined ? { imapPasswordEnc: update.secrets.imap_password_enc } : {}),
      ...(update.secrets.ai_api_key_enc !== undefined ? { aiApiKeyEnc: update.secrets.ai_api_key_enc } : {}),
      updatedByUserId: session.user.id,
    };

    await prisma.$transaction([
      prisma.appSettings.upsert({
        where: { id: SETTINGS_ROW_ID },
        create: { id: SETTINGS_ROW_ID, ...data },
        update: data,
      }),
      prisma.auditEvent.create({
        data: {
          actorUserId: session.user.id,
          action: "settings.updated",
          targetType: "AppSettings",
          targetId: SETTINGS_ROW_ID,
        },
      }),
    ]);

    return back(request, "notice=saved");
  }

  // Test-connection actions probe the merged view: submitted values overlay
  // the stored configuration, and a blank password uses the stored secret.
  const sectionId = action === "test-smtp" ? "smtp" : "imap";
  const section = SETTING_SECTIONS.find((entry) => entry.id === sectionId);
  if (!section) return new NextResponse("Not found", { status: 404 });

  const input = mergedInput(form, storedValues);
  const sectionKeys = new Set(section.fields.map((field) => field.key));
  const sectionErrors = validateSettingsInput(input, { publicAppUrl: process.env.APP_URL })
    .filter((error) => sectionKeys.has(error.field));
  if (sectionErrors.length > 0) {
    const fields = [...new Set(sectionErrors.map((error) => error.field))].join(",");
    return back(request, `error=validation&fields=${encodeURIComponent(fields)}`);
  }

  const value = (key: string) => input[key]?.trim() ?? "";
  const password = await resolveSecret(
    sectionId,
    value(sectionId === "smtp" ? "smtpPassword" : "imapPassword"),
    row,
    encryptionKey,
  );
  if (!password) {
    return back(request, "error=secret");
  }

  const probe =
    sectionId === "smtp"
      ? {
          host: value("smtpHost"),
          port: Number(value("smtpPort") || "0"),
          tlsMode: value("smtpTlsMode"),
          username: value("smtpUsername"),
          timeoutMs: Number(value("smtpConnectionTimeoutSeconds")) * 1000,
          heloName: value("smtpHeloName") || value("smtpHost"),
        }
      : {
          host: value("imapHost"),
          port: Number(value("imapPort") || "0"),
          tlsMode: value("imapTlsMode"),
          username: value("imapUsername"),
          timeoutMs: 10_000,
          heloName: "",
        };

  if (!probe.host || !probe.port || Number.isNaN(probe.port)) {
    return back(request, "error=test");
  }

  const result =
    sectionId === "smtp"
      ? await probeSmtp({ ...probe, username: probe.username }, password)
      : await probeImap(probe, password);

  await prisma.auditEvent.create({
    data: {
      actorUserId: session.user.id,
      action: `settings.${sectionId}_tested`,
      targetType: "AppSettings",
      targetId: SETTINGS_ROW_ID,
    },
  });

  const notice = result.ok ? `notice=${sectionId}-ok` : `error=${sectionId}-failed&detail=${encodeURIComponent(result.message)}`;
  return back(request, notice);
}

async function resolveSecret(
  sectionId: "smtp" | "imap",
  submitted: string,
  row: { smtpPasswordEnc: string | null; imapPasswordEnc: string | null } | null,
  encryptionKey: string,
) {
  if (submitted) return submitted;
  if (!row) return null;
  const stored = sectionId === "smtp" ? row.smtpPasswordEnc : row.imapPasswordEnc;
  if (!stored) return null;
  return decryptSecret(encryptionKey, stored);
}

interface ProbeTarget {
  host: string;
  port: number;
  tlsMode: string;
  username: string;
  timeoutMs: number;
  heloName: string;
}

function plainConnection(host: string, port: number, timeoutMs: number) {
  return new Promise<import("node:net").Socket>((resolve, reject) => {
    const socket = connect({ host, port, timeout: timeoutMs });
    const fail = (message: string) => {
      socket.destroy();
      reject(new Error(message));
    };
    socket.once("error", (error: Error) => fail(error.message));
    socket.once("timeout", () => fail("Connection timed out"));
    socket.once("connect", () => resolve(socket));
  });
}

function secureConnection(host: string, port: number, timeoutMs: number) {
  return new Promise<tls.TLSSocket>((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host, timeout: timeoutMs });
    const fail = (message: string) => {
      socket.destroy();
      reject(new Error(message));
    };
    socket.once("error", (error: Error) => fail(error.message));
    socket.once("timeout", () => fail("Connection timed out"));
    socket.once("secureConnect", () => resolve(socket));
  });
}

/**
 * Buffered line reader for probe conversations. TLS can split a single reply
 * across records, so responses are assembled from a persistent buffer instead
 * of being matched per chunk.
 */
class ProbeReader {
  private lines: string[] = [];
  private buffer = "";
  private error: Error | null = null;
  private wake: (() => void) | null = null;

  constructor(socket: import("node:net").Socket | tls.TLSSocket) {
    socket.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf8");
      let index;
      while ((index = this.buffer.indexOf("\n")) >= 0) {
        let line = this.buffer.slice(0, index);
        this.buffer = this.buffer.slice(index + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        this.lines.push(line);
      }
      this.wake?.();
    });
    socket.once("error", (error: Error) => {
      this.error = error;
      this.wake?.();
    });
    socket.once("close", () => {
      this.error ??= new Error("The connection closed during the handshake");
      this.wake?.();
    });
  }

  async readLine(timeoutMs: number) {
    const deadline = Date.now() + timeoutMs;
    while (this.lines.length === 0) {
      if (this.error) throw this.error;
      const wait = deadline - Date.now();
      if (wait <= 0) throw new Error("The server stopped responding during the handshake");
      await new Promise<void>((resolveWake) => {
        this.wake = resolveWake;
        setTimeout(resolveWake, Math.min(wait, 250));
      });
      this.wake = null;
    }
    return this.lines.shift() as string;
  }
}

/** Reads one full SMTP reply, joining multi-line "250-..." continuations. */
async function readSmtpReply(reader: ProbeReader, timeoutMs: number) {
  const first = await reader.readLine(timeoutMs);
  const match = /^(\d{3})([ -])(.*)$/.exec(first);
  if (!match) {
    throw new Error(`The server sent an unexpected reply: ${first.slice(0, 200)}`);
  }
  const code = match[1];
  let separator = match[2];
  const parts = [match[3]];
  while (separator === "-") {
    const line = await reader.readLine(timeoutMs);
    const continuation = /^(\d{3})([ -])(.*)$/.exec(line);
    if (!continuation || continuation[1] !== code) {
      throw new Error(`The server sent an unexpected reply: ${line.slice(0, 200)}`);
    }
    separator = continuation[2];
    parts.push(continuation[3]);
  }
  return { code, text: parts.join("\n") };
}

async function writeAndReadSmtp(
  reader: ProbeReader,
  socket: import("node:net").Socket | tls.TLSSocket,
  command: string,
  timeoutMs: number,
  check: (reply: { code: string; text: string }) => { ok: true } | { ok: false; message: string },
) {
  await new Promise<void>((resolveWrite, rejectWrite) => {
    socket.write(`${command}\r\n`, (error) => (error ? rejectWrite(error) : resolveWrite()));
  });
  const reply = await readSmtpReply(reader, timeoutMs);
  const outcome = check(reply);
  if (!outcome.ok) throw new Error(outcome.message);
  return reply;
}

async function smtpAuthLogin(
  reader: ProbeReader,
  socket: import("node:net").Socket | tls.TLSSocket,
  username: string,
  password: string,
  timeoutMs: number,
) {
  await writeAndReadSmtp(reader, socket, "AUTH LOGIN", timeoutMs, (reply) =>
    reply.code === "334" ? { ok: true } : { ok: false, message: `The server rejected the authentication request (${reply.code}).` },
  );
  await writeAndReadSmtp(reader, socket, Buffer.from(username).toString("base64"), timeoutMs, (reply) =>
    reply.code.startsWith("3") || reply.code.startsWith("2")
      ? { ok: true }
      : { ok: false, message: `The server rejected the username (${reply.code}).` },
  );
  await writeAndReadSmtp(reader, socket, Buffer.from(password).toString("base64"), timeoutMs, (reply) =>
    reply.code.startsWith("2")
      ? { ok: true }
      : { ok: false, message: `The SMTP username or password was rejected (${reply.code}). Check the credentials and try again.` },
  );
}

async function probeRaw(target: ProbeTarget, password: string, tlsMode: string) {
  const socket = await plainConnection(target.host, target.port, target.timeoutMs);
  let reader = new ProbeReader(socket);
  try {
    const greeting = await readSmtpReply(reader, target.timeoutMs);
    if (greeting.code !== "220") {
      return { ok: false, message: `The server answered with an unexpected greeting (${greeting.code}).` };
    }

    let activeSocket: import("node:net").Socket | tls.TLSSocket = socket;
    if (tlsMode === "STARTTLS") {
      const ehlo = await writeAndReadSmtp(reader, activeSocket, `EHLO ${target.heloName}`, target.timeoutMs, (reply) =>
        reply.code === "250" ? { ok: true } : { ok: false, message: "The server refused the EHLO handshake." });
      if (!/STARTTLS/i.test(ehlo.text)) {
        return { ok: false, message: "The server does not advertise STARTTLS. Choose the SSL mode or a different port." };
      }
      await writeAndReadSmtp(reader, activeSocket, "STARTTLS", target.timeoutMs, (reply) =>
        reply.code === "220" ? { ok: true } : { ok: false, message: "The server refused to start TLS." });
      activeSocket = await upgradeSocket(socket, target.host, target.timeoutMs);
      // After the upgrade, data flows through the TLSSocket, so the reader
      // must be re-created over the secure stream.
      reader = new ProbeReader(activeSocket);
    }

    await writeAndReadSmtp(reader, activeSocket, `EHLO ${target.heloName}`, target.timeoutMs, (reply) =>
      reply.code === "250" ? { ok: true } : { ok: false, message: "The server refused the EHLO handshake." });
    await smtpAuthLogin(reader, activeSocket, target.username, password, target.timeoutMs);
    socket.write("QUIT\r\n", () => undefined);
    return { ok: true, message: "" };
  } finally {
    socket.destroy();
  }
}

function upgradeSocket(socket: import("node:net").Socket, host: string, timeoutMs: number) {
  return new Promise<tls.TLSSocket>((resolve, reject) => {
    const secure = tls.connect({ socket, servername: host });
    const timer = setTimeout(() => {
      secure.destroy();
      reject(new Error("The TLS handshake timed out"));
    }, timeoutMs);
    secure.once("secureConnect", () => {
      clearTimeout(timer);
      resolve(secure);
    });
    secure.once("error", (error: Error) => {
      clearTimeout(timer);
      reject(new Error(`The TLS handshake failed: ${error.message}`));
    });
  });
}

async function probeSmtp(target: ProbeTarget, password: string) {
  if (!target.host || !target.port || Number.isNaN(target.port)) {
    return { ok: false, message: "SMTP host and port are required." };
  }
  try {
    if (target.tlsMode === "SSL") {
      const socket = await secureConnection(target.host, target.port, target.timeoutMs);
      const reader = new ProbeReader(socket);
      try {
        const greeting = await readSmtpReply(reader, target.timeoutMs);
        if (greeting.code !== "220") {
          return { ok: false, message: `The server answered with an unexpected greeting (${greeting.code}).` };
        }
        await writeAndReadSmtp(reader, socket, `EHLO ${target.heloName}`, target.timeoutMs, (reply) =>
          reply.code === "250" ? { ok: true } : { ok: false, message: "The server refused the EHLO handshake." });
        await smtpAuthLogin(reader, socket, target.username, password, target.timeoutMs);
        socket.write("QUIT\r\n", () => undefined);
        return { ok: true, message: "" };
      } finally {
        socket.destroy();
      }
    }
    return await probeRaw(target, password, target.tlsMode);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "The SMTP connection failed." };
  }
}

async function probeImap(target: ProbeTarget, password: string) {
  if (!target.host || !target.port || Number.isNaN(target.port)) {
    return { ok: false, message: "IMAP host and port are required." };
  }
  const useTls = target.tlsMode === "TLS";
  try {
    return await probeImapConnection(target, password, useTls);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "The IMAP connection failed." };
  }
}

async function probeImapConnection(target: ProbeTarget, password: string, useTls: boolean) {
  const socket = useTls
    ? await secureConnection(target.host, target.port, target.timeoutMs)
    : await plainConnection(target.host, target.port, target.timeoutMs);
  const reader = new ProbeReader(socket);
  try {
    const greeting = await reader.readLine(target.timeoutMs);
    if (!/^\* (OK|PREAUTH)/.test(greeting)) {
      return { ok: false, message: `The server did not answer with an IMAP greeting (${greeting.slice(0, 120)}).` };
    }
    const loginTag = "a1";
    const command = `${loginTag} LOGIN "${target.username.replace(/"/g, "")}" "${password.replace(/"/g, "")}"`;
    socket.write(`${command}\r\n`);
    let response = "";
    for (;;) {
      response = await reader.readLine(target.timeoutMs);
      if (response.startsWith(`${loginTag} `)) break;
    }
    if (!response.startsWith(`${loginTag} OK`)) {
      return { ok: false, message: "The IMAP server rejected the username or password." };
    }
    socket.write("a2 LOGOUT\r\n", () => undefined);
    return { ok: true, message: "" };
  } finally {
    socket.destroy();
  }
}

export const dynamic = "force-dynamic";
