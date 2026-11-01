import { createHash } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import { accounts, ledgerEntries, transfers, type Account, type Transfer } from "@/db/schema";
import { type Currency, convertMinor, isCurrency } from "@/lib/money";

export type LedgerErrorCode =
  | "NOT_FOUND"
  | "SAME_ACCOUNT"
  | "INSUFFICIENT_FUNDS"
  | "IDEMPOTENCY_CONFLICT"
  | "INVALID_AMOUNT";

export class LedgerError extends Error {
  constructor(
    public code: LedgerErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type RateProvider = (from: Currency, to: Currency) => Promise<{ rate: string; date: string }>;

type PostResult = { transfer: Transfer; replayed: boolean };
type NewEntry = { accountId: string; amountMinor: bigint; currency: Currency };

const hashRequest = (body: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)))
    .digest("hex");

function currencyOf(account: Account): Currency {
  if (!isCurrency(account.currency)) throw new Error(`Unsupported currency ${account.currency}`);
  return account.currency;
}

async function systemAccount(tx: Tx, code: string): Promise<Account> {
  const [row] = await tx.select().from(accounts).where(eq(accounts.code, code));
  if (!row) throw new Error(`Missing system account ${code} (run db:seed)`);
  return row;
}

/**
 * Inserts the transfer row guarded by the (user_id, idempotency_key) unique index.
 * If the key was already used: same request -> return the original (replay),
 * different request -> conflict. A concurrent duplicate blocks on the index until
 * the first transaction commits, then lands here as a replay.
 */
async function insertTransferIdempotent(
  tx: Tx,
  values: typeof transfers.$inferInsert,
): Promise<PostResult> {
  const [inserted] = await tx.insert(transfers).values(values).onConflictDoNothing().returning();
  if (inserted) return { transfer: inserted, replayed: false };

  const [existing] = await tx
    .select()
    .from(transfers)
    .where(and(eq(transfers.userId, values.userId), eq(transfers.idempotencyKey, values.idempotencyKey)));
  if (!existing) {
    // Conflict came from a different unique index (external_ref).
    throw new LedgerError("IDEMPOTENCY_CONFLICT", "Duplicate external reference");
  }
  if (existing.requestHash !== values.requestHash) {
    throw new LedgerError("IDEMPOTENCY_CONFLICT", "Idempotency key reused with a different request");
  }
  return { transfer: existing, replayed: true };
}

async function balanceOf(tx: Tx | Db, accountId: string): Promise<bigint> {
  const [row] = await tx
    .select({ balance: sql<string>`coalesce(sum(${ledgerEntries.amountMinor}), 0)` })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.accountId, accountId));
  return BigInt(row.balance);
}

function assertBalanced(entries: NewEntry[]) {
  const sums = new Map<string, bigint>();
  for (const e of entries) sums.set(e.currency, (sums.get(e.currency) ?? 0n) + e.amountMinor);
  for (const [ccy, sum] of sums) {
    if (sum !== 0n) throw new Error(`Unbalanced entries in ${ccy}: ${sum}`);
  }
}

/**
 * Move money between two of the user's accounts, converting currency if needed.
 *
 * Same currency  -> 2 entries:  -from, +to
 * Cross currency -> 4 entries:  -from, +fx:FROM   |   -fx:TO, +to
 * so the books balance to zero in every currency.
 */
