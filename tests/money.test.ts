import { describe, expect, it } from "vitest";
import { formatMinorPlain } from "@/lib/csv";
import {
  convertMinor,
  crossRate,
  divRoundHalfEven,
  formatMoney,
  parseAmount,
  rateToScaled,
  scaledToRate,
} from "@/lib/money";

describe("parseAmount", () => {
  it("parses decimals into minor units", () => {
    expect(parseAmount("12.34", "EUR")).toBe(1234n);
    expect(parseAmount("12.3", "EUR")).toBe(1230n);
    expect(parseAmount("12", "EUR")).toBe(1200n);
    expect(parseAmount("0.01", "USD")).toBe(1n);
  });

  it("does not suffer from float errors", () => {
    // 0.1 + 0.2 !== 0.3 in floats; in minor units it's exact
    expect(parseAmount("0.10", "EUR") + parseAmount("0.20", "EUR")).toBe(parseAmount("0.30", "EUR"));
    expect(parseAmount("90071992547409.93", "EUR")).toBe(9007199254740993n); // > Number.MAX_SAFE_INTEGER
  });

  it("rejects invalid input instead of guessing", () => {
    expect(() => parseAmount("1.234", "EUR")).toThrow(/Too many decimals/);
    expect(() => parseAmount("-5", "EUR")).toThrow();
    expect(() => parseAmount("1,50", "EUR")).toThrow();
    expect(() => parseAmount("abc", "EUR")).toThrow();
  });
});

describe("divRoundHalfEven (banker's rounding)", () => {
  it.each([
    [5n, 2n, 2n], // 2.5 -> 2
    [7n, 2n, 4n], // 3.5 -> 4
    [-5n, 2n, -2n],
    [-7n, 2n, -4n],
    [10n, 3n, 3n],
    [11n, 3n, 4n], // 3.67 -> 4
  ])("%s / %s = %s", (n, d, q) => expect(divRoundHalfEven(n, d)).toBe(q));
});

describe("convertMinor", () => {
  it("converts with a decimal rate", () => {
    expect(convertMinor(10000n, "1.0834", "EUR", "USD")).toBe(10834n); // 100.00 EUR -> 108.34 USD
  });

  it("uses the fixed BAM peg", () => {
    expect(convertMinor(10000n, "1.95583", "EUR", "BAM")).toBe(19558n); // 195.583 -> 195.58
  });

  it("rounds half to even at the cent", () => {
    expect(convertMinor(1n, "0.5", "EUR", "USD")).toBe(0n); // 0.5 cent -> 0
    expect(convertMinor(3n, "0.5", "EUR", "USD")).toBe(2n); // 1.5 cent -> 2
  });

  it("is identity for same currency", () => {
    expect(convertMinor(123n, "9.99", "EUR", "EUR")).toBe(123n);
  });
});

describe("rates", () => {
  it("round-trips scaled rates", () => {
    expect(scaledToRate(rateToScaled("1.0834"))).toBe("1.0834");
    expect(scaledToRate(rateToScaled("2"))).toBe("2");
  });

  it("derives a cross rate via EUR", () => {
    // USD->BAM = (BAM per EUR) / (USD per EUR)
    const usdBam = scaledToRate(crossRate(rateToScaled("1.95583"), rateToScaled("1.0834")));
    expect(usdBam).toBe("1.8052704449");
  });
});

describe("formatting", () => {
  it("formats for CSV without locale", () => {
    expect(formatMinorPlain(123456n, "EUR")).toBe("1234.56");
    expect(formatMinorPlain(-5n, "EUR")).toBe("-0.05");
  });

  it("formats for display in hr-HR", () => {
    expect(formatMoney(123456n, "EUR").replace(/\s/g, " ")).toBe("1.234,56 €");
  });
});
