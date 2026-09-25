import { NextRequest, NextResponse } from "next/server";

import { getPrisma } from "@/lib/prisma";
import { readTrackingToken, targetHash } from "@/lib/tracking";

const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");

function pixel() {
  return new NextResponse(PIXEL, { headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, max-age=0" } });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const action = (await params).action;
  if (action !== "open" && action !== "click") return new NextResponse("Not found", { status: 404 });
  const token = readTrackingToken(request.nextUrl.searchParams.get("token") ?? "");
  if (!token || (action === "click" && !token.url)) return action === "open" ? pixel() : new NextResponse("Invalid link", { status: 404 });

  const prisma = getPrisma();
  const message = await prisma.emailMessage.findUnique({ where: { id: token.messageId }, select: { id: true, campaignId: true, contactId: true } });
  if (message) {
    const hash = action === "click" ? targetHash(token.url) : "";
    await prisma.trackingEvent.upsert({
      where: { emailMessageId_type_targetHash: { emailMessageId: message.id, type: action === "open" ? "OPENED" : "CLICKED", targetHash: hash } },
      create: { type: action === "open" ? "OPENED" : "CLICKED", emailMessageId: message.id, campaignId: message.campaignId, contactId: message.contactId, targetHash: hash, targetUrl: action === "click" ? token.url : "" },
      update: {},
    });
  }
  if (action === "open") return pixel();
  if (!message) return new NextResponse("Invalid link", { status: 404 });
  return NextResponse.redirect(token.url, 307);
}

export const dynamic = "force-dynamic";
