import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { type Dictionary, fmt } from "@/i18n/dictionaries";
import { getI18n } from "@/i18n/server";
import { formatRate } from "@/lib/fx";
import { formatMoney } from "@/lib/money";
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

function describe(r: EntryRow, t: Dictionary["account"], intl: string) {
  if (r.kind === "deposit") return { title: r.description ?? t.deposit, detail: null };
  const title =
    r.amountMinor < 0n
      ? fmt(t.transferTo, { name: r.toAccountName })
      : fmt(t.transferFrom, { name: r.fromAccountName ?? "" });
  // Displayed rate is rounded to 6 decimals; the stored rate keeps full precision.
  const fx =
    r.fromCurrency && r.fromCurrency !== r.toCurrency
      ? `${formatMoney(r.transferAmountMinor, r.fromCurrency, intl)} → ${formatMoney(r.convertedMinor, r.toCurrency, intl)} · ${fmt(t.rate, { rate: formatRate(r.rate, intl, 6) })}`
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
  const { t: dict, intl } = await getI18n();
  const t = dict.account;
  const dateTime = new Intl.DateTimeFormat(intl, {
    timeZone: APP_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
      <Link href="/dashboard" className="back">{dict.common.back}</Link>

      <header className="row between">
        <div>
          <p className="muted">{account.name} · {account.currency}</p>
          <p className="balance">{formatMoney(account.balanceMinor, account.currency, intl)}</p>
        </div>
        <a className="button secondary" href={csvHref} download>
          {t.exportCsv}
        </a>
      </header>

      {/* Plain GET form: filters live in the URL, so they survive refresh and can be shared. */}
      <form className="card filters" method="get">
        <label>
          {t.filterFrom}
          <input type="date" name="from" defaultValue={filters.from} />
        </label>
        <label>
          {t.filterTo}
          <input type="date" name="to" defaultValue={filters.to} />
        </label>
        <label>
          {t.filterKind}
          <select name="kind" defaultValue={filters.kind ?? ""}>
            <option value="">{t.kindAll}</option>
            <option value="transfer">{t.kindTransfer}</option>
            <option value="deposit">{t.kindDeposit}</option>
          </select>
        </label>
        <button>{t.filter}</button>
        {filtered && <Link href={`/dashboard/accounts/${id}` as Route}>{t.clear}</Link>}
      </form>

      <section className="card table-card">
        {rows.length === 0 ? (
          <p className="muted empty">{filtered ? t.emptyFiltered : t.empty}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t.colDate}</th>
                <th>{t.colDescription}</th>
                <th className="num">{t.colAmount}</th>
                <th className="num">{t.colBalance}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const { title, detail } = describe(r, t, intl);
                return (
                  <tr key={r.id.toString()}>
                    <td className="nowrap muted">{dateTime.format(r.createdAt)}</td>
                    <td>
                      {title}
                      {detail && <div className="muted small">{detail}</div>}
                    </td>
                    <td className={`num nowrap ${r.amountMinor > 0n ? "positive" : ""}`}>
                      {r.amountMinor > 0n ? "+" : ""}
                      {formatMoney(r.amountMinor, r.currency, intl)}
                    </td>
                    <td className="num nowrap muted">{formatMoney(r.balanceAfterMinor, r.currency, intl)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {total > 0 && (
        <nav className="row between pagination">
          <span className="muted">{fmt(t.range, { first, last, total })}</span>
          <span className="row">
            {filters.page > 1 ? <Link href={pageHref(filters.page - 1)}>{t.newer}</Link> : <span className="muted">{t.newer}</span>}
            <span className="muted">
              {filters.page} / {pages}
            </span>
            {filters.page < pages ? <Link href={pageHref(filters.page + 1)}>{t.older}</Link> : <span className="muted">{t.older}</span>}
          </span>
        </nav>
      )}
    </main>
  );
}
