import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getRequestSession, isSameOrigin, normalizeEmail, requestOrigin } from "@/lib/auth";
import { hashPassword, isValidPassword } from "@/lib/password";
import { getPrisma } from "@/lib/prisma";

function back(request: NextRequest, result: "created" | "updated" | "deleted" | "invalid" | "forbidden") {
  const key = result === "invalid" || result === "forbidden" ? "error" : "notice";
  return NextResponse.redirect(new URL(`/users?${key}=${result}`, requestOrigin(request)), 303);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ action: string }> },
) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const session = await getRequestSession(request);
  if (!session) return NextResponse.redirect(new URL("/login", requestOrigin(request)), 303);
  if (session.user.role !== "SUPER_ADMIN") return back(request, "forbidden");

  const action = (await params).action;
  const form = await request.formData();
  const prisma = getPrisma();

  if (action === "create") {
    const name = String(form.get("name") ?? "").trim();
    const email = normalizeEmail(String(form.get("email") ?? ""));
    const password = String(form.get("password") ?? "");
    if (name.length < 2 || name.length > 120 || email.length > 320 || !/^\S+@\S+\.\S+$/.test(email) || !isValidPassword(password)) {
      return back(request, "invalid");
    }

    try {
      const userId = randomUUID();
      await prisma.$transaction([
        prisma.user.create({ data: { id: userId, name, email, passwordHash: await hashPassword(password), role: "ADMIN" } }),
        prisma.auditEvent.create({ data: { actorUserId: session.user.id, action: "user.created", targetType: "User", targetId: userId } }),
      ]);
      return back(request, "created");
    } catch {
      return back(request, "invalid");
    }
  }

  const targetId = String(form.get("userId") ?? "");
  const target = await prisma.user.findFirst({ where: { id: targetId, role: "ADMIN" } });
  if (!target) return back(request, "invalid");

  if (action === "activate" || action === "deactivate") {
    const active = action === "activate";
    await prisma.$transaction([
      prisma.user.update({ where: { id: target.id }, data: { active } }),
      ...(!active ? [prisma.session.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date() } })] : []),
      prisma.auditEvent.create({ data: { actorUserId: session.user.id, action: `user.${action}d`, targetType: "User", targetId: target.id } }),
    ]);
    return back(request, "updated");
  }

  if (action === "delete") {
    await prisma.$transaction([
      prisma.auditEvent.create({ data: { actorUserId: session.user.id, action: "user.deleted", targetType: "User", targetId: target.id } }),
      prisma.user.delete({ where: { id: target.id } }),
    ]);
    return back(request, "deleted");
  }

  return back(request, "invalid");
}
