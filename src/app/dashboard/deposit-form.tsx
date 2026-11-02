"use client";

import { useActionState, useState } from "react";
import type { Dictionary } from "@/i18n/dictionaries";
import { depositAction, type DepositState } from "./actions";

type AccountOption = { id: string; name: string; currency: string };

export function DepositForm({ accounts, t }: { accounts: AccountOption[]; t: Dictionary["deposit"] }) {
  const [state, action, pending] = useActionState<DepositState, FormData>(depositAction, {});
  // One key per form render; on success the page navigates away to Stripe, so it never needs resetting.
  const [key] = useState(() => crypto.randomUUID());
  const [amount, setAmount] = useState("");

  return (
    <form action={action} className="card stack">
      <h2>{t.title}</h2>
      <input type="hidden" name="idempotencyKey" value={key} />
      <div className="row">
        <label>
          {t.account}
          <select name="accountId" defaultValue={accounts[0]?.id}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>
            ))}
          </select>
        </label>
        <label>
          {t.amount}
          <input
            name="amount"
            inputMode="decimal"
            placeholder="50.00"
            pattern="\d+(\.\d{1,2})?"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
      </div>
      <p className="muted small">{t.testCard}</p>
      {state.error && <p className="error">{t.errors[state.error]}</p>}
      <button disabled={pending || amount.trim() === ""}>{pending ? t.submitting : t.submit}</button>
    </form>
  );
}
