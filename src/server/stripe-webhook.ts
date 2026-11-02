import Stripe from "stripe";
import type { Db } from "@/db";
import { LedgerError, getAccountForUser, postDeposit } from "./ledger";

export type WebhookResult = { status: number; body: Record<string, unknown> };

/**
 * Stripe webhook logic, kept out of the route so it can be tested against a real DB.
 *
 * Status codes matter here: Stripe retries anything that isn't 2xx (for up to 3 days).
 *  - 400: bad signature, nobody should retry it
 *  - 200: booked, already booked, or an event we deliberately ignore
 *  - thrown error -> the route answers 500, Stripe retries later (e.g. DB was down)
 */
export async function handleStripeWebhook(
  db: Db,
  payload: string,
  signature: string | null,
  secret: string,
): Promise<WebhookResult> {
  if (!signature) return { status: 400, body: { error: "MISSING_SIGNATURE" } };

  let event: Stripe.Event;
  try {
    // HMAC-SHA256 over the RAW body + timestamp (rejects replays older than 5 min).
    event = Stripe.webhooks.constructEvent(payload, signature, secret);
  } catch {
    return { status: 400, body: { error: "INVALID_SIGNATURE" } };
  }

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return bookCheckoutSession(db, event.data.object);
    default:
      return { status: 200, body: { received: true, ignored: event.type } };
  }
}

const ignored = (reason: string, details?: unknown): WebhookResult => {
  // Permanent problems: retrying won't fix them, so acknowledge and log for a human.
  console.error(`[stripe] ignored checkout session: ${reason}`, details ?? "");
  return { status: 200, body: { received: true, ignored: reason } };
};

async function bookCheckoutSession(db: Db, session: Stripe.Checkout.Session): Promise<WebhookResult> {
  // Card payments are "paid" on completion; delayed methods arrive later as async_payment_succeeded.
  if (session.payment_status !== "paid") return { status: 200, body: { received: true, pending: true } };

  // Metadata was set by our own server when creating the session, and the event is signed.
  const userId = session.metadata?.userId;
  const accountId = session.metadata?.accountId;
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  const amount = session.amount_total;
  const currency = session.currency?.toUpperCase();
  if (!userId || !accountId || !paymentIntentId || !amount || !currency) {
    return ignored("missing data", { id: session.id });
  }

  const account = await getAccountForUser(db, userId, accountId);
  if (!account) return ignored("account not found", { id: session.id, accountId });
  // A real bank would park this on a suspense account; here we refuse to book the wrong currency.
  if (account.currency !== currency) return ignored("currency mismatch", { id: session.id, currency });

  try {
    const { transfer, replayed } = await postDeposit(db, {
      userId,
      accountId,
      amountMinor: BigInt(amount), // Stripe amounts are already integers in minor units
      // The PaymentIntent id is the idempotency key: Stripe may deliver the same event
      // more than once, and both completed + async_payment_succeeded can arrive.
      externalRef: paymentIntentId,
    });
    return { status: 200, body: { received: true, transferId: transfer.id, replayed } };
  } catch (e) {
    if (e instanceof LedgerError) return ignored(e.code, { id: session.id });
    throw e;
  }
}
