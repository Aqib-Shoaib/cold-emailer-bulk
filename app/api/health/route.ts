import { getPrisma } from "../../../lib/prisma.ts";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getPrisma().$queryRaw`SELECT 1`;

    return Response.json({ status: "ok", checks: { database: "ok" } });
  } catch {
    console.error("Database health check failed");

    return Response.json(
      { status: "unhealthy", checks: { database: "unavailable" } },
      { status: 503 },
    );
  }
}
