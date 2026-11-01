import { setLocale } from "./actions";
import { LOCALES, type Locale } from "./config";

/** Plain form + Server Action: works without client JS and stays on the current page. */
export function LanguageSwitcher({ locale, label }: { locale: Locale; label: string }) {
  return (
    <form action={setLocale} className="segmented lang-switcher" aria-label={label}>
      {LOCALES.map((l) => (
        <button
          key={l}
          name="locale"
          value={l}
          aria-current={l === locale ? "true" : undefined}
          lang={l}
          title={l === "hr" ? "Hrvatski" : "English"}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </form>
  );
}