export async function postTransfer(
  db: Db,
  getRate: RateProvider,
  input: {
    userId: string;
    idempotencyKey: string;
    fromAccountId: string;
    toAccountId: string;
    amountMinor: bigint;
    description?: string;
  },
): Promise<PostResult> {
  const { userId, fromAccountId, toAccountId, amountMinor } = input;
  if (amountMinor <= 0n) throw new LedgerError("INVALID_AMOUNT", "Amount must be positive");
  if (fromAccountId === toAccountId) throw new LedgerError("SAME_ACCOUNT", "Choose two different accounts");

  const owned = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), inArray(accounts.id, [fromAccountId, toAccountId])));
  const from = owned.find((a) => a.id === fromAccountId);
  const to = owned.find((a) => a.id === toAccountId);
  if (!from || !to) throw new LedgerError("NOT_FOUND", "Account not found");

  const fromCcy = currencyOf(from);
  const toCcy = currencyOf(to);
  // Fetch the rate BEFORE opening the DB transaction: never hold row locks across network I/O.
  const { rate, date } = await getRate(fromCcy, toCcy);
  const convertedMinor = convertMinor(amountMinor, rate, fromCcy, toCcy);
  if (convertedMinor <= 0n) throw new LedgerError("INVALID_AMOUNT", "Amount too small to convert");

  return db.transaction(async (tx) => {
    // 1) Lock both accounts FIRST, in a stable order (by id), so concurrent transfers
    //    queue up instead of both spending the same balance.
    //    Must happen before any INSERT: inserting rows that reference `accounts` takes a
    //    FOR KEY SHARE lock on them, and upgrading to FOR UPDATE afterwards deadlocks.
    //    NO KEY UPDATE is the right strength: it serializes writers but not FK checks.
    await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(inArray(accounts.id, [fromAccountId, toAccountId]))
      .orderBy(asc(accounts.id))
      .for("no key update");

    // 2) Idempotency guard.
    const result = await insertTransferIdempotent(tx, {
      userId,
      kind: "transfer",
      idempotencyKey: input.idempotencyKey,
      // Rate is part of the stored result, not the request: a retry tomorrow replays today's rate.
      requestHash: hashRequest({ fromAccountId, toAccountId, amountMinor, description: input.description ?? null }),
      fromAccountId,
      toAccountId,
      amountMinor,
      convertedMinor,
      rate,
      rateDate: date,
      description: input.description,
    });
    if (result.replayed) return result;

    // 3) Balance check under the lock.
    if ((await balanceOf(tx, fromAccountId)) < amountMinor) {
      throw new LedgerError("INSUFFICIENT_FUNDS", "Insufficient funds"); // rolls back the transfer row too
    }

    const entries: NewEntry[] =
      fromCcy === toCcy
        ? [
            { accountId: from.id, amountMinor: -amountMinor, currency: fromCcy },
            { accountId: to.id, amountMinor, currency: toCcy },
          ]
        : [
            { accountId: from.id, amountMinor: -amountMinor, currency: fromCcy },
            { accountId: (await systemAccount(tx, `fx:${fromCcy}`)).id, amountMinor, currency: fromCcy },
            { accountId: (await systemAccount(tx, `fx:${toCcy}`)).id, amountMinor: -convertedMinor, currency: toCcy },
            { accountId: to.id, amountMinor: convertedMinor, currency: toCcy },
          ];
    assertBalanced(entries);
    await tx.insert(ledgerEntries).values(entries.map((e) => ({ ...e, transferId: result.transfer.id })));
    return result;
  });
}

/**
 * Credit an account with money coming from outside (Stripe, opening balance).
 * `externalRef` (e.g. PaymentIntent id) is also the idempotency key, so a webhook
 * delivered twice books the deposit once.
 */
export async function postDeposit(
  db: Db,
  input: { userId: string; accountId: string; amountMinor: bigint; externalRef: string; description?: string },
): Promise<PostResult> {
  if (input.amountMinor <= 0n) throw new LedgerError("INVALID_AMOUNT", "Amount must be positive");
  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, input.accountId), eq(accounts.userId, input.userId)));
  if (!account) throw new LedgerError("NOT_FOUND", "Account not found");
  const ccy = currencyOf(account);

  return db.transaction(async (tx) => {
    await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, account.id)).for("no key update");
    const result = await insertTransferIdempotent(tx, {
      userId: input.userId,
      kind: "deposit",
      idempotencyKey: `deposit:${input.externalRef}`,
      requestHash: hashRequest({ accountId: input.accountId, amountMinor: input.amountMinor }),
      toAccountId: account.id,
      amountMinor: input.amountMinor,
      convertedMinor: input.amountMinor,
      rate: "1",
      externalRef: input.externalRef,
      description: input.description,
    });
    if (result.replayed) return result;

    const external = await systemAccount(tx, `external:${ccy}`);
    const entries: NewEntry[] = [
      { accountId: external.id, amountMinor: -input.amountMinor, currency: ccy },
      { accountId: account.id, amountMinor: input.amountMinor, currency: ccy },
    ];
    assertBalanced(entries);
    await tx.insert(ledgerEntries).values(entries.map((e) => ({ ...e, transferId: result.transfer.id })));
    return result;
  });
}

/* ---------- Read side ---------- */

