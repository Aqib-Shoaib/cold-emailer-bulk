import { NextRequest, NextResponse } from "next/server";

import {
  clearLoginFailures,
  isRecoveryBlocked,
  isSameOrigin,
  normalizeEmail,
  recordRecoveryRequest,
  requestOrigin,
} from "@/lib/auth";
import { decryptSecret } from "@/lib/crypto";
import { hashPassword, isValidPassword } from "@/lib/password";
import {
  generateRecoveryCode,
  RECOVERY_ATTEMPT_LIMIT,
  RECOVERY_CODE_MINUTES,
  recoveryCodeHash,
  recoveryCodeMatches,
  validRecoveryCode,
} from "@/lib/password-recovery";
import { getPrisma } from "@/lib/prisma";
import { SETTINGS_ROW_ID, settingsValues } from "@/lib/settings";
import { sendSmtpEmail } from "@/lib/smtp";

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

function back(request: NextRequest, query: string) {
  return NextResponse.redirect(new URL(`/recover?${query}`, requestOrigin(request)), 303);
}

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error("SESSION_SECRET is required");
  return value;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ action: string }> },
) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });

  const action = (await params).action;
  if (action !== "request" && action !== "reset") return new NextResponse("Not found", { status: 404 });

  const form = await request.formData();
  const email = normalizeEmail(String(form.get("email") ?? ""));
  if (action === "request") {
    if (email && email.length <= 320 && EMAIL_PATTERN.test(email)) {
      try {
        if (await isRecoveryBlocked(email)) return back(request, "notice=sent");
        await recordRecoveryRequest(email);
        await sendRecoveryCode(email);
      } catch {
        console.error("Password recovery email could not be sent");
      }
    }
    return back(request, "notice=sent");
  }

  const code = String(form.get("code") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const confirmation = String(form.get("confirmation") ?? "");
  if (!email || email.length > 320 || !EMAIL_PATTERN.test(email) || !validRecoveryCode(code) || password !== confirmation || !isValidPassword(password)) {
    return back(request, "error=invalid");
  }

  const prisma = getPrisma();
  const user = await prisma.user.findUnique({ where: { email } });
  const reset = user ? await prisma.passwordReset.findUnique({ where: { userId: user.id } }) : null;
  if (!user || !user.active || !reset || reset.expiresAt <= new Date() || reset.attempts >= RECOVERY_ATTEMPT_LIMIT || !recoveryCodeMatches(reset.codeHash, user.id, code, secret())) {
    if (reset && reset.attempts < RECOVERY_ATTEMPT_LIMIT) {
      await prisma.passwordReset.update({ where: { userId: reset.userId }, data: { attempts: { increment: 1 } } });
    }
    return back(request, "error=invalid");
  }

  const passwordHash = await hashPassword(password);
  try {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.passwordReset.deleteMany({
        where: { userId: user.id, codeHash: reset.codeHash, expiresAt: { gt: new Date() }, attempts: { lt: RECOVERY_ATTEMPT_LIMIT } },
      });
      if (claimed.count !== 1) throw new Error("Reset code was already used");
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditEvent.create({ data: { action: "password.recovered", targetType: "User", targetId: user.id } });
    });
  } catch {
    return back(request, "error=invalid");
  }

  await clearLoginFailures(email);
  return NextResponse.redirect(new URL("/login?notice=password-reset", requestOrigin(request)), 303);
}

async function sendRecoveryCode(email: string) {
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user?.active) return;

  const settings = await prisma.appSettings.findUnique({ where: { id: SETTINGS_ROW_ID } });
  const encryptionKey = process.env.SETTINGS_ENCRYPTION_KEY;
  const password = settings?.smtpPasswordEnc && encryptionKey
    ? decryptSecret(encryptionKey, settings.smtpPasswordEnc)
    : null;
  if (!settings || !password) throw new Error("SMTP is not configured");

  const values = settingsValues(settings.values);
  const host = values.smtpHost.trim();
  const port = Number(values.smtpPort);
  const username = values.smtpUsername.trim();
  const from = values.smtpFromAddress.trim();
  const timeoutMs = Number(values.smtpConnectionTimeoutSeconds) * 1000;
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !username || !from || !Number.isFinite(timeoutMs) || timeoutMs < 5000 || timeoutMs > 120_000) {
    throw new Error("SMTP is not configured");
  }

  const code = generateRecoveryCode();
  const codeHash = recoveryCodeHash(user.id, code, secret());
  const expiresAt = new Date(Date.now() + RECOVERY_CODE_MINUTES * 60_000);
  await prisma.$transaction([
    prisma.passwordReset.upsert({
      where: { userId: user.id },
      create: { userId: user.id, codeHash, expiresAt },
      update: { codeHash, expiresAt, attempts: 0, createdAt: new Date() },
    }),
    prisma.auditEvent.create({ data: { action: "password.recovery_requested", targetType: "User", targetId: user.id } }),
  ]);

  try {
    await sendSmtpEmail(
      {
        host,
        port,
        tlsMode: values.smtpTlsMode,
        username,
        password,
        timeoutMs,
        heloName: values.smtpHeloName.trim() || host,
      },
      {
        from,
        to: user.email,
        subject: `${values.companyName || "Cold Emailer"} password reset code`,
        text: `Your password reset code is ${code}.\n\nIt expires in ${RECOVERY_CODE_MINUTES} minutes. If you did not request this, you can ignore this email.`,
      },
    );
  } catch (error) {
    await prisma.passwordReset.deleteMany({ where: { userId: user.id, codeHash } });
    throw error;
  }
}

export const dynamic = "force-dynamic";
