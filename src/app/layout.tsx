import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ledger",
  description: "Multi-currency ledger demo: double-entry bookkeeping, FX and payments",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="hr">
      <body>{children}</body>
    </html>
  );
}
