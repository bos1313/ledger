"use client";

import { useActionState } from "react";
import type { Dictionary } from "@/i18n/dictionaries";
import { login, type LoginState } from "./actions";

export function LoginForm({ next, t }: { next?: string; t: Dictionary["login"] }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  return (
    <form action={action} className="card stack">
      <h1>Ledger</h1>
      <label>
        {t.email}
        <input name="email" type="email" autoComplete="email" defaultValue="demo@ledger.local" required />
      </label>
      <label>
        {t.password}
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      {next && <input type="hidden" name="next" value={next} />}
      {state.error && <p className="error">{t[state.error]}</p>}
      <button disabled={pending}>{pending ? t.submitting : t.submit}</button>
      <p className="muted">{t.demo}</p>
    </form>
  );
}
