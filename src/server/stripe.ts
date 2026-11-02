import "server-only";
import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { db } from "@/db";
import { transfers } from "@/db/schema";
import { apiError } from "./api";

let client: Stripe | undefined;

/** True when real test-mode keys are set (not the `sk_test_...` placeholder from .env.example). */
export function isStripeConfigured() {
  const key = process.env.STRIPE_SECRET_KEY;
  return Boolean(key && !key.includes("..."));
}

export function getStripe(): Stripe {
  if (!isStripeConfigured()) throw new Error("STRIPE_SECRET_KEY is not set");
  return (client ??= new Stripe(process.env.STRIPE_SECRET_KEY!));
}

export const stripeNotConfigured = () => apiError(503, "STRIPE_NOT_CONFIGURED", "Stripe is not configured");

export type CheckoutStatus = "booked" | "processing";

/**
 * Status shown after Stripe redirects back. The redirect proves nothing (anyone can open
 * the success URL); only the signed webhook books money. This just tells the user whether
 * that webhook has already been processed.
 */
export async function getCheckoutStatus(userId: string, sessionId: string): Promise<CheckoutStatus | null> {
  if (!isStripeConfigured() || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return null;
  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId);
    if (session.metadata?.userId !== userId) return null; // someone else's session
    const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
    if (!pi) return "processing";
    const [row] = await db.select({ id: transfers.id }).from(transfers).where(eq(transfers.externalRef, pi));
    return row ? "booked" : "processing";
  } catch (e) {
    console.error("[stripe] could not read checkout session", e);
    return null;
  }
}
