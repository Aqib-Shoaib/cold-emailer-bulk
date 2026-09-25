import { NextRequest, NextResponse } from "next/server";

import { requestOrigin } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { readUnsubscribeData } from "@/lib/unsubscribe";

export async function POST(request: NextRequest) {
  const form = request.headers.get("content-type")?.includes("application/x-www-form-urlencoded") || request.headers.get("content-type")?.includes("multipart/form-data")
    ? await request.formData()
    : new FormData();
  const queryToken = request.nextUrl.searchParams.get("token") ?? "";
  const formToken = String(form.get("token") ?? "");
  const data = readUnsubscribeData(formToken || queryToken);
  if (!data) return formToken
    ? NextResponse.redirect(new URL("/unsubscribe?error=invalid", requestOrigin(request)), 303)
    : new NextResponse("Invalid unsubscribe link", { status: 400 });

  await getPrisma().$transaction(async (tx) => {
    const existing = await tx.suppression.findUnique({ where: { email: data.email } });
    const changed = !existing || existing.reason === "MANUAL";
    if (!existing) await tx.suppression.create({ data: { email: data.email, reason: "UNSUBSCRIBED" } });
    else if (existing.reason === "MANUAL") await tx.suppression.update({ where: { email: data.email }, data: { reason: "UNSUBSCRIBED" } });
    await tx.job.updateMany({ where: { recipient: { email: data.email }, status: "PENDING" }, data: { status: "CANCELED", completedAt: new Date(), lastError: "Canceled after unsubscribe." } });
    if (changed) await tx.auditEvent.create({ data: { action: "contact.unsubscribed", targetType: "Suppression", targetId: data.email } });
    if (data.messageId) {
      const message = await tx.emailMessage.findUnique({ where: { id: data.messageId }, select: { id: true, campaignId: true, contactId: true } });
      if (message) await tx.trackingEvent.upsert({
        where: { emailMessageId_type_targetHash: { emailMessageId: message.id, type: "UNSUBSCRIBED", targetHash: "" } },
        create: { type: "UNSUBSCRIBED", emailMessageId: message.id, campaignId: message.campaignId, contactId: message.contactId },
        update: {},
      });
    }
  });
  return formToken
    ? NextResponse.redirect(new URL("/unsubscribe?notice=complete", requestOrigin(request)), 303)
    : new NextResponse("Unsubscribed", { status: 200 });
}

export const dynamic = "force-dynamic";
