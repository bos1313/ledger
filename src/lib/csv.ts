import { EXPONENT, type Currency } from "./money";

/** 123456n EUR -> "1234.56" (machine-readable, no locale, no thousands separator). */
export function formatMinorPlain(minor: bigint, currency: Currency): string {
  const exp = EXPONENT[currency];
  const base = 10n ** BigInt(exp);
  const abs = minor < 0n ? -minor : minor;
  return `${minor < 0n ? "-" : ""}${abs / base}.${(abs % base).toString().padStart(exp, "0")}`;
}
