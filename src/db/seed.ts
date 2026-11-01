import bcrypt from "bcryptjs";
import { db, pg } from "./index";
import { accounts, users } from "./schema";
import { CURRENCIES, parseAmount } from "../lib/money";
import { postDeposit } from "../server/ledger";

/** Idempotent: safe to run on every container start. */
async function seed() {
  // System accounts: the other side of every entry.
  for (const ccy of CURRENCIES) {
    for (const [prefix, name] of [
      ["external", "External funding"],
      ["fx", "FX position"],
    ] as const) {
      await db
        .insert(accounts)
        .values({ kind: "system", code: `${prefix}:${ccy}`, name: `${name} ${ccy}`, currency: ccy })
        .onConflictDoNothing();
    }
  }

  const [user] = await db
    .insert(users)
    .values({ email: "demo@ledger.local", name: "Demo korisnik", passwordHash: await bcrypt.hash("demo1234", 10) })
    .onConflictDoUpdate({ target: users.email, set: { name: "Demo korisnik" } })
    .returning();

  const names = { EUR: "Tekući račun", USD: "Devizni račun", BAM: "Račun u BiH" } as const;
  for (const ccy of CURRENCIES) {
    await db.insert(accounts).values({ userId: user.id, name: names[ccy], currency: ccy }).onConflictDoNothing();
  }

  const userAccounts = await db.query.accounts.findMany({ where: (a, { eq }) => eq(a.userId, user.id) });
  const opening = { EUR: "2500.00", USD: "800.00", BAM: "1200.00" } as const;
  for (const acc of userAccounts) {
    const ccy = acc.currency as (typeof CURRENCIES)[number];
    await postDeposit(db, {
      userId: user.id,
      accountId: acc.id,
      amountMinor: parseAmount(opening[ccy], ccy),
      externalRef: `seed:opening:${acc.id}`, // same ref every run -> booked once
      description: "Početno stanje",
    });
  }
  console.log("Seeded demo@ledger.local / demo1234");
}

await seed();
await pg.end();
