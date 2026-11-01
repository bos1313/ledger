import { describe, expect, it } from "vitest";
import { crossFromEur, eurRates, isPegged, pairHistory, parseTimeSeries, percentChange, roundRate } from "@/lib/fx";

describe("fx", () => {
  const rates = eurRates("1.0834");

  it("derives every pair from EUR→USD and the BAM peg", () => {
    expect(crossFromEur(rates, "EUR", "USD")).toBe("1.0834");
    expect(crossFromEur(rates, "EUR", "BAM")).toBe("1.95583");
    expect(crossFromEur(rates, "BAM", "EUR")).toBe("0.5112918812");
    expect(crossFromEur(rates, "USD", "BAM")).toBe("1.8052704449");
    expect(crossFromEur(rates, "USD", "USD")).toBe("1");
  });

  it("knows which pairs are fixed by law", () => {
    expect(isPegged("EUR", "BAM")).toBe(true);
    expect(isPegged("BAM", "EUR")).toBe(true);
    expect(isPegged("EUR", "USD")).toBe(false);
    expect(isPegged("USD", "BAM")).toBe(false);
  });

  it("parses a Frankfurter time series, sorted, as strings", () => {
    const body = {
      base: "EUR",
      start_date: "2026-10-28",
      end_date: "2026-10-30",
      rates: { "2026-10-30": { USD: 1.09 }, "2026-10-28": { USD: 1.0834 }, "2026-10-29": { USD: 1.085 } },
    };
    const series = parseTimeSeries(body);
    expect(series.map((p) => p.date)).toEqual(["2026-10-28", "2026-10-29", "2026-10-30"]);
    expect(series[0].usdPerEur).toBe("1.0834000000");
    expect(pairHistory(series, "USD", "EUR")[2].rate).toBe("0.9174311927");
    expect(() => parseTimeSeries({ error: "nope" })).toThrow();
  });

  it("computes day-over-day change without floats", () => {
    expect(percentChange("1.0900", "1.0800")).toBe("0.93");
    expect(percentChange("1.0800", "1.0900")).toBe("-0.92");
    expect(percentChange("1.08", "1.08")).toBe("0.00");
  });

  it("rounds for display only", () => {
    expect(roundRate("0.5112918812", 4)).toBe("0.5113");
    expect(roundRate("1.95583", 4)).toBe("1.9558");
  });
});
