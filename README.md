# Ledger

A small multi-currency bank account: EUR, USD and BAM accounts, transfers with FX conversion at the daily ECB rate, a double-entry ledger, and (coming next) Stripe test-mode deposits with live balance updates.

Built to show how money should be handled in a web app, not just moved around.

> **Live demo:** _coming soon_ · login `demo@ledger.local` / `demo1234`

## What this demonstrates

**Correct money handling**
- Amounts are integers in minor units (cents), `BIGINT` in Postgres and `bigint` in TypeScript. No floats anywhere in the money path; JSON carries amounts as strings (`"amount_minor": "12345"`).
- **Double-entry bookkeeping.** Every transfer writes entries that sum to zero *per currency*. Balances are derived from the append-only ledger (`SUM(amount_minor)`), never stored and mutated.
- **Cross-currency transfers go through FX position accounts**, so both currencies stay balanced (see below).
- **Idempotency keys.** `POST /api/v1/transfers` requires an `Idempotency-Key` header. A retry returns the original result (`200`, `Idempotent-Replayed: true`); reusing a key with a different body returns `409`. Stripe deposits use the PaymentIntent id the same way, so a webhook delivered twice books once.
- **Concurrency safety.** Both accounts are locked (`SELECT … FOR NO KEY UPDATE`, in id order) before the balance check, so parallel requests can't overdraw. Tested with 5 concurrent transfers against a real Postgres.
- **Banker's rounding** (half-to-even) when converting, with fixed-point rates (10 decimals) in integer math.
- **BAM is pegged** to the euro (1 EUR = 1.95583 BAM by the currency board) and isn't published by the ECB, so it is derived, not fetched.

**Next.js App Router**
- Server Components read straight from the database (`/dashboard`).
- Server Actions for login and transfers, with the idempotency key generated per form render.
- Route Handlers as a versioned REST API (`/api/v1/*`).
- `proxy.ts` (Next.js 16's new name for `middleware.ts`) as the auth gate; every data access re-checks the session too.

**Infrastructure**
- PostgreSQL + Drizzle ORM with checked-in SQL migrations.
- Docker Compose: app, Postgres, a one-off migrate/seed job, optional Redis.
- Vitest: unit tests for money math, integration tests for the ledger against real Postgres.
- GitHub Actions: typecheck, migration drift check, tests, build, Docker image.

## Architecture

```mermaid
flowchart LR
  B[Browser] -->|Server Actions / RSC| N[Next.js app]
  C[API client] -->|REST /api/v1| N
  S[Stripe] -->|webhook, signed| N
  N --> P[(PostgreSQL<br/>double-entry ledger)]
  N -->|cached 1h| F[Frankfurter<br/>ECB rates]
  N -. SSE .-> B
```

## The ledger model

```
users ─┬─ accounts (user)        EUR / USD / BAM per user
       │  accounts (system)      external:EUR, fx:EUR, … (the other side of the books)
       └─ transfers              one business event; unique (user_id, idempotency_key)
             └─ ledger_entries   signed amounts; append-only
```

Transfer of 100.00 EUR → USD at 1.0834:

| account        | amount_minor | currency |
|----------------|-------------:|----------|
| user EUR       |      −10000  | EUR      |
| fx:EUR         |      +10000  | EUR      |
| fx:USD         |      −10834  | USD      |
| user USD       |      +10834  | USD      |

EUR sums to 0, USD sums to 0. Same-currency transfers need only two entries. A Stripe deposit is `external:EUR −X / user EUR +X`.

## Run locally

```bash
cp .env.example .env            # set SESSION_SECRET (openssl rand -base64 48)
docker compose up --build       # app on http://localhost:3000
```

Without Docker for the app:

```bash
docker compose up -d db
npm install
npm run db:migrate && npm run db:seed
npm run dev
```

Tests (integration tests need a throwaway database):

```bash
DATABASE_URL=postgres://ledger:ledger@localhost:5432/ledger_test npm test
```

## REST API

All endpoints need the session cookie (log in via `/login`). Errors look like `{"error": {"code": "INSUFFICIENT_FUNDS", "message": "…"}}`.

| Method | Path | Notes |
|--------|------|-------|
| GET  | `/api/v1/accounts` | Accounts with balances |
| GET  | `/api/v1/transactions?accountId=…&page=1&pageSize=20&from=…&to=…` | Add `&format=csv` for export |
| POST | `/api/v1/transfers` | Header `Idempotency-Key`; body `{from_account_id, to_account_id, amount_minor, description?}` |
| GET  | `/api/v1/rates?from=EUR&to=USD` | ECB rate via Frankfurter, cached 1h |
| GET  | `/api/health` | Public; checks DB |

```bash
curl -X POST http://localhost:3000/api/v1/transfers \
  -H "Idempotency-Key: $(uuidgen)" -H "Content-Type: application/json" \
  -b "ledger_session=…" \
  -d '{"from_account_id":"…","to_account_id":"…","amount_minor":"10000"}'
```

## Roadmap

- [x] Schema, double-entry ledger, auth, Docker Compose
- [x] Transfers with FX conversion and idempotency, REST API, CSV export
- [ ] Transactions page with filters and pagination
- [ ] Rate history chart (Frankfurter time series), optional Redis cache
- [ ] Stripe test-mode deposits: Checkout/PaymentIntent, webhook with signature verification
- [ ] Live balance updates over SSE when a deposit lands
- [ ] Deploy to Hetzner (Docker Compose + Caddy for TLS)

## Project layout

```
src/
  app/            pages, Server Actions, Route Handlers (/api/v1/*)
  db/             Drizzle schema, migrate + seed scripts
  lib/            money math, rates, session (no DB access)
  server/         ledger service (transfers, deposits, balances), API helpers
  proxy.ts        auth gate
drizzle/          generated SQL migrations
tests/            Vitest unit + integration tests
```
