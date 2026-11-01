import { db } from "@/db";
import { json, withApi } from "@/server/api";
import { listAccountsWithBalances } from "@/server/ledger";

/** GET /api/v1/accounts — the user's accounts with current balances. */
export const GET = withApi(async (_req, { userId }) => {
  const accounts = await listAccountsWithBalances(db, userId);
  return json({
    data: accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency, balance_minor: a.balanceMinor })),
  });
});
