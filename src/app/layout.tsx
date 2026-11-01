import type { Metadata } from "next";
import { LanguageSwitcher } from "@/i18n/language-switcher";
import { getI18n } from "@/i18n/server";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: "Ledger", description: t.meta.description };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale, t } = await getI18n();
  return (
    <html lang={locale}>
      <body>
        <div className="topbar">
          <LanguageSwitcher locale={locale} label={t.common.language} />
        </div>
        {children}
      </body>
    </html>
  );
}
