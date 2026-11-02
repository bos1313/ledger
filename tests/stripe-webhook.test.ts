/**
 * Stripe webhook against a real Postgres: signature check, idempotent booking, NOTIFY on commit.
 * Events are signed locally with the same HMAC scheme Stripe uses, so no network or Stripe account is needed.
 */
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import Stripe from "stripe";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { CURRENCIES } from "@/lib/money";
import { LEDGER_CHANNEL, listAccountsWithBalances } from "@/server/ledger";
import { handleStripeWebhook } from "@/server/stripe-webhook";

const url = process.env.DATABASE_URL || undefined;
const client = url ? postgres(url, { max: 10, onnotice: () => {} }) : null;
const db = client ? drizzle(client, { schema }) : (null as never);

const SECRET = "whsec_test_secret";
let userId: string;
let eur: string;

function checkoutEvent(overrides: Partial<Stripe.Checkout.Session> = {}, type = "checkout.session.completed", id = "evt_1") {
  return JSON.stringify({
    id,
    object: "event",
    type,
    data: {
      object: {
        id: "cs_test_1",
        object: "checkout.session",
        payment_status: "paid",
        payment_intent: "pi_test_1",
        amount_total: 5000,
        currency: "eur",
        metadata: { userId, accountId: eur },
        ...overrides,
      },
    },
  });
}

const sign = (payload: string, secret = SECRET) => Stripe.webhooks.generateTestHeaderString({ payload, secret });
const deliver = (payload: string, signature: string | null = sign(payload)) =>
  handleStripeWebhook(db, payload, signature, SECRET);

async function eurBalance() {
  const rows = await listAccountsWithBalances(db, userId);
  return rows.find((r) => r.currency === "EUR")!.balanceMinor;
}

describe.skipIf(!url)("stripe webhook", () => {
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
    const [u] = await db.insert(schema.users).values({ email: "s@t.t", name: "S", passwordHash: "x" }).returning();
    userId = u.id;
    const [acc] = await db.insert(schema.accounts).values({ userId, name: "EUR", currency: "EUR" }).returning();
    eur = acc.id;
  });

  afterAll(async () => {
    await client?.end();
  });

  it("books a paid checkout session as a balanced deposit", async () => {
    const res = await deliver(checkoutEvent());
    expect(res.status).toBe(200);
    expect(res.body.replayed).toBe(false);
    expect(await eurBalance()).toBe(5000n);

    const [transfer] = await db.select().from(schema.transfers).where(eq(schema.transfers.externalRef, "pi_test_1"));
    expect(transfer.kind).toBe("deposit");
    const [{ total }] = await db.execute<{ total: string }>(
      sql`select sum(amount_minor)::text as total from ledger_entries where transfer_id = ${transfer.id}`,
    );
    expect(total).toBe("0"); // -50.00 on external:EUR, +50.00 on the user's account
  });

  it("rejects a bad or missing signature and books nothing", async () => {
    const payload = checkoutEvent();
    expect((await deliver(payload, sign(payload, "whsec_wrong"))).status).toBe(400);
    expect((await deliver(payload, null)).status).toBe(400);
    // Tampered body with the original signature
    const tampered = payload.replace('"amount_total":5000', '"amount_total":500000');
    expect((await deliver(tampered, sign(payload))).status).toBe(400);
    expect(await eurBalance()).toBe(0n);
  });

  it("books once when Stripe delivers the same payment twice", async () => {
    await deliver(checkoutEvent());
    const retry = await deliver(checkoutEvent()); // same event retried
    const asyncEvent = await deliver(checkoutEvent({}, "checkout.session.async_payment_succeeded", "evt_2"));
    expect(retry.body.replayed).toBe(true);
    expect(asyncEvent.body.replayed).toBe(true);
    expect(await eurBalance()).toBe(5000n);
  });

  it("books once under concurrent duplicate deliveries", async () => {
    const payload = checkoutEvent();
    const results = await Promise.all(Array.from({ length: 5 }, () => deliver(payload)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.body.replayed === false)).toHaveLength(1);
    expect(await eurBalance()).toBe(5000n);
  });

  it("acknowledges but does not book unpaid, mismatched or foreign sessions", async () => {
    const [other] = await db.insert(schema.users).values({ email: "o@t.t", name: "O", passwordHash: "x" }).returning();
    const cases = [
      checkoutEvent({ payment_status: "unpaid" }),
      checkoutEvent({ currency: "usd" }), // EUR account, USD payment
      checkoutEvent({ metadata: { userId: other.id, accountId: eur } }), // not that user's account
      checkoutEvent({ metadata: {} }),
    ];
    for (const payload of cases) expect((await deliver(payload)).status).toBe(200);
    expect(await eurBalance()).toBe(0n);
  });

  it("ignores unrelated event types", async () => {
    const payload = JSON.stringify({ id: "evt_x", object: "event", type: "customer.created", data: { object: {} } });
    const res = await deliver(payload);
    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe("customer.created");
  });

  it("sends NOTIFY with the user id only after the deposit commits", async () => {
    const listener = postgres(url!, { max: 1, onnotice: () => {} });
    const received: string[] = [];
    const { unlisten } = await listener.listen(LEDGER_CHANNEL, (payload) => received.push(payload));
    try {
      await deliver(checkoutEvent());
      await deliver(checkoutEvent()); // replay: nothing new booked, no notification
      await expect.poll(() => received, { timeout: 2000 }).toEqual([userId]);
      await new Promise((r) => setTimeout(r, 200));
      expect(received).toEqual([userId]);
    } finally {
      await unlisten();
      await listener.end();
    }
  });
});
