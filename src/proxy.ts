import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

/**
 * Auth gate (Next.js 16 renamed `middleware.ts` to `proxy.ts`).
 * Pages redirect to /login; the REST API answers 401 JSON.
 */
export async function proxy(req: NextRequest) {
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  const { pathname } = req.nextUrl;

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Login required" } }, { status: 401 });
    }
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Everything under /dashboard and the versioned API. Webhooks and health stay public.
  matcher: ["/dashboard/:path*", "/api/v1/:path*"],
};
