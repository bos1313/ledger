/**
 * Money helpers. Rule #1: amounts are always integers in minor units (cents),
 * represented as `bigint` in code and `BIGINT` in Postgres. Never `number`/float.
 */

export const CURRENCIES = ["EUR", "USD", "BAM"] as const;
export type Currency = (typeof CURRENCIES)[number];

/** ISO 4217 minor-unit exponent (EUR/USD/BAM all use 2 decimals). */
export const EXPONENT: Record<Currency, number> = { EUR: 2, USD: 2, BAM: 2 };

export function isCurrency(value: string): value is Currency {
  return (CURRENCIES as readonly string[]).includes(value);
}

/**
 * Parse a user-entered decimal string ("12.5", "1 234,56" is NOT accepted) into minor units.
 * Rejects more decimals than the currency allows instead of silently rounding.
 */
export function parseAmount(input: string, currency: Currency): bigint {
  const s = input.trim();
  const exp = EXPONENT[currency];
  const match = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!match) throw new Error(`Invalid amount: "${input}"`);
  const [, whole, frac = ""] = match;
  if (frac.length > exp) throw new Error(`Too many decimals for ${currency}: "${input}"`);
  return BigInt(whole) * 10n ** BigInt(exp) + BigInt(frac.padEnd(exp, "0") || "0");
}

/** Format minor units for display, e.g. 123456n EUR -> "1.234,56 €" (hr-HR). */
export function formatMoney(minor: bigint, currency: Currency, locale = "hr-HR"): string {
  const exp = EXPONENT[currency];
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const base = 10n ** BigInt(exp);
  // Build the decimal string ourselves so no precision is lost for large values.
  const decimal = `${neg ? "-" : ""}${abs / base}.${(abs % base).toString().padStart(exp, "0")}`;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: exp,
  }).format(decimal as unknown as number); // Intl accepts decimal strings (ES2023)
}

/* ---------- Fixed-point rates ---------- */

/** Rates are carried as decimal strings with up to RATE_SCALE fractional digits. */
export const RATE_SCALE = 10;
const RATE_BASE = 10n ** BigInt(RATE_SCALE);

/** "1.0834" -> 10834000000n (scaled by 10^RATE_SCALE). */
export function rateToScaled(rate: string): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(rate.trim());
  if (!match) throw new Error(`Invalid rate: "${rate}"`);
  const [, whole, frac = ""] = match;
  const scaled = BigInt(whole) * RATE_BASE + BigInt(frac.slice(0, RATE_SCALE).padEnd(RATE_SCALE, "0"));
  if (scaled <= 0n) throw new Error("Rate must be positive");
  return scaled;
}

export function scaledToRate(scaled: bigint): string {
  const s = `${scaled / RATE_BASE}.${(scaled % RATE_BASE).toString().padStart(RATE_SCALE, "0")}`;
  return s.replace(/\.?0+$/, "");
}

/** Integer division with banker's rounding (round half to even). */
export function divRoundHalfEven(n: bigint, d: bigint): bigint {
  if (d === 0n) throw new Error("Division by zero");
  if (d < 0n) return divRoundHalfEven(-n, -d);
  const q = n / d; // truncates toward zero
  const r = n % d;
  const twice = 2n * (r < 0n ? -r : r);
  if (twice < d) return q;
  if (twice > d || q % 2n !== 0n) return n < 0n ? q - 1n : q + 1n;
  return q;
}

/**
 * Convert minor units from one currency to another.
 * `rate` = how many units of `to` for 1 unit of `from` (e.g. EUR->USD "1.0834").
 */
export function convertMinor(amount: bigint, rate: string, from: Currency, to: Currency): bigint {
  if (from === to) return amount;
  const expDiff = BigInt(EXPONENT[to] - EXPONENT[from]);
  const numerator = amount * rateToScaled(rate) * (expDiff >= 0n ? 10n ** expDiff : 1n);
  const denominator = RATE_BASE * (expDiff < 0n ? 10n ** -expDiff : 1n);
  return divRoundHalfEven(numerator, denominator);
}

/** Cross rate a/b, both scaled; result scaled. Used to derive USD->BAM via EUR. */
export function crossRate(aScaled: bigint, bScaled: bigint): bigint {
  return divRoundHalfEven(aScaled * RATE_BASE, bScaled);
}
