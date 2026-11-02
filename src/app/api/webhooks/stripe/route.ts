import { db } from "@/db";
import { apiError, json } from "@/server/api";
import { stripeNotConfigured } from "@/server/stripe";
import { handleStripeWebhook } from "@/server/stripe-webhook";

// Public on purpose (outside /api/v1, so proxy.ts doesn't ask for a session):
// Stripe authenticates with the signature header instead.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || secret.includes("...")) return stripeNotConfigured();

  // Signature is computed over the exact bytes Stripe sent: read text, never req.json().
  const payload = await req.text();
  try {
    const { status, body } = await handleStripeWebhook(db, payload, req.headers.get("stripe-signature"), secret);
    return json(body, { status });
  } catch (e) {
    console.error("[stripe] webhook failed, Stripe will retry", e);
    return apiError(500, "INTERNAL", "Webhook processing failed");
  }
}
