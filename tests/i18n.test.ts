import { describe, expect, it } from "vitest";
import { negotiateLocale } from "@/i18n/config";
import { dictionaries, fmt } from "@/i18n/dictionaries";

/** Every key path in a nested object, e.g. "transfer.errors.NOT_FOUND". */
const keys = (o: object, prefix = ""): string[] =>
  Object.entries(o).flatMap(([k, v]) => (typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const get = (o: object, path: string) => path.split(".").reduce((x: any, k) => x[k], o) as string;

describe("i18n", () => {
  it("has the same keys in Croatian and English", () => {
    expect(keys(dictionaries.en)).toEqual(keys(dictionaries.hr));
  });

  it("uses the same placeholders in both languages and no empty strings", () => {
    for (const k of keys(dictionaries.hr)) {
      expect(placeholders(get(dictionaries.en, k)), k).toEqual(placeholders(get(dictionaries.hr, k)));
      expect(get(dictionaries.en, k).trim(), k).not.toBe("");
    }
  });

  it("fills placeholders", () => {
    expect(fmt("{first}–{last} od {total}", { first: 1, last: 20, total: 27 })).toBe("1–20 od 27");
    expect(fmt("{missing}", {})).toBe("{missing}");
  });

  it("negotiates the browser language, defaulting to Croatian", () => {
    expect(negotiateLocale("en-US,en;q=0.9")).toBe("en");
    expect(negotiateLocale("de-DE,de;q=0.9,en;q=0.5,hr;q=0.8")).toBe("hr");
    expect(negotiateLocale("hr-HR")).toBe("hr");
    expect(negotiateLocale("fr")).toBe("hr");
    expect(negotiateLocale(null)).toBe("hr");
  });
});
