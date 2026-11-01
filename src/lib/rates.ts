import "server-only";
import { type Currency, RATE_SCALE, crossRate, rateToScaled, scaledToRate } from "./money";

/**
 * Exchange rates from the ECB via Frankfurter (free, no API key).
 *
 * BAM is NOT published by the ECB: it is pegged to the euro by the currency board
 * at exactly 1 EUR = 1.95583 BAM, so we derive it instead of fetching it.
 */
const FX_API_URL = process.env.FX_API_URL ?? "https://api.frankfurter.app";
export const BAM_PER_EUR = "1.95583";

export class FxUnavailableError extends Error {}

type EurRates = { date: string; rates: Record<Currency, string> };

/** Units of each currency per 1 EUR, cached by Next's data cache for 1 hour. */
export async function getEurRates(): Promise<EurRates> {
  const res = await fetch(`${FX_API_URL}/latest?base=EUR&symbols=USD`, {
    next: { revalidate: 3600, tags: ["fx-rates"] },
  });
  if (!res.ok) throw new FxUnavailableError(`FX API responded ${res.status}`);
  // JSON gives us a float like 1.0834; we immediately turn it into a fixed decimal string
  // and from then on only do integer (bigint) math with it.
  const body = (await res.json()) as { date: string; rates: Record<string, number> };
  return {
    date: body.date,
    rates: { EUR: "1", USD: body.rates.USD.toFixed(RATE_SCALE), BAM: BAM_PER_EUR },
  };
}

/** Units of `to` per 1 unit of `from`, as a decimal string. */
export async function getRate(from: Currency, to: Currency): Promise<{ rate: string; date: string }> {
  const today = new Date().toISOString().slice(0, 10);
  if (from === to) return { rate: "1", date: today };
  // EUR<->BAM is fixed by law; no network call needed.
  const pegged: Partial<Record<Currency, string>> = { EUR: "1", BAM: BAM_PER_EUR };
  if (pegged[from] && pegged[to]) {
    return { rate: scaledToRate(crossRate(rateToScaled(pegged[to]), rateToScaled(pegged[from]))), date: today };
  }
  const { date, rates } = await getEurRates().catch((e) => {
    throw e instanceof FxUnavailableError ? e : new FxUnavailableError(String(e));
  });
  // to/from via EUR: (to per EUR) / (from per EUR)
  const rate = crossRate(rateToScaled(rates[to]), rateToScaled(rates[from]));
  return { rate: scaledToRate(rate), date };
}
