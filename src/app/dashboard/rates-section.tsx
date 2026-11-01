import type { Route } from "next";
import Link from "next/link";
import { type ChartPair, roundRate, splitPair } from "@/lib/fx";
import { FxUnavailableError, getRateBoard, getRateHistory } from "@/lib/rates";
import { RateChart } from "./rate-chart";

export const RANGES = [
  { days: 30, label: "1 mj." },
  { days: 90, label: "3 mj." },
  { days: 365, label: "1 god." },
] as const;
export const PAIR_OPTIONS: ChartPair[] = ["EURUSD", "USDBAM"];

/** "1.745" -> "1,7450": always 4 decimals, Croatian decimal comma. */
const hr = (rate: string) => {
  const [int, frac = ""] = roundRate(rate, 4).split(".");
  return `${int},${frac.padEnd(4, "0")}`;
};
const fmtDay = (iso: string) => iso.split("-").reverse().join(". ") + ".";

/**
 * Async Server Component, rendered inside <Suspense>: balances show immediately and this
 * streams in when the (cached) FX data is ready. If the FX API is down, only this card degrades.
 */
export async function RatesSection({ pair, days }: { pair: ChartPair; days: number }) {
  const [from, to] = splitPair(pair);
  let board: Awaited<ReturnType<typeof getRateBoard>>;
  let history: Awaited<ReturnType<typeof getRateHistory>>;
  try {
    [board, history] = await Promise.all([getRateBoard(), getRateHistory(from, to, days)]);
  } catch (e) {
    if (!(e instanceof FxUnavailableError)) throw e;
    return (
      <section className="card">
        <h2>Tečajna lista</h2>
        <p className="muted">Tečajna lista trenutno nije dostupna. Prijenosi EUR ↔ BAM rade i dalje (fiksni tečaj).</p>
      </section>
    );
  }

  const href = (p: ChartPair, d: number) => `/dashboard?pair=${p}&range=${d}` as Route;

  return (
    <section className="rates-grid">
      <article className="card">
        <h2>Tečajna lista</h2>
        <p className="muted small">ECB, {fmtDay(board.date)} · 1 jedinica prve valute u drugoj</p>
        <table className="board">
          <tbody>
            {board.rows.map((r) => (
              <tr key={r.from + r.to}>
                <td className="muted nowrap">
                  {r.from}/{r.to}
                </td>
                <td className="num nowrap">
                  <strong>{hr(r.rate)}</strong>
                </td>
                <td className="num nowrap small">
                  {r.pegged ? (
                    <span className="muted">fiksni</span>
                  ) : r.changePct!.startsWith("-") ? (
                    <span className="negative">▼ {r.changePct!.slice(1).replace(".", ",")} %</span>
                  ) : (
                    <span className="positive">▲ {r.changePct!.replace(".", ",")} %</span>
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
            <nav className="segmented" aria-label="Valutni par">
              {PAIR_OPTIONS.map((p) => (
                <Link key={p} href={href(p, days)} aria-current={p === pair ? "true" : undefined} scroll={false}>
                  {p.slice(0, 3)}/{p.slice(3)}
                </Link>
              ))}
            </nav>
            <nav className="segmented" aria-label="Razdoblje">
              {RANGES.map((r) => (
                <Link key={r.days} href={href(pair, r.days)} aria-current={r.days === days ? "true" : undefined} scroll={false}>
                  {r.label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
        <RateChart points={history} label={`1 ${from} u ${to}`} />
      </article>
    </section>
  );
}
