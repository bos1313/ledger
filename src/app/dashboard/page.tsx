import type { Route } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { db } from "@/db";
import { getI18n } from "@/i18n/server";
import { formatMoney } from "@/lib/money";
import { requireSession } from "@/server/auth";
import { listAccountsWithBalances } from "@/server/ledger";
import { logout } from "../login/actions";
import { CHART_PAIRS, type ChartPair } from "@/lib/fx";
import { PAIR_OPTIONS, RANGES, RatesSection } from "./rates-section";
import { TransferForm } from "./transfer-form";

export const dynamic = "force-dynamic";

/** Server Component: reads straight from the DB, no API round-trip. */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ pair?: string; range?: string }>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const { t, intl } = await getI18n();
  const pair: ChartPair = (CHART_PAIRS as readonly string[]).includes(sp.pair ?? "") ? (sp.pair as ChartPair) : PAIR_OPTIONS[0];
  const days = RANGES.find((r) => String(r.days) === sp.range)?.days ?? 90;
  const accounts = await listAccountsWithBalances(db, session.userId);

  return (
    <main className="container stack">
      <header className="row between">
        <h1>{t.dashboard.title}</h1>
        <form action={logout}>
          <span className="muted">{session.email}</span> <button className="link">{t.dashboard.logout}</button>
        </form>
      </header>

      <section className="grid">
        {accounts.map((a) => (
          <Link key={a.id} href={`/dashboard/accounts/${a.id}` as Route} className="card account-card">
            <p className="muted">{a.name}</p>
            <p className="balance">{formatMoney(a.balanceMinor, a.currency, intl)}</p>
            <p className="muted small">{t.dashboard.transactions}</p>
          </Link>
        ))}
      </section>

      <TransferForm accounts={accounts.map(({ id, name, currency }) => ({ id, name, currency }))} t={t.transfer} />

      <Suspense key={`${pair}-${days}`} fallback={<section className="card muted">{t.rates.loading}</section>}>
        <RatesSection pair={pair} days={days} />
      </Suspense>
    </main>
  );
}
