import { EXPONENT, type Currency } from "./money";

/** 123456n EUR -> "1234.56" (machine-readable, no locale, no thousands separator). */
export function formatMinorPlain(minor: bigint, currency: Currency): string {
  const exp = EXPONENT[currency];
  const base = 10n ** BigInt(exp);
  const abs = minor < 0n ? -minor : minor;
  return `${minor < 0n ? "-" : ""}${abs / base}.${(abs % base).toString().padStart(exp, "0")}`;
}

const cell = (v: string) => (/[",\n;]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);

type CsvEntry = {
  createdAt: Date;
  kind: string;
  description: string | null;
  amountMinor: bigint;
  balanceAfterMinor: bigint;
  currency: Currency;
  rate: string;
  transferId: string;
};

/** RFC 4180 CSV with a UTF-8 BOM so Excel shows č/ć/š correctly. Amounts are plain decimals. */
export function entriesToCsv(rows: CsvEntry[]): string {
  const header = ["date", "type", "description", "amount", "balance_after", "currency", "rate", "transfer_id"];
  const lines = rows.map((r) =>
    [
      r.createdAt.toISOString(),
      r.kind,
      r.description ?? "",
      formatMinorPlain(r.amountMinor, r.currency),
      formatMinorPlain(r.balanceAfterMinor, r.currency),
      r.currency,
      r.rate,
      r.transferId,
    ]
      .map(cell)
      .join(","),
  );
  return "﻿" + [header.join(","), ...lines].join("\r\n") + "\r\n";
}