export async function listAccountsWithBalances(db: Db, userId: string) {
  const rows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      currency: accounts.currency,
      balance: sql<string>`coalesce(sum(${ledgerEntries.amountMinor}), 0)`,
    })
    .from(accounts)
    .leftJoin(ledgerEntries, eq(ledgerEntries.accountId, accounts.id))
    .where(eq(accounts.userId, userId))
    .groupBy(accounts.id)
    .orderBy(asc(accounts.currency));
  return rows.map((r) => ({ ...r, currency: r.currency as Currency, balanceMinor: BigInt(r.balance) }));
}

export const APP_TIME_ZONE = "Europe/Zagreb";

export async function getAccountForUser(db: Db, userId: string, accountId: string) {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
  return row ?? null;
}

export type EntryFilters = {
  /** Inclusive local dates (YYYY-MM-DD) in APP_TIME_ZONE. */
  from?: string;
  to?: string;
  kind?: "transfer" | "deposit";
};

export type EntryRow = {
  id: bigint;
  amountMinor: bigint;
  /** Account balance right after this entry (running total over the whole account history). */
  balanceAfterMinor: bigint;
  currency: Currency;
  createdAt: Date;
  transferId: string;
  kind: "transfer" | "deposit";
  description: string | null;
  rate: string;
  transferAmountMinor: bigint;
  convertedMinor: bigint;
  fromAccountName: string | null;
  fromCurrency: Currency | null;
  toAccountName: string;
  toCurrency: Currency;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Entries of one account, newest first, with a running balance.
 * The running balance is computed over the account's FULL history (window function)
 * before filters are applied, so it stays correct on every page and date range.
 */
export async function listEntries(
  db: Db,
  input: { userId: string; accountId: string; page?: number; pageSize?: number; all?: boolean } & EntryFilters,
): Promise<{ rows: EntryRow[]; total: number } | null> {
  const account = await getAccountForUser(db, input.userId, input.accountId);
  if (!account) return null;

  const pageSize = Math.min(Math.max(input.pageSize ?? 20, 1), 100);
  const page = Math.max(input.page ?? 1, 1);
  const localDate = sql`(e.created_at at time zone ${APP_TIME_ZONE})::date`;
  const filters = [sql`true`];
  if (input.from && DATE_RE.test(input.from)) filters.push(sql`${localDate} >= ${input.from}::date`);
  if (input.to && DATE_RE.test(input.to)) filters.push(sql`${localDate} <= ${input.to}::date`);
  if (input.kind) filters.push(sql`t.kind = ${input.kind}`);
  const where = sql.join(filters, sql` and `);

  const base = sql`
    with e as (
      select le.id, le.amount_minor, le.currency, le.created_at, le.transfer_id,
             sum(le.amount_minor) over (order by le.created_at, le.id) as balance_after
      from ledger_entries le
      where le.account_id = ${account.id}
    )`;

  const [{ total }] = await db.execute<{ total: string }>(sql`
    ${base}
    select count(*)::text as total
    from e join transfers t on t.id = e.transfer_id
    where ${where}`);

  const limit = input.all ? sql`limit 10000` : sql`limit ${pageSize} offset ${(page - 1) * pageSize}`;
  const rows = await db.execute<Record<string, string | Date | null>>(sql`
    ${base}
    select e.id::text, e.amount_minor::text, e.balance_after::text, e.currency, e.created_at,
           t.id as transfer_id, t.kind, t.description, t.rate::text,
           t.amount_minor::text as transfer_amount, t.converted_minor::text,
           fa.name as from_name, fa.currency as from_currency,
           ta.name as to_name, ta.currency as to_currency
    from e
    join transfers t on t.id = e.transfer_id
    left join accounts fa on fa.id = t.from_account_id
    join accounts ta on ta.id = t.to_account_id
    where ${where}
    order by e.created_at desc, e.id desc
    ${limit}`);

  return {
    total: Number(total),
    rows: rows.map((r) => ({
      id: BigInt(r.id as string),
      amountMinor: BigInt(r.amount_minor as string),
      balanceAfterMinor: BigInt(r.balance_after as string),
      currency: r.currency as Currency,
      createdAt: new Date(r.created_at as Date),
      transferId: r.transfer_id as string,
      kind: r.kind as EntryRow["kind"],
      description: r.description as string | null,
      rate: r.rate as string,
      transferAmountMinor: BigInt(r.transfer_amount as string),
      convertedMinor: BigInt(r.converted_minor as string),
      fromAccountName: r.from_name as string | null,
      fromCurrency: r.from_currency as Currency | null,
      toAccountName: r.to_name as string,
      toCurrency: r.to_currency as Currency,
    })),
  };
}
