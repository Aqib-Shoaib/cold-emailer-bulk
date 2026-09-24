import { NextRequest, NextResponse } from "next/server";
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
import { LineReader, plainConnection, probeSmtp, secureConnection } from "@/lib/smtp";

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
      ? await probeSmtp({ ...probe, password })
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
  const reader = new LineReader(socket);
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
