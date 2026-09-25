import { NextRequest, NextResponse } from "next/server";

import { getRequestSession } from "@/lib/auth";
import { csvCell } from "@/lib/csv";
import { getStatistics, parseStatisticsFilters, rate } from "@/lib/statistics";

export async function GET(request: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  if ((await params).action !== "export") return new NextResponse("Not found", { status: 404 });
  if (!await getRequestSession(request)) return new NextResponse("Unauthorized", { status: 401 });
  const search = request.nextUrl.searchParams;
  const filters = parseStatisticsFilters({ from: search.get("from") ?? undefined, to: search.get("to") ?? undefined, campaign: search.get("campaign") ?? undefined, template: search.get("template") ?? undefined, list: search.get("list") ?? undefined });
  const stats = await getStatistics(filters);
  const rows = [
    ["metric", "count", "rate", "denominator_definition"],
    ["Queued jobs", stats.queued, "", "All jobs matching the selected filters"],
    ["Send attempts", stats.attempted, "", "Stored outbound message attempts"],
    ["SMTP accepted", stats.smtpAccepted, rate(stats.smtpAccepted, stats.attempted), "Send attempts"],
    ["Failed", stats.failed, rate(stats.failed, stats.attempted), "Send attempts"],
    ["Unknown", stats.unknown, rate(stats.unknown, stats.attempted), "Send attempts"],
    ["Bounced", stats.bounced, rate(stats.bounced, stats.smtpAccepted), "SMTP-accepted messages"],
    ["Replied", stats.replied, rate(stats.replied, stats.acceptedRecipients), "Distinct campaign recipients with SMTP acceptance"],
    ["Unsubscribed", stats.unsubscribed, rate(stats.unsubscribed, stats.acceptedRecipients), "Distinct campaign recipients with SMTP acceptance"],
    ["Opened", stats.opened, rate(stats.opened, stats.smtpAccepted), "SMTP-accepted messages"],
    ["Clicked", stats.clicked, rate(stats.clicked, stats.smtpAccepted), "SMTP-accepted messages"],
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="cold-emailer-statistics.csv"' } });
}

export const dynamic = "force-dynamic";
