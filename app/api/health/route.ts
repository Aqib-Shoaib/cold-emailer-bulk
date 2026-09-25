import { getPrisma } from "../../../lib/prisma.ts";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const prisma = getPrisma();
    await prisma.$queryRaw`SELECT 1`;
    const [heartbeat, services] = await Promise.all([
      prisma.workerHeartbeat.findFirst({ orderBy: { lastSeenAt: "desc" } }),
      prisma.serviceStatus.findMany(),
    ]);
    const state = (id: string) => services.find((service) => service.id === id)?.state.toLowerCase() ?? "unchecked";
    const worker = heartbeat && Date.now() - heartbeat.lastSeenAt.getTime() < 120_000 ? "ok" : "stale";

    return Response.json({ status: worker === "ok" && services.every(({ state }) => state !== "ERROR") ? "ok" : "degraded", checks: { web: "ok", database: "ok", worker, smtp: state("smtp"), imap: state("imap"), ai: state("ai") } });
  } catch {
    console.error("Database health check failed");

    return Response.json(
      { status: "unhealthy", checks: { database: "unavailable" } },
      { status: 503 },
    );
  }
}
