import { NextRequest, NextResponse } from "next/server";
import { getRequestSession, isSameOrigin, requestOrigin } from "@/lib/auth";
import { hashPassword, isValidPassword, verifyPassword } from "@/lib/password";
import { getPrisma } from "@/lib/prisma";

function back(request: NextRequest, ok: boolean) {
  return NextResponse.redirect(new URL(`/users?${ok ? "notice=security-updated" : "error=security"}`, requestOrigin(request)), 303);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ action: string }> },
) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const session = await getRequestSession(request);
  if (!session) return NextResponse.redirect(new URL("/login", requestOrigin(request)), 303);

  const action = (await params).action;
  const prisma = getPrisma();

  if (action === "revoke-sessions") {
    await prisma.$transaction([
      prisma.session.updateMany({ where: { userId: session.user.id, tokenHash: { not: session.tokenHash }, revokedAt: null }, data: { revokedAt: new Date() } }),
      prisma.auditEvent.create({ data: { actorUserId: session.user.id, action: "session.others_revoked", targetType: "User", targetId: session.user.id } }),
    ]);
    return back(request, true);
  }

  if (action === "change-password") {
    const form = await request.formData();
    const currentPassword = String(form.get("currentPassword") ?? "");
    const newPassword = String(form.get("newPassword") ?? "");
    const confirmation = String(form.get("confirmation") ?? "");
    if (currentPassword.length > 200 || newPassword !== confirmation || !isValidPassword(newPassword) || !(await verifyPassword(currentPassword, session.user.passwordHash))) {
      return back(request, false);
    }

    await prisma.$transaction([
      prisma.user.update({ where: { id: session.user.id }, data: { passwordHash: await hashPassword(newPassword) } }),
      prisma.session.updateMany({ where: { userId: session.user.id, tokenHash: { not: session.tokenHash }, revokedAt: null }, data: { revokedAt: new Date() } }),
      prisma.auditEvent.create({ data: { actorUserId: session.user.id, action: "password.changed", targetType: "User", targetId: session.user.id } }),
    ]);
    return back(request, true);
  }

  return back(request, false);
}
