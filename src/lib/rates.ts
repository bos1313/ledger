import "server-only";
import { type Currency, RATE_SCALE } from "./money";
import {
  BOARD_PAIRS,
  crossFromEur,
  eurRates,
  isPegged,
  pairHistory,
  parseTimeSeries,
  percentChange,
  type RatePoint,
  type UsdPoint,
} from "./fx";

/**
 * Exchange rates from the ECB via Frankfurter (free, no API key). The ECB publishes once per
 * working day around 16:00 CET, so responses are cached in Next's data cache (shared by all
 * users) instead of being fetched per request.
 */
const FX_API_URL = process.env.FX_API_URL ?? "https://api.frankfurter.app";
export { BAM_PER_EUR } from "./fx";

export class FxUnavailableError extends Error {}

async function fetchJson(path: string, revalidate: number): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${FX_API_URL}${path}`, {
      next: { revalidate, tags: ["fx-rates"] },
      signal: AbortSignal.timeout(5000),
    });
  } catch (e) {
    throw new FxUnavailableError(`FX API unreachable: ${String(e)}`);
  }
  if (!res.ok) throw new FxUnavailableError(`FX API responded ${res.status}`);
  return res.json();
}

/** Latest EUR→USD; EUR and BAM are fixed. Cached for 1 hour. */
export async function getEurRates() {
  const body = (await fetchJson("/latest?base=EUR&symbols=USD", 3600)) as {
    date: string;
    rates: Record<string, number>;
  };
  if (!(body?.rates?.USD > 0)) throw new FxUnavailableError("Unexpected FX response");
  return { date: body.date, rates: eurRates(body.rates.USD.toFixed(RATE_SCALE)) };
}

/** Units of `to` per 1 unit of `from`, as a decimal string. */
export async function getRate(from: Currency, to: Currency): Promise<{ rate: string; date: string }> {
  const today = new Date().toISOString().slice(0, 10);
  if (from === to) return { rate: "1", date: today };
  // EUR<->BAM is fixed by law; no network call needed.
  if (isPegged(from, to)) return { rate: crossFromEur(eurRates("1"), from, to), date: today };
  const { date, rates } = await getEurRates();
  return { rate: crossFromEur(rates, from, to), date };
}

/** Daily EUR→USD for the last `days` calendar days (working days only). Cached for 6 hours. */
export async function getUsdHistory(days: number): Promise<UsdPoint[]> {
  const start = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  return parseTimeSeries(await fetchJson(`/${start}..?base=EUR&symbols=USD`, 6 * 3600));
}

export async function getRateHistory(from: Currency, to: Currency, days: number): Promise<RatePoint[]> {
  return pairHistory(await getUsdHistory(days), from, to);
}

export type BoardRow = {
  from: Currency;
  to: Currency;
  rate: string;
  /** Day-over-day change in percent, e.g. "-0.42"; null for pegged pairs. */
  changePct: string | null;
  pegged: boolean;
};

/** Rate board for the dashboard: latest rate and day-over-day change for each pair. */
export async function getRateBoard(): Promise<{ date: string; rows: BoardRow[] }> {
  const series = await getUsdHistory(10); // enough to always contain two working days
  if (series.length === 0) throw new FxUnavailableError("No FX data");
  const latest = series[series.length - 1];
  const previous = series[series.length - 2];
  const rows = BOARD_PAIRS.map(([from, to]) => {
    const pegged = isPegged(from, to);
    const rate = crossFromEur(eurRates(latest.usdPerEur), from, to);
    const prev = previous && !pegged ? crossFromEur(eurRates(previous.usdPerEur), from, to) : null;
    return { from, to, rate, pegged, changePct: prev ? percentChange(rate, prev) : null };
  });
  return { date: latest.date, rows };
}
