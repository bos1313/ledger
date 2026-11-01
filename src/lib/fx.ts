/**
 * Pure FX helpers (no I/O, safe to unit-test and import anywhere).
 * All rates are decimal strings; arithmetic is fixed-point bigint, never float.
 */
import { type Currency, RATE_SCALE, crossRate, divRoundHalfEven, rateToScaled, scaledToRate } from "./money";

/** BAM is pegged by the currency board: exactly 1 EUR = 1.95583 BAM. Not published by the ECB. */
export const BAM_PER_EUR = "1.95583";

/** Units of each currency per 1 EUR. Only USD comes from the ECB; EUR and BAM are fixed. */
export type EurRates = Record<Currency, string>;

export function eurRates(usdPerEur: string): EurRates {
  return { EUR: "1", USD: usdPerEur, BAM: BAM_PER_EUR };
}

/** Units of `to` per 1 unit of `from`, derived via EUR: (to per EUR) / (from per EUR). */
export function crossFromEur(rates: EurRates, from: Currency, to: Currency): string {
  if (from === to) return "1";
  return scaledToRate(crossRate(rateToScaled(rates[to]), rateToScaled(rates[from])));
}

/** True when both currencies are fixed against each other (EUR/BAM), so no market data is needed. */
export const isPegged = (from: Currency, to: Currency) =>
  from !== "USD" && to !== "USD";

/** Pairs shown on the dashboard. EUR/BAM is listed but never charted: it is a flat line by law. */
export const BOARD_PAIRS: ReadonlyArray<readonly [Currency, Currency]> = [
  ["EUR", "USD"],
  ["USD", "BAM"],
  ["EUR", "BAM"],
];
export const CHART_PAIRS = ["EURUSD", "USDEUR", "USDBAM", "BAMUSD"] as const;
export type ChartPair = (typeof CHART_PAIRS)[number];
export const splitPair = (p: ChartPair) => [p.slice(0, 3), p.slice(3)] as [Currency, Currency];

export type UsdPoint = { date: string; usdPerEur: string };
export type RatePoint = { date: string; rate: string };

/** Turn the ECB's EUR→USD series into any pair's series. */
export function pairHistory(series: UsdPoint[], from: Currency, to: Currency): RatePoint[] {
  return series.map((p) => ({ date: p.date, rate: crossFromEur(eurRates(p.usdPerEur), from, to) }));
}

/**
 * Parse a Frankfurter time-series body:
 * { base: "EUR", rates: { "2026-10-30": { "USD": 1.0834 }, ... } }
 * JSON numbers are converted to fixed decimal strings immediately.
 */
export function parseTimeSeries(body: unknown): UsdPoint[] {
  const rates = (body as { rates?: Record<string, Record<string, number>> })?.rates;
  if (!rates || typeof rates !== "object") throw new Error("Unexpected FX response");
  return Object.entries(rates)
    .filter(([, r]) => typeof r?.USD === "number" && r.USD > 0)
    .map(([date, r]) => ({ date, usdPerEur: r.USD.toFixed(RATE_SCALE) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Percentage change, rounded to 2 decimals, as a string like "-0.42". */
export function percentChange(latest: string, previous: string): string {
  const a = rateToScaled(latest);
  const b = rateToScaled(previous);
  const hundredths = divRoundHalfEven((a - b) * 10_000n, b); // percent × 100
  const sign = hundredths < 0n ? "-" : "";
  const abs = hundredths < 0n ? -hundredths : hundredths;
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

/** Round a rate for display only (stored/booked rates keep full precision). */
export function roundRate(rate: string, decimals: number): string {
  const drop = 10n ** BigInt(RATE_SCALE - decimals);
  return scaledToRate(divRoundHalfEven(rateToScaled(rate), drop) * drop);
}

/** Display a rate in the UI locale with fixed decimals ("1,7450" / "1.7450"). Display only. */
export function formatRate(rate: string | number, intl: string, decimals = 4): string {
  const n = typeof rate === "number" ? rate : Number(roundRate(rate, decimals));
  return n.toLocaleString(intl, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** "2026-10-30" -> "30. 10. 2026." (hr) / "30/10/2026" (en-GB). Calendar date, no time zone shift. */
export function formatIsoDate(iso: string, intl: string, opts: Intl.DateTimeFormatOptions = { dateStyle: "short" }): string {
  return new Intl.DateTimeFormat(intl, { ...opts, timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}
