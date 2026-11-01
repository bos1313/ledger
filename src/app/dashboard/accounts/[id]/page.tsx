import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { divRoundHalfEven, formatMoney, rateToScaled, scaledToRate } from "@/lib/money";
import { requireSession } from "@/server/auth";
import { APP_TIME_ZONE, listAccountsWithBalances, listEntries, type EntryRow } from "@/server/ledger";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Bad or missing query params fall back to defaults instead of erroring. */
const Filters = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  from: date.optional().catch(undefined),
  to: date.optional().catch(undefined),
  kind: z.enum(["transfer", "deposit"]).optional().catch(undefined),
});

const dateTime = new Intl.DateTimeFormat("hr-HR", {
  timeZone: APP_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Display only: rate rounded to 6 decimals ("0,511292"). The stored rate keeps full precision. */
const displayRate = (rate: string) =>
  scaledToRate(divRoundHalfEven(rateToScaled(rate), 10_000n) * 10_000n).replace(".", ",");

function describe(r: EntryRow) {
  if (r.kind === "deposit") return { title: r.description ?? "Uplata", detail: null };
  const title = r.amountMinor < 0n ? `Prijenos na: ${r.toAccountName}` : `Prijenos s: ${r.fromAccountName}`;
  const fx =
    r.fromCurrency && r.fromCurrency !== r.toCurrency
      ? `${formatMoney(r.transferAmountMinor, r.fromCurrency)} → ${formatMoney(r.convertedMinor, r.toCurrency)} · tečaj ${displayRate(r.rate)}`
      : null;
  return { title, detail: [r.description, fx].filter(Boolean).join(" · ") || null };
}

export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const filters = Filters.parse(await searchParams);
  const [result, accounts] = await Promise.all([
    listEntries(db, { userId: session.userId, accountId: id, pageSize: PAGE_SIZE, ...filters }),
    listAccountsWithBalances(db, session.userId),
  ]);
  const account = accounts.find((a) => a.id === id);
  if (!result || !account) notFound();

  const { rows, total } = result;
  const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const first = total === 0 ? 0 : (filters.page - 1) * PAGE_SIZE + 1;
  const last = Math.min(filters.page * PAGE_SIZE, total);

  const query = (extra: Record<string, string | number | undefined>) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries({ from: filters.from, to: filters.to, kind: filters.kind, ...extra })) {
      if (v !== undefined && v !== "") qs.set(k, String(v));
    }
    return qs.toString();
  };
  const pageHref = (page: number) => `/dashboard/accounts/${id}?${query({ page })}` as Route;
  const csvHref = `/api/v1/transactions?${query({ accountId: id, format: "csv" })}`;
  const filtered = Boolean(filters.from || filters.to || filters.kind);

  return (
    <main className="container stack">
      <Link href="/dashboard" className="back">← Računi</Link>

      <header className="row between">
        <div>
          <p className="muted">{account.name} · {account.currency}</p>
          <p className="balance">{formatMoney(account.balanceMinor, account.currency)}</p>
        </div>
        <a className="button secondary" href={csvHref} download>
          Izvezi CSV
        </a>
      </header>

      {/* Plain GET form: filters live in the URL, so they survive refresh and can be shared. */}
      <form className="card filters" method="get">
        <label>
          Od
          <input type="date" name="from" defaultValue={filters.from} />
        </label>
        <label>
          Do
          <input type="date" name="to" defaultValue={filters.to} />
        </label>
        <label>
          Vrsta
          <select name="kind" defaultValue={filters.kind ?? ""}>
            <option value="">Sve</option>
            <option value="transfer">Prijenosi</option>
            <option value="deposit">Uplate</option>
          </select>
        </label>
        <button>Filtriraj</button>
        {filtered && <Link href={`/dashboard/accounts/${id}` as Route}>Očisti</Link>}
      </form>

      <section className="card table-card">
        {rows.length === 0 ? (
          <p className="muted empty">{filtered ? "Nema transakcija za odabrane filtre." : "Još nema transakcija."}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Datum</th>
                <th>Opis</th>
                <th className="num">Iznos</th>
                <th className="num">Stanje</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const { title, detail } = describe(r);
                return (
                  <tr key={r.id.toString()}>
                    <td className="nowrap muted">{dateTime.format(r.createdAt)}</td>
                    <td>
                      {title}
                      {detail && <div className="muted small">{detail}</div>}
                    </td>
                    <td className={`num nowrap ${r.amountMinor > 0n ? "positive" : ""}`}>
                      {r.amountMinor > 0n ? "+" : ""}
                      {formatMoney(r.amountMinor, r.currency)}
                    </td>
                    <td className="num nowrap muted">{formatMoney(r.balanceAfterMinor, r.currency)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {total > 0 && (
        <nav className="row between pagination">
          <span className="muted">
            {first}–{last} od {total}
          </span>
          <span className="row">
            {filters.page > 1 ? <Link href={pageHref(filters.page - 1)}>← Novije</Link> : <span className="muted">← Novije</span>}
            <span className="muted">
              {filters.page} / {pages}
            </span>
            {filters.page < pages ? <Link href={pageHref(filters.page + 1)}>Starije →</Link> : <span className="muted">Starije →</span>}
          </span>
        </nav>
      )}
    </main>
  );
}
