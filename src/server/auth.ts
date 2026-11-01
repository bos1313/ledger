import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySession, type Session } from "@/lib/session";

/** Read the session in Server Components, Server Actions and Route Handlers. */
export async function getSession(): Promise<Session | null> {
  return verifySession((await cookies()).get(SESSION_COOKIE)?.value);
}

/**
 * The proxy already redirects anonymous users, but each data access re-checks:
 * proxy is an optimistic gate, not the authorization layer.
 */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}
