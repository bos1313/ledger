import type { Route } from "next";
import Link from "next/link";
import { db } from "@/db";
import { formatMoney } from "@/lib/money";
import { requireSession } from "@/server/auth";
import { listAccountsWithBalances } from "@/server/ledger";
import { logout } from "../login/actions";
import { TransferForm } from "./transfer-form";

export const dynamic = "force-dynamic";

/** Server Component: reads straight from the DB, no API round-trip. */
export default async function DashboardPage() {
  const session = await requireSession();
  const accounts = await listAccountsWithBalances(db, session.userId);

  return (
    <main className="container stack">
      <header className="row between">
        <h1>Računi</h1>
        <form action={logout}>
          <span className="muted">{session.email}</span> <button className="link">Odjava</button>
        </form>
      </header>

      <section className="grid">
        {accounts.map((a) => (
          <Link key={a.id} href={`/dashboard/accounts/${a.id}` as Route} className="card account-card">
            <p className="muted">{a.name}</p>
            <p className="balance">{formatMoney(a.balanceMinor, a.currency)}</p>
            <p className="muted small">Transakcije →</p>
          </Link>
        ))}
      </section>

      <TransferForm accounts={accounts.map(({ id, name, currency }) => ({ id, name, currency }))} />
    </main>
  );
}
