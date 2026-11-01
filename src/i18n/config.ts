/** Shared by server and client code (no server-only imports here). */
export const LOCALES = ["hr", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "hr";
export const LOCALE_COOKIE = "ledger_locale";

/** BCP 47 tag for Intl (numbers, money, dates). en-GB: day-first dates, € before the amount. */
export const INTL_LOCALE: Record<Locale, string> = { hr: "hr-HR", en: "en-GB" };

export const isLocale = (v: unknown): v is Locale => (LOCALES as readonly unknown[]).includes(v);

/** Pick a locale from an Accept-Language header, e.g. "en-US,en;q=0.9,hr;q=0.8". */
export function negotiateLocale(acceptLanguage: string | null): Locale {
  const tags = (acceptLanguage ?? "")
    .split(",")
    .map((part) => {
      const [tag, q] = part.trim().split(";q=");
      return { lang: tag.toLowerCase().split("-")[0], q: q ? Number(q) : 1 };
    })
    .filter((t) => t.lang && !Number.isNaN(t.q))
    .sort((a, b) => b.q - a.q);
  return tags.map((t) => t.lang).find(isLocale) ?? DEFAULT_LOCALE;
}
