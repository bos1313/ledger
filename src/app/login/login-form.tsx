"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  return (
    <form action={action} className="card stack">
      <h1>Ledger</h1>
      <label>
        Email
        <input name="email" type="email" autoComplete="email" defaultValue="demo@ledger.local" required />
      </label>
      <label>
        Lozinka
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      {next && <input type="hidden" name="next" value={next} />}
      {state.error && <p className="error">{state.error}</p>}
      <button disabled={pending}>{pending ? "Prijava…" : "Prijava"}</button>
      <p className="muted">Demo: demo@ledger.local / demo1234</p>
    </form>
  );
}
