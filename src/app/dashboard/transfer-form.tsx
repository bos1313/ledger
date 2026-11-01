"use client";

import { useActionState, useEffect, useState } from "react";
import { transferAction, type TransferState } from "./actions";

type AccountOption = { id: string; name: string; currency: string };

export function TransferForm({ accounts }: { accounts: AccountOption[] }) {
  const [state, action, pending] = useActionState<TransferState, FormData>(transferAction, {});
  // New key after every successful transfer; the same key is reused if the user retries a failed submit.
  const [key, setKey] = useState(() => crypto.randomUUID());
  useEffect(() => {
    if (state.ok) setKey(crypto.randomUUID());
  }, [state]);

  return (
    <form action={action} className="card stack">
      <h2>Prijenos</h2>
      <input type="hidden" name="idempotencyKey" value={key} />
      <div className="row">
        <label>
          S računa
          <select name="fromAccountId" defaultValue={accounts[0]?.id}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>
            ))}
          </select>
        </label>
        <label>
          Na račun
          <select name="toAccountId" defaultValue={accounts[1]?.id}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Iznos (u valuti izvornog računa)
        <input name="amount" inputMode="decimal" placeholder="100.00" pattern="\d+(\.\d{1,2})?" required />
      </label>
      <label>
        Opis
        <input name="description" maxLength={140} />
      </label>
      {state.error && <p className="error">{state.error}</p>}
      {state.ok && <p className="success">Prijenos proknjižen.</p>}
      <button disabled={pending}>{pending ? "Knjiženje…" : "Prenesi"}</button>
    </form>
  );
}
