"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { isCurrency, parseAmount } from "@/lib/money";
import { FxUnavailableError, getRate } from "@/lib/rates";
import type { Dictionary } from "@/i18n/dictionaries";
import { requireSession } from "@/server/auth";
import { LedgerError, listAccountsWithBalances, postTransfer } from "@/server/ledger";

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
