"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { isCurrency, parseAmount } from "@/lib/money";
import { FxUnavailableError, getRate } from "@/lib/rates";
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

const MESSAGES: Record<LedgerError["code"], string> = {
  NOT_FOUND: "Račun nije pronađen.",
  SAME_ACCOUNT: "Odaberite dva različita računa.",
  INSUFFICIENT_FUNDS: "Nedovoljno sredstava na računu.",
  IDEMPOTENCY_CONFLICT: "Ovaj zahtjev je već poslan s drugim podacima. Osvježite stranicu.",
  INVALID_AMOUNT: "Iznos mora biti veći od nule.",
};

export type TransferState = { ok?: boolean; error?: string };

export async function transferAction(_prev: TransferState, formData: FormData): Promise<TransferState> {
  const session = await requireSession();
  const parsed = TransferSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Neispravni podaci." };

  const accounts = await listAccountsWithBalances(db, session.userId);
  const from = accounts.find((a) => a.id === parsed.data.fromAccountId);
  if (!from || !isCurrency(from.currency)) return { error: "Račun nije pronađen." };

  try {
    await postTransfer(db, getRate, {
      userId: session.userId,
      idempotencyKey: parsed.data.idempotencyKey,
      fromAccountId: parsed.data.fromAccountId,
      toAccountId: parsed.data.toAccountId,
      amountMinor: parseAmount(parsed.data.amount, from.currency),
      description: parsed.data.description || undefined,
    });
  } catch (e) {
    if (e instanceof LedgerError) return { error: MESSAGES[e.code] };
    if (e instanceof FxUnavailableError) return { error: "Tečajna lista trenutno nije dostupna, pokušajte kasnije." };
    if (e instanceof Error && e.message.startsWith("Invalid amount")) return { error: "Neispravan iznos." };
    throw e;
  }
  revalidatePath("/dashboard");
  return { ok: true };
}
