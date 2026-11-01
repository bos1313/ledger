import type { Route } from "next";
import Link from "next/link";
import { fmt } from "@/i18n/dictionaries";
import { getI18n } from "@/i18n/server";
import { type ChartPair, formatIsoDate, formatRate, splitPair } from "@/lib/fx";
import { FxUnavailableError, getRateBoard, getRateHistory } from "@/lib/rates";
import { RateChart } from "./rate-chart";

export const RANGES = [
  { days: 30, key: "range30" },
  { days: 90, key: "range90" },
  { days: 365, key: "range365" },
] as const;
export const PAIR_OPTIONS: ChartPair[] = ["EURUSD", "USDBAM"];

/**
 * Async Server Component, rendered inside <Suspense>: balances show immediately and this
 * streams in when the (cached) FX data is ready. If the FX API is down, only this card degrades.
 */
export async function RatesSection({ pair, days }: { pair: ChartPair; days: number }) {
  const { t, intl } = await getI18n();
  const [from, to] = splitPair(pair);
  let board: Awaited<ReturnType<typeof getRateBoard>>;
  let history: Awaited<ReturnType<typeof getRateHistory>>;
  try {
    [board, history] = await Promise.all([getRateBoard(), getRateHistory(from, to, days)]);
  } catch (e) {
    if (!(e instanceof FxUnavailableError)) throw e;
    return (
      <section className="card">
        <h2>{t.rates.title}</h2>
        <p className="muted">{t.rates.unavailable}</p>
      </section>
    );
  }

  const href = (p: ChartPair, d: number) => `/dashboard?pair=${p}&range=${d}` as Route;
  // "0,14 %" in Croatian, "0.14%" in English (display only).
  const pct = (v: string) =>
    (Number(v.replace("-", "")) / 100).toLocaleString(intl, { style: "percent", minimumFractionDigits: 2 });

  return (
    <section className="rates-grid">
      <article className="card">
        <h2>{t.rates.title}</h2>
        <p className="muted small">{fmt(t.rates.source, { date: formatIsoDate(board.date, intl) })}</p>
        <table className="board">
          <tbody>
            {board.rows.map((r) => (
              <tr key={r.from + r.to}>
                <td className="muted nowrap">
                  {r.from}/{r.to}
                </td>
                <td className="num nowrap">
                  <strong>{formatRate(r.rate, intl)}</strong>
                </td>
                <td className="num nowrap small">
                  {r.pegged ? (
                    <span className="muted">{t.rates.pegged}</span>
                  ) : r.changePct!.startsWith("-") ? (
                    <span className="negative">▼ {pct(r.changePct!)}</span>
                  ) : (
                    <span className="positive">▲ {pct(r.changePct!)}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>

      <article className="card stack">
        <div className="row between">
          <h2>
            {from}/{to}
          </h2>
          <div className="row">
            <nav className="segmented" aria-label={t.rates.pairNav}>
              {PAIR_OPTIONS.map((p) => (
                <Link key={p} href={href(p, days)} aria-current={p === pair ? "true" : undefined} scroll={false}>
                  {p.slice(0, 3)}/{p.slice(3)}
                </Link>
              ))}
            </nav>
            <nav className="segmented" aria-label={t.rates.rangeNav}>
              {RANGES.map((r) => (
                <Link key={r.days} href={href(pair, r.days)} aria-current={r.days === days ? "true" : undefined} scroll={false}>
                  {t.rates[r.key]}
                </Link>
              ))}
            </nav>
          </div>
        </div>
        <RateChart points={history} label={fmt(t.chart.seriesLabel, { from, to })} intl={intl} t={t.chart} />
      </article>
    </section>
  );
}
