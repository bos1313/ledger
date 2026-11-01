import { getI18n } from "@/i18n/server";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const { t } = await getI18n();
  return (
    <main className="center">
      <LoginForm next={next} t={t.login} />
    </main>
  );
}
