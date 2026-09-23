import { createHash, randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { getPrisma } from "./prisma.ts";

export const SESSION_COOKIE = "cold_emailer_session";
export const SESSION_SECONDS = 60 * 60 * 24 * 7;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_FAILURE_LIMIT = 5;

export function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function loginThrottleKey(email: string) {
  return digest(`login:${normalizeEmail(email)}`);
}

export function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const expectedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !expectedHost) return false;

  try {
    return new URL(origin).host === expectedHost;
  } catch {
    return false;
  }
}

export function requestOrigin(request: NextRequest) {
  return request.headers.get("origin") ?? request.nextUrl.origin;
}

export async function isLoginBlocked(email: string) {
  const throttle = await getPrisma().authThrottle.findUnique({
    where: { key: loginThrottleKey(email) },
  });

  return Boolean(
    throttle && throttle.resetAt > new Date() && throttle.failures >= LOGIN_FAILURE_LIMIT,
  );
}

export async function recordLoginFailure(email: string) {
  const now = new Date();
  const resetAt = new Date(now.getTime() + LOGIN_WINDOW_MS);

  await getPrisma().$executeRaw`
    INSERT INTO "auth_throttles" ("key", "failures", "reset_at", "updated_at")
    VALUES (${loginThrottleKey(email)}, 1, ${resetAt}, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "failures" = CASE
        WHEN "auth_throttles"."reset_at" <= ${now} THEN 1
        ELSE "auth_throttles"."failures" + 1
      END,
      "reset_at" = CASE
        WHEN "auth_throttles"."reset_at" <= ${now} THEN ${resetAt}
        ELSE "auth_throttles"."reset_at"
      END,
      "updated_at" = ${now}
  `;
}

export async function clearLoginFailures(email: string) {
  await getPrisma().authThrottle.deleteMany({ where: { key: loginThrottleKey(email) } });
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000);

  await getPrisma().session.create({
    data: { tokenHash: digest(token), userId, expiresAt },
  });

  return { token, expiresAt };
}

export async function getSessionUser(token: string | undefined) {
  if (!token) return null;

  const session = await getPrisma().session.findUnique({
    where: { tokenHash: digest(token) },
    include: { user: true },
  });

  if (!session || session.revokedAt || session.expiresAt <= new Date() || !session.user.active) {
    return null;
  }

  return session.user;
}

export async function getRequestSession(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const user = await getSessionUser(token);
  return user && token ? { user, token, tokenHash: digest(token) } : null;
}

export async function revokeSession(token: string | undefined) {
  if (!token) return;
  await getPrisma().session.updateMany({
    where: { tokenHash: digest(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
