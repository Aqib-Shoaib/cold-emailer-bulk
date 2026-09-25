import { NextRequest, NextResponse } from "next/server";

import { getRequestSession, isSameOrigin, requestOrigin } from "@/lib/auth";
import { retryIsSafe } from "@/lib/operations";
import { getPrisma } from "@/lib/prisma";

function back(request: NextRequest, query: string) {
  return NextResponse.redirect(new URL(`/operations?${query}`, requestOrigin(request)), 303);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const session = await getRequestSession(request);
  if (!session) return NextResponse.redirect(new URL("/login", requestOrigin(request)), 303);
  const action = (await params).action;
  if (action !== "retry" && action !== "cancel") return new NextResponse("Not found", { status: 404 });
  const form = await request.formData();
  const jobId = String(form.get("jobId") ?? "");
  const prisma = getPrisma();
  const job = await prisma.job.findUnique({ where: { id: jobId }, include: { emailMessage: { select: { status: true } } } });
  if (!job) return back(request, "error=missing");

  if (action === "retry") {
    if (!retryIsSafe(job.status, job.emailMessage?.status ?? null)) return back(request, "error=unsafe");
    const retried = await prisma.$transaction(async (tx) => {
      const changed = await tx.job.updateMany({ where: { id: job.id, status: "FAILED" }, data: { status: "PENDING", runAt: new Date(), attempt: 0, completedAt: null, lockedAt: null, lockedBy: "", lastError: "" } });
      if (!changed.count) return false;
      await tx.campaignRecipient.update({ where: { id: job.recipientId }, data: { status: "PENDING", lastError: "" } });
      await tx.auditEvent.create({ data: { actorUserId: session.user.id, action: "job.retried", targetType: "Job", targetId: job.id } });
      return true;
    });
    if (!retried) return back(request, "error=state");
    return back(request, "notice=retried");
  }

  if (job.status !== "FAILED") return back(request, "error=state");
  const canceled = await prisma.$transaction(async (tx) => {
    const changed = await tx.job.updateMany({ where: { id: job.id, status: "FAILED" }, data: { status: "CANCELED", completedAt: new Date(), lastError: "Canceled by an administrator." } });
    if (!changed.count) return false;
    await tx.auditEvent.create({ data: { actorUserId: session.user.id, action: "job.canceled", targetType: "Job", targetId: job.id } });
    return true;
  });
  if (!canceled) return back(request, "error=state");
  return back(request, "notice=canceled");
}

export const dynamic = "force-dynamic";
