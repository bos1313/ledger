"use server";

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/session";

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
  next: z.string().optional(),
});

// Real hash of a random string, used when the email is unknown (constant-time-ish login).
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

/** Errors are dictionary keys, translated by the form, so switching language re-renders them. */
export type LoginState = { error?: "invalidInput" | "wrongCredentials" };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = LoginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "invalidInput" };

  const [user] = await db.select().from(users).where(eq(users.email, parsed.data.email));
  // Compare even when the user doesn't exist, so response time doesn't reveal valid emails.
  const ok = await bcrypt.compare(parsed.data.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) return { error: "wrongCredentials" };

  (await cookies()).set(SESSION_COOKIE, await signSession({ userId: user.id, email: user.email }), sessionCookieOptions);
  const next = parsed.data.next?.startsWith("/") && !parsed.data.next.startsWith("//") ? parsed.data.next : "/dashboard";
  redirect(next as Route); // validated above: same-origin relative path only
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
