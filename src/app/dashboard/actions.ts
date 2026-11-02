"use server";

import { revalidatePath } from "next/cache";
import type { Route } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Stripe from "stripe";
import { z } from "zod";
import { db } from "@/db";
import { formatMoney, isCurrency, parseAmount } from "@/lib/money";
import { FxUnavailableError, getRate } from "@/lib/rates";
import { type Dictionary, fmt } from "@/i18n/dictionaries";
import { getI18n } from "@/i18n/server";
import { requireSession } from "@/server/auth";
import { LedgerError, getAccountForUser, listAccountsWithBalances, postTransfer } from "@/server/ledger";
import { getStripe, isStripeConfigured } from "@/server/stripe";

const TransferSchema = z.object({
  fromAccountId: z.string().uuid(),
  toAccountId: z.string().uuid(),
  amount: z.string().min(1),
  description: z.string().max(140).optional(),
  // Generated once per form render, so a double-click or a retry can't post twice.
  idempotencyKey: z.string().uuid(),
});

/** Errors are dictionary keys (see transfer.errors), translated by the form. */
export type TransferErrorCode = keyof Dictionary["transfer"]["errors"];
export type TransferState = { ok?: boolean; error?: TransferErrorCode };

export async function transferAction(_prev: TransferState, formData: FormData): Promise<TransferState> {
  const session = await requireSession();
  const parsed = TransferSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "INVALID_INPUT" };

  const accounts = await listAccountsWithBalances(db, session.userId);
  const from = accounts.find((a) => a.id === parsed.data.fromAccountId);
  if (!from || !isCurrency(from.currency)) return { error: "NOT_FOUND" };

  let amountMinor: bigint;
  try {
    amountMinor = parseAmount(parsed.data.amount, from.currency);
  } catch {
    return { error: "INVALID_AMOUNT_FORMAT" };
  }

  try {
    await postTransfer(db, getRate, {
      userId: session.userId,
      idempotencyKey: parsed.data.idempotencyKey,
      fromAccountId: parsed.data.fromAccountId,
      toAccountId: parsed.data.toAccountId,
      amountMinor,
      description: parsed.data.description || undefined,
    });
  } catch (e) {
    if (e instanceof LedgerError) return { error: e.code };
    if (e instanceof FxUnavailableError) return { error: "FX_UNAVAILABLE" };
    throw e;
  }
  revalidatePath("/dashboard");
  return { ok: true };
}

/* ---------- Card deposit (Stripe Checkout, test mode) ---------- */

const DepositSchema = z.object({
  accountId: z.string().uuid(),
  amount: z.string().min(1),
  // Sent to Stripe as its Idempotency-Key: a double submit reuses the same Checkout Session.
  idempotencyKey: z.string().uuid(),
});

/** Limits in minor units (not exported: a "use server" file may only export async functions) (same for EUR, USD, BAM). Stripe's own minimum is ~0.50 USD. */
const DEPOSIT_MIN_MINOR = 100n; // 1.00
const DEPOSIT_MAX_MINOR = 1_000_000n; // 10,000.00

export type DepositErrorCode = keyof Dictionary["deposit"]["errors"];
export type DepositState = { error?: DepositErrorCode };

async function appOrigin() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}

/**
 * Creates a Checkout Session and redirects to Stripe. Nothing is booked here:
 * money reaches the ledger only through the signed webhook (/api/webhooks/stripe).
 */
export async function depositAction(_prev: DepositState, formData: FormData): Promise<DepositState> {
  const session = await requireSession();
  if (!isStripeConfigured()) return { error: "STRIPE_NOT_CONFIGURED" };
  const parsed = DepositSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "INVALID_INPUT" };

  const account = await getAccountForUser(db, session.userId, parsed.data.accountId);
  if (!account || !isCurrency(account.currency)) return { error: "NOT_FOUND" };
  const currency = account.currency;

  let amountMinor: bigint;
  try {
    amountMinor = parseAmount(parsed.data.amount, currency);
  } catch {
    return { error: "INVALID_AMOUNT_FORMAT" };
  }
  if (amountMinor < DEPOSIT_MIN_MINOR) return { error: "AMOUNT_TOO_SMALL" };
  if (amountMinor > DEPOSIT_MAX_MINOR) return { error: "AMOUNT_TOO_LARGE" };

  const { t, intl, locale } = await getI18n();
  const origin = await appOrigin();
  const metadata = { userId: session.userId, accountId: account.id };
  let url: string | null;
  try {
    const checkout = await getStripe().checkout.sessions.create(
      {
        mode: "payment",
        locale, // Checkout page in the app's language ("hr" / "en")
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: currency.toLowerCase(),
              unit_amount: Number(amountMinor), // safe: capped at DEPOSIT_MAX_MINOR
              product_data: { name: fmt(t.deposit.productName, { account: t.accountNames[currency] }) },
            },
          },
        ],
        metadata,
        payment_intent_data: { metadata, description: formatMoney(amountMinor, currency, intl) },
        client_reference_id: session.userId,
        success_url: `${origin}/dashboard?deposit=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/dashboard?deposit=cancelled`,
      },
      { idempotencyKey: parsed.data.idempotencyKey },
    );
    url = checkout.url;
  } catch (e) {
    if (e instanceof Stripe.errors.StripeIdempotencyError) return { error: "IDEMPOTENCY_CONFLICT" };
    console.error("[stripe] could not create checkout session", e);
    return { error: "STRIPE_ERROR" };
  }
  if (!url) return { error: "STRIPE_ERROR" };
  redirect(url as Route); // external Stripe URL; outside try because redirect() works by throwing
}
