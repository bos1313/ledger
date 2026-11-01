/**
 * Integration tests against a real Postgres (row locks and unique indexes can't be mocked honestly).
 * Requires TEST_DATABASE_URL (in .env or the shell) pointing at a THROWAWAY database; skipped otherwise.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { CURRENCIES } from "@/lib/money";
import {
  LedgerError,
  listAccountsWithBalances,
  listEntries,
  postDeposit,
  postTransfer,
  type RateProvider,
} from "@/server/ledger";

const url = process.env.DATABASE_URL || undefined;
const client = url ? postgres(url, { max: 10, onnotice: () => {} }) : null;
const db = client ? drizzle(client, { schema }) : (null as never);

const fixedRates: RateProvider = async (from, to) => {
  const table: Record<string, string> = { "EUR:USD": "1.1", "USD:EUR": "0.9", "EUR:BAM": "1.95583" };
  return { rate: from === to ? "1" : table[`${from}:${to}`], date: "2026-11-01" };
};

let userId: string;
let eur: string;
let usd: string;

async function balances() {
  const rows = await listAccountsWithBalances(db, userId);
  return Object.fromEntries(rows.map((r) => [r.currency, r.balanceMinor]));
}

describe.skipIf(!url)("ledger", () => {
  beforeAll(async () => {
    await migrate(drizzle(client!), { migrationsFolder: "./drizzle" });
  });

  beforeEach(async () => {
    await db.execute(sql`truncate ledger_entries, transfers, accounts, users restart identity cascade`);
    for (const ccy of CURRENCIES) {
      await db.insert(schema.accounts).values([
        { kind: "system", code: `external:${ccy}`, name: `ext ${ccy}`, currency: ccy },
        { kind: "system", code: `fx:${ccy}`, name: `fx ${ccy}`, currency: ccy },
      ]);
    }
    const [u] = await db.insert(schema.users).values({ email: "t@t.t", name: "T", passwordHash: "x" }).returning();
    userId = u.id;
    const accs = await db
      .insert(schema.accounts)
      .values([
        { userId, name: "EUR", currency: "EUR" },
        { userId, name: "USD", currency: "USD" },
      ])
      .returning();
    eur = accs[0].id;
    usd = accs[1].id;
    await postDeposit(db, { userId, accountId: eur, amountMinor: 10000n, externalRef: "pi_1" }); // 100.00 EUR
  });

  afterAll(async () => {
    await client?.end();
  });

  it("books a deposit only once for the same external ref (webhook retry)", async () => {
    const again = await postDeposit(db, { userId, accountId: eur, amountMinor: 10000n, externalRef: "pi_1" });
    expect(again.replayed).toBe(true);
    expect((await balances()).EUR).toBe(10000n);
  });

  it("converts cross-currency and keeps every currency balanced", async () => {
    const { transfer } = await postTransfer(db, fixedRates, {
      userId,
      idempotencyKey: randomUUID(),
      fromAccountId: eur,
      toAccountId: usd,
      amountMinor: 5000n,
    });
    expect(transfer.convertedMinor).toBe(5500n);
    expect(await balances()).toEqual({ EUR: 5000n, USD: 5500n });

    const entries = await db.select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.transferId, transfer.id));
    expect(entries).toHaveLength(4);
    const perCcy = await db.execute<{ currency: string; total: string }>(
      sql`select currency, sum(amount_minor)::text as total from ledger_entries group by currency`,
    );
    for (const row of perCcy) expect(row.total).toBe("0"); // whole book sums to zero
  });

  it("replays the same idempotency key instead of posting twice", async () => {
    const input = { userId, idempotencyKey: randomUUID(), fromAccountId: eur, toAccountId: usd, amountMinor: 1000n };
    const first = await postTransfer(db, fixedRates, input);
    const second = await postTransfer(db, fixedRates, input);
    expect(second.replayed).toBe(true);
    expect(second.transfer.id).toBe(first.transfer.id);
    expect((await balances()).EUR).toBe(9000n);
  });

  it("rejects reusing a key with a different body", async () => {
    const key = randomUUID();
    await postTransfer(db, fixedRates, { userId, idempotencyKey: key, fromAccountId: eur, toAccountId: usd, amountMinor: 1000n });
    await expect(
      postTransfer(db, fixedRates, { userId, idempotencyKey: key, fromAccountId: eur, toAccountId: usd, amountMinor: 2000n }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("handles concurrent duplicates with the same key exactly once", async () => {
    const input = { userId, idempotencyKey: randomUUID(), fromAccountId: eur, toAccountId: usd, amountMinor: 1000n };
    const results = await Promise.all(Array.from({ length: 5 }, () => postTransfer(db, fixedRates, input)));
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect((await balances()).EUR).toBe(9000n);
  });

  it("never overdraws under concurrent spending", async () => {
    // 100.00 EUR available, 5 parallel transfers of 30.00 -> only 3 can succeed
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        postTransfer(db, fixedRates, { userId, idempotencyKey: randomUUID(), fromAccountId: eur, toAccountId: usd, amountMinor: 3000n }),
      ),
    );
    const ok = attempts.filter((a) => a.status === "fulfilled");
    const failed = attempts.filter((a) => a.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(3);
    expect(failed.every((f) => f.reason instanceof LedgerError && f.reason.code === "INSUFFICIENT_FUNDS")).toBe(true);
    expect((await balances()).EUR).toBe(1000n);
  });

  it("refuses accounts the user doesn't own", async () => {
    const [other] = await db.insert(schema.users).values({ email: "o@o.o", name: "O", passwordHash: "x" }).returning();
    const [foreign] = await db.insert(schema.accounts).values({ userId: other.id, name: "x", currency: "EUR" }).returning();
    await expect(
      postTransfer(db, fixedRates, { userId, idempotencyKey: randomUUID(), fromAccountId: eur, toAccountId: foreign.id, amountMinor: 100n }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lists entries newest first with a correct running balance on every page", async () => {
    for (const amount of [1000n, 2000n, 3000n]) {
      await postTransfer(db, fixedRates, { userId, idempotencyKey: randomUUID(), fromAccountId: eur, toAccountId: usd, amountMinor: amount });
    }
    // EUR history: +10000, -1000, -2000, -3000  -> balances 10000, 9000, 7000, 4000
    const page1 = await listEntries(db, { userId, accountId: eur, page: 1, pageSize: 2 });
    const page2 = await listEntries(db, { userId, accountId: eur, page: 2, pageSize: 2 });
    expect(page1!.total).toBe(4);
    expect(page1!.rows.map((r) => [r.amountMinor, r.balanceAfterMinor])).toEqual([[-3000n, 4000n], [-2000n, 7000n]]);
    expect(page2!.rows.map((r) => [r.amountMinor, r.balanceAfterMinor])).toEqual([[-1000n, 9000n], [10000n, 10000n]]);
    expect(page1!.rows[0].toAccountName).toBe("USD");

    const deposits = await listEntries(db, { userId, accountId: eur, kind: "deposit" });
    expect(deposits!.total).toBe(1);
    expect(deposits!.rows[0].balanceAfterMinor).toBe(10000n); // running balance ignores the filter

    const future = await listEntries(db, { userId, accountId: eur, from: "2999-01-01" });
    expect(future!.total).toBe(0);
    expect(await listEntries(db, { userId: randomUUID(), accountId: eur })).toBeNull(); // not your account
  });
});
