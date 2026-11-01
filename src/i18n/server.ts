import "server-only";
import { cookies, headers } from "next/headers";
import { INTL_LOCALE, LOCALE_COOKIE, type Locale, isLocale, negotiateLocale } from "./config";
import { dictionaries } from "./dictionaries";

/** The visitor's language: their explicit choice (cookie), else the browser's Accept-Language. */
export async function getLocale(): Promise<Locale> {
  const saved = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(saved)) return saved;
  return negotiateLocale((await headers()).get("accept-language"));
}

/** Everything a Server Component needs to render text, money and dates. */
export async function getI18n() {
  const locale = await getLocale();
  return { locale, intl: INTL_LOCALE[locale], t: dictionaries[locale] };
}
