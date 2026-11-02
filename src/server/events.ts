import postgres from "postgres";
import { LEDGER_CHANNEL } from "./ledger";

/**
 * Fan-out of Postgres NOTIFY to SSE connections.
 *
 * One LISTEN connection per server process (not per browser tab); each notification
 * carries a user id and wakes only that user's subscribers. Because the NOTIFY is sent
 * inside the posting transaction, this works across processes: the webhook can run on
 * one instance and the user's SSE stream on another.
 *
 * LISTEN needs a direct session, not a transaction-mode pooler (PgBouncer, Neon's
 * "-pooler" host), hence DATABASE_URL_UNPOOLED when it is set.
 */
type Listener = () => void;
type State = { listeners: Map<string, Set<Listener>>; ready: Promise<unknown> | null };

// Survive Next.js dev hot reloads without opening a new LISTEN connection each time.
const g = globalThis as unknown as { ledgerEvents?: State };
const state: State = (g.ledgerEvents ??= { listeners: new Map(), ready: null });

function ensureListening() {
  if (!state.ready) {
    const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    const sql = postgres(url, { max: 1, onnotice: () => {} });
    // postgres-js re-subscribes automatically if the connection drops.
    state.ready = sql
      .listen(LEDGER_CHANNEL, (userId) => {
        for (const fn of state.listeners.get(userId) ?? []) fn();
      })
      .catch((e) => {
        state.ready = null; // next subscriber tries again
        void sql.end();
        throw e;
      });
  }
  return state.ready;
}

/** Calls `fn` whenever one of the user's balances changes. Returns an unsubscribe function. */
export async function subscribe(userId: string, fn: Listener): Promise<() => void> {
  await ensureListening();
  let set = state.listeners.get(userId);
  if (!set) state.listeners.set(userId, (set = new Set()));
  set.add(fn);
  return () => {
    set.delete(fn);
    if (set.size === 0) state.listeners.delete(userId);
  };
}
