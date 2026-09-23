import { NextRequest, NextResponse } from "next/server";
import {
  clearLoginFailures,
  createSession,
  isLoginBlocked,
  isSameOrigin,
  normalizeEmail,
  recordLoginFailure,
  SESSION_COOKIE,
  SESSION_SECONDS,
} from "@/lib/auth";
import { verifyPassword } from "@/lib/password";
import { getPrisma } from "@/lib/prisma";

const LOGIN_ERROR = "/login?error=invalid";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });

  const form = await request.formData();
  const email = normalizeEmail(String(form.get("email") ?? ""));
  const password = String(form.get("password") ?? "");

  if (!email || !password || (await isLoginBlocked(email))) {
    return NextResponse.redirect(new URL(LOGIN_ERROR, request.url), 303);
  }

  const user = await getPrisma().user.findUnique({ where: { email } });
  if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) {
    await recordLoginFailure(email);
    return NextResponse.redirect(new URL(LOGIN_ERROR, request.url), 303);
  }

  const session = await createSession(user.id);
  await Promise.all([
    clearLoginFailures(email),
    getPrisma().user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
  ]);

  const response = NextResponse.redirect(new URL("/", request.url), 303);
  response.cookies.set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_SECONDS,
    expires: session.expiresAt,
  });
  return response;
}
