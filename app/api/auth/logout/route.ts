import { NextRequest, NextResponse } from "next/server";
import { isSameOrigin, requestOrigin, revokeSession, SESSION_COOKIE } from "@/lib/auth";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });

  await revokeSession(request.cookies.get(SESSION_COOKIE)?.value);
  const response = NextResponse.redirect(new URL("/login", requestOrigin(request)), 303);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
